import { prisma } from "@/lib/db";
import { encrypt, decrypt } from "@/lib/crypto";

const GRAPH_BASE = "https://graph.microsoft.com/v1.0";
const TOKEN_URL = `https://login.microsoftonline.com/${process.env.AZURE_AD_TENANT_ID}/oauth2/v2.0/token`;

export class CalendarUnavailableError extends Error {
  constructor(message = "Host's calendar connection needs to be reconnected") {
    super(message);
    this.name = "CalendarUnavailableError";
  }
}

/**
 * Exchanges a stored refresh token for a fresh access token.
 * Azure AD rotates refresh tokens on use, so we persist the new one too.
 * On failure (revoked consent, password reset, etc.) we mark the host's
 * refreshTokenStatus as 'revoked' so the dashboard can show a reconnect
 * banner and the public booking page can show "temporarily unavailable"
 * instead of a confusing 500.
 */
async function getAccessTokenForHost(hostUserId: string): Promise<string> {
  const user = await prisma.user.findUnique({ where: { id: hostUserId } });
  if (!user || !user.refreshTokenEnc || user.refreshTokenStatus === "revoked") {
    throw new CalendarUnavailableError();
  }

  const refreshToken = decrypt(user.refreshTokenEnc);

  const body = new URLSearchParams({
    client_id: process.env.AZURE_AD_CLIENT_ID!,
    client_secret: process.env.AZURE_AD_CLIENT_SECRET!,
    grant_type: "refresh_token",
    refresh_token: refreshToken,
    scope: "openid profile email offline_access Calendars.ReadWrite OnlineMeetings.ReadWrite User.Read",
  });

  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });

  if (!res.ok) {
    // Refresh token is dead - consent revoked, password changed, etc.
    await prisma.user.update({
      where: { id: hostUserId },
      data: { refreshTokenStatus: "revoked" },
    });
    throw new CalendarUnavailableError();
  }

  const data = await res.json();

  if (data.refresh_token) {
    await prisma.user.update({
      where: { id: hostUserId },
      data: { refreshTokenEnc: encrypt(data.refresh_token), refreshTokenStatus: "valid" },
    });
  }

  return data.access_token as string;
}

async function graphFetch(hostUserId: string, path: string, init: RequestInit = {}) {
  const accessToken = await getAccessTokenForHost(hostUserId);
  const res = await fetch(`${GRAPH_BASE}${path}`, {
    ...init,
    headers: {
      ...(init.headers ?? {}),
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
  });

  if (res.status === 401) {
    // Access token was rejected outright (rare, but treat like a revoke signal)
    await prisma.user.update({
      where: { id: hostUserId },
      data: { refreshTokenStatus: "revoked" },
    });
    throw new CalendarUnavailableError();
  }

  return res;
}

export interface DirectoryUser {
  name: string;
  email: string;
}

/**
 * Searches the tenant directory by display name, using the organizer's own
 * token (delegated User.ReadBasic.All - granted via admin consent). This
 * lets the organizer find any teammate by typing their name, without that
 * teammate ever needing to have signed into this app themselves.
 */
export async function searchDirectory(organizerUserId: string, query: string): Promise<DirectoryUser[]> {
  const safeQuery = query.replace(/"/g, "");
  const path = `/users?$search="displayName:${encodeURIComponent(safeQuery)}"&$select=displayName,mail,userPrincipalName&$top=10&$count=true`;

  const res = await graphFetch(organizerUserId, path, {
    method: "GET",
    headers: { ConsistencyLevel: "eventual" },
  });

  if (!res.ok) {
    throw new Error(`Graph directory search failed: ${res.status} ${await res.text()}`);
  }

  const data = await res.json();
  return (data.value ?? [])
    .map((u: any) => ({ name: u.displayName as string, email: (u.mail || u.userPrincipalName) as string }))
    .filter((u: any) => !!u.email && !!u.name);
}

export interface BusyBlock {
  start: string; // ISO, UTC
  end: string; // ISO, UTC
}

/**
 * Calls Graph getSchedule for a single mailbox and returns its busy blocks
 * within [rangeStart, rangeEnd] (both ISO UTC strings). Kept for internal
 * use; getMultiUserBusyBlocks below is what the group-booking flow uses.
 */
export async function getBusyBlocks(
  hostUserId: string,
  hostMsUserId: string,
  rangeStart: string,
  rangeEnd: string
): Promise<BusyBlock[]> {
  const result = await getMultiUserBusyBlocks(hostUserId, hostMsUserId, [hostMsUserId], rangeStart, rangeEnd);
  return result[hostMsUserId] ?? [];
}

/**
 * Calls Graph getSchedule ONCE for multiple mailboxes (any mix of the
 * organizer + internal teammates in the same tenant) and returns each
 * person's busy blocks. Used by the group-booking flow so picking N
 * attendees costs one Graph call, not N.
 *
 * mailboxIds should be Graph user ids or UPNs/emails - Graph accepts either
 * for the `schedules` array. The call runs with the organizing host's own
 * token; default free/busy sharing within a tenant means this works for any
 * teammate without them needing to have signed into this app themselves -
 * though in this app every internal attendee IS a signed-in User row anyway,
 * since only allowlisted team members with connected calendars can be
 * selected as internal attendees in the first place.
 */
export async function getMultiUserBusyBlocks(
  organizerUserId: string,
  organizerMsUserId: string,
  mailboxIds: string[],
  rangeStart: string,
  rangeEnd: string
): Promise<Record<string, BusyBlock[]>> {
  const res = await graphFetch(organizerUserId, `/users/${organizerMsUserId}/calendar/getSchedule`, {
    method: "POST",
    body: JSON.stringify({
      schedules: mailboxIds,
      startTime: { dateTime: rangeStart, timeZone: "UTC" },
      endTime: { dateTime: rangeEnd, timeZone: "UTC" },
      availabilityViewInterval: 30,
    }),
  });

  if (!res.ok) {
    throw new Error(`Graph getSchedule failed: ${res.status} ${await res.text()}`);
  }

  const data = await res.json();
  const result: Record<string, BusyBlock[]> = {};

  for (const schedule of data.value ?? []) {
    const items = schedule.scheduleItems ?? [];
    result[schedule.scheduleId] = items
      .filter((item: any) => item.status !== "free")
      .map((item: any) => ({
        start: item.start.dateTime + "Z",
        end: item.end.dateTime + "Z",
      }));
  }

  return result;
}

export interface EventAttendee {
  name: string;
  email: string;
}

/**
 * Creates the Outlook event + Teams meeting for a confirmed booking, with
 * any number of internal + external attendees. The organizer (the signed-in
 * host) owns the event; internal attendees get it in their own Outlook via
 * the normal invite mechanism, same as external attendees - Graph doesn't
 * distinguish between them at this call, the distinction only matters
 * upstream for which attendees get their calendars checked first.
 * Returns the Graph event id (stored as msEventId for cancel).
 */
export async function createCalendarEvent(params: {
  hostUserId: string;
  hostMsUserId: string;
  subject: string;
  startTimeUtc: string;
  endTimeUtc: string;
  attendees: EventAttendee[];
  note?: string;
}): Promise<string> {
  const res = await graphFetch(params.hostUserId, `/users/${params.hostMsUserId}/events`, {
    method: "POST",
    body: JSON.stringify({
      subject: params.subject,
      body: {
        contentType: "text",
        content: params.note ?? "",
      },
      start: { dateTime: params.startTimeUtc, timeZone: "UTC" },
      end: { dateTime: params.endTimeUtc, timeZone: "UTC" },
      attendees: params.attendees.map((a) => ({
        emailAddress: { address: a.email, name: a.name },
        type: "required",
      })),
      isOnlineMeeting: true,
      onlineMeetingProvider: "teamsForBusiness",
    }),
  });

  if (!res.ok) {
    throw new Error(`Graph create event failed: ${res.status} ${await res.text()}`);
  }

  const data = await res.json();
  return data.id as string;
}

export async function deleteCalendarEvent(hostUserId: string, hostMsUserId: string, eventId: string) {
  const res = await graphFetch(hostUserId, `/users/${hostMsUserId}/events/${eventId}`, {
    method: "DELETE",
  });
  // 404 is fine here - event may already be gone; don't block the cancel flow on it.
  if (!res.ok && res.status !== 404) {
    throw new Error(`Graph delete event failed: ${res.status} ${await res.text()}`);
  }
}

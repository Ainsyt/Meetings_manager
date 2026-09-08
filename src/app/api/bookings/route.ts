import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { formatInTimeZone } from "date-fns-tz";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { getMultiUserBusyBlocks, createCalendarEvent, CalendarUnavailableError, EventAttendee } from "@/lib/graph";
import { isRangeFreeForAll, HOST_TIMEZONE } from "@/lib/slots";
import { sendBookingConfirmation, sendOrganizerBookingSummary } from "@/lib/email";
import { generateCancelToken, cancelTokenExpiryFor } from "@/lib/tokens";
import { isEmailAllowed } from "@/lib/allowlist";

export const maxDuration = 30;

async function getSessionUser() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) return null;
  return prisma.user.findUnique({ where: { email: session.user.email.toLowerCase() } });
}

// GET: list the organizer's own upcoming bookings, for the dashboard.
export async function GET() {
  const organizer = await getSessionUser();
  if (!organizer) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const bookings = await prisma.booking.findMany({
    where: { organizerUserId: organizer.id, status: "confirmed", startTime: { gte: new Date() } },
    orderBy: { startTime: "asc" },
  });

  return NextResponse.json(bookings);
}

// POST: create a booking. Internal attendees are anyone on the team
// allowlist - they do NOT need to have signed into this app themselves;
// the organizer's own Graph token is enough to check their calendar, since
// tenant-wide consent is already granted. External attendees are never
// calendar-checked; the organizer has confirmed their time some other way.
export async function POST(req: NextRequest) {
  const organizer = await getSessionUser();
  if (!organizer) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (organizer.refreshTokenStatus === "revoked") {
    return NextResponse.json(
      { error: "Your calendar connection needs to be reconnected before creating a booking." },
      { status: 409 }
    );
  }

  const body = await req.json();
  const { subject, startUtc, endUtc, internalAttendees, externalAttendees, note } = body;

  if (!subject || !startUtc || !endUtc) {
    return NextResponse.json({ error: "subject, startUtc, endUtc are required" }, { status: 400 });
  }
  const internal: { name: string; email: string }[] = Array.isArray(internalAttendees) ? internalAttendees : [];
  const external: { name: string; email: string }[] = Array.isArray(externalAttendees) ? externalAttendees : [];

  if (internal.length === 0 && external.length === 0) {
    return NextResponse.json({ error: "Add at least one attendee" }, { status: 400 });
  }

  // Re-validate every internal attendee against the allowlist server-side -
  // don't trust the client, even though the availability step already checked.
  for (const a of internal) {
    if (!a.email || !(await isEmailAllowed(a.email))) {
      return NextResponse.json(
        { error: `"${a.email ?? "unknown"}" is not on the team allowlist and can't be added as an internal attendee.` },
        { status: 400 }
      );
    }
  }

  const startTime = new Date(startUtc);
  const endTime = new Date(endUtc);
  if (endTime <= startTime) {
    return NextResponse.json({ error: "End time must be after start time" }, { status: 400 });
  }

  // --- Live re-check, immediately before writing (closes the race window) ---
  const checkEmails = [organizer.email, ...internal.map((a) => a.email.toLowerCase())];
  try {
    const busyByEmail = await getMultiUserBusyBlocks(
      organizer.id,
      organizer.msUserId,
      checkEmails,
      startTime.toISOString(),
      endTime.toISOString()
    );
    const { free, conflictsWith } = isRangeFreeForAll(startTime, endTime, busyByEmail);
    if (!free) {
      const names = conflictsWith.map((email) => internal.find((a) => a.email.toLowerCase() === email)?.name ?? email);
      return NextResponse.json(
        {
          error: "SLOT_TAKEN",
          message: `That time is no longer free for: ${names.join(", ")}. Please pick another time.`,
        },
        { status: 409 }
      );
    }
  } catch (err) {
    if (err instanceof CalendarUnavailableError) {
      return NextResponse.json(
        { error: "Your calendar connection needs to be reconnected. Please try again later." },
        { status: 409 }
      );
    }
    throw err;
  }

  // --- Reserve the slot in the DB (unique index is the concurrency backstop) ---
  const cancelToken = generateCancelToken();

  let booking;
  try {
    booking = await prisma.booking.create({
      data: {
        organizerUserId: organizer.id,
        subject,
        note,
        startTime,
        endTime,
        internalAttendees: internal,
        externalAttendees: external,
        status: "confirmed",
        cancelToken,
        cancelTokenExpiresAt: cancelTokenExpiryFor(startTime),
      },
    });
  } catch (err: any) {
    if (err.code === "P2002" || /unique/i.test(String(err.message))) {
      return NextResponse.json(
        { error: "SLOT_TAKEN", message: "You already have a booking at that exact start time." },
        { status: 409 }
      );
    }
    throw err;
  }

  // --- Create the real Graph event + Teams link ---
  const allAttendees: EventAttendee[] = [...internal, ...external];

  let msEventId: string;
  try {
    msEventId = await createCalendarEvent({
      hostUserId: organizer.id,
      hostMsUserId: organizer.msUserId,
      subject,
      startTimeUtc: startTime.toISOString(),
      endTimeUtc: endTime.toISOString(),
      attendees: allAttendees,
      note,
    });
  } catch (err) {
    await prisma.booking.delete({ where: { id: booking.id } });
    console.error("Graph event creation failed, rolled back booking", err);
    return NextResponse.json({ error: "Could not create the calendar event. Please try again." }, { status: 502 });
  }

  await prisma.booking.update({ where: { id: booking.id }, data: { msEventId } });

  // --- Email everyone ---
  const cancelUrl = `${process.env.NEXT_PUBLIC_APP_URL}/cancel/${cancelToken}`;
  const startLocalHost = formatInTimeZone(startTime, HOST_TIMEZONE, "EEEE, MMM d, yyyy 'at' h:mm a") + " IST";
  const emailTargets = [...internal, ...external];

  try {
    await Promise.all([
      ...emailTargets.map((t) =>
        sendBookingConfirmation({
          guestName: t.name,
          guestEmail: t.email,
          hostName: organizer.displayName,
          hostEmail: organizer.email,
          startLocalGuest: startLocalHost,
          startLocalHost,
          cancelUrl,
        })
      ),
      sendOrganizerBookingSummary({
        organizerEmail: organizer.email,
        subject,
        startLocalHost,
        attendeeNames: emailTargets.map((t) => t.name),
        cancelUrl,
      }),
    ]);
  } catch (err) {
    console.error("Confirmation email(s) failed to send", err);
    return NextResponse.json(
      {
        booking: { id: booking.id, cancelUrl },
        warning:
          "Booking created and the calendar invite went out, but one or more confirmation emails failed to send. Cancel link: " +
          cancelUrl,
      },
      { status: 201 }
    );
  }

  return NextResponse.json({ booking: { id: booking.id, cancelUrl } }, { status: 201 });
}

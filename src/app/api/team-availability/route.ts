import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { getMultiUserBusyBlocks, CalendarUnavailableError } from "@/lib/graph";
import { isEmailAllowed } from "@/lib/allowlist";

export const maxDuration = 30;

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const organizer = await prisma.user.findUnique({ where: { email: session.user.email.toLowerCase() } });
  if (!organizer) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (organizer.refreshTokenStatus === "revoked") {
    return NextResponse.json(
      { error: "Your calendar connection needs to be reconnected before checking availability." },
      { status: 409 }
    );
  }

  const { attendees, rangeStartUtc, rangeEndUtc } = await req.json();
  if (!Array.isArray(attendees) || !rangeStartUtc || !rangeEndUtc) {
    return NextResponse.json({ error: "attendees, rangeStartUtc, rangeEndUtc are required" }, { status: 400 });
  }

  // No sign-in required for attendees - the organizer's own token is
  // enough to check anyone's calendar within the tenant (admin consent is
  // already granted). We just require the email to be on the team
  // allowlist, same check used for dashboard sign-in.
  const invalidEmails: string[] = [];
  for (const a of attendees) {
    if (!a.email || !(await isEmailAllowed(a.email))) invalidEmails.push(a.email ?? "(missing)");
  }
  if (invalidEmails.length > 0) {
    return NextResponse.json(
      { error: `Not on the team allowlist: ${invalidEmails.join(", ")}` },
      { status: 400 }
    );
  }

  // Dedupe by email, always include the organizer themselves.
  const byEmail = new Map<string, string>(); // email -> display name
  byEmail.set(organizer.email, organizer.displayName);
  for (const a of attendees) {
    byEmail.set(a.email.toLowerCase(), a.name || a.email);
  }

  // If someone in the list already has a User row (has signed in before),
  // prefer their real display name over whatever name was typed in the form.
  const existingUsers = await prisma.user.findMany({ where: { email: { in: Array.from(byEmail.keys()) } } });
  for (const u of existingUsers) byEmail.set(u.email, u.displayName);

  try {
    const busyByEmail = await getMultiUserBusyBlocks(
      organizer.id,
      organizer.msUserId,
      Array.from(byEmail.keys()),
      rangeStartUtc,
      rangeEndUtc
    );

    const availability = Array.from(byEmail.entries()).map(([email, displayName]) => ({
      email,
      displayName,
      busy: busyByEmail[email] ?? [],
    }));

    return NextResponse.json({ availability });
  } catch (err) {
    if (err instanceof CalendarUnavailableError) {
      return NextResponse.json(
        { error: "Your calendar connection needs to be reconnected." },
        { status: 409 }
      );
    }
    console.error("team-availability error", err);
    return NextResponse.json({ error: "Could not load availability" }, { status: 500 });
  }
}

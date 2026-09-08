import { NextRequest, NextResponse } from "next/server";
import { formatInTimeZone } from "date-fns-tz";
import { prisma } from "@/lib/db";
import { deleteCalendarEvent } from "@/lib/graph";
import { sendCancellationNotice } from "@/lib/email";
import { HOST_TIMEZONE } from "@/lib/slots";
import { checkRateLimit } from "@/lib/rateLimit";

// Token-based self-cancel, for an attendee (internal or external) who got
// the cancel link in their confirmation email and wants to cancel without
// contacting the organizer directly. This is the one remaining public,
// unauthenticated endpoint, so it's rate-limited by IP as a defense against
// token-guessing, even though the tokens themselves are unguessable (32
// random chars via nanoid).
export async function POST(req: NextRequest) {
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
  const { success } = await checkRateLimit(`cancel-ip:${ip}`);
  if (!success) {
    return NextResponse.json({ error: "Too many requests, please try again shortly" }, { status: 429 });
  }

  const { token } = await req.json();
  if (!token) return NextResponse.json({ error: "Missing token" }, { status: 400 });

  const booking = await prisma.booking.findUnique({
    where: { cancelToken: token },
    include: { organizer: true },
  });

  if (!booking) return NextResponse.json({ error: "Invalid or unknown link" }, { status: 404 });
  if (booking.status === "cancelled" || booking.cancelTokenUsedAt) {
    return NextResponse.json({ error: "This link has already been used" }, { status: 410 });
  }
  if (booking.cancelTokenExpiresAt < new Date()) {
    return NextResponse.json({ error: "This link has expired" }, { status: 410 });
  }

  if (booking.msEventId) {
    try {
      await deleteCalendarEvent(booking.organizerUserId, booking.organizer.msUserId, booking.msEventId);
    } catch (err) {
      console.error("Failed to delete Graph event during cancel", err);
    }
  }

  await prisma.booking.update({
    where: { id: booking.id },
    data: { status: "cancelled", cancelTokenUsedAt: new Date() },
  });

  const startLocalHost = formatInTimeZone(booking.startTime, HOST_TIMEZONE, "EEEE, MMM d, yyyy 'at' h:mm a") + " IST";
  const internal = (booking.internalAttendees as any[]) ?? [];
  const external = (booking.externalAttendees as any[]) ?? [];
  const allAttendees = [...internal, ...external];

  try {
    await Promise.all(
      allAttendees.map((a) =>
        sendCancellationNotice({
          guestName: a.name,
          guestEmail: a.email,
          hostName: booking.organizer.displayName,
          startLocalGuest: startLocalHost,
        })
      )
    );
  } catch (err) {
    console.error("Cancellation notice email(s) failed", err);
  }

  return NextResponse.json({ ok: true });
}

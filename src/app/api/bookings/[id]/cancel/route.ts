import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { formatInTimeZone } from "date-fns-tz";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { deleteCalendarEvent } from "@/lib/graph";
import { sendCancellationNotice } from "@/lib/email";
import { HOST_TIMEZONE } from "@/lib/slots";

export async function POST(_req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const organizer = await prisma.user.findUnique({ where: { email: session.user.email.toLowerCase() } });
  if (!organizer) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const booking = await prisma.booking.findUnique({ where: { id: params.id } });
  if (!booking || booking.organizerUserId !== organizer.id) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  if (booking.status === "cancelled") {
    return NextResponse.json({ error: "Already cancelled" }, { status: 410 });
  }

  if (booking.msEventId) {
    try {
      await deleteCalendarEvent(organizer.id, organizer.msUserId, booking.msEventId);
    } catch (err) {
      console.error("Failed to delete Graph event during host cancel", err);
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
          hostName: organizer.displayName,
          startLocalGuest: startLocalHost,
        })
      )
    );
  } catch (err) {
    console.error("Cancellation notice email(s) failed", err);
  }

  return NextResponse.json({ ok: true });
}

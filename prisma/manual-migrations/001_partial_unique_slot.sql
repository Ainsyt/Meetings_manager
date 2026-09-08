-- Run this once, manually, after your first `prisma db push`.
--
-- Backstop against an organizer accidentally double-booking the same start
-- time twice (double-click, two open tabs, etc). The live conflict check in
-- src/app/api/bookings/route.ts is the primary defense against booking a
-- slot where an attendee actually has a conflict; this index just prevents
-- two Booking rows existing for the same organizer + start time.

CREATE UNIQUE INDEX IF NOT EXISTS uniq_organizer_confirmed_slot
ON "Booking" ("organizerUserId", "startTime")
WHERE status = 'confirmed';

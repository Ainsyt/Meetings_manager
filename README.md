# Team Scheduler

Internal Microsoft 365 / Teams booking tool. **No public self-service page** —
bookings are created only by a signed-in team member, who checks internal
teammates' calendars via Graph and manually adds external (non-Microsoft)
attendees whose time they've already confirmed some other way.

See the separate implementation plan for step-by-step deploy instructions.
This README is the quick technical reference.

## How it works

1. Team member signs in with Microsoft (gated by the team allowlist)
2. Goes to **Create a booking**, picks a date, and types a teammate's name
   into the internal-attendee search box — this searches the live Microsoft
   directory (`User.ReadBasic.All`, delegated, admin-consented once for the
   whole tenant) as you type. The person does **not** need to have ever
   signed into this app themselves.
3. App calls Graph **once** for all selected mailboxes together
   (`getMultiUserBusyBlocks`) and renders a busy/free grid — raw calendar
   data, no working-hours filtering
4. Organizer clicks a free time, picks a duration, adds any external
   attendees by name + email (never calendar-checked — the organizer has
   already confirmed the time with them outside this tool)
5. On submit: live re-check against Graph (closes the race window), DB
   write guarded by a unique index backstop, then the real Outlook event +
   Teams link is created with everyone as an attendee
6. Everyone gets a confirmation email with a cancel link; the organizer can
   also cancel any of their bookings from the dashboard

## What's implemented

- Microsoft OAuth sign-in gated by a team allowlist (`src/lib/allowlist.ts`)
  — non-team emails are rejected before any calendar permission is requested
- Live directory search for internal attendees (`searchDirectory` in
  `src/lib/graph.ts`, exposed via `/api/directory-search`) — requires the
  `User.ReadBasic.All` delegated Graph permission with admin consent granted
  once at the tenant level (see implementation plan)
- Encrypted refresh token storage (`src/lib/crypto.ts`), with automatic
  `refreshTokenStatus: revoked` detection when Graph rejects a refresh
- Multi-mailbox availability in one Graph call (`getMultiUserBusyBlocks` in
  `src/lib/graph.ts`), keyed correctly by email address (not the internal
  Graph object id — an earlier bug where this was reversed silently
  returned "no conflicts" for every check)
- Race-condition-safe booking (`src/app/api/bookings/route.ts`): live
  re-check right before writing, DB write guarded by a partial unique index
  (`prisma/manual-migrations/001_partial_unique_slot.sql`), rollback if
  Graph event creation fails
- Host-side cancel (`src/app/api/bookings/[id]/cancel/route.ts`) plus a
  token-based self-cancel for attendees (`src/app/api/cancel/route.ts`),
  rate-limited since it's the one remaining public unauthenticated route
- Duration presets (`BookingType`) are still available as optional
  quick-picks; the booking form also accepts a custom duration

## Local setup

```bash
npm install
cp .env.example .env.local   # fill in real values, see implementation plan
npx prisma db push           # creates tables from prisma/schema.prisma
psql "$DATABASE_URL" -f prisma/manual-migrations/001_partial_unique_slot.sql
npm run dev
```

## Known simplifications (MVP, documented deliberately)

- **Availability grid is a fixed 06:00–22:00 IST display window**, purely
  for rendering — not a working-hours filter (busy/free itself is raw
  calendar data, per your call to ignore configured working hours). Change
  `DISPLAY_START_HOUR` / `DISPLAY_END_HOUR` in `NewBookingClient.tsx` if you
  want a wider or narrower view.
- **Grid shows one day at a time.** Multi-day view is a reasonable follow-up
  if a team member regularly needs to scan a full week at once.
- **No admin UI for the allowlist** — edit the `AllowedEmail` table via
  `npx prisma studio`, or use `ALLOWED_EMAILS` / `ALLOWED_DOMAIN` env vars.
- **Email retry is a single attempt**, not a queued job — acceptable at MVP
  scale for a small team; add retries in `src/lib/email.ts` if needed.

## Directory guide

```
src/lib/
  auth.ts          NextAuth config + allowlist gate + refresh token persistence
  allowlist.ts      Email/domain allowlist check
  crypto.ts         AES-256-GCM encrypt/decrypt for refresh tokens at rest
  graph.ts          Graph calls: token refresh, multi-user getSchedule, create/delete event
  slots.ts          Raw conflict-check helper (no working-hours logic)
  email.ts          SendGrid confirmation/cancellation emails
  rateLimit.ts       Upstash-backed rate limiter (used on the public cancel endpoint)
  tokens.ts          Cancel token generation + expiry

src/app/
  page.tsx                          Sign-in landing page
  dashboard/                        Host dashboard (protected by middleware.ts)
  dashboard/new-booking/            Create-booking flow: pick attendees, view grid, submit
  cancel/[token]/                   Public self-cancel page (no login)
  api/auth/[...nextauth]/           NextAuth handler
  api/directory-search/             Live Microsoft directory search (name -> email), auth required
  api/team-availability/            POST: combined busy/free grid for selected attendees
  api/booking-types/                CRUD duration presets (auth)
  api/bookings/                     GET (my bookings) / POST (create booking), auth required
  api/bookings/[id]/cancel/         Host-side cancel, auth required
  api/cancel/                       Token-based self-cancel, public but rate-limited

prisma/schema.prisma                Data model
prisma/manual-migrations/           Raw SQL for the partial unique index
```

export { default } from "next-auth/middleware";

// Only the dashboard is gated. /cancel/[token] stays public (no login) so
// an internal or external attendee can self-cancel from their emailed link
// without needing an account. There's no public booking page anymore -
// bookings are created only by signed-in team members from the dashboard.
export const config = {
  matcher: ["/dashboard/:path*"],
};

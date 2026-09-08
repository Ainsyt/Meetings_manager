import sgMail from "@sendgrid/mail";

sgMail.setApiKey(process.env.SENDGRID_API_KEY ?? "");

const FROM = process.env.SENDGRID_FROM_EMAIL ?? "scheduler@example.com";

/**
 * Sends the booking confirmation to ONE attendee (internal or external).
 * Call once per attendee - see src/app/api/bookings/route.ts.
 */
export async function sendBookingConfirmation(params: {
  guestName: string;
  guestEmail: string;
  hostName: string;
  hostEmail: string;
  startLocalGuest: string;
  startLocalHost: string;
  cancelUrl: string;
}) {
  await sgMail.send({
    to: params.guestEmail,
    from: FROM,
    subject: `Confirmed: meeting with ${params.hostName}`,
    text: `You're on the calendar with ${params.hostName} for ${params.startLocalGuest}.\n\nA Teams link is on the calendar invite you'll receive separately from Outlook.\n\nNeed to cancel? ${params.cancelUrl}`,
  });
}

/** Sends the organizer a one-time summary of who was invited. Call once per booking, not per attendee. */
export async function sendOrganizerBookingSummary(params: {
  organizerEmail: string;
  subject: string;
  startLocalHost: string;
  attendeeNames: string[];
  cancelUrl: string;
}) {
  await sgMail.send({
    to: params.organizerEmail,
    from: FROM,
    subject: `Booked: ${params.subject}`,
    text: `Your booking "${params.subject}" is set for ${params.startLocalHost}.\n\nAttendees: ${params.attendeeNames.join(
      ", "
    )}\n\nCancel link: ${params.cancelUrl}`,
  });
}

export async function sendCancellationNotice(params: {
  guestName: string;
  guestEmail: string;
  hostName: string;
  startLocalGuest: string;
}) {
  await sgMail.send({
    to: params.guestEmail,
    from: FROM,
    subject: `Cancelled: meeting with ${params.hostName}`,
    text: `Your meeting with ${params.hostName} originally scheduled for ${params.startLocalGuest} has been cancelled.`,
  });
}

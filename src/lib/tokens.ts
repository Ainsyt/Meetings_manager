import { nanoid } from "nanoid";
import { addDays } from "date-fns";

/** Unguessable cancel/reschedule token - not a sequential ID (spec section 9). */
export function generateCancelToken(): string {
  return nanoid(32);
}

/** Cancel/reschedule links stay live for 30 days after the meeting's start time. */
export function cancelTokenExpiryFor(startTime: Date): Date {
  return addDays(startTime, 30);
}

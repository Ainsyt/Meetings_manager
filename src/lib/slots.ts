import { BusyBlock } from "@/lib/graph";

export const HOST_TIMEZONE = "Asia/Kolkata"; // IST - used for display formatting only now

/**
 * Checks whether [startUtc, endUtc) is free of conflicts across every
 * person's busy blocks. Used both for the live re-check right before
 * creating a booking, and can be reused client-side for instant feedback.
 * No working-hours filtering - per your call, this is raw calendar
 * busy/free only, any time of day.
 */
export function isRangeFreeForAll(
  startUtc: Date,
  endUtc: Date,
  busyBlocksByPerson: Record<string, BusyBlock[]>
): { free: boolean; conflictsWith: string[] } {
  const conflictsWith: string[] = [];

  for (const [personKey, blocks] of Object.entries(busyBlocksByPerson)) {
    const overlaps = blocks.some((b) => {
      const bStart = new Date(b.start);
      const bEnd = new Date(b.end);
      return startUtc < bEnd && bStart < endUtc;
    });
    if (overlaps) conflictsWith.push(personKey);
  }

  return { free: conflictsWith.length === 0, conflictsWith };
}

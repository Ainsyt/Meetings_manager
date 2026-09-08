"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";

interface Attendee {
  name: string;
  email: string;
}

interface BusyBlock {
  start: string;
  end: string;
}

interface AvailabilityRow {
  email: string;
  displayName: string;
  busy: BusyBlock[];
}

const DISPLAY_START_HOUR = 6;
const DISPLAY_END_HOUR = 22;
const SLOT_MINUTES = 30;
const SLOT_COUNT = ((DISPLAY_END_HOUR - DISPLAY_START_HOUR) * 60) / SLOT_MINUTES;

function istDateTimeToUtc(dateStr: string, hour: number, minute: number): Date {
  const hh = String(hour).padStart(2, "0");
  const mm = String(minute).padStart(2, "0");
  return new Date(`${dateStr}T${hh}:${mm}:00+05:30`);
}

function slotLabel(index: number): string {
  const totalMin = DISPLAY_START_HOUR * 60 + index * SLOT_MINUTES;
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  const period = h >= 12 ? "PM" : "AM";
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:${String(m).padStart(2, "0")} ${period}`;
}

export default function NewBookingClient() {
  const router = useRouter();

  const today = new Date().toISOString().slice(0, 10);
  const [date, setDate] = useState(today);

  const [internalAttendees, setInternalAttendees] = useState<Attendee[]>([]);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<Attendee[]>([]);
  const [searching, setSearching] = useState(false);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [availability, setAvailability] = useState<AvailabilityRow[] | null>(null);
  const [loadingAvailability, setLoadingAvailability] = useState(false);
  const [availabilityError, setAvailabilityError] = useState("");

  const [startSlotIndex, setStartSlotIndex] = useState<number | null>(null);
  const [durationMinutes, setDurationMinutes] = useState(30);

  const [subject, setSubject] = useState("");
  const [note, setNote] = useState("");
  const [externalAttendees, setExternalAttendees] = useState<Attendee[]>([]);
  const [extName, setExtName] = useState("");
  const [extEmail, setExtEmail] = useState("");

  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState("");
  const [submitWarning, setSubmitWarning] = useState("");
  const [done, setDone] = useState(false);

  // Debounced live directory search as the organizer types a name.
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    const q = searchQuery.trim();
    if (q.length < 2) {
      setSearchResults([]);
      setShowSuggestions(false);
      return;
    }
    debounceRef.current = setTimeout(async () => {
      setSearching(true);
      try {
        const res = await fetch(`/api/directory-search?q=${encodeURIComponent(q)}`);
        const data = await res.json();
        const already = new Set(internalAttendees.map((a) => a.email));
        setSearchResults((data.results ?? []).filter((r: Attendee) => !already.has(r.email)));
        setShowSuggestions(true);
      } catch {
        setSearchResults([]);
      } finally {
        setSearching(false);
      }
    }, 300);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchQuery]);

  function addInternal(person: Attendee) {
    setInternalAttendees((prev) => [...prev, person]);
    setSearchQuery("");
    setSearchResults([]);
    setShowSuggestions(false);
    setAvailability(null);
    setStartSlotIndex(null);
  }

  function removeInternal(i: number) {
    setInternalAttendees((prev) => prev.filter((_, idx) => idx !== i));
    setAvailability(null);
    setStartSlotIndex(null);
  }

  function addExternal() {
    if (!extName || !extEmail) return;
    setExternalAttendees((prev) => [...prev, { name: extName, email: extEmail }]);
    setExtName("");
    setExtEmail("");
  }

  async function fetchAvailability() {
    if (internalAttendees.length === 0) {
      setAvailabilityError("Add at least one internal attendee first.");
      return;
    }
    setLoadingAvailability(true);
    setAvailabilityError("");
    setStartSlotIndex(null);
    const rangeStartUtc = istDateTimeToUtc(date, 0, 0).toISOString();
    const rangeEndUtc = istDateTimeToUtc(date, 23, 59).toISOString();

    try {
      const res = await fetch("/api/team-availability", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ attendees: internalAttendees, rangeStartUtc, rangeEndUtc }),
      });
      const data = await res.json();
      if (!res.ok) {
        setAvailabilityError(data.error ?? "Could not load availability");
        return;
      }
      setAvailability(data.availability);
    } catch (err) {
      setAvailabilityError("Network issue - please try again.");
    } finally {
      setLoadingAvailability(false);
    }
  }

  function isSlotBusyForRow(row: AvailabilityRow, slotIndex: number): boolean {
    const slotStart = istDateTimeToUtc(date, DISPLAY_START_HOUR, slotIndex * SLOT_MINUTES);
    const slotEnd = new Date(slotStart.getTime() + SLOT_MINUTES * 60 * 1000);
    return row.busy.some((b) => {
      const bStart = new Date(b.start);
      const bEnd = new Date(b.end);
      return slotStart < bEnd && bStart < slotEnd;
    });
  }

  const selectedRange = useMemo(() => {
    if (startSlotIndex === null) return null;
    const startUtc = istDateTimeToUtc(date, DISPLAY_START_HOUR, startSlotIndex * SLOT_MINUTES);
    const endUtc = new Date(startUtc.getTime() + durationMinutes * 60 * 1000);
    return { startUtc, endUtc };
  }, [startSlotIndex, durationMinutes, date]);

  const conflicts = useMemo(() => {
    if (!selectedRange || !availability) return [];
    return availability
      .filter((row) =>
        row.busy.some((b) => {
          const bStart = new Date(b.start);
          const bEnd = new Date(b.end);
          return selectedRange.startUtc < bEnd && bStart < selectedRange.endUtc;
        })
      )
      .map((row) => row.displayName);
  }, [selectedRange, availability]);

  async function submit() {
    if (!selectedRange || !subject) return;
    setSubmitting(true);
    setSubmitError("");
    setSubmitWarning("");

    try {
      const res = await fetch("/api/bookings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          subject,
          note,
          startUtc: selectedRange.startUtc.toISOString(),
          endUtc: selectedRange.endUtc.toISOString(),
          internalAttendees,
          externalAttendees,
        }),
      });
      const data = await res.json();

      if (!res.ok) {
        setSubmitError(data.message ?? data.error ?? "Something went wrong");
        return;
      }
      if (data.warning) {
        setSubmitWarning(data.warning);
      }
      setDone(true);
    } catch (err) {
      setSubmitError("The request didn't complete (network issue or timeout). Please try again.");
    } finally {
      setSubmitting(false);
    }
  }

  if (done) {
    return (
      <main className="max-w-xl mx-auto p-6 space-y-3 text-center">
        <h1 className="text-xl font-semibold">Booking created</h1>
        {submitWarning && <p className="text-amber-700 text-sm">{submitWarning}</p>}
        <button onClick={() => router.push("/dashboard")} className="text-blue-600 underline text-sm">
          Back to dashboard
        </button>
      </main>
    );
  }

  return (
    <main className="max-w-2xl mx-auto p-6 space-y-6">
      <h1 className="text-xl font-semibold">Create a booking</h1>

      <section className="space-y-2">
        <label className="text-sm font-medium">Date (IST)</label>
        <input
          type="date"
          value={date}
          onChange={(e) => {
            setDate(e.target.value);
            setAvailability(null);
            setStartSlotIndex(null);
          }}
          className="border rounded px-2 py-1 text-sm block"
        />
      </section>

      <section className="space-y-2">
        <label className="text-sm font-medium">Internal attendees (calendar-checked)</label>
        <p className="text-xs text-gray-500">
          Type a teammate's name — searched live against the company directory. They don't need to
          have signed into this app before.
        </p>
        {internalAttendees.map((a, i) => (
          <div key={i} className="text-sm flex items-center gap-2">
            <span>
              {a.name} ({a.email})
            </span>
            <button onClick={() => removeInternal(i)} className="text-red-600 text-xs underline">
              Remove
            </button>
          </div>
        ))}
        <div className="relative">
          <input
            placeholder="Type a name..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            onFocus={() => searchResults.length > 0 && setShowSuggestions(true)}
            onBlur={() => setTimeout(() => setShowSuggestions(false), 150)}
            className="w-full border rounded px-3 py-2 text-sm"
          />
          {searching && <p className="text-xs text-gray-400 mt-1">Searching...</p>}
          {showSuggestions && searchResults.length > 0 && (
            <div className="absolute z-10 left-0 right-0 mt-1 bg-white border rounded shadow text-sm max-h-48 overflow-y-auto">
              {searchResults.map((p) => (
                <button
                  key={p.email}
                  onMouseDown={() => addInternal(p)}
                  className="w-full text-left px-3 py-2 hover:bg-gray-50"
                >
                  {p.name} <span className="text-gray-400">({p.email})</span>
                </button>
              ))}
            </div>
          )}
          {showSuggestions && !searching && searchQuery.trim().length >= 2 && searchResults.length === 0 && (
            <div className="absolute z-10 left-0 right-0 mt-1 bg-white border rounded shadow text-sm p-2 text-gray-400">
              No matches — make sure they're on the team allowlist.
            </div>
          )}
        </div>
        <button
          onClick={fetchAvailability}
          disabled={loadingAvailability}
          className="text-sm bg-gray-800 text-white rounded px-3 py-1.5 disabled:opacity-50"
        >
          {loadingAvailability ? "Checking..." : "Check availability"}
        </button>
        {availabilityError && <p className="text-sm text-red-600">{availabilityError}</p>}
      </section>

      {availability && (
        <section className="space-y-2">
          <label className="text-sm font-medium">Pick a start time</label>
          <p className="text-xs text-gray-500">
            Showing {DISPLAY_START_HOUR}:00–{DISPLAY_END_HOUR}:00 IST. Red = busy, click any free cell to start.
          </p>
          <div className="overflow-x-auto">
            <table className="text-xs border-collapse">
              <thead>
                <tr>
                  <th className="text-left pr-2 sticky left-0 bg-white">Person</th>
                  {Array.from({ length: SLOT_COUNT }).map((_, i) => (
                    <th key={i} className="w-6 font-normal text-gray-400" style={{ writingMode: "vertical-rl" }}>
                      {i % 4 === 0 ? slotLabel(i) : ""}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {availability.map((row) => (
                  <tr key={row.email}>
                    <td className="pr-2 whitespace-nowrap sticky left-0 bg-white">{row.displayName}</td>
                    {Array.from({ length: SLOT_COUNT }).map((_, i) => {
                      const busy = isSlotBusyForRow(row, i);
                      return (
                        <td
                          key={i}
                          onClick={() => !busy && setStartSlotIndex(i)}
                          className={`w-6 h-5 border cursor-pointer ${
                            busy ? "bg-red-300" : startSlotIndex === i ? "bg-blue-500" : "bg-green-100"
                          }`}
                        />
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {startSlotIndex !== null && (
            <div className="flex items-center gap-2 text-sm pt-2">
              <span>Starting {slotLabel(startSlotIndex)} IST for</span>
              <select
                value={durationMinutes}
                onChange={(e) => setDurationMinutes(Number(e.target.value))}
                className="border rounded px-2 py-1"
              >
                <option value={30}>30 min</option>
                <option value={45}>45 min</option>
                <option value={60}>60 min</option>
                <option value={90}>90 min</option>
              </select>
              {conflicts.length > 0 && (
                <span className="text-red-600 text-xs">Conflicts with: {conflicts.join(", ")}</span>
              )}
            </div>
          )}
        </section>
      )}

      <section className="space-y-2 border-t pt-4">
        <label className="text-sm font-medium">External attendees (not calendar-checked)</label>
        <p className="text-xs text-gray-500">
          For anyone not on Microsoft — confirm the time with them elsewhere first, then add them here.
        </p>
        {externalAttendees.map((a, i) => (
          <div key={i} className="text-sm flex items-center gap-2">
            <span>
              {a.name} ({a.email})
            </span>
            <button
              onClick={() => setExternalAttendees((prev) => prev.filter((_, idx) => idx !== i))}
              className="text-red-600 text-xs underline"
            >
              Remove
            </button>
          </div>
        ))}
        <div className="flex gap-2">
          <input
            placeholder="Name"
            value={extName}
            onChange={(e) => setExtName(e.target.value)}
            className="border rounded px-2 py-1 text-sm flex-1"
          />
          <input
            placeholder="Email"
            value={extEmail}
            onChange={(e) => setExtEmail(e.target.value)}
            className="border rounded px-2 py-1 text-sm flex-1"
          />
          <button onClick={addExternal} className="text-sm bg-gray-800 text-white rounded px-3 py-1">
            Add
          </button>
        </div>
      </section>

      <section className="space-y-2 border-t pt-4">
        <input
          placeholder="Meeting subject"
          value={subject}
          onChange={(e) => setSubject(e.target.value)}
          className="w-full border rounded px-3 py-2 text-sm"
        />
        <textarea
          placeholder="Note (optional)"
          value={note}
          onChange={(e) => setNote(e.target.value)}
          className="w-full border rounded px-3 py-2 text-sm"
        />
        {submitError && <p className="text-sm text-red-600">{submitError}</p>}
        <button
          onClick={submit}
          disabled={submitting || !selectedRange || !subject}
          className="w-full bg-blue-600 text-white rounded px-4 py-2 text-sm disabled:opacity-50"
        >
          {submitting ? "Creating..." : "Create booking"}
        </button>
      </section>
    </main>
  );
}

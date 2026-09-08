"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { signOut } from "next-auth/react";

interface BookingType {
  id: string;
  label: string;
  durationMinutes: number;
}

interface Booking {
  id: string;
  subject: string;
  startTime: string;
  endTime: string;
  internalAttendees: { name: string; email: string }[];
  externalAttendees: { name: string; email: string }[];
}

interface Props {
  displayName: string;
  refreshTokenStatus: string;
  bookingTypes: BookingType[];
}

export default function DashboardClient(props: Props) {
  const [bookingTypes, setBookingTypes] = useState(props.bookingTypes);
  const [newLabel, setNewLabel] = useState("");
  const [newDuration, setNewDuration] = useState(30);

  const [bookings, setBookings] = useState<Booking[] | null>(null);
  const [cancellingId, setCancellingId] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/bookings")
      .then((r) => r.json())
      .then(setBookings);
  }, []);

  async function addBookingType() {
    if (!newLabel || !newDuration) return;
    const res = await fetch("/api/booking-types", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ label: newLabel, durationMinutes: newDuration }),
    });
    if (res.ok) {
      const created = await res.json();
      setBookingTypes((prev) => [...prev, created]);
      setNewLabel("");
      setNewDuration(30);
    }
  }

  async function removeBookingType(id: string) {
    const res = await fetch("/api/booking-types", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id }),
    });
    if (res.ok) setBookingTypes((prev) => prev.filter((t) => t.id !== id));
  }

  async function cancelBooking(id: string) {
    setCancellingId(id);
    const res = await fetch(`/api/bookings/${id}/cancel`, { method: "POST" });
    setCancellingId(null);
    if (res.ok) setBookings((prev) => prev?.filter((b) => b.id !== id) ?? null);
  }

  return (
    <main className="max-w-2xl mx-auto p-6 space-y-8">
      <header className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold">Hi, {props.displayName}</h1>
          <p className="text-sm text-gray-500">Times shown are IST (Asia/Kolkata)</p>
        </div>
        <button onClick={() => signOut({ callbackUrl: "/" })} className="text-sm text-gray-500 underline">
          Sign out
        </button>
      </header>

      {props.refreshTokenStatus === "revoked" && (
        <div className="rounded-md bg-amber-50 border border-amber-300 p-4 text-amber-800 text-sm">
          Your calendar connection needs to be refreshed — availability checks and new bookings won't
          work until you reconnect.{" "}
          <a href="/api/auth/signin/azure-ad" className="underline font-medium">
            Reconnect now
          </a>
        </div>
      )}

      <Link
        href="/dashboard/new-booking"
        className="block text-center bg-blue-600 text-white rounded-md px-4 py-2.5 font-medium"
      >
        + Create a booking
      </Link>

      <section className="rounded-md border p-4 space-y-3">
        <h2 className="font-medium">Upcoming bookings</h2>
        {bookings === null && <p className="text-sm text-gray-500">Loading…</p>}
        {bookings?.length === 0 && <p className="text-sm text-gray-500">Nothing scheduled yet.</p>}
        {bookings?.map((b) => (
          <div key={b.id} className="text-sm border-b last:border-0 pb-2 last:pb-0">
            <div className="flex items-center justify-between">
              <span className="font-medium">{b.subject}</span>
              <button
                onClick={() => cancelBooking(b.id)}
                disabled={cancellingId === b.id}
                className="text-red-600 text-xs underline disabled:opacity-50"
              >
                {cancellingId === b.id ? "Cancelling..." : "Cancel"}
              </button>
            </div>
            <div className="text-gray-500">
              {new Date(b.startTime).toLocaleString("en-IN", {
                timeZone: "Asia/Kolkata",
                dateStyle: "medium",
                timeStyle: "short",
              })}{" "}
              IST
            </div>
            <div className="text-gray-400 text-xs">
              {[...b.internalAttendees.map((a) => a.name), ...b.externalAttendees.map((a) => a.name)].join(
                ", "
              )}
            </div>
          </div>
        ))}
      </section>

      <section className="rounded-md border p-4 space-y-3">
        <h2 className="font-medium">Meeting duration presets</h2>
        <p className="text-xs text-gray-500">Optional quick-pick durations for the booking form.</p>
        {bookingTypes.map((t) => (
          <div key={t.id} className="flex items-center justify-between text-sm">
            <span>
              {t.label} — {t.durationMinutes} min
            </span>
            <button onClick={() => removeBookingType(t.id)} className="text-red-600 text-xs underline">
              Remove
            </button>
          </div>
        ))}
        <div className="flex gap-2 pt-2">
          <input
            placeholder="Label (e.g. 30-min call)"
            value={newLabel}
            onChange={(e) => setNewLabel(e.target.value)}
            className="flex-1 border rounded px-2 py-1 text-sm"
          />
          <input
            type="number"
            value={newDuration}
            onChange={(e) => setNewDuration(Number(e.target.value))}
            className="w-20 border rounded px-2 py-1 text-sm"
          />
          <button onClick={addBookingType} className="text-sm bg-blue-600 text-white rounded px-3 py-1">
            Add
          </button>
        </div>
      </section>
    </main>
  );
}

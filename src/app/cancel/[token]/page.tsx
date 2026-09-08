"use client";

import { useState } from "react";
import { useParams } from "next/navigation";

export default function CancelPage() {
  const params = useParams();
  const token = params.token as string;
  const [status, setStatus] = useState<"idle" | "working" | "done" | "error">("idle");
  const [message, setMessage] = useState("");

  async function cancelBooking() {
    setStatus("working");
    const res = await fetch("/api/cancel", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token }),
    });
    const data = await res.json();
    if (res.ok) {
      setStatus("done");
    } else {
      setStatus("error");
      setMessage(data.error ?? "Something went wrong.");
    }
  }

  return (
    <main className="max-w-md mx-auto p-6 space-y-4 text-center">
      <h1 className="text-xl font-semibold">Manage your booking</h1>

      {status === "idle" && (
        <>
          <p className="text-gray-600">
            Click below to cancel this meeting. To reschedule instead, cancel here first, then book
            a new time on the host's booking page.
          </p>
          <button onClick={cancelBooking} className="bg-red-600 text-white rounded px-4 py-2 text-sm">
            Cancel meeting
          </button>
        </>
      )}

      {status === "working" && <p className="text-gray-500">Cancelling…</p>}

      {status === "done" && (
        <p className="text-green-700">This meeting has been cancelled. Both parties have been notified.</p>
      )}

      {status === "error" && <p className="text-red-600">{message}</p>}
    </main>
  );
}

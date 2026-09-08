"use client";

import { signIn } from "next-auth/react";

export default function SignInButton() {
  return (
    <button
      onClick={() => signIn("azure-ad", { callbackUrl: "/dashboard" })}
      className="rounded-md bg-blue-600 px-5 py-2.5 text-white font-medium hover:bg-blue-700 transition"
    >
      Sign in with Microsoft
    </button>
  );
}

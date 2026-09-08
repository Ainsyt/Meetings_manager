import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";
import { authOptions } from "@/lib/auth";
import SignInButton from "./SignInButton";

export default async function HomePage() {
  const session = await getServerSession(authOptions);
  if (session) redirect("/dashboard");

  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-6 p-6">
      <h1 className="text-2xl font-semibold">Team Scheduler</h1>
      <p className="text-gray-600 max-w-sm text-center">
        Sign in with your Microsoft work account to connect your calendar and set up your booking
        page. Access is limited to the team.
      </p>
      <SignInButton />
    </main>
  );
}

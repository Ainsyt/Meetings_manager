import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/db";
import DashboardClient from "./DashboardClient";

export default async function DashboardPage() {
  const session = await getServerSession(authOptions);
  const user = await prisma.user.findUnique({
    where: { email: session!.user!.email!.toLowerCase() },
    include: { bookingTypes: { where: { isActive: true } } },
  });

  if (!user) {
    return <main className="p-6">Setting up your account, please refresh in a moment.</main>;
  }

  return (
    <DashboardClient
      displayName={user.displayName}
      refreshTokenStatus={user.refreshTokenStatus}
      bookingTypes={user.bookingTypes.map((t) => ({ id: t.id, label: t.label, durationMinutes: t.durationMinutes }))}
    />
  );
}

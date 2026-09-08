import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/db";

async function getSessionUser() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) return null;
  return prisma.user.findUnique({ where: { email: session.user.email.toLowerCase() } });
}

export async function GET() {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const types = await prisma.bookingType.findMany({
    where: { userId: user.id, isActive: true },
    orderBy: { durationMinutes: "asc" },
  });
  return NextResponse.json(types);
}

export async function POST(req: NextRequest) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { durationMinutes, label } = await req.json();
  if (!durationMinutes || !label) {
    return NextResponse.json({ error: "durationMinutes and label are required" }, { status: 400 });
  }

  const type = await prisma.bookingType.create({
    data: { userId: user.id, durationMinutes, label },
  });
  return NextResponse.json(type, { status: 201 });
}

export async function DELETE(req: NextRequest) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await req.json();
  // Soft delete only - keeps FK integrity for historical bookings (spec 5).
  const type = await prisma.bookingType.updateMany({
    where: { id, userId: user.id },
    data: { isActive: false },
  });
  if (type.count === 0) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  return NextResponse.json({ ok: true });
}

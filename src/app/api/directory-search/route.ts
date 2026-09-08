import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { searchDirectory } from "@/lib/graph";
import { isEmailAllowed } from "@/lib/allowlist";

// Live directory search for the internal-attendee autocomplete. Only the
// organizer needs to be signed in - the person being searched for does not.
export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const organizer = await prisma.user.findUnique({ where: { email: session.user.email.toLowerCase() } });
  if (!organizer) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (organizer.refreshTokenStatus === "revoked") {
    return NextResponse.json({ error: "Your calendar connection needs to be reconnected." }, { status: 409 });
  }

  const q = (req.nextUrl.searchParams.get("q") ?? "").trim();
  if (q.length < 2) return NextResponse.json({ results: [] });

  try {
    const results = await searchDirectory(organizer.id, q);
    // Only suggest people who are actually allowed on the team (e.g. within
    // your org domain) - the tenant directory can include guests/other
    // accounts you don't want showing up here.
    const filtered = [];
    for (const r of results) {
      if (await isEmailAllowed(r.email)) filtered.push(r);
    }
    return NextResponse.json({ results: filtered.slice(0, 8) });
  } catch (err) {
    console.error("directory-search error", err);
    return NextResponse.json({ results: [] });
  }
}

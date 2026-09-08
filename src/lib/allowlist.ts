import { prisma } from "@/lib/db";

/**
 * Checks whether an email is allowed to access the host dashboard.
 *
 * Resolution order:
 * 1. ALLOWED_DOMAIN env var, if set (e.g. "yourcompany.com") - anyone with
 *    that domain is allowed. Use this if you don't want to maintain a list.
 * 2. AllowedEmail table in the DB (preferred - editable without a redeploy).
 * 3. ALLOWED_EMAILS env var as a comma-separated fallback/seed list.
 *
 * All checks are case-insensitive.
 */
export async function isEmailAllowed(email: string | null | undefined): Promise<boolean> {
  if (!email) return false;
  const normalized = email.trim().toLowerCase();

  const domain = process.env.ALLOWED_DOMAIN?.trim().toLowerCase();
  if (domain) {
    return normalized.endsWith(`@${domain}`);
  }

  const dbMatch = await prisma.allowedEmail.findUnique({
    where: { email: normalized },
  });
  if (dbMatch) return true;

  const envList = (process.env.ALLOWED_EMAILS ?? "")
    .split(",")
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);

  return envList.includes(normalized);
}

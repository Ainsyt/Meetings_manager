import { NextAuthOptions } from "next-auth";
import AzureADProvider from "next-auth/providers/azure-ad";
import { prisma } from "@/lib/db";
import { encrypt } from "@/lib/crypto";
import { isEmailAllowed } from "@/lib/allowlist";

const SCOPES = ["openid", "profile", "email", "offline_access", "Calendars.ReadWrite", "OnlineMeetings.ReadWrite", "User.Read"].join(" ");

export const authOptions: NextAuthOptions = {
  providers: [
    AzureADProvider({
      clientId: process.env.AZURE_AD_CLIENT_ID!,
      clientSecret: process.env.AZURE_AD_CLIENT_SECRET!,
      tenantId: process.env.AZURE_AD_TENANT_ID!,
      authorization: { params: { scope: SCOPES } },
    }),
  ],
  session: { strategy: "jwt", maxAge: 12 * 60 * 60 }, // 12h, matches spec section 3a
  callbacks: {
    /**
     * The allowlist gate. This runs BEFORE any account/token is persisted,
     * so a non-allowlisted Microsoft account never gets calendar permissions
     * requested or stored - just an immediate reject.
     */
    async signIn({ user, profile }) {
      const email = (user.email ?? (profile as any)?.email ?? (profile as any)?.preferred_username) as
        | string
        | undefined;
      const allowed = await isEmailAllowed(email);
      if (!allowed) {
        // NextAuth redirects to /api/auth/error?error=AccessDenied
        return false;
      }
      return true;
    },

    /**
     * Persist/refresh the encrypted MS refresh token on every sign-in so the
     * booking flow (which runs with no logged-in user - the guest never
     * authenticates) can act on the host's calendar via Graph later.
     */
    async jwt({ token, account, profile }) {
      if (account && profile) {
        const email = (profile as any).email ?? (profile as any).preferred_username;
        const msUserId = (profile as any).oid ?? (profile as any).sub;
        const displayName = (profile as any).name ?? email;

        if (email && msUserId && account.refresh_token) {
          const username = await deriveUsername(email);
          await prisma.user.upsert({
            where: { msUserId },
            create: {
              msUserId,
              email: email.toLowerCase(),
              username,
              displayName,
              refreshTokenEnc: encrypt(account.refresh_token),
              refreshTokenStatus: "valid",
            },
            update: {
              email: email.toLowerCase(),
              displayName,
              refreshTokenEnc: encrypt(account.refresh_token),
              refreshTokenStatus: "valid",
            },
          });
        }
        token.msUserId = msUserId;
      }
      return token;
    },

    async session({ session, token }) {
      if (session.user) {
        (session.user as any).msUserId = token.msUserId;
      }
      return session;
    },
  },
  pages: {
    error: "/dashboard/access-denied",
  },
};

/**
 * Turns "jsmith@yourcompany.com" into a URL-safe username "jsmith",
 * de-duplicating against existing usernames if needed.
 */
async function deriveUsername(email: string): Promise<string> {
  const base = email.split("@")[0].toLowerCase().replace(/[^a-z0-9]/g, "");
  let candidate = base;
  let suffix = 1;
  // Only loops if there's a genuine collision, which will be rare for a small team.
  while (
    await prisma.user.findFirst({
      where: { username: candidate, email: { not: email.toLowerCase() } },
    })
  ) {
    suffix += 1;
    candidate = `${base}${suffix}`;
  }
  return candidate;
}

import { PrismaClient } from "@prisma/client";

// Standard Next.js Prisma singleton pattern - avoids exhausting DB
// connections from hot-reload in dev / serverless cold starts.
const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

export const prisma = globalForPrisma.prisma ?? new PrismaClient();

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}

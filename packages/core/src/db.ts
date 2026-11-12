import { PrismaClient } from "@prisma/client";

declare global {
  // eslint-disable-next-line no-var
  var svPrisma: PrismaClient | undefined;
}

/** One Prisma client per process (survives dev-server reloads). */
export const prisma: PrismaClient = globalThis.svPrisma ?? new PrismaClient();
if (process.env.NODE_ENV !== "production") globalThis.svPrisma = prisma;

export type Db = PrismaClient;

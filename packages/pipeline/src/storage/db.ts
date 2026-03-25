/**
 * Shared Prisma client instance (lazy singleton).
 *
 * Defers initialization until first access so that dotenv
 * has time to load env vars before we read DATABASE_URL.
 */

import { PrismaClient } from "../generated/prisma/client.js";
import { PrismaPg } from "@prisma/adapter-pg";

let _prisma: PrismaClient | undefined;

export function getPrisma(): PrismaClient {
  if (!_prisma) {
    if (!process.env.DATABASE_URL) {
      throw new Error("DATABASE_URL is not set. Add it to your .env file.");
    }
    const url = new URL(process.env.DATABASE_URL);
    url.searchParams.set("sslmode", "verify-full");
    const adapter = new PrismaPg({ connectionString: url.toString() });
    _prisma = new PrismaClient({ adapter });
  }
  return _prisma;
}

export const prisma = new Proxy({} as PrismaClient, {
  get(_, prop) {
    return Reflect.get(getPrisma(), prop);
  },
});

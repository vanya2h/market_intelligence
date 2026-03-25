/**
 * Shared Prisma client instance (singleton).
 */

import { PrismaClient } from "../generated/prisma/client.js";
import { PrismaPg } from "@prisma/adapter-pg";

const url = new URL(process.env.DATABASE_URL!);
url.searchParams.set("sslmode", "verify-full");
const adapter = new PrismaPg({ connectionString: url.toString() });
export const prisma = new PrismaClient({ adapter });

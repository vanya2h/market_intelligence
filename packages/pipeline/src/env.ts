import path from "node:path";
import dotenv from "dotenv";

// Load .env from the monorepo root (3 levels up from this file)
dotenv.config({ path: path.resolve(import.meta.dirname, "../../../.env") });

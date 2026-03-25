import dotenv from "dotenv";
import path from "node:path";

// Load .env from the monorepo root (3 levels up from this file)
dotenv.config({ path: path.resolve(import.meta.dirname, "../../../.env") });

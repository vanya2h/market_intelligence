import { createApiClient } from "@market-intel/api/client";

const API_URL = process.env.API_URL ?? "http://localhost:3001";

export const api = createApiClient(API_URL);

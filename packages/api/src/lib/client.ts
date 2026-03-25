import { hc } from "hono/client";
import type { AppType } from "../index.js";

export type { AppType };

export function createApiClient(baseUrl: string) {
  return hc<AppType>(baseUrl);
}

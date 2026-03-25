import { createMiddleware } from "hono/factory";

export const apiKeyAuth = createMiddleware(async (c, next) => {
  // Skip auth for health checks
  if (c.req.path === "/api/health") return next();

  const key = c.req.header("X-API-Key") ?? c.req.query("api_key");
  if (!process.env.API_KEY || key !== process.env.API_KEY) {
    return c.json({ error: "Unauthorized" }, 401);
  }
  return next();
});

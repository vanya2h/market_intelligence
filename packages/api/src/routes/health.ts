import { describeRoute, resolver } from "hono-openapi";
import { z } from "zod";
import { createController } from "../common/controller.js";

const HealthSchema = z.object({
  status: z.string(),
  timestamp: z.string(),
});

const route = describeRoute({
  summary: "Health check",
  description: "Returns API health status",
  tags: ["System"],
  responses: {
    200: {
      description: "API is healthy",
      content: {
        "application/json": { schema: resolver(HealthSchema) },
      },
    },
  },
});

export const HealthController = createController({
  build: (factory) =>
    factory.createApp().get("/health", route, (c) => {
      return c.json({ status: "ok", timestamp: new Date().toISOString() });
    }),
});

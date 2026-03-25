import dotenv from "dotenv";
import path from "node:path";
if (process.env.NODE_ENV !== "production") {
  dotenv.config({ path: path.resolve(import.meta.dirname, "../../../.env") });
}

import { Hono } from "hono";
import { serve } from "@hono/node-server";
import { HealthController } from "./routes/health.js";
import { BriefsController } from "./routes/briefs.js";
import { DimensionsController } from "./routes/dimensions.js";
import { PriceController } from "./routes/price.js";
import type { IFactory } from "./common/controller.js";

const factory: IFactory = {
  createApp: () => new Hono(),
};

const app = new Hono()
  .route("/api", HealthController.build(factory))
  .route("/api/briefs", BriefsController.build(factory))
  .route("/api/dimensions", DimensionsController.build(factory))
  .route("/api/price", PriceController.build(factory));

export type AppType = typeof app;

const port = Number(process.env.API_PORT ?? 3001);

serve({ fetch: app.fetch, port, hostname: "0.0.0.0" }, () => {
  console.log(`API server running on http://localhost:${port}`);
});

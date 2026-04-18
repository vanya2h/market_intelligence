import path from "node:path";
import dotenv from "dotenv";
if (process.env.NODE_ENV !== "production") {
  dotenv.config({ path: path.resolve(import.meta.dirname, "../../../.env") });
}

import { serve } from "@hono/node-server";
import { Hono } from "hono";
import type { IFactory } from "./common/controller.js";
import { BriefsController } from "./routes/briefs.js";
import { CandlesController } from "./routes/candles.js";
import { DimensionsController } from "./routes/dimensions.js";
import { HealthController } from "./routes/health.js";
import { PriceController } from "./routes/price.js";
import { TradeIdeasController } from "./routes/trade-ideas.js";

const factory: IFactory = {
  createApp: () => new Hono(),
};

const app = new Hono()
  .route("/api", HealthController.build(factory))
  .route("/api/briefs", BriefsController.build(factory))
  .route("/api/dimensions", DimensionsController.build(factory))
  .route("/api/price", PriceController.build(factory))
  .route("/api/trades", TradeIdeasController.build(factory))
  .route("/api/candles", CandlesController.build(factory));

export type AppType = typeof app;

const port = Number(process.env.API_PORT ?? 3001);

serve({ fetch: app.fetch, port, hostname: "0.0.0.0" }, () => {
  console.log(`API server running on http://localhost:${port}`);
});

export * from "./lib/exports.js";

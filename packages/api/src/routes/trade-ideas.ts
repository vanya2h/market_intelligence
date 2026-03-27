/**
 * Trade Ideas — API Routes
 *
 * Endpoints for querying trade ideas, their returns curves, and aggregate stats.
 */

import { z } from "zod";
import { describeRoute, validator } from "hono-openapi";
import { prisma } from "@market-intel/pipeline";
import { createController } from "../common/controller.js";
import { AssetParamSchema, PaginationQuerySchema } from "../common/schemas.js";
import { tradeIdeaInclude, getTradeIdeaStats, getConfluenceStats } from "../lib/trade-ideas.js";

// ─── GET /latest/:asset ──────────────────────────────────────────────────────

const latestRoute = describeRoute({
  summary: "Get latest trade idea",
  description: "Returns the most recent trade idea for an asset, with full returns curve",
  tags: ["Trade Ideas"],
  responses: {
    200: { description: "Latest trade idea with returns" },
    404: { description: "No trade idea found for this asset" },
  },
});

export const GetLatestTradeIdeaController = createController({
  build: (factory) =>
    factory.createApp().get("/latest/:asset", latestRoute, validator("param", AssetParamSchema), async (c) => {
      const { asset } = c.req.valid("param");
      const idea = await prisma.tradeIdea.findFirst({
        where: { asset },
        orderBy: { createdAt: "desc" },
        include: tradeIdeaInclude,
      });
      if (!idea) return c.json({ error: "No trade idea found" } as const, 404);
      return c.json(idea);
    }),
});

// ─── GET /history/:asset ─────────────────────────────────────────────────────

const historyRoute = describeRoute({
  summary: "Get trade idea history",
  description: "Returns recent trade ideas for an asset with outcomes and quality scores",
  tags: ["Trade Ideas"],
  responses: {
    200: { description: "Array of trade ideas" },
  },
});

export const GetTradeIdeaHistoryController = createController({
  build: (factory) =>
    factory
      .createApp()
      .get(
        "/history/:asset",
        historyRoute,
        validator("param", AssetParamSchema),
        validator("query", PaginationQuerySchema),
        async (c) => {
          const { asset } = c.req.valid("param");
          const { take } = c.req.valid("query");
          const ideas = await prisma.tradeIdea.findMany({
            where: { asset },
            orderBy: { createdAt: "desc" },
            take,
            include: tradeIdeaInclude,
          });
          return c.json(ideas.reverse());
        },
      ),
});

// ─── GET /stats/:asset ──────────────────────────────────────────────────────

const statsRoute = describeRoute({
  summary: "Get trade idea stats",
  description: "Returns aggregate win rate, quality scores, and counts",
  tags: ["Trade Ideas"],
  responses: {
    200: { description: "Aggregate statistics" },
  },
});

export const GetTradeIdeaStatsController = createController({
  build: (factory) =>
    factory.createApp().get("/stats/:asset", statsRoute, validator("param", AssetParamSchema), async (c) => {
      const { asset } = c.req.valid("param");
      const stats = await getTradeIdeaStats(asset);
      return c.json(stats);
    }),
});

// ─── GET /by-brief/:briefId ─────────────────────────────────────────────────

const IdParamSchema = z.object({ briefId: z.string().min(1) });

const byBriefRoute = describeRoute({
  summary: "Get trade idea by brief ID",
  description: "Returns the trade idea linked to a specific brief, with full returns curve",
  tags: ["Trade Ideas"],
  responses: {
    200: { description: "Trade idea with returns" },
    404: { description: "No trade idea for this brief" },
  },
});

export const GetTradeIdeaByBriefController = createController({
  build: (factory) =>
    factory.createApp().get("/by-brief/:briefId", byBriefRoute, validator("param", IdParamSchema), async (c) => {
      const { briefId } = c.req.valid("param");
      const idea = await prisma.tradeIdea.findUnique({
        where: { briefId },
        include: tradeIdeaInclude,
      });
      if (!idea) return c.json({ error: "No trade idea for this brief" } as const, 404);
      return c.json(idea);
    }),
});

// ─── GET /confluence/:asset ──────────────────────────────────────────────────

const confluenceRoute = describeRoute({
  summary: "Get confluence stats",
  description: "Returns per-dimension hit rates bucketed by agreement score (agreed/disagreed/neutral)",
  tags: ["Trade Ideas"],
  responses: {
    200: { description: "Per-dimension confluence statistics" },
  },
});

export const GetConfluenceStatsController = createController({
  build: (factory) =>
    factory.createApp().get("/confluence/:asset", confluenceRoute, validator("param", AssetParamSchema), async (c) => {
      const { asset } = c.req.valid("param");
      const stats = await getConfluenceStats(asset);
      return c.json(stats);
    }),
});

// ─── Composite controller ────────────────────────────────────────────────────

export const TradeIdeasController = createController({
  build: (factory) =>
    factory
      .createApp()
      .route("/", GetLatestTradeIdeaController.build(factory))
      .route("/", GetTradeIdeaHistoryController.build(factory))
      .route("/", GetTradeIdeaStatsController.build(factory))
      .route("/", GetConfluenceStatsController.build(factory))
      .route("/", GetTradeIdeaByBriefController.build(factory)),
});

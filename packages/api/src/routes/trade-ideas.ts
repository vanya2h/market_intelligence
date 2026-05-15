/**
 * Trade Ideas — API Routes
 */

import { prisma } from "@market-intel/pipeline";
import { describeRoute, validator } from "hono-openapi";
import { z } from "zod";
import { createController } from "../common/controller.js";
import { AssetParamSchema, PaginationQuerySchema } from "../common/schemas.js";
import { tradeIdeaInclude } from "../lib/trade-ideas.js";

// ─── GET /latest/:asset ──────────────────────────────────────────────────────

const latestRoute = describeRoute({
  summary: "Get latest trade idea",
  description: "Returns the most recent trade idea for an asset",
  tags: ["Trade Ideas"],
  responses: {
    200: { description: "Latest trade idea" },
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
  description: "Returns recent trade ideas for an asset",
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

// ─── GET /by-brief/:briefId ─────────────────────────────────────────────────

const IdParamSchema = z.object({ briefId: z.string().min(1) });

const byBriefRoute = describeRoute({
  summary: "Get trade idea by brief ID",
  description: "Returns the trade idea linked to a specific brief",
  tags: ["Trade Ideas"],
  responses: {
    200: { description: "Trade idea" },
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

// ─── Composite controller ────────────────────────────────────────────────────

export const TradeIdeasController = createController({
  build: (factory) =>
    factory
      .createApp()
      .route("/", GetLatestTradeIdeaController.build(factory))
      .route("/", GetTradeIdeaHistoryController.build(factory))
      .route("/", GetTradeIdeaByBriefController.build(factory)),
});

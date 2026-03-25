import { describeRoute, resolver, validator } from "hono-openapi";
import { prisma } from "@market-intel/pipeline";
import { createController } from "../common/controller.js";
import { AssetParamSchema, BriefSchema, PaginationQuerySchema } from "../common/schemas.js";

const latestRoute = describeRoute({
  summary: "Get latest brief",
  description: "Returns the most recent market brief for an asset",
  tags: ["Briefs"],
  responses: {
    200: {
      description: "Latest brief with all dimension data",
      content: {
        "application/json": { schema: resolver(BriefSchema) },
      },
    },
    404: { description: "No brief found for this asset" },
  },
});

export const GetLatestBriefController = createController({
  build: (factory) =>
    factory.createApp().get("/latest/:asset", latestRoute, validator("param", AssetParamSchema), async (c) => {
      const { asset } = c.req.valid("param");
      const brief = await prisma.brief.findFirst({
        where: { asset },
        orderBy: { timestamp: "desc" },
        include: { dimensions: true },
      });
      if (!brief) return c.json({ error: "No brief found" }, 404);
      return c.json(brief);
    }),
});

const historyRoute = describeRoute({
  summary: "Get brief history",
  description: "Returns recent briefs for an asset, ordered chronologically",
  tags: ["Briefs"],
  responses: {
    200: {
      description: "Array of briefs with dimension data",
      content: {
        "application/json": {
          schema: resolver(BriefSchema.array()),
        },
      },
    },
  },
});

export const GetBriefHistoryController = createController({
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
          const briefs = await prisma.brief.findMany({
            where: { asset },
            orderBy: { timestamp: "desc" },
            take,
            include: { dimensions: true },
          });
          return c.json(briefs.reverse());
        },
      ),
});

export const BriefsController = createController({
  build: (factory) =>
    factory
      .createApp()
      .route("/", GetLatestBriefController.build(factory))
      .route("/", GetBriefHistoryController.build(factory)),
});

import { describeRoute, resolver, validator } from "hono-openapi";
import { prisma } from "@market-intel/pipeline";
import { createController } from "../common/controller.js";
import {
  AssetParamSchema,
  DimensionParamSchema,
  DimensionStateSchema,
  DimensionSnapshotSchema,
  PaginationQuerySchema,
} from "../common/schemas.js";

const statesRoute = describeRoute({
  summary: "Get dimension states",
  description: "Returns current regime state for all dimensions of an asset",
  tags: ["Dimensions"],
  responses: {
    200: {
      description: "Array of dimension states",
      content: {
        "application/json": {
          schema: resolver(DimensionStateSchema.array()),
        },
      },
    },
  },
});

export const GetDimensionStatesController = createController({
  build: (factory) =>
    factory.createApp().get(
      "/states/:asset",
      statesRoute,
      validator("param", AssetParamSchema),
      async (c) => {
        const { asset } = c.req.valid("param");
        const states = await prisma.dimensionState.findMany({
          where: { asset },
        });
        return c.json(states);
      },
    ),
});

const snapshotsRoute = describeRoute({
  summary: "Get dimension snapshots",
  description:
    "Returns historical snapshots for a specific dimension and asset",
  tags: ["Dimensions"],
  responses: {
    200: {
      description: "Array of dimension snapshots",
      content: {
        "application/json": {
          schema: resolver(DimensionSnapshotSchema.array()),
        },
      },
    },
  },
});

export const GetDimensionSnapshotsController = createController({
  build: (factory) =>
    factory.createApp().get(
      "/snapshots/:asset/:dimension",
      snapshotsRoute,
      validator("param", DimensionParamSchema),
      validator("query", PaginationQuerySchema),
      async (c) => {
        const { asset, dimension } = c.req.valid("param");
        const { take } = c.req.valid("query");
        const snapshots = await prisma.dimensionSnapshot.findMany({
          where: { asset, dimension },
          orderBy: { timestamp: "desc" },
          take,
        });
        return c.json(snapshots.reverse());
      },
    ),
});

export const DimensionsController = createController({
  build: (factory) =>
    factory
      .createApp()
      .route("/", GetDimensionStatesController.build(factory))
      .route("/", GetDimensionSnapshotsController.build(factory)),
});

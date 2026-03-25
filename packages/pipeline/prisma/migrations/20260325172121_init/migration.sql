-- CreateEnum
CREATE TYPE "Asset" AS ENUM ('BTC', 'ETH');

-- CreateEnum
CREATE TYPE "Dimension" AS ENUM ('DERIVATIVES', 'ETFS', 'HTF', 'SENTIMENT');

-- CreateTable
CREATE TABLE "dimension_states" (
    "id" TEXT NOT NULL,
    "asset" "Asset" NOT NULL,
    "dimension" "Dimension" NOT NULL,
    "regime" TEXT NOT NULL,
    "since" TIMESTAMP(3) NOT NULL,
    "previousRegime" TEXT,
    "lastUpdated" TIMESTAMP(3) NOT NULL,
    "metadata" JSONB,

    CONSTRAINT "dimension_states_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "dimension_snapshots" (
    "id" TEXT NOT NULL,
    "asset" "Asset" NOT NULL,
    "dimension" "Dimension" NOT NULL,
    "timestamp" TIMESTAMP(3) NOT NULL,
    "data" JSONB NOT NULL,

    CONSTRAINT "dimension_snapshots_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "briefs" (
    "id" TEXT NOT NULL,
    "asset" "Asset" NOT NULL,
    "timestamp" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "brief" TEXT NOT NULL,
    "compositeIndex" DOUBLE PRECISION,
    "compositeLabel" TEXT,
    "positioning" DOUBLE PRECISION,
    "trend" DOUBLE PRECISION,
    "institutionalFlows" DOUBLE PRECISION,
    "expertConsensus" DOUBLE PRECISION,

    CONSTRAINT "briefs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "brief_dimensions" (
    "id" TEXT NOT NULL,
    "briefId" TEXT NOT NULL,
    "dimension" "Dimension" NOT NULL,
    "label" TEXT NOT NULL,
    "regime" TEXT NOT NULL,
    "context" JSONB NOT NULL,
    "interpretation" TEXT NOT NULL,

    CONSTRAINT "brief_dimensions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "dimension_states_asset_idx" ON "dimension_states"("asset");

-- CreateIndex
CREATE UNIQUE INDEX "dimension_states_asset_dimension_key" ON "dimension_states"("asset", "dimension");

-- CreateIndex
CREATE INDEX "dimension_snapshots_asset_dimension_timestamp_idx" ON "dimension_snapshots"("asset", "dimension", "timestamp");

-- CreateIndex
CREATE INDEX "briefs_asset_timestamp_idx" ON "briefs"("asset", "timestamp");

-- CreateIndex
CREATE UNIQUE INDEX "brief_dimensions_briefId_dimension_key" ON "brief_dimensions"("briefId", "dimension");

-- AddForeignKey
ALTER TABLE "brief_dimensions" ADD CONSTRAINT "brief_dimensions_briefId_fkey" FOREIGN KEY ("briefId") REFERENCES "briefs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

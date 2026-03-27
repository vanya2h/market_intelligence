-- CreateEnum
CREATE TYPE "TradeDirection" AS ENUM ('LONG', 'SHORT', 'FLAT');

-- CreateEnum
CREATE TYPE "TradeOutcome" AS ENUM ('OPEN', 'WIN', 'LOSS');

-- CreateEnum
CREATE TYPE "LevelType" AS ENUM ('INVALIDATION', 'TARGET');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "HtfRegime" ADD VALUE 'ACCUMULATION';
ALTER TYPE "HtfRegime" ADD VALUE 'DISTRIBUTION';

-- CreateTable
CREATE TABLE "trade_ideas" (
    "id" TEXT NOT NULL,
    "briefId" TEXT NOT NULL,
    "asset" "Asset" NOT NULL,
    "direction" "TradeDirection" NOT NULL,
    "entryPrice" DOUBLE PRECISION NOT NULL,
    "compositeTarget" DOUBLE PRECISION NOT NULL,
    "confluence" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "trade_ideas_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "trade_idea_levels" (
    "id" TEXT NOT NULL,
    "tradeIdeaId" TEXT NOT NULL,
    "type" "LevelType" NOT NULL,
    "label" TEXT NOT NULL,
    "price" DOUBLE PRECISION NOT NULL,
    "outcome" "TradeOutcome" NOT NULL DEFAULT 'OPEN',
    "qualityScore" DOUBLE PRECISION,
    "resolvedAt" TIMESTAMP(3),

    CONSTRAINT "trade_idea_levels_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "trade_idea_returns" (
    "id" TEXT NOT NULL,
    "tradeIdeaId" TEXT NOT NULL,
    "hoursAfter" INTEGER NOT NULL,
    "price" DOUBLE PRECISION NOT NULL,
    "returnPct" DOUBLE PRECISION NOT NULL,
    "qualityAtPoint" DOUBLE PRECISION NOT NULL,

    CONSTRAINT "trade_idea_returns_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "trade_ideas_briefId_key" ON "trade_ideas"("briefId");

-- CreateIndex
CREATE INDEX "trade_ideas_asset_createdAt_idx" ON "trade_ideas"("asset", "createdAt");

-- CreateIndex
CREATE INDEX "trade_idea_levels_tradeIdeaId_idx" ON "trade_idea_levels"("tradeIdeaId");

-- CreateIndex
CREATE INDEX "trade_idea_levels_outcome_idx" ON "trade_idea_levels"("outcome");

-- CreateIndex
CREATE INDEX "trade_idea_levels_type_outcome_idx" ON "trade_idea_levels"("type", "outcome");

-- CreateIndex
CREATE UNIQUE INDEX "trade_idea_levels_tradeIdeaId_type_label_key" ON "trade_idea_levels"("tradeIdeaId", "type", "label");

-- CreateIndex
CREATE INDEX "trade_idea_returns_tradeIdeaId_idx" ON "trade_idea_returns"("tradeIdeaId");

-- CreateIndex
CREATE UNIQUE INDEX "trade_idea_returns_tradeIdeaId_hoursAfter_key" ON "trade_idea_returns"("tradeIdeaId", "hoursAfter");

-- AddForeignKey
ALTER TABLE "trade_ideas" ADD CONSTRAINT "trade_ideas_briefId_fkey" FOREIGN KEY ("briefId") REFERENCES "briefs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "trade_idea_levels" ADD CONSTRAINT "trade_idea_levels_tradeIdeaId_fkey" FOREIGN KEY ("tradeIdeaId") REFERENCES "trade_ideas"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "trade_idea_returns" ADD CONSTRAINT "trade_idea_returns_tradeIdeaId_fkey" FOREIGN KEY ("tradeIdeaId") REFERENCES "trade_ideas"("id") ON DELETE CASCADE ON UPDATE CASCADE;

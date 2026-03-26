-- CreateEnum
CREATE TYPE "Asset" AS ENUM ('BTC', 'ETH');

-- CreateEnum
CREATE TYPE "Dimension" AS ENUM ('DERIVATIVES', 'ETFS', 'HTF', 'SENTIMENT');

-- CreateEnum
CREATE TYPE "PositioningRegime" AS ENUM ('CROWDED_LONG', 'CROWDED_SHORT', 'HEATING_UP', 'POSITIONING_NEUTRAL');

-- CreateEnum
CREATE TYPE "StressLevel" AS ENUM ('CAPITULATION', 'UNWINDING', 'DELEVERAGING', 'STRESS_NONE');

-- CreateEnum
CREATE TYPE "EtfRegime" AS ENUM ('STRONG_INFLOW', 'STRONG_OUTFLOW', 'REVERSAL_TO_INFLOW', 'REVERSAL_TO_OUTFLOW', 'ETF_NEUTRAL', 'MIXED');

-- CreateEnum
CREATE TYPE "HtfRegime" AS ENUM ('MACRO_BULLISH', 'BULL_EXTENDED', 'MACRO_BEARISH', 'BEAR_EXTENDED', 'RECLAIMING', 'RANGING');

-- CreateEnum
CREATE TYPE "MarketStructure" AS ENUM ('HH_HL', 'LH_LL', 'HH_LL', 'LH_HL', 'STRUCTURE_UNKNOWN');

-- CreateEnum
CREATE TYPE "OiSignal" AS ENUM ('EXTREME', 'ELEVATED', 'OI_NORMAL', 'DEPRESSED');

-- CreateEnum
CREATE TYPE "SentimentRegime" AS ENUM ('EXTREME_FEAR', 'FEAR', 'SENTIMENT_NEUTRAL', 'GREED', 'EXTREME_GREED', 'CONSENSUS_BULLISH', 'CONSENSUS_BEARISH', 'SENTIMENT_DIVERGENCE');

-- CreateTable
CREATE TABLE "dimension_states" (
    "id" TEXT NOT NULL,
    "asset" "Asset" NOT NULL,
    "dimension" "Dimension" NOT NULL,
    "regime" TEXT NOT NULL,
    "since" TIMESTAMP(3) NOT NULL,
    "previousRegime" TEXT,
    "lastUpdated" TIMESTAMP(3) NOT NULL,
    "stress" TEXT,
    "previousStress" TEXT,
    "lastStructure" TEXT,

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
    "richBrief" JSONB,
    "dimensions" "Dimension"[],

    CONSTRAINT "briefs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "brief_derivatives" (
    "id" TEXT NOT NULL,
    "briefId" TEXT NOT NULL,
    "regime" "PositioningRegime" NOT NULL,
    "stress" "StressLevel",
    "previousRegime" "PositioningRegime",
    "previousStress" "StressLevel",
    "oiSignal" "OiSignal",
    "since" TIMESTAMP(3) NOT NULL,
    "context" JSONB NOT NULL,
    "interpretation" TEXT NOT NULL,

    CONSTRAINT "brief_derivatives_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "brief_etfs" (
    "id" TEXT NOT NULL,
    "briefId" TEXT NOT NULL,
    "regime" "EtfRegime" NOT NULL,
    "previousRegime" "EtfRegime",
    "since" TIMESTAMP(3) NOT NULL,
    "context" JSONB NOT NULL,
    "interpretation" TEXT NOT NULL,

    CONSTRAINT "brief_etfs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "brief_htf" (
    "id" TEXT NOT NULL,
    "briefId" TEXT NOT NULL,
    "regime" "HtfRegime" NOT NULL,
    "previousRegime" "HtfRegime",
    "since" TIMESTAMP(3) NOT NULL,
    "lastStructure" "MarketStructure",
    "snapshotPrice" DOUBLE PRECISION,
    "context" JSONB NOT NULL,
    "interpretation" TEXT NOT NULL,

    CONSTRAINT "brief_htf_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "brief_sentiment" (
    "id" TEXT NOT NULL,
    "briefId" TEXT NOT NULL,
    "regime" "SentimentRegime" NOT NULL,
    "previousRegime" "SentimentRegime",
    "since" TIMESTAMP(3) NOT NULL,
    "compositeIndex" DOUBLE PRECISION,
    "compositeLabel" TEXT,
    "positioning" DOUBLE PRECISION,
    "trend" DOUBLE PRECISION,
    "institutionalFlows" DOUBLE PRECISION,
    "expertConsensus" DOUBLE PRECISION,
    "context" JSONB NOT NULL,
    "interpretation" TEXT NOT NULL,

    CONSTRAINT "brief_sentiment_pkey" PRIMARY KEY ("id")
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
CREATE UNIQUE INDEX "brief_derivatives_briefId_key" ON "brief_derivatives"("briefId");

-- CreateIndex
CREATE UNIQUE INDEX "brief_etfs_briefId_key" ON "brief_etfs"("briefId");

-- CreateIndex
CREATE UNIQUE INDEX "brief_htf_briefId_key" ON "brief_htf"("briefId");

-- CreateIndex
CREATE UNIQUE INDEX "brief_sentiment_briefId_key" ON "brief_sentiment"("briefId");

-- AddForeignKey
ALTER TABLE "brief_derivatives" ADD CONSTRAINT "brief_derivatives_briefId_fkey" FOREIGN KEY ("briefId") REFERENCES "briefs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "brief_etfs" ADD CONSTRAINT "brief_etfs_briefId_fkey" FOREIGN KEY ("briefId") REFERENCES "briefs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "brief_htf" ADD CONSTRAINT "brief_htf_briefId_fkey" FOREIGN KEY ("briefId") REFERENCES "briefs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "brief_sentiment" ADD CONSTRAINT "brief_sentiment_briefId_fkey" FOREIGN KEY ("briefId") REFERENCES "briefs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

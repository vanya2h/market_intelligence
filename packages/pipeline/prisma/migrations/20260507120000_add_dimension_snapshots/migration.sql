-- Per-dimension snapshot tables — typed time-series rows produced hourly,
-- consumed by ML features and brief generation. Brief models keep a nullable
-- snapshotId pointer so each brief can be traced back to its source snapshot.
--
-- This migration is purely additive: no existing rows are modified or dropped.
-- The legacy `dimension_snapshots` table stays for one release while the
-- backfill runs and the cutover completes.

-- AlterTable: snapshotId pointers on brief models
ALTER TABLE "brief_derivatives" ADD COLUMN "snapshotId" TEXT;
ALTER TABLE "brief_etfs" ADD COLUMN "snapshotId" TEXT;
ALTER TABLE "brief_htf" ADD COLUMN "snapshotId" TEXT;
ALTER TABLE "brief_sentiment" ADD COLUMN "snapshotId" TEXT;
ALTER TABLE "brief_exchange_flows" ADD COLUMN "snapshotId" TEXT;

-- CreateTable
CREATE TABLE "derivatives_snapshots" (
    "id" TEXT NOT NULL,
    "asset" "Asset" NOT NULL,
    "timestamp" TIMESTAMP(3) NOT NULL,
    "regime" "PositioningRegime" NOT NULL,
    "stress" "StressLevel",
    "previousRegime" "PositioningRegime",
    "previousStress" "StressLevel",
    "oiSignal" "OiSignal",
    "since" TIMESTAMP(3) NOT NULL,
    "fundingPct1m" DOUBLE PRECISION,
    "oiZScore30d" DOUBLE PRECISION,
    "oiChange24h" DOUBLE PRECISION,
    "oiChange7d" DOUBLE PRECISION,
    "liqPct1m" DOUBLE PRECISION,
    "fundingPressureCycles" DOUBLE PRECISION,
    "fundingCurrent" DOUBLE PRECISION,
    "fundingPercentile1m" DOUBLE PRECISION,
    "oiCurrent" DOUBLE PRECISION,
    "oiPercentile1m" DOUBLE PRECISION,
    "liq8h" DOUBLE PRECISION,
    "cbPremiumCurrent" DOUBLE PRECISION,
    "cbPremiumPercentile1m" DOUBLE PRECISION,
    "context" JSONB NOT NULL,

    CONSTRAINT "derivatives_snapshots_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "etfs_snapshots" (
    "id" TEXT NOT NULL,
    "asset" "Asset" NOT NULL,
    "timestamp" TIMESTAMP(3) NOT NULL,
    "regime" "EtfRegime" NOT NULL,
    "previousRegime" "EtfRegime",
    "since" TIMESTAMP(3) NOT NULL,
    "flowTodaySigma" DOUBLE PRECISION,
    "flowPercentile1m" DOUBLE PRECISION,
    "flowToday" DOUBLE PRECISION,
    "flowD3Sum" DOUBLE PRECISION,
    "flowD7Sum" DOUBLE PRECISION,
    "consecutiveInflowDays" DOUBLE PRECISION,
    "consecutiveOutflowDays" DOUBLE PRECISION,
    "reversalRatio" DOUBLE PRECISION,
    "totalAumUsd" DOUBLE PRECISION,
    "context" JSONB NOT NULL,

    CONSTRAINT "etfs_snapshots_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "htf_snapshots" (
    "id" TEXT NOT NULL,
    "asset" "Asset" NOT NULL,
    "timestamp" TIMESTAMP(3) NOT NULL,
    "regime" "HtfRegime" NOT NULL,
    "previousRegime" "HtfRegime",
    "since" TIMESTAMP(3) NOT NULL,
    "lastStructure" "MarketStructure",
    "snapshotPrice" DOUBLE PRECISION,
    "priceVsSma50Pct" DOUBLE PRECISION,
    "priceVsSma200Pct" DOUBLE PRECISION,
    "rsiDaily" DOUBLE PRECISION,
    "rsiH4" DOUBLE PRECISION,
    "cvdFutShortSlope" DOUBLE PRECISION,
    "cvdFutShortR2" DOUBLE PRECISION,
    "cvdFutLongSlope" DOUBLE PRECISION,
    "cvdSpotShortSlope" DOUBLE PRECISION,
    "cvdSpotLongSlope" DOUBLE PRECISION,
    "atrPercentile" DOUBLE PRECISION,
    "atrRatio" DOUBLE PRECISION,
    "recentDisplacement" DOUBLE PRECISION,
    "priceVsPocPct" DOUBLE PRECISION,
    "context" JSONB NOT NULL,

    CONSTRAINT "htf_snapshots_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sentiment_snapshots" (
    "id" TEXT NOT NULL,
    "asset" "Asset" NOT NULL,
    "timestamp" TIMESTAMP(3) NOT NULL,
    "regime" "SentimentRegime" NOT NULL,
    "previousRegime" "SentimentRegime",
    "since" TIMESTAMP(3) NOT NULL,
    "compositeIndex" DOUBLE PRECISION,
    "compositeLabel" TEXT,
    "positioning" DOUBLE PRECISION,
    "trend" DOUBLE PRECISION,
    "momentumDivergence" DOUBLE PRECISION,
    "institutionalFlows" DOUBLE PRECISION,
    "exchangeFlows" DOUBLE PRECISION,
    "expertConsensus" DOUBLE PRECISION,
    "consensusIndex" DOUBLE PRECISION,
    "sentZScore" DOUBLE PRECISION,
    "bullishRatio" DOUBLE PRECISION,
    "context" JSONB NOT NULL,

    CONSTRAINT "sentiment_snapshots_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "exchange_flows_snapshots" (
    "id" TEXT NOT NULL,
    "asset" "Asset" NOT NULL,
    "timestamp" TIMESTAMP(3) NOT NULL,
    "regime" "ExchangeFlowsRegime" NOT NULL,
    "previousRegime" "ExchangeFlowsRegime",
    "since" TIMESTAMP(3) NOT NULL,
    "flowTodaySigma" DOUBLE PRECISION,
    "flowPercentile1m" DOUBLE PRECISION,
    "reserveChange1dPct" DOUBLE PRECISION,
    "reserveChange7dPct" DOUBLE PRECISION,
    "reserveChange30dPct" DOUBLE PRECISION,
    "netFlow1d" DOUBLE PRECISION,
    "netFlow7d" DOUBLE PRECISION,
    "context" JSONB NOT NULL,

    CONSTRAINT "exchange_flows_snapshots_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "derivatives_snapshots_asset_timestamp_key" ON "derivatives_snapshots"("asset", "timestamp");
CREATE INDEX "derivatives_snapshots_asset_timestamp_idx" ON "derivatives_snapshots"("asset", "timestamp");

CREATE UNIQUE INDEX "etfs_snapshots_asset_timestamp_key" ON "etfs_snapshots"("asset", "timestamp");
CREATE INDEX "etfs_snapshots_asset_timestamp_idx" ON "etfs_snapshots"("asset", "timestamp");

CREATE UNIQUE INDEX "htf_snapshots_asset_timestamp_key" ON "htf_snapshots"("asset", "timestamp");
CREATE INDEX "htf_snapshots_asset_timestamp_idx" ON "htf_snapshots"("asset", "timestamp");

CREATE UNIQUE INDEX "sentiment_snapshots_asset_timestamp_key" ON "sentiment_snapshots"("asset", "timestamp");
CREATE INDEX "sentiment_snapshots_asset_timestamp_idx" ON "sentiment_snapshots"("asset", "timestamp");

CREATE UNIQUE INDEX "exchange_flows_snapshots_asset_timestamp_key" ON "exchange_flows_snapshots"("asset", "timestamp");
CREATE INDEX "exchange_flows_snapshots_asset_timestamp_idx" ON "exchange_flows_snapshots"("asset", "timestamp");

CREATE INDEX "brief_derivatives_snapshotId_idx" ON "brief_derivatives"("snapshotId");
CREATE INDEX "brief_etfs_snapshotId_idx" ON "brief_etfs"("snapshotId");
CREATE INDEX "brief_htf_snapshotId_idx" ON "brief_htf"("snapshotId");
CREATE INDEX "brief_sentiment_snapshotId_idx" ON "brief_sentiment"("snapshotId");
CREATE INDEX "brief_exchange_flows_snapshotId_idx" ON "brief_exchange_flows"("snapshotId");

-- AddForeignKey
ALTER TABLE "brief_derivatives" ADD CONSTRAINT "brief_derivatives_snapshotId_fkey" FOREIGN KEY ("snapshotId") REFERENCES "derivatives_snapshots"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "brief_etfs" ADD CONSTRAINT "brief_etfs_snapshotId_fkey" FOREIGN KEY ("snapshotId") REFERENCES "etfs_snapshots"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "brief_htf" ADD CONSTRAINT "brief_htf_snapshotId_fkey" FOREIGN KEY ("snapshotId") REFERENCES "htf_snapshots"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "brief_sentiment" ADD CONSTRAINT "brief_sentiment_snapshotId_fkey" FOREIGN KEY ("snapshotId") REFERENCES "sentiment_snapshots"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "brief_exchange_flows" ADD CONSTRAINT "brief_exchange_flows_snapshotId_fkey" FOREIGN KEY ("snapshotId") REFERENCES "exchange_flows_snapshots"("id") ON DELETE SET NULL ON UPDATE CASCADE;

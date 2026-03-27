-- CreateEnum
CREATE TYPE "ExchangeFlowsRegime" AS ENUM ('ACCUMULATION', 'DISTRIBUTION', 'EF_NEUTRAL', 'HEAVY_INFLOW', 'HEAVY_OUTFLOW');

-- AlterEnum
ALTER TYPE "Dimension" ADD VALUE 'EXCHANGE_FLOWS';

-- AlterTable
ALTER TABLE "brief_sentiment" ADD COLUMN     "exchangeFlows" DOUBLE PRECISION;

-- CreateTable
CREATE TABLE "brief_exchange_flows" (
    "id" TEXT NOT NULL,
    "briefId" TEXT NOT NULL,
    "regime" "ExchangeFlowsRegime" NOT NULL,
    "previousRegime" "ExchangeFlowsRegime",
    "since" TIMESTAMP(3) NOT NULL,
    "context" JSONB NOT NULL,
    "interpretation" TEXT NOT NULL,

    CONSTRAINT "brief_exchange_flows_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "brief_exchange_flows_briefId_key" ON "brief_exchange_flows"("briefId");

-- AddForeignKey
ALTER TABLE "brief_exchange_flows" ADD CONSTRAINT "brief_exchange_flows_briefId_fkey" FOREIGN KEY ("briefId") REFERENCES "briefs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

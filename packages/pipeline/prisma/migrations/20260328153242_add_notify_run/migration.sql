-- CreateEnum
CREATE TYPE "NotifyStage" AS ENUM ('DIMENSIONS', 'TRADE_IDEA', 'SYNTHESIS', 'PERSIST', 'TELEGRAM', 'TWITTER');

-- CreateEnum
CREATE TYPE "RunStatus" AS ENUM ('RUNNING', 'COMPLETED', 'FAILED');

-- CreateTable
CREATE TABLE "notify_runs" (
    "id" TEXT NOT NULL,
    "asset" "Asset" NOT NULL,
    "status" "RunStatus" NOT NULL DEFAULT 'RUNNING',
    "lastCompleted" "NotifyStage",
    "failedStage" "NotifyStage",
    "error" TEXT,
    "artifacts" JSONB,
    "briefId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "notify_runs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "notify_runs_asset_createdAt_idx" ON "notify_runs"("asset", "createdAt");

-- CreateIndex
CREATE INDEX "notify_runs_status_idx" ON "notify_runs"("status");

-- AddForeignKey
ALTER TABLE "notify_runs" ADD CONSTRAINT "notify_runs_briefId_fkey" FOREIGN KEY ("briefId") REFERENCES "briefs"("id") ON DELETE SET NULL ON UPDATE CASCADE;

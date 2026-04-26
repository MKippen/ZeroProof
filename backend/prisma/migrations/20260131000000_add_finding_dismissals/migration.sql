-- CreateEnum
CREATE TYPE "FindingType" AS ENUM ('RULE', 'INTENT_GAP');

-- CreateTable
CREATE TABLE "FindingDismissal" (
    "id" TEXT NOT NULL,
    "findingType" "FindingType" NOT NULL,
    "findingId" TEXT NOT NULL,
    "affectedResource" TEXT,
    "reason" TEXT NOT NULL,
    "dismissedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "isActive" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "FindingDismissal_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "FindingDismissal_findingType_isActive_idx" ON "FindingDismissal"("findingType", "isActive");

-- CreateIndex
CREATE UNIQUE INDEX "FindingDismissal_findingType_findingId_affectedResource_key" ON "FindingDismissal"("findingType", "findingId", "affectedResource");

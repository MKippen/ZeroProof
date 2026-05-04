-- CreateEnum
CREATE TYPE "CampaignRunStatus" AS ENUM ('QUEUED', 'RUNNING', 'COMPLETED', 'FAILED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "CampaignVerdict" AS ENUM ('NOT_RUN', 'VALIDATED', 'AT_RISK', 'SUSPECTED_COMPROMISE', 'INCONCLUSIVE', 'DISABLED');

-- AlterTable
ALTER TABLE "Vulnerability"
  ADD COLUMN "campaignId" TEXT,
  ADD COLUMN "campaignRunId" TEXT;

-- CreateTable
CREATE TABLE "CampaignSetting" (
  "id" TEXT NOT NULL,
  "campaignId" TEXT NOT NULL,
  "enabled" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "CampaignSetting_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CampaignRun" (
  "id" TEXT NOT NULL,
  "campaignId" TEXT NOT NULL,
  "status" "CampaignRunStatus" NOT NULL DEFAULT 'QUEUED',
  "verdict" "CampaignVerdict" NOT NULL DEFAULT 'NOT_RUN',
  "configId" TEXT,
  "stepsJson" JSONB NOT NULL,
  "optionsJson" JSONB,
  "evidenceJson" JSONB,
  "summaryJson" JSONB,
  "testRunIdsJson" JSONB,
  "error" TEXT,
  "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "completedAt" TIMESTAMP(3),
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "CampaignRun_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "CampaignSetting_campaignId_key" ON "CampaignSetting"("campaignId");

-- CreateIndex
CREATE INDEX "CampaignRun_campaignId_startedAt_idx" ON "CampaignRun"("campaignId", "startedAt");

-- CreateIndex
CREATE INDEX "CampaignRun_status_idx" ON "CampaignRun"("status");

-- CreateIndex
CREATE INDEX "CampaignRun_verdict_idx" ON "CampaignRun"("verdict");

-- CreateIndex
CREATE INDEX "Vulnerability_campaignId_status_idx" ON "Vulnerability"("campaignId", "status");

-- CreateIndex
CREATE INDEX "Vulnerability_campaignRunId_idx" ON "Vulnerability"("campaignRunId");

-- AddForeignKey
ALTER TABLE "CampaignRun"
  ADD CONSTRAINT "CampaignRun_configId_fkey"
  FOREIGN KEY ("configId") REFERENCES "Configuration"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Vulnerability"
  ADD CONSTRAINT "Vulnerability_campaignRunId_fkey"
  FOREIGN KEY ("campaignRunId") REFERENCES "CampaignRun"("id") ON DELETE SET NULL ON UPDATE CASCADE;

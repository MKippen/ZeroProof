-- CreateEnum
CREATE TYPE "DnsAttributionStatus" AS ENUM ('HEALTHY', 'DEGRADED', 'UNKNOWN');

-- CreateTable
CREATE TABLE "AdGuardConnection" (
  "id" TEXT NOT NULL,
  "name" TEXT NOT NULL DEFAULT 'AdGuard Home',
  "host" TEXT NOT NULL,
  "port" INTEGER NOT NULL DEFAULT 3000,
  "useHttps" BOOLEAN NOT NULL DEFAULT false,
  "usernameEnc" TEXT NOT NULL,
  "passwordEnc" TEXT NOT NULL,
  "isActive" BOOLEAN NOT NULL DEFAULT true,
  "pollingEnabled" BOOLEAN NOT NULL DEFAULT false,
  "pollingIntervalSec" INTEGER NOT NULL DEFAULT 60,
  "retentionDays" INTEGER NOT NULL DEFAULT 30,
  "lastSyncAt" TIMESTAMP(3),
  "lastSyncStatus" "SyncStatus",
  "lastSyncError" TEXT,
  "lastQueryAt" TIMESTAMP(3),
  "queryLogEnabled" BOOLEAN,
  "anonymizeClientIp" BOOLEAN,
  "attributionStatus" "DnsAttributionStatus" NOT NULL DEFAULT 'UNKNOWN',
  "attributionReason" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "AdGuardConnection_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DnsQueryEvent" (
  "id" TEXT NOT NULL,
  "connectionId" TEXT NOT NULL,
  "source" TEXT NOT NULL DEFAULT 'adguard_home',
  "eventHash" TEXT NOT NULL,
  "queriedAt" TIMESTAMP(3) NOT NULL,
  "ingestedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "clientIp" TEXT,
  "clientName" TEXT,
  "clientId" TEXT,
  "clientProto" TEXT,
  "domain" TEXT NOT NULL,
  "queryType" TEXT,
  "status" TEXT,
  "reason" TEXT,
  "rule" TEXT,
  "upstream" TEXT,
  "answerJson" JSONB,
  "rulesJson" JSONB,
  "rawJson" JSONB,
  "isBlocked" BOOLEAN NOT NULL DEFAULT false,
  "isSuspicious" BOOLEAN NOT NULL DEFAULT false,
  "campaignId" TEXT,
  "campaignRunId" TEXT,

  CONSTRAINT "DnsQueryEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DnsSignal" (
  "id" TEXT NOT NULL,
  "connectionId" TEXT NOT NULL,
  "queryEventId" TEXT,
  "type" TEXT NOT NULL,
  "severity" "Severity" NOT NULL,
  "title" TEXT NOT NULL,
  "description" TEXT NOT NULL,
  "domain" TEXT,
  "clientIp" TEXT,
  "clientName" TEXT,
  "campaignId" TEXT,
  "campaignRunId" TEXT,
  "confidence" DOUBLE PRECISION NOT NULL DEFAULT 0.5,
  "evidenceJson" JSONB,
  "detectedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "expiresAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "DnsSignal_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "DnsQueryEvent_eventHash_key" ON "DnsQueryEvent"("eventHash");

-- CreateIndex
CREATE INDEX "DnsQueryEvent_connectionId_queriedAt_idx" ON "DnsQueryEvent"("connectionId", "queriedAt");

-- CreateIndex
CREATE INDEX "DnsQueryEvent_clientIp_idx" ON "DnsQueryEvent"("clientIp");

-- CreateIndex
CREATE INDEX "DnsQueryEvent_domain_idx" ON "DnsQueryEvent"("domain");

-- CreateIndex
CREATE INDEX "DnsQueryEvent_reason_idx" ON "DnsQueryEvent"("reason");

-- CreateIndex
CREATE INDEX "DnsQueryEvent_status_idx" ON "DnsQueryEvent"("status");

-- CreateIndex
CREATE INDEX "DnsQueryEvent_isSuspicious_queriedAt_idx" ON "DnsQueryEvent"("isSuspicious", "queriedAt");

-- CreateIndex
CREATE INDEX "DnsQueryEvent_expiresAt_idx" ON "DnsQueryEvent"("expiresAt");

-- CreateIndex
CREATE INDEX "DnsSignal_connectionId_detectedAt_idx" ON "DnsSignal"("connectionId", "detectedAt");

-- CreateIndex
CREATE INDEX "DnsSignal_type_idx" ON "DnsSignal"("type");

-- CreateIndex
CREATE INDEX "DnsSignal_severity_idx" ON "DnsSignal"("severity");

-- CreateIndex
CREATE INDEX "DnsSignal_domain_idx" ON "DnsSignal"("domain");

-- CreateIndex
CREATE INDEX "DnsSignal_clientIp_idx" ON "DnsSignal"("clientIp");

-- CreateIndex
CREATE INDEX "DnsSignal_campaignId_idx" ON "DnsSignal"("campaignId");

-- CreateIndex
CREATE INDEX "DnsSignal_campaignRunId_idx" ON "DnsSignal"("campaignRunId");

-- CreateIndex
CREATE INDEX "DnsSignal_expiresAt_idx" ON "DnsSignal"("expiresAt");

-- AddForeignKey
ALTER TABLE "DnsQueryEvent"
  ADD CONSTRAINT "DnsQueryEvent_connectionId_fkey"
  FOREIGN KEY ("connectionId") REFERENCES "AdGuardConnection"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DnsSignal"
  ADD CONSTRAINT "DnsSignal_connectionId_fkey"
  FOREIGN KEY ("connectionId") REFERENCES "AdGuardConnection"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DnsSignal"
  ADD CONSTRAINT "DnsSignal_queryEventId_fkey"
  FOREIGN KEY ("queryEventId") REFERENCES "DnsQueryEvent"("id") ON DELETE CASCADE ON UPDATE CASCADE;

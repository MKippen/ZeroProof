-- AlterTable: add polling/retention cursors to UniFiConnection.
-- IF NOT EXISTS so this is a no-op on existing prod DBs where the prior
-- baseline_phantom_objects migration already created UniFiConnection in
-- its full current shape (those columns are present already).
ALTER TABLE "UniFiConnection" ADD COLUMN IF NOT EXISTS "flowsHighWater" TIMESTAMP(3);
ALTER TABLE "UniFiConnection" ADD COLUMN IF NOT EXISTS "threatsHighWater" TIMESTAMP(3);
ALTER TABLE "UniFiConnection" ADD COLUMN IF NOT EXISTS "flowRetentionDays" INTEGER NOT NULL DEFAULT 7;

-- CreateTable: FirewallFlowEvent
CREATE TABLE "FirewallFlowEvent" (
  "id" TEXT NOT NULL,
  "unifiId" TEXT NOT NULL,
  "occurredAt" TIMESTAMP(3) NOT NULL,
  "flowStartAt" TIMESTAMP(3),
  "flowEndAt" TIMESTAMP(3),
  "durationMs" INTEGER,
  "action" TEXT NOT NULL,
  "count" INTEGER NOT NULL DEFAULT 1,
  "protocol" TEXT,
  "service" TEXT,
  "risk" TEXT,
  "direction" TEXT,
  "bytesTotal" BIGINT,
  "packetsTotal" INTEGER,
  "srcMac" TEXT,
  "srcIp" TEXT,
  "srcPort" INTEGER,
  "srcClientName" TEXT,
  "srcHostName" TEXT,
  "srcOui" TEXT,
  "srcNetworkId" TEXT,
  "srcNetworkName" TEXT,
  "srcZoneName" TEXT,
  "srcSubnet" TEXT,
  "dstMac" TEXT,
  "dstIp" TEXT,
  "dstPort" INTEGER,
  "dstClientName" TEXT,
  "dstHostName" TEXT,
  "dstNetworkId" TEXT,
  "dstNetworkName" TEXT,
  "dstZoneName" TEXT,
  "dstRegion" TEXT,
  "dstDomains" JSONB,
  "inNetworkId" TEXT,
  "inNetworkName" TEXT,
  "outNetworkId" TEXT,
  "outNetworkName" TEXT,
  "policies" JSONB NOT NULL,
  "primaryPolicyName" TEXT,
  "connectionId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "FirewallFlowEvent_pkey" PRIMARY KEY ("id")
);

-- Unique by UniFi's row id so re-polling is idempotent.
CREATE UNIQUE INDEX "FirewallFlowEvent_unifiId_key" ON "FirewallFlowEvent"("unifiId");
CREATE INDEX "FirewallFlowEvent_connectionId_occurredAt_idx" ON "FirewallFlowEvent"("connectionId", "occurredAt");
CREATE INDEX "FirewallFlowEvent_connectionId_srcMac_idx" ON "FirewallFlowEvent"("connectionId", "srcMac");
CREATE INDEX "FirewallFlowEvent_connectionId_primaryPolicyName_idx" ON "FirewallFlowEvent"("connectionId", "primaryPolicyName");
CREATE INDEX "FirewallFlowEvent_connectionId_dstRegion_idx" ON "FirewallFlowEvent"("connectionId", "dstRegion");

ALTER TABLE "FirewallFlowEvent" ADD CONSTRAINT "FirewallFlowEvent_connectionId_fkey"
  FOREIGN KEY ("connectionId") REFERENCES "UniFiConnection"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- CreateTable: FirewallThreatEvent
CREATE TABLE "FirewallThreatEvent" (
  "id" TEXT NOT NULL,
  "unifiId" TEXT NOT NULL,
  "occurredAt" TIMESTAMP(3) NOT NULL,
  "category" TEXT,
  "subcategory" TEXT,
  "event" TEXT,
  "key" TEXT,
  "severity" TEXT,
  "status" TEXT,
  "message" TEXT,
  "type" TEXT,
  "srcIp" TEXT,
  "dstIp" TEXT,
  "deviceMac" TEXT,
  "deviceModel" TEXT,
  "rawJson" JSONB,
  "connectionId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "FirewallThreatEvent_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "FirewallThreatEvent_unifiId_key" ON "FirewallThreatEvent"("unifiId");
CREATE INDEX "FirewallThreatEvent_connectionId_occurredAt_idx" ON "FirewallThreatEvent"("connectionId", "occurredAt");
CREATE INDEX "FirewallThreatEvent_connectionId_severity_idx" ON "FirewallThreatEvent"("connectionId", "severity");

ALTER TABLE "FirewallThreatEvent" ADD CONSTRAINT "FirewallThreatEvent_connectionId_fkey"
  FOREIGN KEY ("connectionId") REFERENCES "UniFiConnection"("id") ON DELETE CASCADE ON UPDATE CASCADE;

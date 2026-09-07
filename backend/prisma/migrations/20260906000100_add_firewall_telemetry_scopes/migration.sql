-- Preserve every existing telemetry row and its unknown provenance. Host/site
-- settings have historically been mutable, so backfilling scopes would guess.
BEGIN;

CREATE TABLE "TelemetryScope" (
  "id" TEXT NOT NULL,
  "connectionId" TEXT NOT NULL,
  "controllerHost" TEXT NOT NULL,
  "controllerPort" INTEGER NOT NULL,
  "siteId" TEXT NOT NULL,
  "flowsHighWater" TIMESTAMP(3),
  "threatsHighWater" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "TelemetryScope_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "TelemetryScope_source_key"
  ON "TelemetryScope"("connectionId", "controllerHost", "controllerPort", "siteId");
ALTER TABLE "TelemetryScope" ADD CONSTRAINT "TelemetryScope_connectionId_fkey"
  FOREIGN KEY ("connectionId") REFERENCES "UniFiConnection"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "FirewallFlowEvent" ADD COLUMN "scopeId" TEXT;
ALTER TABLE "FirewallThreatEvent" ADD COLUMN "scopeId" TEXT;

CREATE UNIQUE INDEX "FirewallFlowEvent_scopeId_unifiId_key" ON "FirewallFlowEvent"("scopeId", "unifiId");
CREATE UNIQUE INDEX "FirewallThreatEvent_scopeId_unifiId_key" ON "FirewallThreatEvent"("scopeId", "unifiId");
-- PostgreSQL UNIQUE permits multiple NULL values. Keep old/unscoped writers
-- idempotent within a connection without reinstating global upstream IDs.
CREATE UNIQUE INDEX "FirewallFlowEvent_legacy_connectionId_unifiId_key"
  ON "FirewallFlowEvent"("connectionId", "unifiId") WHERE "scopeId" IS NULL;
CREATE UNIQUE INDEX "FirewallThreatEvent_legacy_connectionId_unifiId_key"
  ON "FirewallThreatEvent"("connectionId", "unifiId") WHERE "scopeId" IS NULL;
DROP INDEX "FirewallFlowEvent_unifiId_key";
DROP INDEX "FirewallThreatEvent_unifiId_key";

CREATE INDEX "FirewallFlowEvent_scopeId_occurredAt_idx" ON "FirewallFlowEvent"("scopeId", "occurredAt");
CREATE INDEX "FirewallThreatEvent_scopeId_occurredAt_idx" ON "FirewallThreatEvent"("scopeId", "occurredAt");
ALTER TABLE "FirewallFlowEvent" ADD CONSTRAINT "FirewallFlowEvent_scopeId_fkey"
  FOREIGN KEY ("scopeId") REFERENCES "TelemetryScope"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "FirewallThreatEvent" ADD CONSTRAINT "FirewallThreatEvent_scopeId_fkey"
  FOREIGN KEY ("scopeId") REFERENCES "TelemetryScope"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- App rollback remains able to ingest unscoped rows through the legacy partial
-- indexes, but old detector code does not respect provenance. A schema rollback
-- cannot restore global unifiId uniqueness after distinct scopes share IDs;
-- retain this additive schema instead of deleting telemetry to recreate it.
COMMIT;

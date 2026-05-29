-- CreateTable: DnsAllowlistEntry — user-managed domains skipped by DNS detectors.
-- Layered on top of the built-in defaults in rules/detection/dns_allowlist.yaml.
CREATE TABLE "DnsAllowlistEntry" (
  "id"                TEXT NOT NULL,
  "parentDomain"      TEXT NOT NULL,
  "scope"             TEXT NOT NULL,
  -- Empty-string sentinel for GLOBAL scope. NULL in a unique index is distinct
  -- in Postgres, so duplicates would slip through.
  "deviceKey"         TEXT NOT NULL DEFAULT '',
  "deviceLabel"       TEXT,
  "sourceDetectionId" TEXT,
  "note"              TEXT,
  "createdAt"         TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdBy"         TEXT,
  CONSTRAINT "DnsAllowlistEntry_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "DnsAllowlistEntry_parentDomain_scope_deviceKey_key"
  ON "DnsAllowlistEntry"("parentDomain", "scope", "deviceKey");
CREATE INDEX "DnsAllowlistEntry_parentDomain_idx"
  ON "DnsAllowlistEntry"("parentDomain");
CREATE INDEX "DnsAllowlistEntry_deviceKey_idx"
  ON "DnsAllowlistEntry"("deviceKey");

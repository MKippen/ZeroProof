-- CreateTable: Detection
CREATE TABLE "Detection" (
  "id"               TEXT NOT NULL,
  "detectorId"       TEXT NOT NULL,
  "fingerprint"      TEXT NOT NULL,
  "severity"         "Severity" NOT NULL,
  "status"           TEXT NOT NULL DEFAULT 'OPEN',
  "title"            TEXT NOT NULL,
  "description"      TEXT NOT NULL,
  "remediation"      TEXT,
  "references"       JSONB,
  "affectedResource" TEXT,
  "srcMac"           TEXT,
  "confidence"       DOUBLE PRECISION NOT NULL DEFAULT 1.0,
  "evidence"         JSONB NOT NULL,
  "metadata"         JSONB,
  "firstSeen"        TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "lastSeen"         TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "expiresAt"        TIMESTAMP(3) NOT NULL,
  "occurrences"      INTEGER NOT NULL DEFAULT 1,
  CONSTRAINT "Detection_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "Detection_fingerprint_key" ON "Detection"("fingerprint");
CREATE INDEX "Detection_severity_lastSeen_idx" ON "Detection"("severity", "lastSeen");
CREATE INDEX "Detection_detectorId_lastSeen_idx" ON "Detection"("detectorId", "lastSeen");
CREATE INDEX "Detection_srcMac_lastSeen_idx" ON "Detection"("srcMac", "lastSeen");
CREATE INDEX "Detection_status_idx" ON "Detection"("status");
CREATE INDEX "Detection_expiresAt_idx" ON "Detection"("expiresAt");

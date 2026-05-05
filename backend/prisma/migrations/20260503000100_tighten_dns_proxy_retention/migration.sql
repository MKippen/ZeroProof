-- Keep DNS query rows short-lived by default and cap existing connections to the v1 retention window.
ALTER TABLE "AdGuardConnection"
  ALTER COLUMN "retentionDays" SET DEFAULT 7;

UPDATE "AdGuardConnection"
SET "retentionDays" = LEAST("retentionDays", 7)
WHERE "retentionDays" > 7;

-- Full AdGuard payloads are not needed for ZeroProof validation. Retain normalized fields
-- plus durable DnsSignal rows, and clear bulky historical payloads from non-signal query rows.
UPDATE "DnsQueryEvent"
SET
  "rawJson" = NULL,
  "answerJson" = NULL,
  "rulesJson" = CASE WHEN "isBlocked" = true THEN "rulesJson" ELSE NULL END
WHERE "isSuspicious" = false;

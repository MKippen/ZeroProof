-- Existing sync/history status is retained. The next owned run can recover
-- abandoned IN_PROGRESS entries; migration does not guess which jobs are live.
BEGIN;
CREATE TABLE "JobLease" (
  "key" TEXT NOT NULL,
  "ownerToken" TEXT NOT NULL,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "JobLease_pkey" PRIMARY KEY ("key")
);
COMMIT;

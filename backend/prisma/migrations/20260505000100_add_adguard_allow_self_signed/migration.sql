-- AlterTable — IF NOT EXISTS so this is a no-op on existing prod DBs that
-- already have the column (Mac-Mini-style installs that pre-date this PR).
ALTER TABLE "AdGuardConnection" ADD COLUMN IF NOT EXISTS "allowSelfSigned" BOOLEAN NOT NULL DEFAULT false;

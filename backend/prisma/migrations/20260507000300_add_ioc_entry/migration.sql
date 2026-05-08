CREATE TABLE "IocEntry" (
  "id"          TEXT NOT NULL,
  "feed"        TEXT NOT NULL,
  "kind"        TEXT NOT NULL,
  "value"       TEXT NOT NULL,
  "category"    TEXT,
  "severity"    TEXT,
  "context"     JSONB,
  "refreshedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "IocEntry_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "IocEntry_feed_kind_value_key" ON "IocEntry"("feed", "kind", "value");
CREATE INDEX "IocEntry_kind_value_idx" ON "IocEntry"("kind", "value");
CREATE INDEX "IocEntry_feed_idx" ON "IocEntry"("feed");
CREATE INDEX "IocEntry_refreshedAt_idx" ON "IocEntry"("refreshedAt");

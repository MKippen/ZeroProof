-- Baseline migration for objects originally introduced via
-- `prisma db push` during early development and never captured by
-- `prisma migrate dev`. Without this, fresh `prisma migrate deploy`
-- fails on later migrations that reference these objects.
--
-- Idempotent: every statement is a no-op against an existing DB
-- (the production Mac Mini install) that already has these objects.

-- Missing enums (wrap in DO/EXCEPTION since CREATE TYPE has no IF NOT EXISTS)

DO $$ BEGIN CREATE TYPE "CampaignRunStatus" AS ENUM ( 'QUEUED', 'RUNNING', 'COMPLETED', 'FAILED', 'CANCELLED' ); EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN CREATE TYPE "CampaignVerdict" AS ENUM ( 'NOT_RUN', 'VALIDATED', 'AT_RISK', 'SUSPECTED_COMPROMISE', 'INCONCLUSIVE', 'DISABLED' ); EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN CREATE TYPE "ChangeType" AS ENUM ( 'CREATED', 'MODIFIED', 'DELETED' ); EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN CREATE TYPE "NotificationType" AS ENUM ( 'NEW_VULNERABILITIES', 'CONFIG_CHANGED', 'SYNC_FAILED', 'SYNC_COMPLETED', 'SECURITY_SCORE_DECREASED', 'NEW_DEVICES', 'FIRMWARE_UPDATE' ); EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN CREATE TYPE "RemediationStatus" AS ENUM ( 'PENDING', 'APPROVED', 'APPLIED', 'FAILED', 'ROLLED_BACK' ); EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN CREATE TYPE "SyncStatus" AS ENUM ( 'SUCCESS', 'FAILED', 'IN_PROGRESS' ); EXCEPTION WHEN duplicate_object THEN NULL; END $$;


-- Missing tables (CREATE TABLE IF NOT EXISTS)

CREATE TABLE IF NOT EXISTS "CachedIntentEval" (
    id text NOT NULL,
    "sourceId" text NOT NULL,
    name text NOT NULL,
    description text NOT NULL,
    category text NOT NULL,
    priority integer NOT NULL,
    "intentSetting" text NOT NULL,
    "yamlContent" text NOT NULL,
    "fileHash" text NOT NULL,
    "filePath" text NOT NULL,
    author text,
    version text,
    tags text[] DEFAULT ARRAY[]::text[],
    enabled boolean DEFAULT true NOT NULL,
    "loadedAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "updatedAt" timestamp(3) without time zone NOT NULL
);

CREATE TABLE IF NOT EXISTS "CachedRule" (
    id text NOT NULL,
    "sourceId" text NOT NULL,
    category text NOT NULL,
    name text NOT NULL,
    description text NOT NULL,
    severity "Severity" NOT NULL,
    impact text NOT NULL,
    remediation text NOT NULL,
    "yamlContent" text NOT NULL,
    "fileHash" text NOT NULL,
    "filePath" text NOT NULL,
    author text,
    version text,
    tags text[] DEFAULT ARRAY[]::text[],
    "references" text[] DEFAULT ARRAY[]::text[],
    enabled boolean DEFAULT true NOT NULL,
    "loadedAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "updatedAt" timestamp(3) without time zone NOT NULL
);

CREATE TABLE IF NOT EXISTS "CachedTest" (
    id text NOT NULL,
    "sourceId" text NOT NULL,
    name text NOT NULL,
    description text NOT NULL,
    category text NOT NULL,
    target text NOT NULL,
    "isDynamic" boolean DEFAULT false NOT NULL,
    "isMeshTest" boolean DEFAULT false NOT NULL,
    "yamlContent" text NOT NULL,
    "fileHash" text NOT NULL,
    "filePath" text NOT NULL,
    author text,
    version text,
    tags text[] DEFAULT ARRAY[]::text[],
    "estimatedDuration" text,
    enabled boolean DEFAULT true NOT NULL,
    "loadedAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "updatedAt" timestamp(3) without time zone NOT NULL
);

CREATE TABLE IF NOT EXISTS "CampaignRun" (
    id text NOT NULL,
    "campaignId" text NOT NULL,
    status "CampaignRunStatus" DEFAULT 'QUEUED'::"CampaignRunStatus" NOT NULL,
    verdict "CampaignVerdict" DEFAULT 'NOT_RUN'::"CampaignVerdict" NOT NULL,
    "configId" text,
    "stepsJson" jsonb NOT NULL,
    "optionsJson" jsonb,
    "evidenceJson" jsonb,
    "summaryJson" jsonb,
    "testRunIdsJson" jsonb,
    error text,
    "startedAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "completedAt" timestamp(3) without time zone,
    "updatedAt" timestamp(3) without time zone NOT NULL
);

CREATE TABLE IF NOT EXISTS "CampaignSetting" (
    id text NOT NULL,
    "campaignId" text NOT NULL,
    enabled boolean DEFAULT true NOT NULL,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "updatedAt" timestamp(3) without time zone NOT NULL
);

CREATE TABLE IF NOT EXISTS "GitHubRuleRepo" (
    id text NOT NULL,
    owner text NOT NULL,
    repo text NOT NULL,
    branch text DEFAULT 'main'::text NOT NULL,
    path text DEFAULT 'rules'::text NOT NULL,
    name text NOT NULL,
    description text,
    "tokenEnc" text,
    enabled boolean DEFAULT true NOT NULL,
    "autoSync" boolean DEFAULT false NOT NULL,
    "syncIntervalMin" integer DEFAULT 1440 NOT NULL,
    "lastSyncAt" timestamp(3) without time zone,
    "lastSyncStatus" "SyncStatus",
    "lastSyncError" text,
    "filesDownloaded" integer,
    "filesUpdated" integer,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "updatedAt" timestamp(3) without time zone NOT NULL
);

CREATE TABLE IF NOT EXISTS "NetworkClient" (
    id text NOT NULL,
    mac text NOT NULL,
    hostname text,
    "displayName" text,
    oui text,
    "lastIp" text,
    "lastNetworkId" text,
    "lastNetworkName" text,
    "isWired" boolean DEFAULT false NOT NULL,
    "unifiFirstSeen" timestamp(3) without time zone,
    "unifiLastSeen" timestamp(3) without time zone,
    "firstTrackedAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "lastUpdatedAt" timestamp(3) without time zone NOT NULL
);

CREATE TABLE IF NOT EXISTS "Notification" (
    id text NOT NULL,
    type "NotificationType" NOT NULL,
    severity "Severity" NOT NULL,
    title text NOT NULL,
    message text NOT NULL,
    "resourceType" text,
    "resourceId" text,
    "isRead" boolean DEFAULT false NOT NULL,
    "isDismissed" boolean DEFAULT false NOT NULL,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "readAt" timestamp(3) without time zone
);

CREATE TABLE IF NOT EXISTS "RemediationAction" (
    id text NOT NULL,
    "vulnerabilityId" text NOT NULL,
    "actionType" text NOT NULL,
    description text NOT NULL,
    "resourceType" text NOT NULL,
    "resourceId" text,
    "changeData" jsonb NOT NULL,
    status "RemediationStatus" DEFAULT 'PENDING'::"RemediationStatus" NOT NULL,
    "appliedAt" timestamp(3) without time zone,
    "appliedBy" integer,
    "errorMessage" text,
    "rollbackData" jsonb,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);

CREATE TABLE IF NOT EXISTS "RuleSource" (
    id text NOT NULL,
    name text NOT NULL,
    description text NOT NULL,
    url text,
    license text,
    "references" text[] DEFAULT ARRAY[]::text[],
    "loadedAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "updatedAt" timestamp(3) without time zone NOT NULL
);

CREATE TABLE IF NOT EXISTS "UniFiConfigChange" (
    id text NOT NULL,
    "connectionId" text NOT NULL,
    "changeType" "ChangeType" NOT NULL,
    "resourceType" text NOT NULL,
    "resourceId" text,
    "resourceName" text,
    "previousValue" jsonb,
    "newValue" jsonb,
    "detectedAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "changedBy" text
);

CREATE TABLE IF NOT EXISTS "UniFiConnection" (
    id text NOT NULL,
    name text NOT NULL,
    host text NOT NULL,
    port integer DEFAULT 443 NOT NULL,
    "usernameEnc" text NOT NULL,
    "passwordEnc" text NOT NULL,
    "siteId" text DEFAULT 'default'::text NOT NULL,
    "isActive" boolean DEFAULT true NOT NULL,
    "autoSync" boolean DEFAULT false NOT NULL,
    "syncIntervalMin" integer DEFAULT 1440 NOT NULL,
    "lastSyncAt" timestamp(3) without time zone,
    "lastSyncStatus" "SyncStatus",
    "lastSyncError" text,
    "canWrite" boolean DEFAULT false NOT NULL,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "updatedAt" timestamp(3) without time zone NOT NULL,
    "flowsHighWater" timestamp(3) without time zone,
    "threatsHighWater" timestamp(3) without time zone,
    "flowRetentionDays" integer DEFAULT 7 NOT NULL
);

CREATE TABLE IF NOT EXISTS "UniFiSyncHistory" (
    id text NOT NULL,
    "connectionId" text NOT NULL,
    status "SyncStatus" NOT NULL,
    "startedAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "completedAt" timestamp(3) without time zone,
    "devicesFound" integer,
    "networksFound" integer,
    "rulesFound" integer,
    "wlansFound" integer,
    "changesDetected" integer,
    "vulnerabilitiesFound" integer,
    "errorMessage" text,
    "configId" text
);


-- Missing indexes (CREATE INDEX IF NOT EXISTS)

CREATE INDEX IF NOT EXISTS "CachedIntentEval_intentSetting_idx" ON "CachedIntentEval" USING btree ("intentSetting");

CREATE INDEX IF NOT EXISTS "CachedIntentEval_sourceId_idx" ON "CachedIntentEval" USING btree ("sourceId");

CREATE INDEX IF NOT EXISTS "CachedRule_category_idx" ON "CachedRule" USING btree (category);

CREATE INDEX IF NOT EXISTS "CachedRule_severity_idx" ON "CachedRule" USING btree (severity);

CREATE INDEX IF NOT EXISTS "CachedRule_sourceId_idx" ON "CachedRule" USING btree ("sourceId");

CREATE INDEX IF NOT EXISTS "CachedTest_category_idx" ON "CachedTest" USING btree (category);

CREATE INDEX IF NOT EXISTS "CachedTest_sourceId_idx" ON "CachedTest" USING btree ("sourceId");

CREATE INDEX IF NOT EXISTS "CampaignRun_campaignId_startedAt_idx" ON "CampaignRun" USING btree ("campaignId", "startedAt");

CREATE INDEX IF NOT EXISTS "CampaignRun_status_idx" ON "CampaignRun" USING btree (status);

CREATE INDEX IF NOT EXISTS "CampaignRun_verdict_idx" ON "CampaignRun" USING btree (verdict);

CREATE UNIQUE INDEX IF NOT EXISTS "CampaignSetting_campaignId_key" ON "CampaignSetting" USING btree ("campaignId");

CREATE UNIQUE INDEX IF NOT EXISTS "GitHubRuleRepo_owner_repo_key" ON "GitHubRuleRepo" USING btree (owner, repo);

CREATE INDEX IF NOT EXISTS "NetworkClient_lastNetworkId_idx" ON "NetworkClient" USING btree ("lastNetworkId");

CREATE UNIQUE INDEX IF NOT EXISTS "NetworkClient_mac_key" ON "NetworkClient" USING btree (mac);

CREATE INDEX IF NOT EXISTS "NetworkClient_unifiFirstSeen_idx" ON "NetworkClient" USING btree ("unifiFirstSeen");

CREATE INDEX IF NOT EXISTS "NetworkClient_unifiLastSeen_idx" ON "NetworkClient" USING btree ("unifiLastSeen");

CREATE INDEX IF NOT EXISTS "Notification_isRead_isDismissed_createdAt_idx" ON "Notification" USING btree ("isRead", "isDismissed", "createdAt");

CREATE INDEX IF NOT EXISTS "Notification_type_idx" ON "Notification" USING btree (type);

CREATE INDEX IF NOT EXISTS "RemediationAction_vulnerabilityId_idx" ON "RemediationAction" USING btree ("vulnerabilityId");

CREATE INDEX IF NOT EXISTS "UniFiConfigChange_connectionId_detectedAt_idx" ON "UniFiConfigChange" USING btree ("connectionId", "detectedAt");

CREATE INDEX IF NOT EXISTS "UniFiConfigChange_resourceType_idx" ON "UniFiConfigChange" USING btree ("resourceType");

CREATE INDEX IF NOT EXISTS "UniFiSyncHistory_connectionId_startedAt_idx" ON "UniFiSyncHistory" USING btree ("connectionId", "startedAt");


-- Missing constraints (idempotent via DO/EXCEPTION)

DO $$ BEGIN
  ALTER TABLE ONLY "CachedIntentEval"
    ADD CONSTRAINT "CachedIntentEval_pkey" PRIMARY KEY (id);
EXCEPTION WHEN duplicate_object THEN NULL; WHEN duplicate_table THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE ONLY "CachedRule"
    ADD CONSTRAINT "CachedRule_pkey" PRIMARY KEY (id);
EXCEPTION WHEN duplicate_object THEN NULL; WHEN duplicate_table THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE ONLY "CachedTest"
    ADD CONSTRAINT "CachedTest_pkey" PRIMARY KEY (id);
EXCEPTION WHEN duplicate_object THEN NULL; WHEN duplicate_table THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE ONLY "CampaignRun"
    ADD CONSTRAINT "CampaignRun_pkey" PRIMARY KEY (id);
EXCEPTION WHEN duplicate_object THEN NULL; WHEN duplicate_table THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE ONLY "CampaignSetting"
    ADD CONSTRAINT "CampaignSetting_pkey" PRIMARY KEY (id);
EXCEPTION WHEN duplicate_object THEN NULL; WHEN duplicate_table THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE ONLY "GitHubRuleRepo"
    ADD CONSTRAINT "GitHubRuleRepo_pkey" PRIMARY KEY (id);
EXCEPTION WHEN duplicate_object THEN NULL; WHEN duplicate_table THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE ONLY "NetworkClient"
    ADD CONSTRAINT "NetworkClient_pkey" PRIMARY KEY (id);
EXCEPTION WHEN duplicate_object THEN NULL; WHEN duplicate_table THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE ONLY "Notification"
    ADD CONSTRAINT "Notification_pkey" PRIMARY KEY (id);
EXCEPTION WHEN duplicate_object THEN NULL; WHEN duplicate_table THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE ONLY "RemediationAction"
    ADD CONSTRAINT "RemediationAction_pkey" PRIMARY KEY (id);
EXCEPTION WHEN duplicate_object THEN NULL; WHEN duplicate_table THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE ONLY "RuleSource"
    ADD CONSTRAINT "RuleSource_pkey" PRIMARY KEY (id);
EXCEPTION WHEN duplicate_object THEN NULL; WHEN duplicate_table THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE ONLY "UniFiConfigChange"
    ADD CONSTRAINT "UniFiConfigChange_pkey" PRIMARY KEY (id);
EXCEPTION WHEN duplicate_object THEN NULL; WHEN duplicate_table THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE ONLY "UniFiConnection"
    ADD CONSTRAINT "UniFiConnection_pkey" PRIMARY KEY (id);
EXCEPTION WHEN duplicate_object THEN NULL; WHEN duplicate_table THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE ONLY "UniFiSyncHistory"
    ADD CONSTRAINT "UniFiSyncHistory_pkey" PRIMARY KEY (id);
EXCEPTION WHEN duplicate_object THEN NULL; WHEN duplicate_table THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE ONLY "CampaignRun"
    ADD CONSTRAINT "CampaignRun_configId_fkey" FOREIGN KEY ("configId") REFERENCES "Configuration"(id) ON UPDATE CASCADE ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object THEN NULL; WHEN duplicate_table THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE ONLY "UniFiConfigChange"
    ADD CONSTRAINT "UniFiConfigChange_connectionId_fkey" FOREIGN KEY ("connectionId") REFERENCES "UniFiConnection"(id) ON UPDATE CASCADE ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; WHEN duplicate_table THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE ONLY "UniFiSyncHistory"
    ADD CONSTRAINT "UniFiSyncHistory_connectionId_fkey" FOREIGN KEY ("connectionId") REFERENCES "UniFiConnection"(id) ON UPDATE CASCADE ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; WHEN duplicate_table THEN NULL;
END $$;

-- Preserve the pre-existing UniFi behavior: the backend accepted self-signed
-- controller certificates unless the operator explicitly opts into strict
-- verification from the UI/API.
ALTER TABLE "UniFiConnection" ADD COLUMN "allowSelfSigned" BOOLEAN NOT NULL DEFAULT true;

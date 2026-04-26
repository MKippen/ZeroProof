import { Prisma } from '@prisma/client';
import prisma from './database';

export type JsonObject = Record<string, unknown>;

export interface ResultsTransportPatch {
  chunked?: boolean;
  chunkCount?: number;
  receivedChunks?: number;
  truncated?: boolean;
  incomplete?: boolean;
  reason?: string;
}

function isRecord(value: unknown): value is JsonObject {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

export function asJsonObject(value: unknown): JsonObject {
  return isRecord(value) ? { ...value } : {};
}

function asArray(value: unknown): unknown[] | null {
  return Array.isArray(value) ? [...value] : null;
}

function mergeJson(base: unknown, patch: unknown): unknown {
  if (!isRecord(base) || !isRecord(patch)) return patch;

  const merged: JsonObject = { ...base };
  for (const [key, patchValue] of Object.entries(patch)) {
    const baseValue = merged[key];
    if (isRecord(baseValue) && isRecord(patchValue)) {
      merged[key] = mergeJson(baseValue, patchValue);
    } else {
      merged[key] = patchValue;
    }
  }
  return merged;
}

function extractLegacyMetadata(payload: JsonObject): JsonObject {
  const metadata: JsonObject = {};
  const legacyKeys = ['topologyMetadata', 'deviceToDeviceMetadata', 'honeypotExclusions', 'meshDevices'];

  for (const key of legacyKeys) {
    if (payload[key] !== undefined) {
      metadata[key] = payload[key];
    }
  }

  return metadata;
}

function extractCommandResults(payload: JsonObject): unknown[] {
  return (
    asArray(payload.commandResults) ||
    asArray(payload.results) ||
    asArray(payload.command_results) ||
    []
  );
}

function extractEvidence(payload: JsonObject): unknown[] {
  return asArray(payload.evidence) || [];
}

function extractVerdicts(payload: JsonObject): unknown[] {
  return asArray(payload.verdicts) || [];
}

export function buildStructuredResultsJson(
  existingResultsJson: unknown,
  incomingPayload: unknown,
  transportPatch?: ResultsTransportPatch
): JsonObject {
  const current = asJsonObject(existingResultsJson);
  const incoming = asJsonObject(incomingPayload);

  const mergedRoot = mergeJson(current, incoming) as JsonObject;
  const mergedMetadata = mergeJson(
    mergeJson(asJsonObject(current.metadata), extractLegacyMetadata(current)),
    mergeJson(asJsonObject(incoming.metadata), extractLegacyMetadata(incoming))
  ) as JsonObject;

  const commandResults = extractCommandResults(incoming).length > 0
    ? extractCommandResults(incoming)
    : extractCommandResults(current);
  const evidence = extractEvidence(incoming).length > 0
    ? extractEvidence(incoming)
    : extractEvidence(current);
  const verdicts = extractVerdicts(incoming).length > 0
    ? extractVerdicts(incoming)
    : extractVerdicts(current);

  const mergedTransport = mergeJson(
    asJsonObject(current.transport),
    mergeJson(asJsonObject(incoming.transport), transportPatch || {})
  ) as JsonObject;

  const schemaVersion = typeof incoming.schemaVersion === 'number'
    ? incoming.schemaVersion
    : typeof current.schemaVersion === 'number'
      ? current.schemaVersion
      : 2;

  mergedRoot.metadata = mergedMetadata;
  mergedRoot.commandResults = commandResults;
  mergedRoot.results = commandResults; // Legacy compatibility for existing consumers.
  mergedRoot.evidence = evidence;
  mergedRoot.verdicts = verdicts;
  mergedRoot.transport = mergedTransport;
  mergedRoot.schemaVersion = schemaVersion;

  if (mergedMetadata.topologyMetadata !== undefined) {
    mergedRoot.topologyMetadata = mergedMetadata.topologyMetadata;
  }
  if (mergedMetadata.deviceToDeviceMetadata !== undefined) {
    mergedRoot.deviceToDeviceMetadata = mergedMetadata.deviceToDeviceMetadata;
  }
  if (mergedMetadata.honeypotExclusions !== undefined) {
    mergedRoot.honeypotExclusions = mergedMetadata.honeypotExclusions;
  }

  return mergedRoot;
}

export async function mergeTestRunResultsJson(testId: string, patch: JsonObject): Promise<void> {
  const existing = await prisma.testRun.findUnique({
    where: { id: testId },
    select: { resultsJson: true },
  });

  const merged = mergeJson(asJsonObject(existing?.resultsJson), patch) as JsonObject;

  await prisma.testRun.update({
    where: { id: testId },
    data: {
      resultsJson: merged as Prisma.InputJsonValue,
    },
  });
}

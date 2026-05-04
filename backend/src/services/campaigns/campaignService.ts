import { CampaignRun, CampaignRunStatus, CampaignVerdict, Prisma, VulnStatus } from '@prisma/client';
import prisma from '../database';
import { mqttClient } from '../../mqtt';
import logger from '../../utils/logger';
import {
  CampaignDetail,
  CampaignListItem,
  CampaignOptions,
  CampaignStepId,
  CampaignStepResult,
  CampaignStepState,
} from './types';
import {
  getCampaignDefinition,
  listCampaignDefinitions,
  RESIDENTIAL_PROXY_CAMPAIGN_ID,
} from './registry';
import {
  buildResidentialValidationCommandBatches,
  collectResidentialProxyEvidence,
  evaluateResidentialProxyEvidence,
  mergeResidentialOptions,
  mergeValidationEvidence,
  ResidentialEvidence,
  ResidentialEvaluationSummary,
  toInputJson,
} from './residentialProxy';
import { startCommandTest, TestStartError, waitForTestCompletion } from '../testStartService';

export class CampaignServiceError extends Error {
  code: string;
  status: number;

  constructor(code: string, message: string, status = 400) {
    super(message);
    this.name = 'CampaignServiceError';
    this.code = code;
    this.status = status;
  }
}

function nowIso(): string {
  return new Date().toISOString();
}

function stepStatesForCampaign(campaignId: string): CampaignStepState[] {
  const definition = getCampaignDefinition(campaignId);
  if (!definition) return [];

  return definition.steps.map((step) => ({
    ...step,
    status: 'pending',
  }));
}

function parseSteps(run: Pick<CampaignRun, 'stepsJson'>): CampaignStepState[] {
  return Array.isArray(run.stepsJson) ? (run.stepsJson as unknown as CampaignStepState[]) : [];
}

function parseOptions(run: Pick<CampaignRun, 'optionsJson'>): CampaignOptions {
  return mergeResidentialOptions(
    run.optionsJson && typeof run.optionsJson === 'object'
      ? (run.optionsJson as Partial<CampaignOptions>)
      : undefined
  );
}

function mergeOptions(current: CampaignOptions, patch?: unknown): CampaignOptions {
  if (!patch || typeof patch !== 'object' || Array.isArray(patch)) return mergeResidentialOptions(current);
  return mergeResidentialOptions({ ...current, ...(patch as Partial<CampaignOptions>) });
}

function setStepStatus(
  steps: CampaignStepState[],
  stepId: CampaignStepId,
  status: CampaignStepState['status'],
  message?: string
): CampaignStepState[] {
  return steps.map((step) => {
    if (step.id !== stepId) return step;
    return {
      ...step,
      status,
      message,
      ...(status === 'running' && { startedAt: nowIso() }),
      ...(['completed', 'failed', 'skipped'].includes(status) && { completedAt: nowIso() }),
    };
  });
}

async function getSetting(campaignId: string): Promise<{ enabled: boolean }> {
  const setting = await prisma.campaignSetting.upsert({
    where: { campaignId },
    update: {},
    create: { campaignId, enabled: true },
    select: { enabled: true },
  });
  return setting;
}

async function ensureCampaignEnabled(campaignId: string): Promise<void> {
  const setting = await getSetting(campaignId);
  if (!setting.enabled) {
    throw new CampaignServiceError('CAMPAIGN_DISABLED', 'Campaign is disabled');
  }
}

async function latestRunFor(campaignId: string): Promise<CampaignRun | null> {
  return prisma.campaignRun.findFirst({
    where: { campaignId },
    orderBy: { startedAt: 'desc' },
  });
}

async function openFindingCountFor(campaignId: string): Promise<number> {
  return prisma.vulnerability.count({
    where: {
      campaignId,
      status: { in: ['OPEN', 'ACKNOWLEDGED'] },
    },
  });
}

export async function listCampaigns(): Promise<CampaignListItem[]> {
  const definitions = listCampaignDefinitions();

  return Promise.all(
    definitions.map(async (definition) => {
      const [setting, latestRun, openFindingCount] = await Promise.all([
        getSetting(definition.id),
        latestRunFor(definition.id),
        openFindingCountFor(definition.id),
      ]);

      return {
        definition,
        enabled: setting.enabled,
        latestRun: setting.enabled ? latestRun : latestRun && { ...latestRun, verdict: 'DISABLED' as CampaignVerdict },
        openFindingCount,
      };
    })
  );
}

export async function getCampaign(campaignId: string): Promise<CampaignDetail> {
  const definition = getCampaignDefinition(campaignId);
  if (!definition) {
    throw new CampaignServiceError('CAMPAIGN_NOT_FOUND', 'Campaign not found', 404);
  }

  const [setting, latestRun, openFindingCount, runs] = await Promise.all([
    getSetting(campaignId),
    latestRunFor(campaignId),
    openFindingCountFor(campaignId),
    prisma.campaignRun.findMany({
      where: { campaignId },
      orderBy: { startedAt: 'desc' },
      take: 10,
    }),
  ]);

  return {
    definition,
    enabled: setting.enabled,
    latestRun: setting.enabled ? latestRun : latestRun && { ...latestRun, verdict: 'DISABLED' as CampaignVerdict },
    openFindingCount,
    runs,
  };
}

export async function getCampaignRun(campaignId: string, runId: string): Promise<CampaignRun> {
  return getRunOrThrow(campaignId, runId);
}

export async function updateCampaignSettings(
  campaignId: string,
  enabled: boolean
): Promise<{ enabled: boolean }> {
  const definition = getCampaignDefinition(campaignId);
  if (!definition) {
    throw new CampaignServiceError('CAMPAIGN_NOT_FOUND', 'Campaign not found', 404);
  }

  const setting = await prisma.campaignSetting.upsert({
    where: { campaignId },
    update: { enabled },
    create: { campaignId, enabled },
    select: { enabled: true },
  });

  return setting;
}

export async function startCampaignRun(
  campaignId: string,
  body?: Record<string, unknown>
): Promise<CampaignRun> {
  const definition = getCampaignDefinition(campaignId);
  if (!definition) {
    throw new CampaignServiceError('CAMPAIGN_NOT_FOUND', 'Campaign not found', 404);
  }
  await ensureCampaignEnabled(campaignId);

  const activeConfig = await prisma.configuration.findFirst({
    where: { isActive: true },
    orderBy: { importedAt: 'desc' },
    select: { id: true },
  });
  const options = mergeOptions(definition.defaultOptions, body?.options);

  const run = await prisma.campaignRun.create({
    data: {
      campaignId,
      status: 'RUNNING',
      verdict: 'NOT_RUN',
      configId: activeConfig?.id,
      stepsJson: stepStatesForCampaign(campaignId) as unknown as Prisma.InputJsonValue,
      optionsJson: options as unknown as Prisma.InputJsonValue,
      testRunIdsJson: [] as unknown as Prisma.InputJsonValue,
    },
  });

  mqttClient.broadcastCampaignProgress(campaignId, run.id, 'setup', 'pending', 0);
  return run;
}

function asResidentialEvidence(value: unknown): ResidentialEvidence | null {
  return value && typeof value === 'object' ? (value as ResidentialEvidence) : null;
}

async function getRunOrThrow(campaignId: string, runId: string): Promise<CampaignRun> {
  const run = await prisma.campaignRun.findUnique({ where: { id: runId } });
  if (!run || run.campaignId !== campaignId) {
    throw new CampaignServiceError('RUN_NOT_FOUND', 'Campaign run not found', 404);
  }
  return run;
}

async function executeSetupStep(): Promise<CampaignStepResult> {
  const [activeConfig, connection, runners] = await Promise.all([
    prisma.configuration.findFirst({
      where: { isActive: true },
      orderBy: { importedAt: 'desc' },
      select: { id: true, siteName: true, importedAt: true },
    }),
    prisma.uniFiConnection.findFirst({
      where: { isActive: true },
      orderBy: { createdAt: 'desc' },
      select: { id: true, name: true, host: true },
    }),
    prisma.device.findMany({
      where: { status: 'ONLINE' },
      orderBy: [{ deviceId: 'asc' }],
      select: { id: true, deviceId: true, name: true, status: true, ipAddress: true },
    }),
  ]);

  const summary = {
    setup: {
      activeConfig,
      unifiConnection: connection,
      validationRunners: runners,
      warnings: [
        ...(!activeConfig ? ['No active UniFi configuration is available.'] : []),
        ...(runners.length === 0 ? ['No server-local or ESP32 validation runner is online.'] : []),
      ],
    },
  };

  return {
    summary: summary as Prisma.InputJsonValue,
    message:
      activeConfig && runners.length > 0
        ? 'Setup prerequisites are ready.'
        : 'Setup completed with warnings.',
  };
}

async function executeConfigureStep(
  run: CampaignRun,
  body?: Record<string, unknown>
): Promise<CampaignStepResult> {
  const options = mergeOptions(parseOptions(run), body?.options);
  return {
    options,
    message: 'Campaign options updated.',
  };
}

async function executeCollectStep(run: CampaignRun): Promise<CampaignStepResult> {
  const { evidence, options } = await collectResidentialProxyEvidence(parseOptions(run));
  return {
    options,
    evidence: toInputJson(evidence),
    message: `Collected curated evidence for ${evidence.candidateDevices.length} candidate device(s).`,
  };
}

async function executeEvaluateStep(run: CampaignRun): Promise<CampaignStepResult> {
  let evidence = asResidentialEvidence(run.evidenceJson);
  let options = parseOptions(run);

  if (!evidence) {
    const collected = await collectResidentialProxyEvidence(options);
    evidence = collected.evidence;
    options = collected.options;
  }

  const summary = evaluateResidentialProxyEvidence(evidence);
  return {
    options,
    evidence: toInputJson(evidence),
    summary: toInputJson(summary),
    verdict: summary.verdict,
    message: `Evaluation completed with ${summary.verdict.toLowerCase().replace(/_/g, ' ')} verdict.`,
  };
}

function selectValidationRunner(evidence: ResidentialEvidence): { id: string; deviceId: string; name: string; ipAddress?: string | null } | null {
  const runners = evidence.dataSources.validationRunners;
  return runners.find((runner) => runner.deviceId === 'server-local') || runners[0] || null;
}

async function syncCampaignVulnerabilities(
  campaignId: string,
  runId: string,
  configId: string | null,
  evidence: ResidentialEvidence,
  summary: ResidentialEvaluationSummary
): Promise<void> {
  const setting = await getSetting(campaignId);
  if (!setting.enabled) return;

  const actionableFindings = summary.findings.filter((finding) =>
    ['HIGH', 'MEDIUM'].includes(finding.severity)
  );
  const now = new Date();

  for (const finding of actionableFindings) {
    const existing = await prisma.vulnerability.findFirst({
      where: {
        campaignId,
        type: finding.type,
        affectedResource: finding.affectedResource,
        status: { not: 'FALSE_POSITIVE' },
      },
      orderBy: { lastSeen: 'desc' },
    });

    const data = {
      testRunId: null,
      configId,
      campaignId,
      campaignRunId: runId,
      type: finding.type,
      severity: finding.severity,
      title: finding.title,
      description: finding.description,
      impact: finding.impact,
      remediation: finding.remediation,
      affectedResource: finding.affectedResource,
      status: 'OPEN' as VulnStatus,
      lastSeen: now,
    };

    if (existing) {
      await prisma.vulnerability.update({
        where: { id: existing.id },
        data,
      });
    } else {
      await prisma.vulnerability.create({
        data: {
          ...data,
          firstSeen: now,
        },
      });
    }
  }

  const activeAffectedResources = new Set(actionableFindings.map((finding) => finding.affectedResource));
  const cleanResources = (evidence.validation?.cleanHosts || [])
    .map((ip) => {
      const candidate = evidence.candidateDevices.find((device) => device.ip === ip);
      if (!candidate) return null;
      return `${candidate.name}${candidate.ip ? ` (${candidate.ip})` : ''}`;
    })
    .filter((resource): resource is string => Boolean(resource));

  const fixableResources = cleanResources.filter((resource) => !activeAffectedResources.has(resource));
  if (fixableResources.length > 0) {
    await prisma.vulnerability.updateMany({
      where: {
        campaignId,
        affectedResource: { in: fixableResources },
        status: { in: ['OPEN', 'ACKNOWLEDGED'] },
      },
      data: {
        status: 'FIXED',
        campaignRunId: runId,
        lastSeen: now,
      },
    });
  }
}

async function executeValidateStep(run: CampaignRun): Promise<CampaignStepResult> {
  let evidence = asResidentialEvidence(run.evidenceJson);
  let options = parseOptions(run);

  if (!evidence) {
    const collected = await collectResidentialProxyEvidence(options);
    evidence = collected.evidence;
    options = collected.options;
  }

  const runner = selectValidationRunner(evidence);
  if (!runner) {
    const summary = evaluateResidentialProxyEvidence(evidence);
    return {
      options,
      evidence: toInputJson(evidence),
      summary: toInputJson(summary),
      verdict: 'INCONCLUSIVE',
      message: 'No online validation runner was available.',
    };
  }

  const batches = buildResidentialValidationCommandBatches(evidence, options);
  if (batches.length === 0) {
    const summary = evaluateResidentialProxyEvidence(evidence);
    await syncCampaignVulnerabilities(
      run.campaignId,
      run.id,
      run.configId,
      evidence,
      summary
    );
    return {
      options,
      evidence: toInputJson(evidence),
      summary: toInputJson(summary),
      verdict: summary.verdict,
      message: 'No candidate devices with IP addresses were available for active validation.',
    };
  }

  const completedTestRuns: Array<{ id: string; status: string; resultsJson: unknown }> = [];

  for (const [index, batch] of batches.entries()) {
    mqttClient.broadcastCampaignProgress(
      run.campaignId,
      run.id,
      'validate',
      'running',
      Math.round((index / batches.length) * 100)
    );

    const testRun = await startCommandTest({
      deviceId: runner.id,
      testType: 'campaign_residential_proxy_validation',
      configId: run.configId || undefined,
      commands: batch.commands,
      metadata: {
        campaignId: run.campaignId,
        campaignRunId: run.id,
        batchIndex: index,
        batchCount: batches.length,
      },
    });
    const completed = await waitForTestCompletion(testRun.id, 120_000);
    completedTestRuns.push({
      id: completed.id,
      status: completed.status,
      resultsJson: completed.resultsJson,
    });
  }

  const validatedEvidence = mergeValidationEvidence(
    evidence,
    completedTestRuns,
    options.validationPorts.length,
    runner
  );
  const summary = evaluateResidentialProxyEvidence(validatedEvidence);

  await syncCampaignVulnerabilities(
    run.campaignId,
    run.id,
    run.configId,
    validatedEvidence,
    summary
  );

  return {
    options,
    evidence: toInputJson(validatedEvidence),
    summary: toInputJson(summary),
    verdict: summary.verdict,
    testRunIds: completedTestRuns.map((testRun) => testRun.id),
    message: `Validation completed across ${validatedEvidence.validation?.scannedHosts || 0} host(s).`,
  };
}

async function executeCleanupStep(
  run: CampaignRun,
  body?: Record<string, unknown>
): Promise<CampaignStepResult> {
  const options = mergeOptions(parseOptions(run), body?.options);
  const previousSummary = run.summaryJson && typeof run.summaryJson === 'object'
    ? (run.summaryJson as Record<string, unknown>)
    : {};

  return {
    options,
    summary: toInputJson({
      ...previousSummary,
      cleanup: {
        completed: options.cleanupCompleted,
        updatedAt: nowIso(),
      },
    }),
    message: 'Guided cleanup checklist updated.',
  };
}

async function runStep(
  run: CampaignRun,
  stepId: CampaignStepId,
  body?: Record<string, unknown>
): Promise<CampaignStepResult> {
  if (run.campaignId !== RESIDENTIAL_PROXY_CAMPAIGN_ID) {
    throw new CampaignServiceError('STEP_NOT_IMPLEMENTED', 'Campaign step is not implemented yet');
  }

  switch (stepId) {
    case 'setup':
      return executeSetupStep();
    case 'configure':
      return executeConfigureStep(run, body);
    case 'collect':
      return executeCollectStep(run);
    case 'evaluate':
      return executeEvaluateStep(run);
    case 'validate':
      return executeValidateStep(run);
    case 'cleanup':
      return executeCleanupStep(run, body);
    default:
      throw new CampaignServiceError('STEP_NOT_FOUND', 'Runbook step not found', 404);
  }
}

export async function executeCampaignStep(
  campaignId: string,
  runId: string,
  stepId: CampaignStepId,
  body?: Record<string, unknown>
): Promise<CampaignRun> {
  const definition = getCampaignDefinition(campaignId);
  if (!definition || !definition.steps.some((step) => step.id === stepId)) {
    throw new CampaignServiceError('STEP_NOT_FOUND', 'Runbook step not found', 404);
  }
  await ensureCampaignEnabled(campaignId);

  const run = await getRunOrThrow(campaignId, runId);
  let steps = setStepStatus(parseSteps(run), stepId, 'running');
  await prisma.campaignRun.update({
    where: { id: run.id },
    data: {
      status: 'RUNNING',
      stepsJson: steps as unknown as Prisma.InputJsonValue,
      error: null,
    },
  });
  mqttClient.broadcastCampaignProgress(campaignId, runId, stepId, 'running');

  try {
    const latestRun = await getRunOrThrow(campaignId, runId);
    const result = await runStep(latestRun, stepId, body);
    steps = setStepStatus(parseSteps(latestRun), stepId, 'completed', result.message);

    const existingTestRunIds = Array.isArray(latestRun.testRunIdsJson)
      ? (latestRun.testRunIdsJson as unknown as string[])
      : [];
    const nextTestRunIds = Array.from(new Set([...existingTestRunIds, ...(result.testRunIds || [])]));
    const completesRun = stepId === 'validate' || stepId === 'cleanup';
    const verdict = result.verdict || latestRun.verdict;

    const updated = await prisma.campaignRun.update({
      where: { id: run.id },
      data: {
        status: completesRun ? 'COMPLETED' : 'RUNNING',
        verdict,
        stepsJson: steps as unknown as Prisma.InputJsonValue,
        ...(result.options && { optionsJson: result.options as unknown as Prisma.InputJsonValue }),
        ...(result.evidence && { evidenceJson: result.evidence }),
        ...(result.summary && { summaryJson: result.summary }),
        testRunIdsJson: nextTestRunIds as unknown as Prisma.InputJsonValue,
        ...(completesRun && { completedAt: new Date() }),
      },
    });

    mqttClient.broadcastCampaignProgress(campaignId, runId, stepId, 'completed', 100);
    if (completesRun) {
      mqttClient.broadcastCampaignComplete(campaignId, runId, updated.verdict, updated.status);
    }
    return updated;
  } catch (error) {
    const message =
      error instanceof TestStartError || error instanceof CampaignServiceError || error instanceof Error
        ? error.message
        : 'Campaign step failed';
    steps = setStepStatus(steps, stepId, 'failed', message);
    const failed = await prisma.campaignRun.update({
      where: { id: run.id },
      data: {
        status: 'FAILED',
        verdict: 'INCONCLUSIVE',
        stepsJson: steps as unknown as Prisma.InputJsonValue,
        error: message,
        completedAt: new Date(),
      },
    });
    mqttClient.broadcastCampaignProgress(campaignId, runId, stepId, 'failed');
    mqttClient.broadcastCampaignComplete(campaignId, runId, failed.verdict, failed.status);
    logger.error(`Campaign step failed (${campaignId}/${runId}/${stepId}):`, error);
    throw error;
  }
}

export async function cancelCampaignRun(campaignId: string, runId: string): Promise<CampaignRun> {
  const run = await getRunOrThrow(campaignId, runId);
  const steps = parseSteps(run).map((step) =>
    step.status === 'running'
      ? { ...step, status: 'failed' as const, completedAt: nowIso(), message: 'Run cancelled.' }
      : step
  );

  const updated = await prisma.campaignRun.update({
    where: { id: run.id },
    data: {
      status: 'CANCELLED',
      verdict: 'INCONCLUSIVE',
      stepsJson: steps as unknown as Prisma.InputJsonValue,
      completedAt: new Date(),
      error: 'Run cancelled.',
    },
  });
  mqttClient.broadcastCampaignComplete(campaignId, runId, updated.verdict, updated.status);
  return updated;
}

export function campaignStatusForRun(
  enabled: boolean,
  latestRun: CampaignRun | null
): CampaignVerdict {
  if (!enabled) return 'DISABLED';
  return latestRun?.verdict || 'NOT_RUN';
}

export type { CampaignRunStatus };

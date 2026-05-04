import { CampaignRun, CampaignVerdict, Prisma, Severity } from '@prisma/client';
import { Command } from '../testDefinitions';

export type CampaignStepId = 'setup' | 'configure' | 'collect' | 'evaluate' | 'validate' | 'cleanup';
export type CampaignStepStatus = 'pending' | 'running' | 'completed' | 'failed' | 'skipped';

export interface CampaignStepDefinition {
  id: CampaignStepId;
  label: string;
  description: string;
}

export interface CampaignOptionDefinition {
  id: string;
  label: string;
  type: 'string[]' | 'number[]' | 'boolean' | 'number';
  defaultValue: unknown;
  description?: string;
}

export interface CampaignDefinition {
  id: string;
  name: string;
  shortName: string;
  description: string;
  category: string;
  severity: Severity;
  frontendComponent: string;
  references: Array<{ label: string; url: string }>;
  requiredDataSources: string[];
  steps: CampaignStepDefinition[];
  options: CampaignOptionDefinition[];
  defaultOptions: CampaignOptions;
}

export interface CampaignStepState extends CampaignStepDefinition {
  status: CampaignStepStatus;
  startedAt?: string;
  completedAt?: string;
  message?: string;
}

export interface CampaignOptions {
  targetNetworkKeywords: string[];
  validationPorts: number[];
  manualClientMacs: string[];
  lookbackHours: number;
  validationTimeoutMs: number;
  cleanupCompleted: string[];
}

export interface CampaignListItem {
  definition: CampaignDefinition;
  enabled: boolean;
  latestRun: CampaignRun | null;
  openFindingCount: number;
}

export interface CampaignDetail extends CampaignListItem {
  runs: CampaignRun[];
}

export interface CampaignRunContext {
  run: CampaignRun;
  options: CampaignOptions;
  body?: Record<string, unknown>;
}

export interface CampaignStepResult {
  verdict?: CampaignVerdict;
  options?: CampaignOptions;
  evidence?: Prisma.InputJsonValue;
  summary?: Prisma.InputJsonValue;
  testRunIds?: string[];
  message?: string;
}

export interface ValidationCommandBatch {
  commands: Command[];
  hostCount: number;
  portCount: number;
}

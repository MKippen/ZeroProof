import type { Severity, VulnStatus } from '@/types';

export const SEVERITY_LEVELS: readonly Severity[] = ['CRITICAL', 'HIGH', 'MEDIUM', 'LOW', 'INFO'];

export const SEVERITY_ORDER: Record<Severity, number> = {
  CRITICAL: 0,
  HIGH: 1,
  MEDIUM: 2,
  LOW: 3,
  INFO: 4,
};

export const SEVERITY_LABELS: Record<Severity, string> = {
  CRITICAL: 'Critical',
  HIGH: 'High',
  MEDIUM: 'Medium',
  LOW: 'Low',
  INFO: 'Info',
};

export const SEVERITY_BADGE_VARIANT: Record<
  Severity,
  'critical' | 'high' | 'medium' | 'low' | 'info'
> = {
  CRITICAL: 'critical',
  HIGH: 'high',
  MEDIUM: 'medium',
  LOW: 'low',
  INFO: 'info',
};

export const VULNERABILITY_STATUS_OPTIONS: Array<{ value: VulnStatus; label: string }> = [
  { value: 'OPEN', label: 'Open' },
  { value: 'ACKNOWLEDGED', label: 'Acknowledged' },
  { value: 'FIXED', label: 'Fixed' },
  { value: 'FALSE_POSITIVE', label: 'False Positive' },
];

export const VULNERABILITY_STATUS_CLASS: Record<VulnStatus, string> = {
  OPEN: 'bg-red-500/20 text-red-400',
  ACKNOWLEDGED: 'bg-yellow-500/20 text-yellow-400',
  FIXED: 'bg-green-500/20 text-green-400',
  FALSE_POSITIVE: 'bg-slate-500/20 text-slate-300',
};

export const SEVERITY_FILTER_OPTIONS = [
  'all',
  'CRITICAL_HIGH',
  'MEDIUM_LOW',
  'CRITICAL',
  'HIGH',
  'MEDIUM',
  'LOW',
] as const;

export type SeverityFilterOption = (typeof SEVERITY_FILTER_OPTIONS)[number];

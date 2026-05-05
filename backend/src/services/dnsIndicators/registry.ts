import type { Severity } from '@prisma/client';

export type DnsIndicatorMatch =
  | { kind: 'domain_pattern'; pattern: RegExp }
  | { kind: 'reason_equals'; reason: string };

export interface DnsIndicator {
  /** Unique stable identifier, e.g. 'baseline:adguard_safebrowsing' or 'campaign:residential_proxy:xdresi'. */
  id: string;
  /** Where this indicator came from. Used for attribution and filtering. */
  source: string;
  /** DnsSignal.type value when this indicator fires. */
  type: string;
  /** Human-readable title for the signal/UI. */
  label: string;
  /** Optional description template; `{{domain}}` is substituted at classify time. */
  description?: string;
  severity: Severity;
  /** Default confidence (0..1) for signals produced by this indicator. */
  confidence: number;
  match: DnsIndicatorMatch;
}

export interface ClassifyInput {
  domain: string;
  reason?: string;
  rule?: string;
}

const indicators = new Map<string, DnsIndicator>();

export function registerDnsIndicator(indicator: DnsIndicator): () => void {
  if (indicators.has(indicator.id)) {
    indicators.set(indicator.id, indicator);
  } else {
    indicators.set(indicator.id, indicator);
  }
  return () => {
    indicators.delete(indicator.id);
  };
}

export function unregisterDnsIndicator(id: string): boolean {
  return indicators.delete(id);
}

export function unregisterDnsIndicatorsBySource(source: string): number {
  let removed = 0;
  for (const [id, indicator] of indicators) {
    if (indicator.source === source) {
      indicators.delete(id);
      removed += 1;
    }
  }
  return removed;
}

export function listDnsIndicators(): DnsIndicator[] {
  return Array.from(indicators.values());
}

export function findMatchingDnsIndicator(input: ClassifyInput): DnsIndicator | undefined {
  for (const indicator of indicators.values()) {
    if (indicator.match.kind === 'domain_pattern' && indicator.match.pattern.test(input.domain)) {
      return indicator;
    }
    if (indicator.match.kind === 'reason_equals' && input.reason === indicator.match.reason) {
      return indicator;
    }
  }
  return undefined;
}

/** Reasons that should be treated as security-relevant for cross-correlation queries. */
export function getSecurityRelevantReasons(): string[] {
  const reasons = new Set<string>();
  for (const indicator of indicators.values()) {
    if (indicator.match.kind === 'reason_equals') {
      reasons.add(indicator.match.reason);
    }
  }
  return Array.from(reasons);
}

/** Test-only: clear the registry. */
export function resetDnsIndicators(): void {
  indicators.clear();
}

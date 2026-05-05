import { registerDnsIndicator } from './registry';

export const BASELINE_SOURCE = 'baseline';

/**
 * Registers DNS indicators that ship with ZeroProof itself.
 *
 * These indicators only react to upstream signals AdGuard itself emits
 * (Safe Browsing detections and blocked-service rules). Campaign-specific
 * domain patterns are NOT registered here — those live with their owning
 * campaign module and only activate when that campaign is loaded.
 *
 * Idempotent: re-registering an indicator id overwrites the prior entry.
 */
export function registerBaselineDnsIndicators(): void {
  registerDnsIndicator({
    id: 'baseline:adguard_safebrowsing',
    source: BASELINE_SOURCE,
    type: 'adguard_safebrowsing_block',
    label: 'AdGuard Safe Browsing block',
    description: 'AdGuard blocked {{domain}} using Safe Browsing protection.',
    severity: 'HIGH',
    confidence: 0.85,
    match: { kind: 'reason_equals', reason: 'FilteredSafeBrowsing' },
  });

  registerDnsIndicator({
    id: 'baseline:adguard_blocked_service',
    source: BASELINE_SOURCE,
    type: 'adguard_blocked_service',
    label: 'AdGuard blocked service',
    description: 'AdGuard blocked {{domain}} through a blocked service rule.',
    severity: 'MEDIUM',
    confidence: 0.7,
    match: { kind: 'reason_equals', reason: 'FilteredBlockedService' },
  });
}

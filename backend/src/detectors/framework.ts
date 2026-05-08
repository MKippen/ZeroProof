/**
 * Detection framework — the contract every detector implements.
 *
 * This file owns the *types* and the runner. Each detector lives in its own
 * file under `detectors/<area>/` and exports a `Detector` instance. Detectors
 * never call Prisma's `detection` model directly; they emit `DetectionResult`
 * objects and the runner persists them via `detectionService`. This keeps
 * detectors pure (input → result) and easy to test.
 */
import type { Severity } from '@prisma/client';

/** Time window the detector evaluates. Configurable per run. */
export interface DetectorContext {
  /** Inclusive lower bound (epoch ms) for event queries. */
  beginTime: number;
  /** Inclusive upper bound (epoch ms). Defaults to "now". */
  endTime: number;
  /** Per-run logger, scoped to the detector. */
  log: {
    debug: (msg: string, meta?: object) => void;
    info: (msg: string, meta?: object) => void;
    warn: (msg: string, meta?: object) => void;
  };
  /** ISO timezone for any time-of-day reasoning a detector might do. */
  tz: string;
  /** "now()" — overridable in tests. */
  now: () => number;
}

/**
 * One finding emitted by a detector. The runner converts this into a
 * `Detection` row, deduping by `fingerprint` so re-runs of the same evidence
 * collapse onto a single record (with `occurrences` incremented).
 */
export interface DetectionResult {
  /** Stable across re-evaluations of the same evidence. e.g. `${detectorId}:${srcMac}:${dstIp}` */
  fingerprint: string;
  severity: Severity;
  /** One-line headline shown in the UI feed. */
  title: string;
  /** Multi-line plain-English explanation. */
  description: string;
  /** Optional override of the rule's default remediation. */
  remediation?: string;
  /** What the detection is about — MAC, IP, hostname, network name. */
  affectedResource?: string;
  /** Denormalized source MAC for indexing/grouping when applicable. */
  srcMac?: string;
  /** 0.0–1.0. Defaults to 1.0 (rule-based detections are deterministic by default). */
  confidence?: number;
  /**
   * IDs of underlying rows that triggered this detection. Use the discriminated
   * shape so the UI can link back to the right table for each evidence item.
   */
  evidence: DetectionEvidence[];
  /** Free-form context useful for debugging — not surfaced in the UI by default. */
  metadata?: Record<string, unknown>;
}

export type DetectionEvidence =
  | { kind: 'flow'; id: string }
  | { kind: 'threat'; id: string }
  | { kind: 'dns_query'; id: string }
  | { kind: 'dns_signal'; id: string }
  | { kind: 'ioc'; ioc: string; feed: string }
  | { kind: 'config'; ref: string };

/**
 * The detector contract. Each detector:
 *   - has a stable `id` and `severity` ceiling defined in YAML
 *   - reads from the same `DetectorContext`
 *   - returns zero or more `DetectionResult`s
 *
 * Detectors must be **idempotent**: running twice over the same window yields
 * the same fingerprints. The runner handles dedupe via the unique fingerprint
 * constraint on the Detection table.
 */
export interface Detector {
  /** Stable kebab-case identifier. Matches the YAML rule file's `id`. */
  readonly id: string;
  /** Default time window the detector wants. The scheduler may widen it. */
  readonly defaultWindowMinutes: number;
  /** Single-line description, lifted from the rule YAML. */
  readonly description: string;
  /** Run the detector and emit findings. */
  evaluate(ctx: DetectorContext): Promise<DetectionResult[]>;
}

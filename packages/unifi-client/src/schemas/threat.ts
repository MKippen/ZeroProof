import { z } from 'zod';

const ThreatParamRef = z
  .object({
    id: z.string().optional(),
    name: z.string().optional(),
    not_actionable: z.boolean().optional(),
  })
  .passthrough();

const ThreatDevice = z
  .object({
    id: z.string().optional(),
    ip: z.string().optional(),
    name: z.string().optional(),
    model: z.string().optional(),
    model_name: z.string().optional(),
    version: z.string().optional(),
    fingerprint_source: z.number().optional(),
    device_fingerprint_id: z.number().optional(),
  })
  .passthrough();

const ThreatParameters = z
  .object({
    SRC_IP: ThreatParamRef.optional(),
    DST_IP: ThreatParamRef.optional(),
    DEVICE: ThreatDevice.optional(),
    CONSOLE_NAME: ThreatParamRef.optional(),
    CONSOLE_WITH_DEVICE_NAME: ThreatParamRef.optional(),
    INITIATOR_ID: ThreatParamRef.optional(),
  })
  .passthrough();

/**
 * One row from `POST /v2/api/site/{site}/system-log/threat-alert`. These are
 * IPS / honeypot detections — distinct from the firewall-policy-driven blocks
 * in `traffic-flows`.
 */
export const ThreatAlertSchema = z
  .object({
    id: z.string(),
    /** Stable timestamp in epoch milliseconds. */
    timestamp: z.number().optional(),
    category: z.string().optional(),
    subcategory: z.string().optional(),
    /** Discrete event identifier — e.g. THREAT_BLOCKED. */
    event: z.string().optional(),
    /** Stable key suitable for grouping (e.g. THREAT_BLOCKED_V3). */
    key: z.string().optional(),
    /** Human-friendly rendered message. */
    message: z.string().optional(),
    /** Raw template — useful when the rendered message is too prose-y. */
    message_raw: z.string().optional(),
    severity: z.string().optional(),
    status: z.string().optional(),
    /** Top-level event type (THREAT_DETECTION_AND_PREVENTION etc). */
    type: z.string().optional(),
    title_raw: z.string().optional(),
    target: z.string().optional(),
    show_on_dashboard: z.boolean().optional(),
    parameters: ThreatParameters.optional(),
  })
  .passthrough();

export type ThreatAlert = z.infer<typeof ThreatAlertSchema>;

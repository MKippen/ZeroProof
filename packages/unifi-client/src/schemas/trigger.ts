import { z } from 'zod';

/**
 * One row from `POST /v2/api/site/{site}/system-log/triggers`. These are
 * traffic-rule / firewall-rule / traffic-route hits — what UniFi calls
 * "Top Triggered Policies" on the dashboard.
 *
 * The schema intentionally accepts the broad set of optional fields the
 * controller emits (the exact fields vary by triggerType) and uses
 * `.passthrough()` so unknown fields are preserved on the typed object.
 */
export const TriggerSchema = z
  .object({
    id: z.string(),
    /** Stable epoch-ms timestamp. */
    timestamp: z.number().optional(),
    /** Discrete event class: TRAFFIC_RULE / TRAFFIC_ROUTE / FIREWALL_RULE / etc. */
    triggerType: z.string().optional(),
    category: z.string().optional(),
    subcategory: z.string().optional(),
    event: z.string().optional(),
    key: z.string().optional(),
    severity: z.string().optional(),
    status: z.string().optional(),
    message: z.string().optional(),
    message_raw: z.string().optional(),
    title_raw: z.string().optional(),
    parameters: z.record(z.unknown()).optional(),
  })
  .passthrough();

export type Trigger = z.infer<typeof TriggerSchema>;

/** Categories of triggered policies the controller emits. */
export type TriggerType = 'TRAFFIC_RULE' | 'TRAFFIC_ROUTE' | 'FIREWALL_RULE';

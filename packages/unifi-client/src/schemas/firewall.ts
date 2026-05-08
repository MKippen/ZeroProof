import { z } from 'zod';

/** Legacy firewall rule — `GET /rest/firewallrule`. */
export const FirewallRuleSchema = z
  .object({
    _id: z.string().optional(),
    name: z.string().optional(),
    enabled: z.boolean().optional(),
    action: z.string().optional(),
    rule_index: z.number().optional(),
    ruleset: z.string().optional(),
    protocol: z.string().optional(),
    src_address: z.string().optional(),
    src_address_ipv6: z.string().optional(),
    src_networkconf_id: z.string().optional(),
    dst_address: z.string().optional(),
    dst_address_ipv6: z.string().optional(),
    dst_networkconf_id: z.string().optional(),
    src_port: z.string().optional(),
    dst_port: z.string().optional(),
    site_id: z.string().optional(),
  })
  .passthrough();

export type FirewallRule = z.infer<typeof FirewallRuleSchema>;

/** Legacy firewall group — `GET /rest/firewallgroup`. */
export const FirewallGroupSchema = z
  .object({
    _id: z.string().optional(),
    name: z.string().optional(),
    group_type: z.string().optional(),
    group_members: z.array(z.string()).optional(),
    site_id: z.string().optional(),
  })
  .passthrough();

export type FirewallGroup = z.infer<typeof FirewallGroupSchema>;

/**
 * Zone-based firewall policy — `GET /v2/api/site/{site}/firewall-policies`.
 * Returned as a bare array (no `{data: []}` envelope), unlike the legacy
 * endpoints. UniFi 10.x replacement for the old firewallrule resource.
 */
export const FirewallPolicySchema = z
  .object({
    _id: z.string().optional(),
    name: z.string().optional(),
    action: z.string().optional(),
    enabled: z.boolean().optional(),
    predefined: z.boolean().optional(),
    index: z.number().optional(),
    ip_version: z.string().optional(),
    protocol: z.string().optional(),
    logging: z.boolean().optional(),
    connection_state_type: z.string().optional(),
    connection_states: z.array(z.unknown()).optional(),
    source: z.record(z.unknown()).optional(),
    destination: z.record(z.unknown()).optional(),
    schedule: z.record(z.unknown()).optional(),
  })
  .passthrough();

export type FirewallPolicy = z.infer<typeof FirewallPolicySchema>;

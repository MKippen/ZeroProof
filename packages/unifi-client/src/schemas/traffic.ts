import { z } from 'zod';

/**
 * Traffic rule (v2) — `GET /v2/api/site/{site}/trafficrules`. Application /
 * domain / category-aware traffic shaping ruleset.
 */
export const TrafficRuleSchema = z
  .object({
    _id: z.string().optional(),
    name: z.string().optional(),
    description: z.string().optional(),
    enabled: z.boolean().optional(),
    action: z.string().optional(),
    matching_target: z.string().optional(),
    target_devices: z.array(z.unknown()).optional(),
    schedule: z.record(z.unknown()).optional(),
  })
  .passthrough();

export type TrafficRule = z.infer<typeof TrafficRuleSchema>;

/**
 * Traffic route (v2) — `GET /v2/api/site/{site}/trafficroutes`. Source-based
 * static routes for split-tunnel scenarios.
 */
export const TrafficRouteSchema = z
  .object({
    _id: z.string().optional(),
    description: z.string().optional(),
    enabled: z.boolean().optional(),
    matching_target: z.string().optional(),
    next_hop: z.string().optional(),
    network_id: z.string().optional(),
    target_devices: z.array(z.unknown()).optional(),
  })
  .passthrough();

export type TrafficRoute = z.infer<typeof TrafficRouteSchema>;

/** Legacy port-forward — `GET /rest/portforward`. */
export const PortForwardSchema = z
  .object({
    _id: z.string().optional(),
    name: z.string().optional(),
    enabled: z.boolean().optional(),
    src: z.string().optional(),
    dst_port: z.string().optional(),
    fwd: z.string().optional(),
    fwd_port: z.string().optional(),
    proto: z.string().optional(),
    site_id: z.string().optional(),
  })
  .passthrough();

export type PortForward = z.infer<typeof PortForwardSchema>;

/** Legacy routing rule — `GET /rest/routing`. */
export const RoutingRuleSchema = z
  .object({
    _id: z.string().optional(),
    name: z.string().optional(),
    enabled: z.boolean().optional(),
    type: z.string().optional(),
    static_route_type: z.string().optional(),
    static_route_network: z.string().optional(),
    static_route_nexthop: z.string().optional(),
    site_id: z.string().optional(),
  })
  .passthrough();

export type RoutingRule = z.infer<typeof RoutingRuleSchema>;

import { z } from 'zod';

const ClientFingerprint = z
  .object({
    computed_dev_id: z.number().optional(),
    computed_engine: z.number().optional(),
    confidence: z.number().optional(),
    dev_cat: z.number().optional(),
    dev_family: z.number().optional(),
    dev_id: z.number().optional(),
    dev_vendor: z.number().optional(),
    has_override: z.boolean().optional(),
    os_name: z.number().optional(),
  })
  .passthrough();

const Endpoint = z
  .object({
    client_fingerprint: ClientFingerprint.optional(),
    client_name: z.string().optional(),
    client_oui: z.string().optional(),
    domains: z.array(z.string()).optional(),
    host_name: z.string().optional(),
    id: z.string().optional(),
    ip: z.string().optional(),
    mac: z.string().optional(),
    network_id: z.string().optional(),
    network_name: z.string().optional(),
    port: z.number().optional(),
    region: z.string().optional(),
    subnet: z.string().optional(),
    zone_id: z.string().optional(),
    zone_name: z.string().optional(),
  })
  .passthrough();

const NetworkRef = z
  .object({
    network_id: z.string().optional(),
    network_name: z.string().optional(),
  })
  .passthrough();

const PolicyRef = z
  .object({
    // Some matches (e.g. Region Blocking, IPS signatures) ship without a
    // stable policy id — only `name`/`type`/`internal_type` are reliable.
    id: z.string().optional(),
    name: z.string().optional(),
    type: z.string().optional(),
    internal_type: z.string().optional(),
    ips_category: z.string().optional(),
  })
  .passthrough();

export const FlowSchema = z
  .object({
    id: z.string(),
    action: z.string(),
    count: z.number().optional().default(1),
    protocol: z.string().optional(),
    service: z.string().optional(),
    risk: z.string().optional(),
    direction: z.string().optional(),
    time: z.number().optional(),
    flow_start_time: z.number().optional(),
    flow_end_time: z.number().optional(),
    duration_milliseconds: z.number().optional(),
    traffic_data: z
      .object({
        bytes_total: z.number().optional(),
        packets_total: z.number().optional(),
      })
      .partial()
      .passthrough()
      .optional(),
    source: Endpoint.optional(),
    destination: Endpoint.optional(),
    in: NetworkRef.optional(),
    out: NetworkRef.optional(),
    policies: z.array(PolicyRef).optional().default([]),
    next_ai: z.array(z.unknown()).optional(),
  })
  .passthrough();

export type FlowEvent = z.infer<typeof FlowSchema>;

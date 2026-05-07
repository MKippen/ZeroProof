import { z } from 'zod';

/**
 * Network client (a station, NOT a UniFi-managed device). Returned by
 * `GET /api/s/{site}/stat/sta` (currently online) and `/api/s/{site}/stat/alluser`
 * (historical). Field set varies dramatically by client type so we keep the
 * schema permissive.
 */
export const ClientSchema = z
  .object({
    _id: z.string().optional(),
    mac: z.string(),
    ip: z.string().optional(),
    hostname: z.string().optional(),
    name: z.string().optional(),
    note: z.string().optional(),
    is_wired: z.boolean().optional(),
    is_guest: z.boolean().optional(),
    network: z.string().optional(),
    network_id: z.string().optional(),
    last_seen: z.number().optional(),
    first_seen: z.number().optional(),
    site_id: z.string().optional(),
  })
  .passthrough();

export type NetworkClient = z.infer<typeof ClientSchema>;

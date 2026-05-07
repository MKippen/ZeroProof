import { z } from 'zod';

/**
 * UniFi managed device (gateway, switch, AP, doorbell, camera, etc.). Returned
 * by `GET /api/s/{site}/stat/device`. Many fields are model-dependent; we
 * model the universal ones and rely on `.passthrough()` for the long tail.
 */
export const DeviceSchema = z
  .object({
    _id: z.string(),
    mac: z.string().optional(),
    name: z.string().optional(),
    model: z.string().optional(),
    type: z.string().optional(),
    ip: z.string().optional(),
    version: z.string().optional(),
    adopted: z.boolean().optional(),
    state: z.number().optional(),
    serial: z.string().optional(),
    site_id: z.string().optional(),
  })
  .passthrough();

export type Device = z.infer<typeof DeviceSchema>;

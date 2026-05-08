import { z } from 'zod';

/**
 * Most legacy `/api/s/{site}/...` endpoints return objects with a stable `_id`
 * plus a free-form pile of fields. We model only the fields callers actually
 * read and leave the rest available via `.passthrough()`.
 *
 * Each resource module owns its own narrower schema; this base is exported as
 * a building block.
 */
export const LegacyResourceBase = z
  .object({
    _id: z.string().optional(),
    name: z.string().optional(),
    site_id: z.string().optional(),
    enabled: z.boolean().optional(),
  })
  .passthrough();

export type LegacyResource = z.infer<typeof LegacyResourceBase>;

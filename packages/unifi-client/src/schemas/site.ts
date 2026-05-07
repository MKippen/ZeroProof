import { z } from 'zod';

/**
 * One row from `GET /api/self/sites`. UniFi returns more fields than we model
 * — `.passthrough()` keeps unknown fields available on the typed object so
 * forward-compatibility doesn't require a lib version bump.
 */
export const SiteSchema = z
  .object({
    /** Stable site identifier — typically a CUID-like string. */
    _id: z.string().optional(),
    /** Slug used in URL paths (`/api/s/{name}/...`). */
    name: z.string(),
    /** Human-friendly description. */
    desc: z.string().optional(),
    /** Cluster role indicator (UniFi multi-site setups). */
    role: z.string().optional(),
  })
  .passthrough();

export type Site = z.infer<typeof SiteSchema>;

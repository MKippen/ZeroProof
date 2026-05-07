import { z } from 'zod';

/** UniFi v2 paginated response envelope. */
export const PaginatedV2Envelope = <T extends z.ZodTypeAny>(item: T) =>
  z.object({
    data: z.array(item),
    page_number: z.number().int().nonnegative().optional().default(0),
    total_element_count: z.number().int().nonnegative().optional().default(0),
    total_page_count: z.number().int().nonnegative().optional().default(0),
    has_next: z.boolean().optional(),
    or_more: z.boolean().optional(),
  });

/** Legacy /api/s/{site}/... envelope. */
export const LegacyEnvelope = <T extends z.ZodTypeAny>(item: T) =>
  z.object({
    meta: z.object({ rc: z.string(), msg: z.string().optional() }).optional(),
    data: z.array(item),
  });

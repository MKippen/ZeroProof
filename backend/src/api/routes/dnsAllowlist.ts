/**
 * /api/v1/dns-allowlist — manage the DNS allowlist.
 *
 *   GET    /                returns built-in defaults + user entries + disabled-builtin keys
 *   POST   /                create a user entry { parentDomain, scope, deviceKey?, deviceLabel?, note? }
 *   DELETE /:id             remove a user entry
 *   PUT    /builtin-disabled  replace the set of disabled built-in keys
 *
 * Built-in entries are stored in the YAML rule file and can't be edited
 * through the API; users disable them instead. See dnsAllowlist service.
 */
import { Router, Request, Response } from 'express';
import { z } from 'zod';
import prisma from '../../services/database';
import { requireAuth } from '../middleware/auth';
import {
  getBuiltInAllowlist,
  getDisabledBuiltins,
  setDisabledBuiltins,
  listUserEntries,
  createUserEntry,
  deleteUserEntry,
  builtinKey,
  builtinCategoryKey,
} from '../../services/dnsAllowlist';
import type { ApiResponse } from '../../types';
import logger from '../../utils/logger';

const router = Router();

const CreateBody = z.object({
  parentDomain: z
    .string()
    .min(1)
    .max(253)
    .regex(/^[a-zA-Z0-9.\-_*]+$/, 'invalid domain'),
  scope: z.enum(['GLOBAL', 'DEVICE']),
  deviceKey: z.string().min(1).max(128).optional(),
  deviceLabel: z.string().min(1).max(128).optional(),
  sourceDetectionId: z.string().min(1).max(64).optional(),
  note: z.string().max(500).optional(),
});

const DisabledBody = z.object({
  keys: z.array(z.string().min(1).max(128)),
});

function sendError(
  res: Response,
  error: unknown,
  code: string,
  message: string,
  status = 500
): void {
  if (error instanceof z.ZodError) {
    const response: ApiResponse = {
      success: false,
      error: {
        code: 'VALIDATION_ERROR',
        message: 'Invalid DNS allowlist request',
        details: error.message,
      },
    };
    res.status(400).json(response);
    return;
  }
  const errorMessage = error instanceof Error ? error.message : message;
  if (status >= 500) logger.error(message, error);
  const response: ApiResponse = { success: false, error: { code, message: errorMessage } };
  res.status(status).json(response);
}

router.get('/', requireAuth, async (_req: Request, res: Response) => {
  try {
    const [builtIn, disabledBuiltins, userEntries] = await Promise.all([
      getBuiltInAllowlist(),
      getDisabledBuiltins(),
      listUserEntries(),
    ]);
    const response: ApiResponse = {
      success: true,
      data: {
        builtIn,
        disabledBuiltins,
        userEntries,
      },
    };
    res.json(response);
  } catch (error) {
    sendError(res, error, 'DNS_ALLOWLIST_GET_ERROR', 'Failed to load DNS allowlist');
  }
});

router.post('/', requireAuth, async (req: Request, res: Response) => {
  try {
    const body = CreateBody.parse(req.body ?? {});
    const userId = (req.user as { id?: string } | undefined)?.id ?? null;
    const created = await createUserEntry({
      parentDomain: body.parentDomain,
      scope: body.scope,
      deviceKey: body.deviceKey ?? null,
      deviceLabel: body.deviceLabel ?? null,
      sourceDetectionId: body.sourceDetectionId ?? null,
      note: body.note ?? null,
      createdBy: userId,
    });
    const response: ApiResponse = { success: true, data: created };
    res.json(response);
  } catch (error) {
    sendError(res, error, 'DNS_ALLOWLIST_CREATE_ERROR', 'Failed to create allowlist entry');
  }
});

router.delete('/:id', requireAuth, async (req: Request, res: Response) => {
  try {
    const id = String(req.params.id);
    const result = await deleteUserEntry(id);
    if (!result.deleted) {
      sendError(res, null, 'NOT_FOUND', 'Allowlist entry not found', 404);
      return;
    }
    const response: ApiResponse = { success: true, data: { id, deleted: true } };
    res.json(response);
  } catch (error) {
    sendError(res, error, 'DNS_ALLOWLIST_DELETE_ERROR', 'Failed to delete allowlist entry');
  }
});

router.put('/builtin-disabled', requireAuth, async (req: Request, res: Response) => {
  try {
    const body = DisabledBody.parse(req.body ?? {});
    // Validate every key against the loaded built-in shape — protects the
    // settings row from getting littered with stale or made-up entries.
    const builtIn = getBuiltInAllowlist();
    const valid = new Set<string>();
    for (const cat of builtIn.categories) {
      valid.add(builtinCategoryKey(cat.id));
      for (const d of cat.domains) valid.add(builtinKey(cat.id, d));
    }
    const filtered = body.keys.filter((k) => valid.has(k));
    await setDisabledBuiltins(filtered);
    const response: ApiResponse = {
      success: true,
      data: { disabledBuiltins: filtered },
    };
    res.json(response);
  } catch (error) {
    sendError(res, error, 'DNS_ALLOWLIST_TOGGLE_ERROR', 'Failed to update disabled built-ins');
  }
});

/**
 * Suppress all currently-open dns_tunneling detections that match a
 * (parentDomain, scope, deviceKey) — used right after the user creates
 * an allowlist entry so noisy backlog is cleared in one shot.
 *
 * Distinct from `POST /detections/:id/allowlist` because that route ties
 * an entry to a single source detection; this one cleans the rest.
 */
const BulkResolveBody = z.object({
  parentDomain: z.string().min(1).max(253),
  scope: z.enum(['GLOBAL', 'DEVICE']),
  deviceKey: z.string().min(1).max(128).optional(),
});

router.post('/bulk-resolve', requireAuth, async (req: Request, res: Response) => {
  try {
    const body = BulkResolveBody.parse(req.body ?? {});
    const parent = body.parentDomain.toLowerCase().replace(/\.$/, '');
    if (body.scope === 'DEVICE' && !body.deviceKey) {
      sendError(res, null, 'VALIDATION_ERROR', 'DEVICE scope requires deviceKey', 400);
      return;
    }
    // Match by detector + metadata.parentDomain (+ metadata.clientIp when DEVICE).
    // We can't index into JSON cheaply in Prisma without raw SQL, so do a
    // small fetch and filter — backlog volumes are O(thousands) at worst.
    const candidates = await prisma.detection.findMany({
      where: {
        detectorId: 'dns_tunneling',
        status: 'OPEN',
      },
      select: { id: true, metadata: true },
    });
    const matched: string[] = [];
    for (const c of candidates) {
      const meta = (c.metadata ?? {}) as { parentDomain?: string; clientIp?: string };
      if (meta.parentDomain !== parent) continue;
      if (body.scope === 'DEVICE' && meta.clientIp !== body.deviceKey) continue;
      matched.push(c.id);
    }
    if (matched.length > 0) {
      await prisma.detection.updateMany({
        where: { id: { in: matched } },
        data: { status: 'RESOLVED' },
      });
    }
    const response: ApiResponse = {
      success: true,
      data: { resolvedIds: matched, resolvedCount: matched.length },
    };
    res.json(response);
  } catch (error) {
    sendError(res, error, 'DNS_ALLOWLIST_BULK_RESOLVE_ERROR', 'Failed to bulk-resolve');
  }
});

export default router;

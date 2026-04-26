import { Router, Request, Response } from 'express';
import { requireAuth } from '../middleware/auth';
import { ApiResponse } from '../../types';
import {
  getNotifications,
  getUnreadCount,
  markAsRead,
  markAllAsRead,
  dismissNotification,
} from '../../services/notificationService';
import { NotificationType } from '@prisma/client';
import logger from '../../utils/logger';

const router = Router();

// GET /api/v1/notifications - Paginated list
router.get('/', requireAuth, async (req: Request, res: Response) => {
  try {
    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 20;
    const unreadOnly = req.query.unreadOnly === 'true';
    const type = req.query.type as NotificationType | undefined;

    const result = await getNotifications({ page, limit, unreadOnly, type });

    const response: ApiResponse = {
      success: true,
      data: result,
    };
    res.json(response);
  } catch (error) {
    logger.error('Get notifications error:', error);
    const response: ApiResponse = {
      success: false,
      error: { code: 'FETCH_ERROR', message: 'Failed to fetch notifications' },
    };
    res.status(500).json(response);
  }
});

// GET /api/v1/notifications/unread-count
router.get('/unread-count', requireAuth, async (_req: Request, res: Response) => {
  try {
    const count = await getUnreadCount();
    const response: ApiResponse = { success: true, data: { count } };
    res.json(response);
  } catch (error) {
    logger.error('Get unread count error:', error);
    const response: ApiResponse = {
      success: false,
      error: { code: 'FETCH_ERROR', message: 'Failed to get unread count' },
    };
    res.status(500).json(response);
  }
});

// PATCH /api/v1/notifications/:id/read - Mark single read
router.patch('/:id/read', requireAuth, async (req: Request, res: Response) => {
  try {
    await markAsRead(req.params.id);
    const response: ApiResponse = { success: true };
    res.json(response);
  } catch (error) {
    logger.error('Mark notification read error:', error);
    const response: ApiResponse = {
      success: false,
      error: { code: 'UPDATE_ERROR', message: 'Failed to mark as read' },
    };
    res.status(500).json(response);
  }
});

// POST /api/v1/notifications/mark-all-read
router.post('/mark-all-read', requireAuth, async (_req: Request, res: Response) => {
  try {
    await markAllAsRead();
    const response: ApiResponse = { success: true };
    res.json(response);
  } catch (error) {
    logger.error('Mark all read error:', error);
    const response: ApiResponse = {
      success: false,
      error: { code: 'UPDATE_ERROR', message: 'Failed to mark all as read' },
    };
    res.status(500).json(response);
  }
});

// DELETE /api/v1/notifications/:id - Dismiss
router.delete('/:id', requireAuth, async (req: Request, res: Response) => {
  try {
    await dismissNotification(req.params.id);
    const response: ApiResponse = { success: true };
    res.json(response);
  } catch (error) {
    logger.error('Dismiss notification error:', error);
    const response: ApiResponse = {
      success: false,
      error: { code: 'DELETE_ERROR', message: 'Failed to dismiss notification' },
    };
    res.status(500).json(response);
  }
});

export default router;

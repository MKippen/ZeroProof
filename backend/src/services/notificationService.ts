import { NotificationType, Severity } from '@prisma/client';
import prisma from './database';
import logger from '../utils/logger';

interface CreateNotificationParams {
  type: NotificationType;
  severity: Severity;
  title: string;
  message: string;
  resourceType?: string;
  resourceId?: string;
}

export async function createNotification(params: CreateNotificationParams) {
  const notification = await prisma.notification.create({
    data: {
      type: params.type,
      severity: params.severity,
      title: params.title,
      message: params.message,
      resourceType: params.resourceType,
      resourceId: params.resourceId,
    },
  });

  logger.info(`Notification created: [${params.severity}] ${params.title}`);
  return notification;
}

interface GetNotificationsParams {
  page?: number;
  limit?: number;
  unreadOnly?: boolean;
  type?: NotificationType;
}

export async function getNotifications(params: GetNotificationsParams = {}) {
  const page = params.page || 1;
  const limit = params.limit || 20;
  const skip = (page - 1) * limit;

  const where: any = {
    isDismissed: false,
  };

  if (params.unreadOnly) {
    where.isRead = false;
  }

  if (params.type) {
    where.type = params.type;
  }

  const [notifications, total] = await Promise.all([
    prisma.notification.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip,
      take: limit,
    }),
    prisma.notification.count({ where }),
  ]);

  return {
    notifications,
    pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
  };
}

export async function getUnreadCount(): Promise<number> {
  return prisma.notification.count({
    where: { isRead: false, isDismissed: false },
  });
}

export async function markAsRead(id: string) {
  return prisma.notification.update({
    where: { id },
    data: { isRead: true, readAt: new Date() },
  });
}

export async function markAllAsRead() {
  return prisma.notification.updateMany({
    where: { isRead: false, isDismissed: false },
    data: { isRead: true, readAt: new Date() },
  });
}

export async function dismissNotification(id: string) {
  return prisma.notification.update({
    where: { id },
    data: { isDismissed: true },
  });
}

export async function cleanupOldNotifications() {
  const readDismissedThreshold = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000); // 7 days
  const allThreshold = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000); // 30 days

  const [readResult, oldResult] = await Promise.all([
    prisma.notification.deleteMany({
      where: {
        OR: [{ isRead: true }, { isDismissed: true }],
        createdAt: { lt: readDismissedThreshold },
      },
    }),
    prisma.notification.deleteMany({
      where: { createdAt: { lt: allThreshold } },
    }),
  ]);

  const total = readResult.count + oldResult.count;
  if (total > 0) {
    logger.info(`Cleaned up ${total} old notifications`);
  }
}

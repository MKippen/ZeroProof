// Mock prisma before importing the service
const mockPrisma = {
  notification: {
    create: jest.fn(),
    findMany: jest.fn(),
    count: jest.fn(),
    update: jest.fn(),
    updateMany: jest.fn(),
    deleteMany: jest.fn(),
  },
};

jest.mock('../../../src/services/database', () => ({
  __esModule: true,
  default: mockPrisma,
  prisma: mockPrisma,
}));

import {
  createNotification,
  getNotifications,
  getUnreadCount,
  markAsRead,
  markAllAsRead,
  dismissNotification,
  cleanupOldNotifications,
} from '../../../src/services/notificationService';

describe('NotificationService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('createNotification', () => {
    it('creates a notification with required fields', async () => {
      const mockNotification = {
        id: 'notif-1',
        type: 'CONFIG_CHANGED',
        severity: 'INFO',
        title: 'Config Changed',
        message: '5 changes detected',
        createdAt: new Date(),
      };
      (mockPrisma.notification.create as jest.Mock).mockResolvedValue(mockNotification);

      const result = await createNotification({
        type: 'CONFIG_CHANGED',
        severity: 'INFO',
        title: 'Config Changed',
        message: '5 changes detected',
      });

      expect(mockPrisma.notification.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          type: 'CONFIG_CHANGED',
          severity: 'INFO',
          title: 'Config Changed',
          message: '5 changes detected',
        }),
      });
      expect(result).toEqual(mockNotification);
    });

    it('creates a notification with optional resource fields', async () => {
      (mockPrisma.notification.create as jest.Mock).mockResolvedValue({ id: 'notif-2' });

      await createNotification({
        type: 'NEW_VULNERABILITIES',
        severity: 'CRITICAL',
        title: 'Security Issues',
        message: '3 critical vulnerabilities',
        resourceType: 'configuration',
        resourceId: 'config-123',
      });

      expect(mockPrisma.notification.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          resourceType: 'configuration',
          resourceId: 'config-123',
        }),
      });
    });
  });

  describe('getNotifications', () => {
    it('returns paginated notifications excluding dismissed', async () => {
      const mockNotifications = [
        { id: 'n1', title: 'First', isRead: false },
        { id: 'n2', title: 'Second', isRead: true },
      ];
      (mockPrisma.notification.findMany as jest.Mock).mockResolvedValue(mockNotifications);
      (mockPrisma.notification.count as jest.Mock).mockResolvedValue(2);

      const result = await getNotifications({ page: 1, limit: 20 });

      expect(mockPrisma.notification.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { isDismissed: false },
          orderBy: { createdAt: 'desc' },
          skip: 0,
          take: 20,
        })
      );
      expect(result.notifications).toHaveLength(2);
      expect(result.pagination.page).toBe(1);
    });

    it('filters by unread only', async () => {
      (mockPrisma.notification.findMany as jest.Mock).mockResolvedValue([]);
      (mockPrisma.notification.count as jest.Mock).mockResolvedValue(0);

      await getNotifications({ unreadOnly: true });

      expect(mockPrisma.notification.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { isDismissed: false, isRead: false },
        })
      );
    });

    it('filters by notification type', async () => {
      (mockPrisma.notification.findMany as jest.Mock).mockResolvedValue([]);
      (mockPrisma.notification.count as jest.Mock).mockResolvedValue(0);

      await getNotifications({ type: 'SYNC_FAILED' as any });

      expect(mockPrisma.notification.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { isDismissed: false, type: 'SYNC_FAILED' },
        })
      );
    });

    it('calculates pagination correctly', async () => {
      (mockPrisma.notification.findMany as jest.Mock).mockResolvedValue([]);
      (mockPrisma.notification.count as jest.Mock).mockResolvedValue(45);

      const result = await getNotifications({ page: 2, limit: 10 });

      expect(mockPrisma.notification.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ skip: 10, take: 10 })
      );
      expect(result.pagination.totalPages).toBe(5);
    });
  });

  describe('getUnreadCount', () => {
    it('counts unread, non-dismissed notifications', async () => {
      (mockPrisma.notification.count as jest.Mock).mockResolvedValue(7);

      const count = await getUnreadCount();

      expect(mockPrisma.notification.count).toHaveBeenCalledWith({
        where: { isRead: false, isDismissed: false },
      });
      expect(count).toBe(7);
    });
  });

  describe('markAsRead', () => {
    it('marks a notification as read with timestamp', async () => {
      (mockPrisma.notification.update as jest.Mock).mockResolvedValue({ id: 'n1', isRead: true });

      await markAsRead('n1');

      expect(mockPrisma.notification.update).toHaveBeenCalledWith({
        where: { id: 'n1' },
        data: { isRead: true, readAt: expect.any(Date) },
      });
    });
  });

  describe('markAllAsRead', () => {
    it('marks all unread notifications as read', async () => {
      (mockPrisma.notification.updateMany as jest.Mock).mockResolvedValue({ count: 5 });

      await markAllAsRead();

      expect(mockPrisma.notification.updateMany).toHaveBeenCalledWith({
        where: { isRead: false, isDismissed: false },
        data: { isRead: true, readAt: expect.any(Date) },
      });
    });
  });

  describe('dismissNotification', () => {
    it('dismisses a notification by id', async () => {
      (mockPrisma.notification.update as jest.Mock).mockResolvedValue({ id: 'n1', isDismissed: true });

      await dismissNotification('n1');

      expect(mockPrisma.notification.update).toHaveBeenCalledWith({
        where: { id: 'n1' },
        data: { isDismissed: true },
      });
    });
  });

  describe('cleanupOldNotifications', () => {
    it('deletes read/dismissed notifications older than 7 days and all older than 30 days', async () => {
      (mockPrisma.notification.deleteMany as jest.Mock).mockResolvedValue({ count: 3 });

      await cleanupOldNotifications();

      expect(mockPrisma.notification.deleteMany).toHaveBeenCalledTimes(2);
    });
  });
});

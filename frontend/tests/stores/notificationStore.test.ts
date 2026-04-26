import { describe, it, expect, beforeEach, vi } from 'vitest';
import { useNotificationStore } from '@/stores/notificationStore';

// Mock the API client
vi.mock('@/api/client', () => ({
  default: {
    get: vi.fn(),
    post: vi.fn(),
    patch: vi.fn(),
    delete: vi.fn(),
  },
}));

import api from '@/api/client';

describe('Notification Store', () => {
  beforeEach(() => {
    // Reset store state
    useNotificationStore.setState({
      unreadCount: 0,
      notifications: [],
      isLoading: false,
    });
    vi.clearAllMocks();
  });

  it('should start with zero unread count', () => {
    const state = useNotificationStore.getState();
    expect(state.unreadCount).toBe(0);
    expect(state.notifications).toEqual([]);
    expect(state.isLoading).toBe(false);
  });

  it('should fetch unread count', async () => {
    (api.get as ReturnType<typeof vi.fn>).mockResolvedValue({
      success: true,
      data: { count: 5 },
    });

    await useNotificationStore.getState().fetchUnreadCount();

    expect(api.get).toHaveBeenCalledWith('/notifications/unread-count');
    expect(useNotificationStore.getState().unreadCount).toBe(5);
  });

  it('should fetch notifications', async () => {
    const mockNotifications = [
      { id: 'n1', type: 'CONFIG_CHANGED', severity: 'INFO', title: 'Config Changed', message: 'test', isRead: false, createdAt: '2026-02-14T10:00:00Z' },
      { id: 'n2', type: 'SYNC_COMPLETED', severity: 'INFO', title: 'Sync Done', message: 'test', isRead: true, createdAt: '2026-02-14T09:00:00Z' },
    ];

    (api.get as ReturnType<typeof vi.fn>).mockResolvedValue({
      success: true,
      data: { notifications: mockNotifications },
    });

    await useNotificationStore.getState().fetchNotifications(1);

    expect(api.get).toHaveBeenCalledWith('/notifications?page=1&limit=20');
    expect(useNotificationStore.getState().notifications).toHaveLength(2);
    expect(useNotificationStore.getState().isLoading).toBe(false);
  });

  it('should mark notification as read', async () => {
    useNotificationStore.setState({
      unreadCount: 3,
      notifications: [
        { id: 'n1', type: 'CONFIG_CHANGED' as const, severity: 'INFO' as const, title: 'Test', message: 'msg', isRead: false, createdAt: '2026-02-14T10:00:00Z' },
      ],
    });

    (api.patch as ReturnType<typeof vi.fn>).mockResolvedValue({ success: true });

    await useNotificationStore.getState().markAsRead('n1');

    expect(api.patch).toHaveBeenCalledWith('/notifications/n1/read');
    const state = useNotificationStore.getState();
    expect(state.notifications[0].isRead).toBe(true);
    expect(state.unreadCount).toBe(2);
  });

  it('should mark all as read', async () => {
    useNotificationStore.setState({
      unreadCount: 5,
      notifications: [
        { id: 'n1', type: 'CONFIG_CHANGED' as const, severity: 'INFO' as const, title: 'A', message: 'msg', isRead: false, createdAt: '2026-02-14T10:00:00Z' },
        { id: 'n2', type: 'SYNC_COMPLETED' as const, severity: 'INFO' as const, title: 'B', message: 'msg', isRead: false, createdAt: '2026-02-14T09:00:00Z' },
      ],
    });

    (api.post as ReturnType<typeof vi.fn>).mockResolvedValue({ success: true });

    await useNotificationStore.getState().markAllAsRead();

    expect(api.post).toHaveBeenCalledWith('/notifications/mark-all-read');
    const state = useNotificationStore.getState();
    expect(state.unreadCount).toBe(0);
    expect(state.notifications.every((n) => n.isRead)).toBe(true);
  });

  it('should dismiss a notification', async () => {
    useNotificationStore.setState({
      unreadCount: 2,
      notifications: [
        { id: 'n1', type: 'CONFIG_CHANGED' as const, severity: 'INFO' as const, title: 'A', message: 'msg', isRead: false, createdAt: '2026-02-14T10:00:00Z' },
        { id: 'n2', type: 'SYNC_COMPLETED' as const, severity: 'INFO' as const, title: 'B', message: 'msg', isRead: true, createdAt: '2026-02-14T09:00:00Z' },
      ],
    });

    (api.delete as ReturnType<typeof vi.fn>).mockResolvedValue({ success: true });

    await useNotificationStore.getState().dismiss('n1');

    expect(api.delete).toHaveBeenCalledWith('/notifications/n1');
    const state = useNotificationStore.getState();
    expect(state.notifications).toHaveLength(1);
    expect(state.notifications[0].id).toBe('n2');
    // n1 was unread, so unreadCount should decrease
    expect(state.unreadCount).toBe(1);
  });

  it('should not decrease unread count when dismissing read notification', async () => {
    useNotificationStore.setState({
      unreadCount: 1,
      notifications: [
        { id: 'n1', type: 'SYNC_COMPLETED' as const, severity: 'INFO' as const, title: 'A', message: 'msg', isRead: true, createdAt: '2026-02-14T10:00:00Z' },
      ],
    });

    (api.delete as ReturnType<typeof vi.fn>).mockResolvedValue({ success: true });

    await useNotificationStore.getState().dismiss('n1');

    expect(useNotificationStore.getState().unreadCount).toBe(1);
  });
});

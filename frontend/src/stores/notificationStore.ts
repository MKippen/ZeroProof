import { create } from 'zustand';
import type { Notification } from '@/types';
import api from '@/api/client';

interface NotificationState {
  unreadCount: number;
  notifications: Notification[];
  isLoading: boolean;
  mutationError: string | null;
  fetchUnreadCount: () => Promise<void>;
  fetchNotifications: (page?: number) => Promise<void>;
  markAsRead: (id: string) => Promise<void>;
  markAllAsRead: () => Promise<void>;
  dismiss: (id: string) => Promise<void>;
}

export const useNotificationStore = create<NotificationState>((set, get) => ({
  unreadCount: 0,
  notifications: [],
  isLoading: false,
  mutationError: null,

  fetchUnreadCount: async () => {
    const result = await api.get<{ count: number }>('/notifications/unread-count');
    if (result.success && result.data) {
      set({ unreadCount: result.data.count });
    }
  },

  fetchNotifications: async (page = 1) => {
    set({ isLoading: true });
    const result = await api.get<{ notifications: Notification[] }>(
      `/notifications?page=${page}&limit=20`
    );
    if (result.success && result.data) {
      set({ notifications: result.data.notifications, isLoading: false });
    } else {
      set({ isLoading: false });
    }
  },

  markAsRead: async (id: string) => {
    set({ mutationError: null });
    const result = await api.patch(`/notifications/${id}/read`);
    if (!result.success) {
      set({ mutationError: result.error?.message || 'Could not mark notification as read. Please try again.' });
      return;
    }
    set((state) => ({
      notifications: state.notifications.map((n) =>
        n.id === id ? { ...n, isRead: true } : n
      ),
      unreadCount: state.notifications.some((n) => n.id === id && !n.isRead)
        ? Math.max(0, state.unreadCount - 1)
        : state.unreadCount,
    }));
  },

  markAllAsRead: async () => {
    set({ mutationError: null });
    const result = await api.post('/notifications/mark-all-read');
    if (!result.success) {
      set({ mutationError: result.error?.message || 'Could not mark notifications as read. Please try again.' });
      return;
    }
    set((state) => ({
      notifications: state.notifications.map((n) => ({ ...n, isRead: true })),
      unreadCount: 0,
    }));
  },

  dismiss: async (id: string) => {
    set({ mutationError: null });
    const result = await api.delete(`/notifications/${id}`);
    if (!result.success) {
      set({ mutationError: result.error?.message || 'Could not dismiss notification. Please try again.' });
      return;
    }
    const notification = get().notifications.find((n) => n.id === id);
    set((state) => ({
      notifications: state.notifications.filter((n) => n.id !== id),
      unreadCount: notification && !notification.isRead
        ? Math.max(0, state.unreadCount - 1)
        : state.unreadCount,
    }));
  },
}));

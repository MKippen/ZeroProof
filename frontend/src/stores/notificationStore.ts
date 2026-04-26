import { create } from 'zustand';
import type { Notification } from '@/types';
import api from '@/api/client';

interface NotificationState {
  unreadCount: number;
  notifications: Notification[];
  isLoading: boolean;
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
    await api.patch(`/notifications/${id}/read`);
    set((state) => ({
      notifications: state.notifications.map((n) =>
        n.id === id ? { ...n, isRead: true } : n
      ),
      unreadCount: Math.max(0, state.unreadCount - 1),
    }));
  },

  markAllAsRead: async () => {
    await api.post('/notifications/mark-all-read');
    set((state) => ({
      notifications: state.notifications.map((n) => ({ ...n, isRead: true })),
      unreadCount: 0,
    }));
  },

  dismiss: async (id: string) => {
    await api.delete(`/notifications/${id}`);
    const notification = get().notifications.find((n) => n.id === id);
    set((state) => ({
      notifications: state.notifications.filter((n) => n.id !== id),
      unreadCount: notification && !notification.isRead
        ? Math.max(0, state.unreadCount - 1)
        : state.unreadCount,
    }));
  },
}));

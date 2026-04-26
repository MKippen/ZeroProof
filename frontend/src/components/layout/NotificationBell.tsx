import { useEffect, useRef, useState } from 'react';
import { Bell, X, Check, CheckCheck } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { useNotificationStore } from '@/stores/notificationStore';
import { cn } from '@/lib/utils';
import type { Notification, Severity } from '@/types';
import { POLL_INTERVALS } from '@/config/polling';

const POLL_INTERVAL = POLL_INTERVALS.notificationUnread;

function severityColor(severity: Severity): string {
  switch (severity) {
    case 'CRITICAL': return 'bg-red-500';
    case 'HIGH': return 'bg-orange-500';
    case 'MEDIUM': return 'bg-yellow-500';
    case 'LOW': return 'bg-blue-500';
    case 'INFO': return 'bg-slate-400';
  }
}

function relativeTime(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return `${days}d ago`;
}

function NotificationItem({
  notification,
  onRead,
  onDismiss,
}: {
  notification: Notification;
  onRead: () => void;
  onDismiss: () => void;
}) {
  return (
    <div
      className={cn(
        'flex items-start gap-3 p-3 rounded-lg cursor-pointer transition-colors',
        notification.isRead
          ? 'bg-transparent hover:bg-muted/30'
          : 'bg-muted/50 hover:bg-muted/70'
      )}
      onClick={onRead}
    >
      <div className={cn('w-2 h-2 mt-2 rounded-full flex-shrink-0', severityColor(notification.severity))} />
      <div className="flex-1 min-w-0">
        <p className={cn('text-sm', notification.isRead ? 'text-muted-foreground' : 'text-foreground font-medium')}>
          {notification.title}
        </p>
        <p className="text-xs text-muted-foreground line-clamp-2 mt-0.5">{notification.message}</p>
        <p className="text-xs text-muted-foreground/60 mt-1">{relativeTime(notification.createdAt)}</p>
      </div>
      <Button
        variant="ghost"
        size="icon"
        className="h-6 w-6 flex-shrink-0 opacity-0 group-hover:opacity-100 hover:opacity-100"
        onClick={(e) => {
          e.stopPropagation();
          onDismiss();
        }}
      >
        <X className="h-3 w-3" />
      </Button>
    </div>
  );
}

export function NotificationBell({ align = 'right' }: { align?: 'left' | 'right' }) {
  const [isOpen, setIsOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const navigate = useNavigate();

  const {
    unreadCount,
    notifications,
    fetchUnreadCount,
    fetchNotifications,
    markAsRead,
    markAllAsRead,
    dismiss,
  } = useNotificationStore();

  // Poll unread count
  useEffect(() => {
    fetchUnreadCount();
    const interval = setInterval(fetchUnreadCount, POLL_INTERVAL);
    return () => clearInterval(interval);
  }, [fetchUnreadCount]);

  // Fetch notifications when dropdown opens
  useEffect(() => {
    if (isOpen) {
      fetchNotifications();
    }
  }, [isOpen, fetchNotifications]);

  // Close on outside click
  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    }
    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside);
      return () => document.removeEventListener('mousedown', handleClickOutside);
    }
  }, [isOpen]);

  const handleNotificationClick = (notification: Notification) => {
    if (!notification.isRead) {
      markAsRead(notification.id);
    }

    // Navigate based on notification type
    switch (notification.type) {
      case 'NEW_VULNERABILITIES':
      case 'SECURITY_SCORE_DECREASED':
        navigate('/security');
        break;
      case 'CONFIG_CHANGED':
      case 'NEW_DEVICES':
      case 'FIRMWARE_UPDATE':
        navigate('/timeline');
        break;
      case 'SYNC_FAILED':
        navigate('/settings');
        break;
    }
    setIsOpen(false);
  };

  return (
    <div className="relative" ref={dropdownRef}>
      <Button
        variant="ghost"
        size="icon"
        className="relative"
        onClick={() => setIsOpen(!isOpen)}
      >
        <Bell className="h-5 w-5" />
        {unreadCount > 0 && (
          <span className="absolute -top-0.5 -right-0.5 flex items-center justify-center h-4 min-w-4 px-1 text-[10px] font-bold text-white bg-red-500 rounded-full">
            {unreadCount > 99 ? '99+' : unreadCount}
          </span>
        )}
      </Button>

      {isOpen && (
        <div className={cn(
          'fixed left-2 right-2 top-[calc(3.75rem+env(safe-area-inset-top))] max-h-[min(70vh,28rem)] bg-card border border-border/50 rounded-lg shadow-lg z-50 flex flex-col overflow-hidden sm:absolute sm:top-full sm:mt-2 sm:max-h-[28rem] sm:w-80 sm:left-auto sm:right-0',
          align === 'left' ? 'sm:left-0 sm:right-auto' : 'sm:right-0 sm:left-auto'
        )}>
          {/* Header */}
          <div className="flex items-center justify-between px-4 py-3 border-b border-border/50">
            <h3 className="text-sm font-semibold">Notifications</h3>
            {unreadCount > 0 && (
              <Button
                variant="ghost"
                size="sm"
                className="h-7 text-xs text-muted-foreground hover:text-foreground"
                onClick={() => markAllAsRead()}
              >
                <CheckCheck className="h-3 w-3 mr-1" />
                Mark all read
              </Button>
            )}
          </div>

          {/* Notification list */}
          <div className="flex-1 overflow-y-auto p-2 space-y-1">
            {notifications.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-8 text-muted-foreground">
                <Check className="h-8 w-8 mb-2 opacity-50" />
                <p className="text-sm">All caught up!</p>
              </div>
            ) : (
              notifications.map((n) => (
                <div key={n.id} className="group">
                  <NotificationItem
                    notification={n}
                    onRead={() => handleNotificationClick(n)}
                    onDismiss={() => dismiss(n.id)}
                  />
                </div>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}

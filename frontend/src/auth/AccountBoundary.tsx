import { useEffect, useState, type ReactNode } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Navigate, useLocation } from 'react-router-dom';
import api from '@/api/client';
import { DataLoadError } from '@/components/DataLoadError';
import { useAuthStore } from '@/stores/authStore';
import { useNotificationStore } from '@/stores/notificationStore';
import { useWebSocketStore } from '@/stores/websocketStore';
import { verifySession } from './session';

export function AccountBoundary({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();
  const [booted, setBooted] = useState(false);
  const { verificationStatus, verificationError, initialized, isAuthenticated, mustChangePassword } = useAuthStore();
  const { pathname } = useLocation();

  useEffect(() => {
    // Remove the previous version's persisted auth hints; they are never read.
    try { window.localStorage.removeItem('auth-storage'); } catch { /* Storage may be disabled. */ }
    const unsubscribe = useAuthStore.subscribe((state, previous) => {
      if (state.sessionVersion === previous.sessionVersion) return;
      useWebSocketStore.getState().disconnect();
      api.invalidateCsrfToken();
      // Starting a password submission cancels old responses and pauses new
      // background work without rebuilding queries during session rotation.
      if (state.credentialChangePending && !previous.credentialChangePending) return;
      // Clear synchronously before the new account can mount any protected UI.
      queryClient.clear();
      useNotificationStore.getState().reset();
    });
    let mounted = true;
    void verifySession().then(() => { if (mounted) setBooted(true); });
    return () => { mounted = false; unsubscribe(); };
  }, [queryClient]);

  if (!booted || verificationStatus === 'checking') {
    return <AccountLoading />;
  }
  if (verificationStatus === 'error') {
    return (
      <main className="min-h-screen bg-background flex items-center justify-center p-6">
        <div className="w-full max-w-lg">
          <DataLoadError
            title="Unable to verify your account"
            message={verificationError || 'Please retry when the server is available.'}
            onRetry={() => { void verifySession(); }}
            isRetrying={false}
          />
        </div>
      </main>
    );
  }
  if (!initialized) return pathname === '/setup' ? children : <Navigate to="/setup" replace />;
  if (!isAuthenticated) return pathname === '/login' ? children : <Navigate to="/login" replace />;
  if (mustChangePassword) return pathname === '/change-password' ? children : <Navigate to="/change-password" replace />;
  if (['/login', '/setup', '/change-password'].includes(pathname)) return <Navigate to="/dashboard" replace />;
  return children;
}

export function AccountLoading() {
  return (
    <div className="min-h-screen bg-background flex items-center justify-center text-sm text-muted-foreground" role="status">
      Checking your account…
    </div>
  );
}

import api from '@/api/client';
import { useAuthStore } from '@/stores/authStore';
import type { User } from '@/types';

let verification: { version: number; promise: Promise<void> } | null = null;

export function verifySession(): Promise<void> {
  const version = useAuthStore.getState().sessionVersion;
  if (verification?.version === version) return verification.promise;
  useAuthStore.getState().beginVerification();

  const promise = (async () => {
    try {
      const response = await api.get<{ user: User }>('/auth/me');
      if (useAuthStore.getState().sessionVersion !== version) return;
      if (response.success && response.data?.user &&
        typeof response.data.user.id === 'number' &&
        typeof response.data.user.mustChangePassword === 'boolean') {
        useAuthStore.getState().setUser(response.data.user);
        return;
      }
      if (!response.success && response.error?.code === 'UNAUTHORIZED') {
        const setup = await api.get<{ initialized: boolean }>('/auth/setup-status');
        if (useAuthStore.getState().sessionVersion !== version) return;
        if (setup.success && typeof setup.data?.initialized === 'boolean') {
          useAuthStore.getState().setAnonymous(setup.data.initialized);
          return;
        }
        throw new Error(setup.error?.message || 'Unable to check whether setup is complete.');
      }
      throw new Error(response.error?.message || 'Unable to verify your session.');
    } catch (error) {
      if (useAuthStore.getState().sessionVersion === version) {
        useAuthStore.getState().failVerification(error instanceof Error ? error.message : 'Unable to verify your session.');
      }
    }
  })();
  verification = { version, promise };
  void promise.finally(() => {
    if (verification?.promise === promise) verification = null;
  });
  return promise;
}

import api from './client';

export class UniFiSyncRequestError extends Error {
  constructor(readonly code: string, message: string) {
    super(message);
    this.name = 'UniFiSyncRequestError';
  }
}

/** One user-requested attempt. Busy/interrupted operations are never replayed. */
export async function requestUniFiSync<T>(endpoint = '/unifi/sync', body?: unknown): Promise<T> {
  const response = await api.post<T>(endpoint, body);
  if (!response.success) {
    throw new UniFiSyncRequestError(response.error?.code || 'SYNC_FAILED', response.error?.message || 'Could not sync configuration.');
  }
  if (response.data === undefined) {
    throw new UniFiSyncRequestError('INVALID_RESPONSE', 'The server did not return a sync result. Please check the sync history.');
  }
  return response.data;
}

/** Imported configurations can still be analyzed without a live controller. */
export async function refreshUniFiBeforeAnalysis(): Promise<void> {
  try {
    await requestUniFiSync('/unifi/sync');
  } catch (error) {
    if (error instanceof UniFiSyncRequestError && error.code === 'NOT_CONFIGURED') return;
    throw error;
  }
}

export function uniFiSyncFeedback(error: Error, fallbackTitle = 'Sync failed'): {
  variant: 'default' | 'destructive'; title: string; description: string;
} {
  if (error instanceof UniFiSyncRequestError) {
    if (error.code === 'SYNC_IN_PROGRESS') {
      return { variant: 'default', title: 'Sync already in progress', description: 'Another UniFi sync is running. Wait for it to finish, then try again.' };
    }
    if (error.code === 'SYNC_LEASE_LOST' || error.code === 'CONNECTION_CHANGED') {
      return { variant: 'default', title: 'Sync interrupted', description: 'The sync stopped before completion. Please try again.' };
    }
  }
  return { variant: 'destructive', title: fallbackTitle, description: error.message };
}

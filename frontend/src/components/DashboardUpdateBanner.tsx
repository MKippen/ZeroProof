import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { Sparkles, X } from 'lucide-react';
import api from '@/api/client';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';

interface SystemUpdateStatus {
  current: string;
  latest: string | null;
  hasUpdate: boolean;
  publishedAt: string | null;
}

function relativeAge(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  if (Number.isNaN(ms) || ms < 0) return '';
  const days = Math.floor(ms / 86_400_000);
  if (days >= 14) return `${Math.floor(days / 7)} weeks ago`;
  if (days >= 1) return `${days} day${days === 1 ? '' : 's'} ago`;
  const hours = Math.floor(ms / 3_600_000);
  if (hours >= 1) return `${hours} hour${hours === 1 ? '' : 's'} ago`;
  return 'just now';
}

const DISMISS_KEY_PREFIX = 'dashboard-update-banner-dismissed:';

// Shares the ['system','update'] cache with SettingsPage's SystemUpdateCard,
// so mounting the banner doesn't cost an extra network call when both are
// rendered. Dismissal is keyed by the *latest* version so a new release
// re-surfaces the banner automatically — clicking "Dismiss" for v1.1.18
// won't silence the banner when v1.1.19 ships.
export function DashboardUpdateBanner() {
  const { data } = useQuery({
    queryKey: ['system', 'update'],
    queryFn: async () => {
      const response = await api.get<SystemUpdateStatus>('/system/update');
      if (!response.success || !response.data) {
        throw new Error(response.error?.message || 'Request failed');
      }
      return response.data;
    },
    staleTime: 60_000,
    refetchOnMount: false,
  });

  const latest = data?.latest ?? null;
  const dismissKey = latest ? `${DISMISS_KEY_PREFIX}${latest}` : null;
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    if (!dismissKey) {
      setDismissed(false);
      return;
    }
    setDismissed(localStorage.getItem(dismissKey) === '1');
  }, [dismissKey]);

  if (!data?.hasUpdate || !latest || dismissed) return null;

  const handleDismiss = () => {
    if (dismissKey) localStorage.setItem(dismissKey, '1');
    setDismissed(true);
  };

  return (
    <Alert className="border-primary/40 bg-primary/5">
      <Sparkles className="h-4 w-4 text-primary" />
      <AlertTitle className="flex items-center justify-between gap-2">
        <span>
          Update available: <span className="font-semibold">{latest}</span>
          <span className="ml-2 text-xs font-normal text-muted-foreground">
            (current {data.current})
          </span>
        </span>
        <button
          type="button"
          onClick={handleDismiss}
          aria-label="Dismiss update notification"
          className="text-muted-foreground hover:text-foreground transition-colors"
        >
          <X className="h-4 w-4" />
        </button>
      </AlertTitle>
      <AlertDescription className="mt-2 flex items-center justify-between gap-4">
        <span className="text-muted-foreground">
          A newer ZeroProof release is available
          {data.publishedAt ? <> — released {relativeAge(data.publishedAt)}</> : null}.
          Review and apply from Settings.
        </span>
        <Button asChild size="sm" variant="outline">
          <Link to="/settings">Apply {latest}</Link>
        </Button>
      </AlertDescription>
    </Alert>
  );
}

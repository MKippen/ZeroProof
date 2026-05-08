import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CheckCircle2, ExternalLink, Loader2, RefreshCw, Sparkles } from 'lucide-react';
import api from '@/api/client';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { useToast } from '@/hooks/useToast';
import type { ApiResponse } from '@/types';

type ReleaseChannel = 'stable' | 'beta';

interface SystemUpdateStatus {
  current: string;
  latest: string | null;
  channel: ReleaseChannel;
  hasUpdate: boolean;
  htmlUrl: string | null;
  notes: string | null;
  publishedAt: string | null;
  error?: string;
}

function requireData<T>(response: ApiResponse<T>): T {
  if (!response.success || response.data === undefined) {
    throw new Error(response.error?.message || 'Request failed');
  }
  return response.data;
}

/** Truncate Markdown release notes to a paragraph for the card preview. */
function previewNotes(notes: string | null): string | null {
  if (!notes) return null;
  const cleaned = notes
    .replace(/^##.*$/gm, '')
    .replace(/\r?\n{2,}/g, '\n')
    .trim();
  if (!cleaned) return null;
  const limit = 280;
  return cleaned.length > limit ? `${cleaned.slice(0, limit).trim()}…` : cleaned;
}

export function SystemUpdateCard() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [showFullNotes, setShowFullNotes] = useState(false);

  const updateQuery = useQuery({
    queryKey: ['system', 'update'],
    queryFn: async () =>
      requireData(await api.get<SystemUpdateStatus>('/system/update')),
    // GitHub anon rate limit + a 5-min server cache mean refetching too
    // aggressively just costs latency. 60s in the browser is plenty.
    staleTime: 60_000,
  });

  const channelMutation = useMutation({
    mutationFn: async (channel: ReleaseChannel) =>
      requireData(
        await api.put<SystemUpdateStatus>('/system/update/channel', { channel })
      ),
    onSuccess: (data) => {
      queryClient.setQueryData(['system', 'update'], data);
      toast({
        title: `Switched to ${data.channel === 'beta' ? 'Beta' : 'Stable'} channel`,
        description:
          data.channel === 'beta'
            ? 'You will now see pre-release versions.'
            : 'You will only see stable releases.',
      });
    },
    onError: (error: Error) => {
      toast({
        variant: 'destructive',
        title: 'Could not change channel',
        description: error.message,
      });
    },
  });

  const status = updateQuery.data;
  const notesPreview = useMemo(() => previewNotes(status?.notes ?? null), [status?.notes]);

  return (
    <Card className="border-border/50">
      <CardHeader>
        <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <CardTitle className="flex items-center gap-2">
              <Sparkles className="h-5 w-5 text-orange-400" />
              Updates
            </CardTitle>
            <CardDescription>
              Notify-and-confirm only — applying updates is still a CLI step today (`./scripts/upgrade.sh`).
            </CardDescription>
          </div>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => updateQuery.refetch()}
            disabled={updateQuery.isFetching}
          >
            {updateQuery.isFetching ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <RefreshCw className="mr-2 h-4 w-4" />
            )}
            Check now
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Version + channel meta */}
        <div className="grid gap-2 text-sm">
          <div className="flex items-center justify-between gap-3">
            <span className="text-muted-foreground">Current version</span>
            <span className="font-mono">{status?.current ?? '…'}</span>
          </div>
          <div className="flex items-center justify-between gap-3">
            <span className="text-muted-foreground">Latest available</span>
            <span className="font-mono">
              {status?.latest ?? (status?.error ? 'unable to check' : '…')}
            </span>
          </div>
        </div>

        {/* Update banner */}
        {status?.hasUpdate ? (
          <div className="rounded-md border border-orange-500/30 bg-orange-500/10 p-3">
            <div className="flex items-center gap-2 font-medium text-sm">
              <Sparkles className="h-4 w-4 text-orange-400" />
              {status.latest} is available
            </div>
            {notesPreview && (
              <div className="mt-2 whitespace-pre-line text-xs text-muted-foreground">
                {showFullNotes ? status.notes : notesPreview}
                {status.notes && status.notes.length > (notesPreview?.length ?? 0) && (
                  <button
                    type="button"
                    onClick={() => setShowFullNotes((v) => !v)}
                    className="ml-2 text-orange-400 underline-offset-2 hover:underline"
                  >
                    {showFullNotes ? 'Show less' : 'Show more'}
                  </button>
                )}
              </div>
            )}
            {status.htmlUrl && (
              <a
                href={status.htmlUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="mt-3 inline-flex items-center gap-1 text-xs text-orange-400 hover:underline"
              >
                View on GitHub
                <ExternalLink className="h-3 w-3" />
              </a>
            )}
          </div>
        ) : status && !status.error ? (
          <div className="flex items-center gap-2 rounded-md border border-emerald-500/30 bg-emerald-500/5 p-3 text-sm text-muted-foreground">
            <CheckCircle2 className="h-4 w-4 text-emerald-400" />
            You are running the latest {status.channel} release.
          </div>
        ) : status?.error ? (
          <div className="rounded-md border border-yellow-500/30 bg-yellow-500/10 p-3 text-xs text-muted-foreground">
            Couldn't reach GitHub to check for updates: {status.error}
          </div>
        ) : null}

        {/* Channel selector */}
        <div className="space-y-2">
          <Label className="text-xs uppercase tracking-wide text-muted-foreground">
            Release channel
          </Label>
          <div className="grid grid-cols-2 gap-2">
            <ChannelOption
              value="stable"
              currentValue={status?.channel}
              disabled={channelMutation.isPending}
              onPick={(c) => channelMutation.mutate(c)}
              title="Stable"
              description="Released versions only. Recommended."
            />
            <ChannelOption
              value="beta"
              currentValue={status?.channel}
              disabled={channelMutation.isPending}
              onPick={(c) => channelMutation.mutate(c)}
              title="Beta"
              description="Includes pre-releases. Help test what's coming next."
            />
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function ChannelOption({
  value,
  currentValue,
  disabled,
  onPick,
  title,
  description,
}: {
  value: ReleaseChannel;
  currentValue: ReleaseChannel | undefined;
  disabled: boolean;
  onPick: (channel: ReleaseChannel) => void;
  title: string;
  description: string;
}) {
  const selected = currentValue === value;
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={() => onPick(value)}
      className={`flex flex-col items-start gap-1 rounded-md border p-3 text-left text-sm transition-colors disabled:opacity-60 ${
        selected
          ? 'border-orange-500/60 bg-orange-500/10 text-foreground'
          : 'border-border/60 hover:border-orange-500/40 hover:bg-muted/40'
      }`}
    >
      <span className="font-medium">{title}</span>
      <span className="text-xs text-muted-foreground">{description}</span>
    </button>
  );
}

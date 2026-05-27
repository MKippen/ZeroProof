import { useEffect, useMemo, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, CheckCircle2, Download, ExternalLink, FileText, Loader2, RefreshCw, Sparkles } from 'lucide-react';
import api from '@/api/client';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { useToast } from '@/hooks/useToast';
import { useWebSocketStore } from '@/stores/websocketStore';
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
  applyEnabled?: boolean;
  versions?: {
    backend: string;
    updater: string | null;
  };
  error?: string;
}

type ApplyState =
  | { kind: 'idle' }
  | { kind: 'confirming'; target: string }
  | { kind: 'installing'; target: string; lines: string[] }
  | { kind: 'restarting'; target: string; lines: string[] }
  | { kind: 'done'; target: string }
  | { kind: 'rolledback'; target: string; lines: string[] }
  | { kind: 'failed'; target: string; lines: string[]; reason: string };

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

  const [applyState, setApplyState] = useState<ApplyState>({ kind: 'idle' });
  const lastMessage = useWebSocketStore((s) => s.lastMessage);
  const isWsConnected = useWebSocketStore((s) => s.isConnected);
  const logRef = useRef<HTMLDivElement | null>(null);

  // Stream progress lines into the installing state. Each WS message is a
  // tiny event (one bash line); we append to the lines array so the UI
  // can render a scrolling log.
  useEffect(() => {
    if (!lastMessage) return;
    if (lastMessage.type === 'updater_progress' && typeof lastMessage.line === 'string') {
      setApplyState((prev) => {
        if (prev.kind !== 'installing' && prev.kind !== 'restarting') return prev;
        return { ...prev, lines: [...prev.lines, lastMessage.line as string] };
      });
    } else if (lastMessage.type === 'updater_complete') {
      setApplyState((prev) => {
        if (prev.kind !== 'installing' && prev.kind !== 'restarting') return prev;
        // Backend may or may not be about to restart. We transition to
        // 'restarting' first; the WS-disconnect effect below will hold
        // there until we reconnect, then we refetch /system/update and
        // resolve to 'done' or 'rolledback'.
        if (lastMessage.rolledBack) {
          return { kind: 'rolledback', target: prev.target, lines: prev.lines };
        }
        return { kind: 'restarting', target: prev.target, lines: prev.lines };
      });
    }
  }, [lastMessage]);

  // While the apply is in flight, a WS disconnect means the backend is
  // restarting (host networking + container recreate). Two pathways
  // land us in `restarting`:
  //
  // 1. `updater_complete` WS message arrived before the backend went
  //    down — explicit signal, handled in the message effect above.
  // 2. WS dropped *during* the installing phase — backend was recreated
  //    mid-upgrade and the `updater_complete` message was lost in flight.
  //    We have to infer "the upgrade reached the recreate phase" from
  //    the disconnect itself, otherwise the UI sits on `installing`
  //    forever (the 2026-05-25 v1.1.22 stuck-spinner bug).
  useEffect(() => {
    if (applyState.kind === 'installing' && !isWsConnected) {
      setApplyState((prev) => {
        if (prev.kind !== 'installing') return prev;
        return { kind: 'restarting', target: prev.target, lines: prev.lines };
      });
    }
  }, [applyState.kind, isWsConnected]);

  // Once WS reconnects after the recreate, poll /system/update until
  // the reported `current` matches the target we asked to install — or
  // give up after ~30s and surface a clear failure. Single-shot refetch
  // (the previous behaviour) raced backend's prisma migrate + bootup
  // and false-positived as "Server reconnected but version did not
  // change" on slow recreates.
  const restartingTarget =
    applyState.kind === 'restarting' ? applyState.target : null;

  // Poll /system/update over HTTP until the reported `current` matches
  // the target we asked to install. Two prior bugs informed the shape:
  //
  // 1. We do NOT gate on WS reconnect (v1.1.23 did). nginx keeps a
  //    keep-alived upstream connection to backend that dies during
  //    backend's recreate; the WS reconnect through nginx can hang on
  //    that dead socket until a new request forces nginx to refresh
  //    it. Meanwhile the *HTTP* path through nginx → backend works
  //    fine, so we poll over HTTP directly and ignore WS state.
  //
  // 2. We only count attempts where we got a usable response back.
  //    Network errors / 5xx while backend is mid-restart mean "keep
  //    trying", not "version didn't change". Counting those burned
  //    the budget against actual liveness probes and made the UI
  //    silently fail to transition (v1.1.25 → v1.1.26 stuck spinner).
  useEffect(() => {
    if (!restartingTarget) return;
    let cancelled = false;
    let staleResponses = 0;
    const maxStale = 10;
    const intervalMs = 3000;
    const overallDeadline = Date.now() + 5 * 60 * 1000; // 5 min hard cap

    const tick = async () => {
      if (cancelled) return;
      const r = await updateQuery.refetch();
      if (cancelled) return;
      const fresh = r.data;
      if (fresh && fresh.current === restartingTarget) {
        setApplyState((prev) =>
          prev.kind === 'restarting' && prev.target === restartingTarget
            ? { kind: 'done', target: prev.target }
            : prev
        );
        return;
      }
      // Got a parseable response with the *old* version — backend is
      // alive but hasn't applied the upgrade yet. Burn budget.
      if (fresh) staleResponses += 1;
      // Either too many stale responses, or we blew the overall
      // deadline (used when backend is dead long enough that nothing
      // we see is parseable).
      if (staleResponses >= maxStale || Date.now() > overallDeadline) {
        setApplyState((prev) =>
          prev.kind === 'restarting' && prev.target === restartingTarget
            ? {
                kind: 'failed',
                target: prev.target,
                lines: prev.lines,
                reason:
                  staleResponses >= maxStale
                    ? `Backend reported the old version ${maxStale} times in a row — upgrade may have silently rolled back`
                    : 'Backend did not come back within 5 minutes',
              }
            : prev
        );
        return;
      }
      setTimeout(tick, intervalMs);
    };

    // First check after a short settle delay so we don't hammer a
    // backend that's literally one HTTP request into its lifetime.
    const initial = setTimeout(tick, 1500);
    return () => {
      cancelled = true;
      clearTimeout(initial);
    };
  }, [restartingTarget, updateQuery]);

  // Auto-scroll the progress log on new lines.
  useEffect(() => {
    if (logRef.current) {
      logRef.current.scrollTop = logRef.current.scrollHeight;
    }
  }, [applyState]);

  const applyMutation = useMutation({
    mutationFn: async (target: string) =>
      requireData(
        await api.post<{ accepted: boolean; run: { progressPath: string } }>(
          '/system/update/apply',
          { target }
        )
      ),
    onSuccess: (_data, target) => {
      setApplyState({ kind: 'installing', target, lines: [] });
      toast({
        title: `Installing ${target}`,
      });
    },
    onError: (error: Error, target) => {
      setApplyState({
        kind: 'failed',
        target,
        lines: [],
        reason: error.message,
      });
      toast({
        variant: 'destructive',
        title: 'Could not start update',
        description: error.message,
      });
    },
  });

  const beginInstall = () => {
    if (!status?.latest) return;
    setApplyState({ kind: 'confirming', target: status.latest });
  };
  const confirmInstall = () => {
    if (applyState.kind !== 'confirming') return;
    applyMutation.mutate(applyState.target);
  };
  const cancelInstall = () => setApplyState({ kind: 'idle' });
  const dismissDone = () => setApplyState({ kind: 'idle' });

  const exportLog = (lines: string[], target?: string) => {
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const slug = target ? `-${target.replace(/[^A-Za-z0-9._-]/g, '_')}` : '';
    const blob = new Blob([lines.join('\n') + '\n'], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `zeroproof-upgrade${slug}-${stamp}.log`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  };

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
              {status?.applyEnabled
                ? 'Install updates with one click. Services restart for ~1–2 minutes during apply.'
                : 'Notify-and-confirm — apply updates from the CLI (`./scripts/upgrade.sh`). In-app updates need UPDATER_SECRET set.'}
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
            <span className="text-muted-foreground">Backend</span>
            <span className="font-mono">
              {status?.versions?.backend ?? status?.current ?? '…'}
            </span>
          </div>
          <div className="flex items-center justify-between gap-3">
            <span className="text-muted-foreground">Updater</span>
            <span className="font-mono">
              {status?.versions?.updater ?? (status?.applyEnabled ? '…' : 'not running')}
            </span>
          </div>
          {/* Drift between backend and updater versions used to require a
              manual `docker compose up -d --build updater`. v1.1.29 spawns
              a detached helper at the tail of upgrade.sh that recreates the
              updater automatically, so drift should self-resolve within ~30s
              of any successful in-app upgrade. Surfacing it as UI cruft is
              user-hostile — if the helper fails, that's an operator bug to
              dig into via logs, not a workflow we ask users to do. */}
          <div className="flex items-center justify-between gap-3">
            <span className="text-muted-foreground">Latest available</span>
            <span className="font-mono">
              {status?.latest ?? (status?.error ? 'unable to check' : '…')}
            </span>
          </div>
        </div>

        {/* Apply-flow status (takes priority over the static "update available" banner) */}
        {applyState.kind === 'confirming' && (
          <div className="rounded-md border border-orange-500/30 bg-orange-500/10 p-3 text-sm">
            <div className="flex items-center gap-2 font-medium">
              <AlertTriangle className="h-4 w-4 text-orange-400" />
              Install {applyState.target}?
            </div>
            <p className="mt-2 text-xs text-muted-foreground">
              Backend, scheduler, and the public web server will restart. Expect ~1–2 minutes of downtime. If health doesn't recover, ZeroProof rolls back automatically.
            </p>
            <div className="mt-3 flex gap-2">
              <Button size="sm" onClick={confirmInstall} disabled={applyMutation.isPending}>
                {applyMutation.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Download className="mr-2 h-4 w-4" />}
                Install now
              </Button>
              <Button size="sm" variant="outline" onClick={cancelInstall} disabled={applyMutation.isPending}>
                Cancel
              </Button>
            </div>
          </div>
        )}

        {(applyState.kind === 'installing' || applyState.kind === 'restarting') && (
          <div className="rounded-md border border-orange-500/30 bg-orange-500/10 p-3 text-sm">
            <div className="flex items-center gap-2 font-medium">
              <Loader2 className="h-4 w-4 animate-spin text-orange-400" />
              {applyState.kind === 'installing'
                ? `Installing ${applyState.target}…`
                : `Server is restarting… (waiting for ${applyState.target})`}
            </div>
            <div
              ref={logRef}
              className="mt-2 max-h-48 overflow-x-hidden overflow-y-auto whitespace-pre-wrap break-all rounded bg-background/40 p-2 font-mono text-xs leading-tight text-muted-foreground"
            >
              {applyState.lines.join('\n') || 'Waiting for the updater to start…'}
            </div>
            {applyState.lines.length > 0 && (
              <div className="mt-2">
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => exportLog(applyState.lines, applyState.target)}
                >
                  <FileText className="mr-2 h-4 w-4" />
                  Export log
                </Button>
              </div>
            )}
          </div>
        )}

        {applyState.kind === 'done' && (
          <div className="rounded-md border border-emerald-500/30 bg-emerald-500/10 p-3 text-sm">
            <div className="flex items-center gap-2 font-medium">
              <CheckCircle2 className="h-4 w-4 text-emerald-400" />
              Updated to {applyState.target}
            </div>
            <Button size="sm" variant="outline" className="mt-3" onClick={dismissDone}>
              Dismiss
            </Button>
          </div>
        )}

        {applyState.kind === 'rolledback' && (
          <div className="rounded-md border border-yellow-500/30 bg-yellow-500/10 p-3 text-sm">
            <div className="flex items-center gap-2 font-medium">
              <AlertTriangle className="h-4 w-4 text-yellow-400" />
              Auto-rollback applied: {applyState.target} failed health checks
            </div>
            <p className="mt-2 text-xs text-muted-foreground">
              You're back on the previous version. Check the log below for details.
            </p>
            <div className="mt-2 max-h-48 overflow-x-hidden overflow-y-auto whitespace-pre-wrap break-all rounded bg-background/40 p-2 font-mono text-xs leading-tight text-muted-foreground">
              {applyState.lines.join('\n')}
            </div>
            <div className="mt-3 flex gap-2">
              <Button size="sm" variant="outline" onClick={dismissDone}>
                Dismiss
              </Button>
              {applyState.lines.length > 0 && (
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => exportLog(applyState.lines, applyState.target)}
                >
                  <FileText className="mr-2 h-4 w-4" />
                  Export log
                </Button>
              )}
            </div>
          </div>
        )}

        {applyState.kind === 'failed' && (
          <div className="rounded-md border border-red-500/30 bg-red-500/10 p-3 text-sm">
            <div className="flex items-center gap-2 font-medium">
              <AlertTriangle className="h-4 w-4 text-red-400" />
              Update failed: {applyState.reason}
            </div>
            {applyState.lines.length > 0 && (
              <div className="mt-2 max-h-48 overflow-x-hidden overflow-y-auto whitespace-pre-wrap break-all rounded bg-background/40 p-2 font-mono text-xs leading-tight text-muted-foreground">
                {applyState.lines.join('\n')}
              </div>
            )}
            <div className="mt-3 flex gap-2">
              <Button size="sm" variant="outline" onClick={dismissDone}>
                Dismiss
              </Button>
              {applyState.lines.length > 0 && (
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => exportLog(applyState.lines, applyState.target)}
                >
                  <FileText className="mr-2 h-4 w-4" />
                  Export log
                </Button>
              )}
            </div>
          </div>
        )}

        {/* Update banner — only when not actively applying */}
        {applyState.kind === 'idle' && status?.hasUpdate ? (
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
            <div className="mt-3 flex flex-wrap gap-2">
              {status.applyEnabled && (
                <Button size="sm" onClick={beginInstall}>
                  <Download className="mr-2 h-4 w-4" />
                  Install update
                </Button>
              )}
              {status.htmlUrl && (
                <a
                  href={status.htmlUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 text-xs text-orange-400 hover:underline"
                >
                  View on GitHub
                  <ExternalLink className="h-3 w-3" />
                </a>
              )}
            </div>
          </div>
        ) : applyState.kind === 'idle' && status && !status.error ? (
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

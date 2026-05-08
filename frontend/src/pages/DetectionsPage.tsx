import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  EyeOff,
  Loader2,
  Radar,
  RotateCcw,
  ShieldAlert,
} from 'lucide-react';
import api from '@/api/client';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { cn, formatDate } from '@/lib/utils';
import type {
  ApiResponse,
  DetectionRow,
  DetectionSeverity,
  DetectionStatus,
  DetectionSummary,
} from '@/types';

const NUM_FORMAT = new Intl.NumberFormat();

const SEVERITY_ORDER: Record<DetectionSeverity, number> = {
  INFO: 0,
  LOW: 1,
  MEDIUM: 2,
  HIGH: 3,
  CRITICAL: 4,
};

const SEVERITY_TIERS: DetectionSeverity[] = [
  'CRITICAL',
  'HIGH',
  'MEDIUM',
  'LOW',
  'INFO',
];

function requireData<T>(response: ApiResponse<T>): T {
  if (!response.success || response.data === undefined) {
    throw new Error(response.error?.message || 'Request failed');
  }
  return response.data;
}

function severityClass(severity: DetectionSeverity): string {
  switch (severity) {
    case 'CRITICAL':
      return 'bg-red-600/30 text-red-200 border-red-500/40';
    case 'HIGH':
      return 'bg-red-500/20 text-red-300 border-red-500/30';
    case 'MEDIUM':
      return 'bg-yellow-500/20 text-yellow-300 border-yellow-500/30';
    case 'LOW':
      return 'bg-blue-500/20 text-blue-300 border-blue-500/30';
    case 'INFO':
    default:
      return 'bg-muted text-muted-foreground border-border';
  }
}

function statusClass(status: DetectionStatus): string {
  switch (status) {
    case 'OPEN':
      return 'bg-orange-500/20 text-orange-300';
    case 'RESOLVED':
      return 'bg-emerald-500/20 text-emerald-300';
    case 'DISMISSED':
      return 'bg-muted text-muted-foreground';
  }
}

function SummaryTiles({ summary }: { summary: DetectionSummary }): JSX.Element {
  const critical =
    summary.bySeverity.find((s) => s.severity === 'CRITICAL')?.count ?? 0;
  const high = summary.bySeverity.find((s) => s.severity === 'HIGH')?.count ?? 0;

  return (
    <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
      <Card>
        <CardContent className="p-4">
          <p className="text-xs uppercase text-muted-foreground">
            Open detections
          </p>
          <p className="mt-1 text-3xl font-semibold">
            {NUM_FORMAT.format(summary.open)}
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            {NUM_FORMAT.format(summary.total)} total in last {summary.windowHours}h
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-4">
          <p className="text-xs uppercase text-muted-foreground">Critical</p>
          <p className="mt-1 text-3xl font-semibold flex items-center gap-2">
            <ShieldAlert className="h-6 w-6 text-red-400" />
            {NUM_FORMAT.format(critical)}
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            {NUM_FORMAT.format(high)} high severity
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-4">
          <p className="text-xs uppercase text-muted-foreground">Resolved</p>
          <p className="mt-1 text-3xl font-semibold">
            {NUM_FORMAT.format(summary.resolved)}
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            {NUM_FORMAT.format(summary.dismissed)} dismissed
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-4">
          <p className="text-xs uppercase text-muted-foreground">Severity mix</p>
          <ul className="mt-2 space-y-1 text-sm">
            {SEVERITY_TIERS.map((tier) => {
              const count =
                summary.bySeverity.find((s) => s.severity === tier)?.count ?? 0;
              return (
                <li key={tier} className="flex items-center justify-between">
                  <span
                    className={cn(
                      'rounded border px-1.5 py-0.5 text-[10px] uppercase',
                      severityClass(tier)
                    )}
                  >
                    {tier}
                  </span>
                  <span className="font-mono text-xs">
                    {NUM_FORMAT.format(count)}
                  </span>
                </li>
              );
            })}
          </ul>
        </CardContent>
      </Card>
    </div>
  );
}

function BarList({
  title,
  description,
  rows,
}: {
  title: string;
  description: string;
  rows: { label: string; sub?: string; count: number; severity?: DetectionSeverity }[];
}): JSX.Element {
  const max = rows[0]?.count ?? 0;
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg">{title}</CardTitle>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
      <CardContent>
        {rows.length === 0 ? (
          <div className="flex min-h-32 items-center justify-center rounded-md border border-dashed border-border/60 px-4 text-center text-sm text-muted-foreground">
            No detections in this window.
          </div>
        ) : (
          <ol className="space-y-3">
            {rows.map((row, idx) => (
              <li key={`${row.label}-${idx}`} className="space-y-1">
                <div className="flex items-baseline justify-between gap-3">
                  <div className="min-w-0 truncate text-sm">
                    <span className="mr-2 text-xs text-muted-foreground">
                      {idx + 1}.
                    </span>
                    <span className="font-medium">{row.label}</span>
                    {row.sub && (
                      <span className="ml-2 text-xs text-muted-foreground">
                        {row.sub}
                      </span>
                    )}
                    {row.severity && (
                      <span
                        className={cn(
                          'ml-2 inline-block rounded border px-1.5 py-0.5 text-[10px] uppercase',
                          severityClass(row.severity)
                        )}
                      >
                        {row.severity}
                      </span>
                    )}
                  </div>
                  <span className="font-mono text-xs text-muted-foreground">
                    {NUM_FORMAT.format(row.count)}
                  </span>
                </div>
                <div className="h-1.5 overflow-hidden rounded-full bg-muted">
                  <div
                    className="h-full rounded-full bg-red-500/70"
                    style={{
                      width: max ? `${Math.max(2, (row.count / max) * 100)}%` : '0%',
                    }}
                  />
                </div>
              </li>
            ))}
          </ol>
        )}
      </CardContent>
    </Card>
  );
}

interface DetectionRowProps {
  row: DetectionRow;
  expanded: boolean;
  onToggle: () => void;
  onResolve: () => void;
  onDismiss: () => void;
  onReopen: () => void;
  busy: boolean;
}

function DetectionListRow({
  row,
  expanded,
  onToggle,
  onResolve,
  onDismiss,
  onReopen,
  busy,
}: DetectionRowProps): JSX.Element {
  return (
    <>
      <tr className="align-top hover:bg-muted/30">
        <td className="px-3 py-2">
          <Button
            variant="ghost"
            size="icon"
            className="h-6 w-6"
            onClick={onToggle}
            aria-label={expanded ? 'Collapse' : 'Expand'}
          >
            {expanded ? (
              <ChevronDown className="h-3 w-3" />
            ) : (
              <ChevronRight className="h-3 w-3" />
            )}
          </Button>
        </td>
        <td className="whitespace-nowrap px-3 py-2">
          <span
            className={cn(
              'rounded border px-1.5 py-0.5 text-[10px] uppercase',
              severityClass(row.severity)
            )}
          >
            {row.severity}
          </span>
        </td>
        <td className="px-3 py-2">
          <div className="font-medium">{row.title}</div>
          <div className="text-xs text-muted-foreground">
            {row.detectorId}
            {row.occurrences > 1 && (
              <span className="ml-2">×{row.occurrences}</span>
            )}
          </div>
        </td>
        <td className="px-3 py-2 text-sm">{row.affectedResource ?? '—'}</td>
        <td className="whitespace-nowrap px-3 py-2 text-xs text-muted-foreground">
          {formatDate(row.lastSeen)}
        </td>
        <td className="whitespace-nowrap px-3 py-2">
          <span
            className={cn(
              'rounded px-1.5 py-0.5 text-[10px] uppercase',
              statusClass(row.status)
            )}
          >
            {row.status}
          </span>
        </td>
        <td className="whitespace-nowrap px-3 py-2 text-right">
          {row.status === 'OPEN' ? (
            <div className="flex justify-end gap-1">
              <Button
                size="sm"
                variant="ghost"
                disabled={busy}
                onClick={onResolve}
                className="h-7 px-2 text-xs"
              >
                <CheckCircle2 className="mr-1 h-3 w-3" />
                Resolve
              </Button>
              <Button
                size="sm"
                variant="ghost"
                disabled={busy}
                onClick={onDismiss}
                className="h-7 px-2 text-xs"
              >
                <EyeOff className="mr-1 h-3 w-3" />
                Dismiss
              </Button>
            </div>
          ) : (
            <Button
              size="sm"
              variant="ghost"
              disabled={busy}
              onClick={onReopen}
              className="h-7 px-2 text-xs"
            >
              <RotateCcw className="mr-1 h-3 w-3" />
              Reopen
            </Button>
          )}
        </td>
      </tr>
      {expanded && (
        <tr className="bg-muted/20">
          <td colSpan={7} className="px-6 py-4 text-sm">
            <div className="space-y-3">
              <p className="whitespace-pre-line text-muted-foreground">
                {row.description}
              </p>
              {row.remediation && (
                <div>
                  <p className="mb-1 text-xs font-semibold uppercase text-muted-foreground">
                    Remediation
                  </p>
                  <p className="whitespace-pre-line text-sm">{row.remediation}</p>
                </div>
              )}
              {Array.isArray(row.references) && row.references.length > 0 && (
                <div>
                  <p className="mb-1 text-xs font-semibold uppercase text-muted-foreground">
                    References
                  </p>
                  <ul className="space-y-1 text-xs">
                    {(row.references as string[]).map((ref) => (
                      <li key={ref}>
                        <a
                          href={ref}
                          target="_blank"
                          rel="noreferrer"
                          className="text-blue-400 hover:underline"
                        >
                          {ref}
                        </a>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              <div className="grid gap-3 text-xs text-muted-foreground sm:grid-cols-2">
                <div>
                  First seen: <span className="font-mono">{formatDate(row.firstSeen)}</span>
                </div>
                <div>
                  Expires: <span className="font-mono">{formatDate(row.expiresAt)}</span>
                </div>
                {row.srcMac && (
                  <div>
                    Source MAC: <span className="font-mono">{row.srcMac}</span>
                  </div>
                )}
                <div>
                  Fingerprint: <span className="font-mono">{row.fingerprint}</span>
                </div>
              </div>
              {row.metadata != null && Object.keys(row.metadata as object).length > 0 && (
                <details>
                  <summary className="cursor-pointer text-xs uppercase text-muted-foreground">
                    Metadata
                  </summary>
                  <pre className="mt-2 overflow-x-auto rounded bg-background/60 p-3 text-xs">
                    {JSON.stringify(row.metadata, null, 2)}
                  </pre>
                </details>
              )}
            </div>
          </td>
        </tr>
      )}
    </>
  );
}

export function DetectionsPage(): JSX.Element {
  const queryClient = useQueryClient();
  const [windowHours, setWindowHours] = useState(24);
  const [statusFilter, setStatusFilter] = useState<DetectionStatus | 'ALL'>('OPEN');
  const [severityFloor, setSeverityFloor] = useState<DetectionSeverity | 'ALL'>(
    'ALL'
  );
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const summaryQuery = useQuery({
    queryKey: ['detections', 'analytics', windowHours],
    queryFn: async () =>
      requireData(
        await api.get<DetectionSummary>(
          `/detections/analytics?hours=${windowHours}`
        )
      ),
    refetchInterval: 30_000,
  });

  const listQuery = useQuery({
    queryKey: ['detections', 'list', windowHours, statusFilter, severityFloor],
    queryFn: async () => {
      const params = new URLSearchParams();
      params.set('hours', String(windowHours));
      if (statusFilter !== 'ALL') params.set('status', statusFilter);
      if (severityFloor !== 'ALL') params.set('severityAtLeast', severityFloor);
      params.set('limit', '200');
      return requireData(
        await api.get<DetectionRow[]>(`/detections?${params.toString()}`)
      );
    },
    refetchInterval: 30_000,
  });

  const mutation = useMutation({
    mutationFn: async ({
      id,
      action,
    }: {
      id: string;
      action: 'resolve' | 'dismiss' | 'reopen';
    }) => {
      await api.post(`/detections/${id}/${action}`, {});
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['detections'] });
    },
  });

  const summary = summaryQuery.data;
  const rows = useMemo(() => listQuery.data ?? [], [listQuery.data]);
  const sortedRows = useMemo(
    () =>
      [...rows].sort(
        (a, b) =>
          SEVERITY_ORDER[b.severity] - SEVERITY_ORDER[a.severity] ||
          new Date(b.lastSeen).getTime() - new Date(a.lastSeen).getTime()
      ),
    [rows]
  );

  const detectorRows =
    summary?.byDetector.map((d) => ({
      label: d.detectorId,
      count: d.count,
    })) ?? [];

  const affectedRows =
    summary?.topAffected.map((a) => ({
      label: a.resource,
      count: a.count,
      severity: a.maxSeverity,
    })) ?? [];

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
        <div>
          <h1 className="flex items-center gap-2 text-3xl font-bold tracking-tight">
            <Radar className="h-7 w-7 text-red-400" />
            Detections
          </h1>
          <p className="mt-2 max-w-3xl text-sm text-muted-foreground">
            Findings from ZeroProof&apos;s detection engine — IOC matches, IDS
            corroboration, scanning, DNS bypass, and more. Cross-correlated across
            UniFi flows, threat events, DNS queries, and threat-intel feeds.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <select
            className="rounded-md border border-border bg-background px-2 py-1 text-sm"
            value={windowHours}
            onChange={(e) => setWindowHours(Number(e.target.value))}
          >
            <option value={1}>Last 1h</option>
            <option value={6}>Last 6h</option>
            <option value={24}>Last 24h</option>
            <option value={72}>Last 3d</option>
            <option value={168}>Last 7d</option>
          </select>
        </div>
      </div>

      {summaryQuery.isLoading ? (
        <div className="flex h-32 items-center justify-center rounded-md border border-border/60 text-sm text-muted-foreground">
          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          Loading detections...
        </div>
      ) : !summary || summary.total === 0 ? (
        <Card className="border-dashed">
          <CardContent className="flex flex-col items-center gap-4 py-12 text-center">
            <div className="rounded-full border border-border/60 bg-muted/40 p-3">
              <AlertTriangle className="h-6 w-6 text-muted-foreground" />
            </div>
            <div className="max-w-lg space-y-2">
              <h2 className="text-xl font-semibold">No detections in this window</h2>
              <p className="text-sm text-muted-foreground">
                The detection engine evaluates UniFi flow + threat events and DNS
                queries every few minutes. New findings will appear here as they
                fire — and the cache survives across sessions for review.
              </p>
            </div>
          </CardContent>
        </Card>
      ) : (
        <>
          <SummaryTiles summary={summary} />

          <div className="grid gap-4 lg:grid-cols-2">
            <BarList
              title="Top detectors"
              description="Which rules are firing most in this window."
              rows={detectorRows}
            />
            <BarList
              title="Top affected resources"
              description="Devices / hosts with the most findings against them."
              rows={affectedRows}
            />
          </div>

          <Card>
            <CardHeader>
              <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                <div>
                  <CardTitle className="text-xl">Findings</CardTitle>
                  <CardDescription>
                    Detections in this window, severity-first.
                  </CardDescription>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <select
                    className="rounded-md border border-border bg-background px-2 py-1 text-sm"
                    value={statusFilter}
                    onChange={(e) =>
                      setStatusFilter(e.target.value as DetectionStatus | 'ALL')
                    }
                  >
                    <option value="ALL">All statuses</option>
                    <option value="OPEN">Open</option>
                    <option value="RESOLVED">Resolved</option>
                    <option value="DISMISSED">Dismissed</option>
                  </select>
                  <select
                    className="rounded-md border border-border bg-background px-2 py-1 text-sm"
                    value={severityFloor}
                    onChange={(e) =>
                      setSeverityFloor(
                        e.target.value as DetectionSeverity | 'ALL'
                      )
                    }
                  >
                    <option value="ALL">Any severity</option>
                    <option value="CRITICAL">Critical only</option>
                    <option value="HIGH">≥ High</option>
                    <option value="MEDIUM">≥ Medium</option>
                    <option value="LOW">≥ Low</option>
                  </select>
                </div>
              </div>
            </CardHeader>
            <CardContent>
              {listQuery.isLoading ? (
                <div className="flex h-32 items-center justify-center text-sm text-muted-foreground">
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Loading findings...
                </div>
              ) : sortedRows.length === 0 ? (
                <div className="flex min-h-32 items-center justify-center rounded-md border border-dashed border-border/60 text-sm text-muted-foreground">
                  No detections match these filters.
                </div>
              ) : (
                <div className="overflow-x-auto rounded-md border border-border/60">
                  <table className="min-w-[1000px] w-full text-sm">
                    <thead className="text-left text-xs uppercase text-muted-foreground">
                      <tr>
                        <th className="w-8 px-3 py-2"></th>
                        <th className="px-3 py-2 font-medium">Severity</th>
                        <th className="px-3 py-2 font-medium">Title</th>
                        <th className="px-3 py-2 font-medium">Affected</th>
                        <th className="px-3 py-2 font-medium">Last seen</th>
                        <th className="px-3 py-2 font-medium">Status</th>
                        <th className="px-3 py-2 text-right font-medium">
                          Actions
                        </th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border/60">
                      {sortedRows.map((row) => (
                        <DetectionListRow
                          key={row.id}
                          row={row}
                          expanded={expandedId === row.id}
                          onToggle={() =>
                            setExpandedId((cur) => (cur === row.id ? null : row.id))
                          }
                          busy={mutation.isPending}
                          onResolve={() =>
                            mutation.mutate({ id: row.id, action: 'resolve' })
                          }
                          onDismiss={() =>
                            mutation.mutate({ id: row.id, action: 'dismiss' })
                          }
                          onReopen={() =>
                            mutation.mutate({ id: row.id, action: 'reopen' })
                          }
                        />
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
              {sortedRows.length > 0 && (
                <p className="mt-3 text-right text-xs text-muted-foreground">
                  Showing {sortedRows.length} of {summary?.total ?? 0} findings
                </p>
              )}
            </CardContent>
          </Card>
        </>
      )}

      <Badge variant="outline" className="text-xs text-muted-foreground">
        Window: last {summary?.windowHours ?? windowHours}h · since{' '}
        {summary?.since ? formatDate(summary.since) : '—'}
      </Badge>
    </div>
  );
}

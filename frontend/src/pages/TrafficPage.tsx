import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import {
  ArrowDown,
  ArrowRight,
  ArrowUp,
  ArrowUpDown,
  Loader2,
  Server,
  Shield,
  ShieldAlert,
  Settings as SettingsIcon,
} from 'lucide-react';
import api from '@/api/client';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { cn, formatDate } from '@/lib/utils';
import type {
  ApiResponse,
  TrafficAnalytics,
  TrafficFlow,
  TrafficThreat,
} from '@/types';

function requireData<T>(response: ApiResponse<T>): T {
  if (!response.success || response.data === undefined) {
    throw new Error(response.error?.message || 'Request failed');
  }
  return response.data;
}

const NUM_FORMAT = new Intl.NumberFormat();

function NotConfigured(): JSX.Element {
  return (
    <Card className="border-dashed">
      <CardContent className="flex flex-col items-center gap-4 py-12 text-center">
        <div className="rounded-full border border-border/60 bg-muted/40 p-3">
          <Server className="h-6 w-6 text-muted-foreground" />
        </div>
        <div className="space-y-2 max-w-lg">
          <h2 className="text-xl font-semibold">UniFi not configured</h2>
          <p className="text-sm text-muted-foreground">
            Connect your UniFi controller to start ingesting firewall flows and threat detections.
            Each pull lands in ZeroProof&apos;s database — survive UniFi&apos;s ~5,000-row session
            window and cross-correlate with DNS Proxy verdicts.
          </p>
        </div>
        <Button asChild>
          <Link to="/settings#unifi">
            <SettingsIcon className="mr-2 h-4 w-4" />
            Configure UniFi
          </Link>
        </Button>
      </CardContent>
    </Card>
  );
}

function SummaryTiles({ analytics }: { analytics: TrafficAnalytics }): JSX.Element {
  const summary = analytics.summary!;
  return (
    <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
      <Card>
        <CardContent className="p-4">
          <p className="text-xs uppercase text-muted-foreground">Total blocked</p>
          <p className="mt-1 text-3xl font-semibold">{NUM_FORMAT.format(summary.totalBlocked)}</p>
          <p className="mt-1 text-xs text-muted-foreground">last {analytics.windowHours}h</p>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-4">
          <p className="text-xs uppercase text-muted-foreground">Risk breakdown</p>
          <ul className="mt-2 space-y-1 text-sm">
            <li className="flex items-center justify-between">
              <span className="text-emerald-400">Low</span>
              <span className="font-mono">{NUM_FORMAT.format(summary.byRisk.low)}</span>
            </li>
            <li className="flex items-center justify-between">
              <span className="text-yellow-400">Medium</span>
              <span className="font-mono">{NUM_FORMAT.format(summary.byRisk.medium)}</span>
            </li>
            <li className="flex items-center justify-between">
              <span className="text-red-400">High</span>
              <span className="font-mono">{NUM_FORMAT.format(summary.byRisk.high)}</span>
            </li>
          </ul>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-4">
          <p className="text-xs uppercase text-muted-foreground">Affected clients</p>
          <p className="mt-1 text-3xl font-semibold">{NUM_FORMAT.format(summary.uniqueSrcMacs)}</p>
          <p className="mt-1 text-xs text-muted-foreground">distinct source MACs</p>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-4">
          <p className="text-xs uppercase text-muted-foreground">Threat detections</p>
          <p className="mt-1 text-3xl font-semibold flex items-center gap-2">
            <ShieldAlert className="h-6 w-6 text-red-400" />
            {NUM_FORMAT.format(summary.threatCount)}
          </p>
          <p className="mt-1 text-xs text-muted-foreground">IPS events this window</p>
        </CardContent>
      </Card>
    </div>
  );
}

function BarList({
  title,
  description,
  rows,
  icon: Icon,
}: {
  title: string;
  description: string;
  rows: { label: string; sub?: string; count: number }[];
  icon?: typeof Shield;
}): JSX.Element {
  const max = rows[0]?.count ?? 0;
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-lg">
          {Icon && <Icon className="h-4 w-4 text-muted-foreground" />}
          {title}
        </CardTitle>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
      <CardContent>
        {rows.length === 0 ? (
          <div className="flex min-h-32 items-center justify-center rounded-md border border-dashed border-border/60 px-4 text-center text-sm text-muted-foreground">
            No data yet — run a sync or wait for the scheduler to poll.
          </div>
        ) : (
          <ol className="space-y-3">
            {rows.map((row, idx) => (
              <li key={`${row.label}-${idx}`} className="space-y-1">
                <div className="flex items-baseline justify-between gap-3">
                  <div className="min-w-0 truncate text-sm">
                    <span className="mr-2 text-xs text-muted-foreground">{idx + 1}.</span>
                    <span className="font-medium">{row.label}</span>
                    {row.sub && (
                      <span className="ml-2 text-xs text-muted-foreground">{row.sub}</span>
                    )}
                  </div>
                  <span className="font-mono text-xs text-muted-foreground">
                    {NUM_FORMAT.format(row.count)}
                  </span>
                </div>
                <div className="h-1.5 overflow-hidden rounded-full bg-muted">
                  <div
                    className="h-full rounded-full bg-red-500/70"
                    style={{ width: max ? `${Math.max(2, (row.count / max) * 100)}%` : '0%' }}
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

function directionIcon(direction: string | null): JSX.Element {
  if (direction === 'outgoing') return <ArrowUp className="h-3 w-3 text-muted-foreground" />;
  if (direction === 'incoming') return <ArrowDown className="h-3 w-3 text-muted-foreground" />;
  if (direction === 'local') return <ArrowRight className="h-3 w-3 text-muted-foreground" />;
  return <ArrowUpDown className="h-3 w-3 text-muted-foreground" />;
}

function FlowRow({ flow }: { flow: TrafficFlow }): JSX.Element {
  return (
    <tr className="align-top">
      <td className="whitespace-nowrap px-3 py-2 text-xs text-muted-foreground">
        {formatDate(flow.occurredAt)}
      </td>
      <td className="px-3 py-2">
        <div className="font-medium">{flow.srcClientName ?? flow.srcMac ?? '—'}</div>
        <div className="font-mono text-xs text-muted-foreground">
          {flow.srcMac} · {flow.srcNetworkName}
        </div>
      </td>
      <td className="px-3 py-2">
        <div className="font-mono text-xs">{flow.dstIp ?? '—'}</div>
        <div className="text-xs text-muted-foreground">
          {flow.dstClientName ?? '—'}
          {flow.dstRegion && (
            <span className="ml-2 inline-block rounded bg-muted px-1 py-0.5 text-[10px] uppercase">
              {flow.dstRegion}
            </span>
          )}
        </div>
      </td>
      <td className="whitespace-nowrap px-3 py-2 text-xs text-muted-foreground">
        {flow.service ?? flow.protocol ?? '—'}
      </td>
      <td className="whitespace-nowrap px-3 py-2">
        <span
          className={cn(
            'rounded px-1.5 py-0.5 text-[10px] uppercase',
            flow.risk === 'high' && 'bg-red-500/20 text-red-300',
            flow.risk === 'medium' && 'bg-yellow-500/20 text-yellow-300',
            flow.risk === 'low' && 'bg-emerald-500/20 text-emerald-300',
            !['high', 'medium', 'low'].includes(flow.risk ?? '') && 'bg-muted text-muted-foreground'
          )}
        >
          {flow.risk ?? '—'}
        </span>
      </td>
      <td className="whitespace-nowrap px-3 py-2">{directionIcon(flow.direction)}</td>
      <td className="whitespace-nowrap px-3 py-2 text-xs text-muted-foreground">
        {flow.inNetworkName ?? '—'}
      </td>
      <td className="px-3 py-2 text-xs">{flow.primaryPolicyName ?? '—'}</td>
      <td className="whitespace-nowrap px-3 py-2">
        <Badge variant={flow.action === 'blocked' ? 'destructive' : 'success'}>
          {flow.action}
        </Badge>
      </td>
    </tr>
  );
}

function ThreatRow({ threat }: { threat: TrafficThreat }): JSX.Element {
  const sev = (threat.severity ?? '').toLowerCase();
  return (
    <tr className="align-top">
      <td className="whitespace-nowrap px-3 py-2 text-xs text-muted-foreground">
        {formatDate(threat.occurredAt)}
      </td>
      <td className="px-3 py-2">
        <span
          className={cn(
            'rounded px-1.5 py-0.5 text-[10px] uppercase',
            sev === 'high' && 'bg-red-500/20 text-red-300',
            sev === 'medium' && 'bg-yellow-500/20 text-yellow-300',
            sev === 'low' && 'bg-emerald-500/20 text-emerald-300',
            !['high', 'medium', 'low'].includes(sev) && 'bg-muted text-muted-foreground'
          )}
        >
          {threat.severity ?? '—'}
        </span>
      </td>
      <td className="px-3 py-2 text-sm">{threat.message ?? '—'}</td>
      <td className="whitespace-nowrap px-3 py-2 font-mono text-xs">{threat.srcIp ?? '—'}</td>
      <td className="whitespace-nowrap px-3 py-2 font-mono text-xs">{threat.dstIp ?? '—'}</td>
    </tr>
  );
}

export function TrafficPage(): JSX.Element {
  const analyticsQuery = useQuery({
    queryKey: ['traffic', 'analytics', 24],
    queryFn: async () => requireData(await api.get<TrafficAnalytics>('/traffic/analytics?hours=24')),
    refetchInterval: 30_000,
  });

  const analytics = analyticsQuery.data;
  const configured = Boolean(analytics?.configured);

  const policyRows = useMemo(
    () => analytics?.topPolicies.map((p) => ({ label: p.name, count: p.count })) ?? [],
    [analytics]
  );
  const clientRows = useMemo(
    () =>
      analytics?.topClients.map((c) => ({
        label: c.displayName,
        sub: c.mac,
        count: c.count,
      })) ?? [],
    [analytics]
  );
  const regionRows = useMemo(
    () => analytics?.topRegions.map((r) => ({ label: r.region, count: r.count })) ?? [],
    [analytics]
  );

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Traffic &amp; Flow</h1>
          <p className="mt-2 max-w-3xl text-sm text-muted-foreground">
            UniFi firewall flows and IPS detections, captured into ZeroProof&apos;s database and
            cross-correlatable with DNS Proxy verdicts. Outlasts UniFi&apos;s session window so you
            can investigate yesterday&apos;s blocks, not just the last hour.
          </p>
        </div>
        {configured && (
          <Button asChild variant="outline" size="sm">
            <Link to="/settings#unifi">
              <SettingsIcon className="mr-2 h-4 w-4" />
              UniFi settings
            </Link>
          </Button>
        )}
      </div>

      {analyticsQuery.isLoading ? (
        <div className="flex h-32 items-center justify-center rounded-md border border-border/60 text-sm text-muted-foreground">
          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          Loading traffic analytics...
        </div>
      ) : !configured || !analytics?.summary ? (
        <NotConfigured />
      ) : (
        <>
          <SummaryTiles analytics={analytics} />

          <div className="grid gap-4 lg:grid-cols-3">
            <BarList
              title="Top triggered policies"
              description="Firewall policies firing most in the last 24h."
              rows={policyRows}
              icon={Shield}
            />
            <BarList
              title="Top affected clients"
              description="UniFi clients responsible for the most blocked flows."
              rows={clientRows}
            />
            <BarList
              title="Top affected regions"
              description="Country codes hit most by blocked outbound traffic."
              rows={regionRows}
            />
          </div>

          {analytics.recentThreats.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-xl">
                  <ShieldAlert className="h-5 w-5 text-red-400" />
                  Recent threats
                </CardTitle>
                <CardDescription>
                  IPS / honeypot detections from the UniFi system log. Distinct from policy-driven
                  firewall blocks below.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <div className="overflow-x-auto rounded-md border border-border/60">
                  <table className="w-full text-sm">
                    <thead className="text-left text-xs uppercase text-muted-foreground">
                      <tr>
                        <th className="px-3 py-2 font-medium">Time</th>
                        <th className="px-3 py-2 font-medium">Severity</th>
                        <th className="px-3 py-2 font-medium">Message</th>
                        <th className="px-3 py-2 font-medium">Source</th>
                        <th className="px-3 py-2 font-medium">Destination</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border/60">
                      {analytics.recentThreats.map((threat) => (
                        <ThreatRow key={threat.id} threat={threat} />
                      ))}
                    </tbody>
                  </table>
                </div>
              </CardContent>
            </Card>
          )}

          <Card>
            <CardHeader>
              <CardTitle className="text-xl">Recent flows</CardTitle>
              <CardDescription>
                Per-flow rows from the last {analytics.windowHours} hours. UniFi only exposes
                blocked flows; allow-traffic visibility comes from DPI / DNS proxy data instead.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="overflow-x-auto rounded-md border border-border/60">
                <table className="min-w-[1100px] w-full text-sm">
                  <thead className="text-left text-xs uppercase text-muted-foreground">
                    <tr>
                      <th className="px-3 py-2 font-medium">Time</th>
                      <th className="px-3 py-2 font-medium">Source</th>
                      <th className="px-3 py-2 font-medium">Destination</th>
                      <th className="px-3 py-2 font-medium">Service</th>
                      <th className="px-3 py-2 font-medium">Risk</th>
                      <th className="px-3 py-2 font-medium">Dir.</th>
                      <th className="px-3 py-2 font-medium">In</th>
                      <th className="px-3 py-2 font-medium">Policy</th>
                      <th className="px-3 py-2 font-medium">Action</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border/60">
                    {analytics.recentFlows.map((flow) => (
                      <FlowRow key={flow.id} flow={flow} />
                    ))}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}

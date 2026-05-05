import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import {
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  Database,
  Loader2,
  RefreshCw,
  Search,
  Server,
  ShieldCheck,
  Settings as SettingsIcon,
  XCircle,
} from 'lucide-react';
import api from '@/api/client';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { cn, formatDate } from '@/lib/utils';
import { DnsActivityChart } from '@/components/dns-proxy/DnsActivityChart';
import { DnsCoveragePanel } from '@/components/dns-proxy/DnsCoveragePanel';
import { DnsTopClients } from '@/components/dns-proxy/DnsTopClients';
import { DnsTopDomains } from '@/components/dns-proxy/DnsTopDomains';
import type {
  ApiResponse,
  DnsAttributionStatus,
  DnsProxyAnalytics,
  DnsProxyQueriesResponse,
  DnsProxyQuery,
  DnsProxyStatus,
} from '@/types';

type QueryStatusFilter = 'all' | 'blocked' | 'allowed';

interface QueryFilters {
  search: string;
  client: string;
  status: QueryStatusFilter;
  suspiciousOnly: boolean;
}

type Tone = 'success' | 'warning' | 'danger' | 'neutral';

function requireData<T>(response: ApiResponse<T>): T {
  if (!response.success || response.data === undefined) {
    throw new Error(response.error?.message || 'Request failed');
  }
  return response.data;
}

function attributionVariant(status?: DnsAttributionStatus): 'success' | 'medium' | 'outline' {
  if (status === 'HEALTHY') return 'success';
  if (status === 'DEGRADED') return 'medium';
  return 'outline';
}

function attributionLabel(status?: DnsAttributionStatus): string {
  if (status === 'HEALTHY') return 'Device-level';
  if (status === 'DEGRADED') return 'Gateway-only';
  return 'Unknown';
}

function boolLabel(value?: boolean | null): string {
  if (value === true) return 'Enabled';
  if (value === false) return 'Disabled';
  return 'Unknown';
}

function clientIpVisibilityLabel(anonymized?: boolean | null): string {
  if (anonymized === true) return 'Anonymized';
  if (anonymized === false) return 'Visible';
  return 'Unknown';
}

function clientLabel(query: DnsProxyQuery): string {
  if (query.clientName && query.clientIp) return `${query.clientName} (${query.clientIp})`;
  return query.clientName || query.clientIp || 'Unknown client';
}

function isRecentTimestamp(timestamp?: string, withinMs = 10 * 60 * 1000): boolean {
  if (!timestamp) return false;
  const value = new Date(timestamp).getTime();
  return Number.isFinite(value) && Date.now() - value <= withinMs;
}

const TONE_STYLES: Record<Tone, { icon: string; chip: string; border: string }> = {
  success: {
    icon: 'text-emerald-400',
    chip: 'border-emerald-500/40 bg-emerald-500/10',
    border: 'border-emerald-500/40',
  },
  warning: {
    icon: 'text-yellow-400',
    chip: 'border-yellow-500/40 bg-yellow-500/10',
    border: 'border-yellow-500/40',
  },
  danger: {
    icon: 'text-red-400',
    chip: 'border-red-500/40 bg-red-500/10',
    border: 'border-red-500/40',
  },
  neutral: {
    icon: 'text-muted-foreground',
    chip: 'border-border/60 bg-muted/40',
    border: 'border-border/60',
  },
};

function StatusMetric({
  label,
  value,
  detail,
  icon: Icon,
  tone = 'neutral',
}: {
  label: string;
  value: string;
  detail?: string;
  icon: typeof Server;
  tone?: Tone;
}) {
  const styles = TONE_STYLES[tone];
  return (
    <Card className={cn(tone !== 'neutral' && styles.border)}>
      <CardContent className="p-4">
        <div className="flex items-start gap-3">
          <div className={cn('rounded-md border p-2', styles.chip)}>
            <Icon className={cn('h-4 w-4', styles.icon)} />
          </div>
          <div className="min-w-0">
            <p className="text-xs font-medium uppercase text-muted-foreground">{label}</p>
            <p className="mt-1 truncate text-lg font-semibold">{value}</p>
            {detail && <p className="mt-1 text-xs text-muted-foreground">{detail}</p>}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function QueryTable({ queries, isLoading }: { queries: DnsProxyQuery[]; isLoading: boolean }) {
  if (isLoading) {
    return (
      <div className="flex min-h-48 items-center justify-center rounded-md border border-border/60 text-sm text-muted-foreground">
        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
        Loading DNS queries...
      </div>
    );
  }

  if (queries.length === 0) {
    return (
      <div className="flex min-h-48 flex-col items-center justify-center rounded-md border border-dashed border-border/80 px-4 text-center">
        <Database className="h-7 w-7 text-muted-foreground" />
        <p className="mt-3 text-sm font-medium">No DNS queries collected yet</p>
        <p className="mt-1 max-w-lg text-sm text-muted-foreground">
          Save an AdGuard Home connection, enable polling, and run a sync after UniFi clients are using AdGuard for DNS.
        </p>
      </div>
    );
  }

  return (
    <div className="overflow-x-auto rounded-md border border-border/60">
      <table className="min-w-[980px] w-full text-sm">
        <thead className="bg-muted/50 text-left text-xs uppercase text-muted-foreground">
          <tr>
            <th className="px-4 py-3 font-medium">Time</th>
            <th className="px-4 py-3 font-medium">Client</th>
            <th className="px-4 py-3 font-medium">Domain</th>
            <th className="px-4 py-3 font-medium">Type</th>
            <th className="px-4 py-3 font-medium">Status</th>
            <th className="px-4 py-3 font-medium">Reason / Rule</th>
            <th className="px-4 py-3 font-medium">Upstream</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border/60">
          {queries.map((query) => (
            <tr key={query.id} className="align-top">
              <td className="whitespace-nowrap px-4 py-3 text-muted-foreground">{formatDate(query.queriedAt)}</td>
              <td className="max-w-[180px] px-4 py-3">
                <span className="block truncate" title={clientLabel(query)}>
                  {clientLabel(query)}
                </span>
              </td>
              <td className="max-w-[260px] px-4 py-3">
                <span className="block truncate font-medium" title={query.domain}>
                  {query.domain}
                </span>
                {query.isSuspicious && (
                  <Badge variant="high" className="mt-1">
                    Suspicious
                  </Badge>
                )}
              </td>
              <td className="px-4 py-3 text-muted-foreground">{query.queryType || '-'}</td>
              <td className="px-4 py-3">
                <Badge variant={query.isBlocked ? 'destructive' : 'success'}>
                  {query.isBlocked ? 'Blocked' : 'Allowed'}
                </Badge>
              </td>
              <td className="max-w-[260px] px-4 py-3 text-muted-foreground">
                <span className="block truncate" title={[query.reason, query.rule].filter(Boolean).join(' / ')}>
                  {[query.reason, query.rule].filter(Boolean).join(' / ') || query.status || '-'}
                </span>
              </td>
              <td className="max-w-[180px] px-4 py-3 text-muted-foreground">
                <span className="block truncate" title={query.upstream || undefined}>
                  {query.upstream || '-'}
                </span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function NotConfiguredState() {
  return (
    <Card className="border-dashed">
      <CardContent className="flex flex-col items-center gap-4 py-12 text-center">
        <div className="rounded-full border border-border/60 bg-muted/40 p-3">
          <Server className="h-6 w-6 text-muted-foreground" />
        </div>
        <div className="space-y-2 max-w-lg">
          <h2 className="text-xl font-semibold">DNS Proxy is not configured</h2>
          <p className="text-sm text-muted-foreground">
            Connect AdGuard Home in Settings to start polling DNS queries, run an attribution check against your UniFi
            client inventory, and surface campaign-relevant signals here.
          </p>
        </div>
        <Button asChild>
          <Link to="/settings#dns-proxy">
            <SettingsIcon className="mr-2 h-4 w-4" />
            Configure in Settings
          </Link>
        </Button>
      </CardContent>
    </Card>
  );
}

export function DNSProxyPage() {
  const [filters, setFilters] = useState<QueryFilters>({
    search: '',
    client: '',
    status: 'all',
    suspiciousOnly: false,
  });

  const statusQuery = useQuery({
    queryKey: ['dns-proxy', 'status'],
    queryFn: async () => requireData(await api.get<DnsProxyStatus>('/dns-proxy/status')),
    refetchInterval: 30000,
  });

  const status = statusQuery.data;
  const settings = status?.settings;
  const configured = Boolean(status?.configured);

  const queryString = useMemo(() => {
    const params = new URLSearchParams({ limit: '50', status: filters.status });
    if (filters.search.trim()) params.set('search', filters.search.trim());
    if (filters.client.trim()) params.set('client', filters.client.trim());
    if (filters.suspiciousOnly) params.set('suspiciousOnly', 'true');
    return params.toString();
  }, [filters]);

  const queriesQuery = useQuery({
    queryKey: ['dns-proxy', 'queries', queryString],
    queryFn: async () => requireData(await api.get<DnsProxyQueriesResponse>(`/dns-proxy/queries?${queryString}`)),
    refetchInterval: 30000,
    enabled: configured,
  });

  const analyticsQuery = useQuery({
    queryKey: ['dns-proxy', 'analytics', 24],
    queryFn: async () => requireData(await api.get<DnsProxyAnalytics>('/dns-proxy/analytics?hours=24')),
    refetchInterval: 60000,
    enabled: configured,
  });
  const analytics = analyticsQuery.data;
  const [showQueryLog, setShowQueryLog] = useState(false);

  const queries = queriesQuery.data?.queries || [];
  const attribution = status?.attribution;
  const attributionStatus = attribution?.status || settings?.attributionStatus || 'UNKNOWN';
  const attributionReason = attribution?.reason || settings?.attributionReason || 'No attribution check has run yet.';

  const queryLogEnabled = status?.adguard?.queryLogConfig?.enabled ?? settings?.queryLogEnabled;

  const adguardTone: Tone = !configured
    ? 'neutral'
    : status?.adguard?.reachable
      ? 'success'
      : status?.adguard?.error
        ? 'danger'
        : 'warning';

  const queryLogTone: Tone = !configured
    ? 'neutral'
    : queryLogEnabled === true
      ? 'success'
      : queryLogEnabled === false
        ? 'danger'
        : 'warning';

  const attributionTone: Tone = !configured
    ? 'neutral'
    : attributionStatus === 'HEALTHY'
      ? 'success'
      : attributionStatus === 'DEGRADED'
        ? 'warning'
        : 'neutral';

  const recentTone: Tone = !configured
    ? 'neutral'
    : isRecentTimestamp(status?.stats.lastQueryAt)
      ? 'success'
      : settings?.pollingEnabled
        ? 'warning'
        : 'neutral';

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">DNS Proxy</h1>
          <p className="mt-2 max-w-3xl text-sm text-muted-foreground">
            DNS visibility, attribution checks, and campaign-relevant signals from AdGuard Home.
          </p>
        </div>
        {configured && (
          <Button asChild variant="outline" size="sm">
            <Link to="/settings#dns-proxy">
              <SettingsIcon className="mr-2 h-4 w-4" />
              Settings
            </Link>
          </Button>
        )}
      </div>

      {!configured ? (
        <NotConfiguredState />
      ) : (
        <>
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
            <StatusMetric
              label="AdGuard"
              value={status?.adguard?.reachable ? 'Reachable' : status?.adguard?.error ? 'Unreachable' : 'Configured'}
              detail={status?.adguard?.version ? `Version ${status.adguard.version}` : status?.adguard?.error}
              icon={Server}
              tone={adguardTone}
            />
            <StatusMetric
              label="Query Log"
              value={boolLabel(queryLogEnabled)}
              detail={status?.stats.lastQueryAt ? `Last query ${formatDate(status.stats.lastQueryAt)}` : 'Waiting for query output'}
              icon={Database}
              tone={queryLogTone}
            />
            <StatusMetric
              label="Attribution"
              value={attributionLabel(attributionStatus)}
              detail={`${attribution?.matchedClientCount || 0}/${attribution?.uniqueClientCount || 0} clients match UniFi`}
              icon={ShieldCheck}
              tone={attributionTone}
            />
            <StatusMetric
              label="Recent DNS"
              value={`${status?.stats.recentQueries || 0} queries`}
              detail={`${status?.stats.blockedQueries || 0} blocked, ${status?.stats.suspiciousQueries || 0} suspicious`}
              icon={Search}
              tone={recentTone}
            />
          </div>

          <Card>
            <CardHeader>
              <CardTitle className="text-xl">DNS activity — last 24 hours</CardTitle>
              <CardDescription>Hourly query volume across your network. Allowed and blocked queries are stacked.</CardDescription>
            </CardHeader>
            <CardContent>
              {analyticsQuery.isLoading ? (
                <div className="flex h-56 items-center justify-center text-sm text-muted-foreground">
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Loading analytics...
                </div>
              ) : analytics ? (
                <DnsActivityChart buckets={analytics.hourlyBuckets} windowHours={analytics.windowHours} />
              ) : (
                <div className="flex h-56 items-center justify-center text-sm text-muted-foreground">
                  Analytics unavailable.
                </div>
              )}
            </CardContent>
          </Card>

          {analytics && <DnsCoveragePanel analytics={analytics} />}

          {analytics && (
            <div className="grid gap-4 lg:grid-cols-2">
              <DnsTopDomains
                title="Top blocked domains"
                description="Highest-volume domains AdGuard refused in the last 24h."
                rows={analytics.topBlocked}
                variant="blocked"
              />
              <DnsTopDomains
                title="Top allowed domains"
                description="Highest-volume domains AdGuard let through. Look for surprising ones."
                rows={analytics.topAllowed}
                variant="allowed"
              />
            </div>
          )}

          {analytics && <DnsTopClients rows={analytics.topClients} />}

          <Card>
            <CardHeader>
              <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <CardTitle className="text-xl">Attribution status</CardTitle>
                  <CardDescription>ZeroProof compares AdGuard client IPs with UniFi client inventory.</CardDescription>
                </div>
                <Badge variant={attributionVariant(attributionStatus)}>{attributionStatus}</Badge>
              </div>
            </CardHeader>
            <CardContent className="space-y-4">
              <div
                className={cn(
                  'rounded-md border p-4 text-sm',
                  attributionStatus === 'HEALTHY' && 'border-green-500/30 bg-green-500/10',
                  attributionStatus === 'DEGRADED' && 'border-yellow-500/40 bg-yellow-500/10',
                  attributionStatus === 'UNKNOWN' && 'border-border/60 bg-muted/30'
                )}
              >
                <div className="flex gap-3">
                  {attributionStatus === 'HEALTHY' ? (
                    <CheckCircle2 className="mt-0.5 h-5 w-5 text-green-500" />
                  ) : attributionStatus === 'DEGRADED' ? (
                    <AlertTriangle className="mt-0.5 h-5 w-5 text-yellow-500" />
                  ) : (
                    <XCircle className="mt-0.5 h-5 w-5 text-muted-foreground" />
                  )}
                  <div className="space-y-2">
                    <div>
                      <p className="font-medium">{attributionLabel(attributionStatus)} DNS evidence</p>
                      <p className="mt-1 text-muted-foreground">{attributionReason}</p>
                    </div>
                    {attributionStatus === 'DEGRADED' && (
                      <p className="text-muted-foreground">
                        To recover device-level attribution, hand out the AdGuard Home IP as the DHCP DNS server in
                        each UniFi network or VLAN.
                      </p>
                    )}
                  </div>
                </div>
              </div>
              <div className="grid gap-3 sm:grid-cols-3">
                <div className="rounded-md border border-border/60 p-3">
                  <p className="text-xs text-muted-foreground">AdGuard clients</p>
                  <p className="mt-1 text-lg font-semibold">{status?.stats.uniqueClients || 0}</p>
                </div>
                <div className="rounded-md border border-border/60 p-3">
                  <p className="text-xs text-muted-foreground">UniFi matches</p>
                  <p className="mt-1 text-lg font-semibold">{attribution?.matchedClientCount || 0}</p>
                </div>
                <div className="rounded-md border border-border/60 p-3">
                  <p className="text-xs text-muted-foreground">Client IPs</p>
                  <p className="mt-1 text-lg font-semibold">
                    {clientIpVisibilityLabel(settings?.anonymizeClientIp ?? status?.adguard?.queryLogConfig?.anonymize_client_ip)}
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>

          <Collapsible open={showQueryLog} onOpenChange={setShowQueryLog}>
          <Card>
            <CardHeader>
              <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                <div>
                  <CardTitle className="text-xl">Recent DNS query output</CardTitle>
                  <CardDescription>
                    Raw query log rows. Deduplicated, normalized, retained for {settings?.retentionDays || 7} days.
                  </CardDescription>
                </div>
                <div className="flex gap-2">
                  <CollapsibleTrigger asChild>
                    <Button variant="outline">
                      <ChevronDown
                        className={cn('mr-2 h-4 w-4 transition-transform', showQueryLog && 'rotate-180')}
                      />
                      {showQueryLog ? 'Hide' : 'Show'} query log
                    </Button>
                  </CollapsibleTrigger>
                  {showQueryLog && (
                    <Button variant="outline" onClick={() => queriesQuery.refetch()} disabled={queriesQuery.isFetching}>
                      {queriesQuery.isFetching ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <RefreshCw className="mr-2 h-4 w-4" />}
                      Refresh
                    </Button>
                  )}
                </div>
              </div>
            </CardHeader>
            <CollapsibleContent>
            <CardContent className="space-y-4">
              <div className="grid gap-3 md:grid-cols-[minmax(0,1.1fr)_minmax(0,0.9fr)_10rem_auto]">
                <div className="space-y-2">
                  <Label htmlFor="domain-filter">Domain filter</Label>
                  <Input
                    id="domain-filter"
                    value={filters.search}
                    placeholder="xdresi.to"
                    onChange={(event) => setFilters((current) => ({ ...current, search: event.target.value }))}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="client-filter">Client filter</Label>
                  <Input
                    id="client-filter"
                    value={filters.client}
                    placeholder="192.168.30.50"
                    onChange={(event) => setFilters((current) => ({ ...current, client: event.target.value }))}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="status-filter">Status</Label>
                  <select
                    id="status-filter"
                    className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                    value={filters.status}
                    onChange={(event) =>
                      setFilters((current) => ({ ...current, status: event.target.value as QueryStatusFilter }))
                    }
                  >
                    <option value="all">All</option>
                    <option value="blocked">Blocked</option>
                    <option value="allowed">Allowed</option>
                  </select>
                </div>
                <label className="flex items-end gap-3 pb-2 text-sm">
                  <input
                    type="checkbox"
                    className="h-4 w-4 rounded border-border"
                    checked={filters.suspiciousOnly}
                    onChange={(event) => setFilters((current) => ({ ...current, suspiciousOnly: event.target.checked }))}
                  />
                  Suspicious only
                </label>
              </div>

              <QueryTable queries={queries} isLoading={queriesQuery.isLoading} />
            </CardContent>
            </CollapsibleContent>
          </Card>
          </Collapsible>
        </>
      )}
    </div>
  );
}

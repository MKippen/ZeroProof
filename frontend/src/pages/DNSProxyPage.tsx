import { FormEvent, useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  AlertTriangle,
  CheckCircle2,
  Database,
  Loader2,
  RefreshCw,
  Save,
  Search,
  Server,
  ShieldCheck,
  Trash2,
  XCircle,
} from 'lucide-react';
import api from '@/api/client';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useToast } from '@/hooks/useToast';
import { cn, formatDate } from '@/lib/utils';
import type {
  ApiResponse,
  DnsAttributionStatus,
  DnsProxyQueriesResponse,
  DnsProxyQuery,
  DnsProxySettings,
  DnsProxyStatus,
} from '@/types';

type SettingsResponse = { configured: boolean; settings: DnsProxySettings | null };
type QueryStatusFilter = 'all' | 'blocked' | 'allowed';

interface DnsProxyFormState {
  host: string;
  port: number;
  useHttps: boolean;
  username: string;
  password: string;
  pollingEnabled: boolean;
  retentionDays: number;
}

interface QueryFilters {
  search: string;
  client: string;
  status: QueryStatusFilter;
  suspiciousOnly: boolean;
}

const defaultForm: DnsProxyFormState = {
  host: '',
  port: 3000,
  useHttps: false,
  username: '',
  password: '',
  pollingEnabled: true,
  retentionDays: 7,
};

function requireData<T>(response: ApiResponse<T>): T {
  if (!response.success || response.data === undefined) {
    throw new Error(response.error?.message || 'Request failed');
  }
  return response.data;
}

function settingsToForm(settings: DnsProxySettings | null): DnsProxyFormState {
  if (!settings) return defaultForm;
  return {
    host: settings.host,
    port: settings.port,
    useHttps: settings.useHttps,
    username: settings.username,
    password: '',
    pollingEnabled: settings.pollingEnabled,
    retentionDays: settings.retentionDays,
  };
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

function StatusMetric({
  label,
  value,
  detail,
  icon: Icon,
}: {
  label: string;
  value: string;
  detail?: string;
  icon: typeof Server;
}) {
  return (
    <Card>
      <CardContent className="p-4">
        <div className="flex items-start gap-3">
          <div className="rounded-md border border-border/60 bg-muted/40 p-2">
            <Icon className="h-4 w-4 text-muted-foreground" />
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

export function DNSProxyPage() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [form, setForm] = useState<DnsProxyFormState>(defaultForm);
  const [filters, setFilters] = useState<QueryFilters>({
    search: '',
    client: '',
    status: 'all',
    suspiciousOnly: false,
  });

  const settingsQuery = useQuery({
    queryKey: ['dns-proxy', 'settings'],
    queryFn: async () => requireData(await api.get<SettingsResponse>('/dns-proxy/settings')),
  });

  const statusQuery = useQuery({
    queryKey: ['dns-proxy', 'status'],
    queryFn: async () => requireData(await api.get<DnsProxyStatus>('/dns-proxy/status')),
    refetchInterval: 30000,
  });

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
  });

  useEffect(() => {
    if (settingsQuery.data?.settings) {
      setForm(settingsToForm(settingsQuery.data.settings));
    }
  }, [settingsQuery.data?.settings]);

  const payload = useMemo(
    () => ({
      host: form.host.trim(),
      port: Number(form.port),
      useHttps: form.useHttps,
      username: form.username.trim(),
      password: form.password || undefined,
      pollingEnabled: form.pollingEnabled,
      retentionDays: Number(form.retentionDays),
    }),
    [form]
  );

  const invalidateDnsProxy = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ['dns-proxy', 'settings'] }),
      queryClient.invalidateQueries({ queryKey: ['dns-proxy', 'status'] }),
      queryClient.invalidateQueries({ queryKey: ['dns-proxy', 'queries'] }),
    ]);
  };

  const testMutation = useMutation({
    mutationFn: async () => requireData(await api.post('/dns-proxy/test', payload)),
    onSuccess: () => toast({ title: 'AdGuard connection verified' }),
    onError: (error) => toast({ variant: 'destructive', title: 'Connection failed', description: error.message }),
  });

  const saveMutation = useMutation({
    mutationFn: async () => requireData(await api.post<SettingsResponse>('/dns-proxy/settings', payload)),
    onSuccess: async () => {
      setForm((current) => ({ ...current, password: '' }));
      await invalidateDnsProxy();
      toast({ title: 'DNS proxy settings saved' });
    },
    onError: (error) => toast({ variant: 'destructive', title: 'Save failed', description: error.message }),
  });

  const deleteMutation = useMutation({
    mutationFn: async () => requireData(await api.delete('/dns-proxy/settings')),
    onSuccess: async () => {
      setForm(defaultForm);
      await invalidateDnsProxy();
      toast({ title: 'DNS proxy connection removed' });
    },
    onError: (error) => toast({ variant: 'destructive', title: 'Delete failed', description: error.message }),
  });

  const syncMutation = useMutation({
    mutationFn: async () => requireData(await api.post('/dns-proxy/sync')),
    onSuccess: async () => {
      await invalidateDnsProxy();
      toast({ title: 'DNS query log synced' });
    },
    onError: (error) => toast({ variant: 'destructive', title: 'Sync failed', description: error.message }),
  });

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    saveMutation.mutate();
  };

  const status = statusQuery.data;
  const settings = settingsQuery.data?.settings;
  const configured = settingsQuery.data?.configured || status?.configured;
  const queries = queriesQuery.data?.queries || [];
  const attribution = status?.attribution;
  const attributionStatus = attribution?.status || settings?.attributionStatus || 'UNKNOWN';
  const attributionReason = attribution?.reason || settings?.attributionReason || 'No attribution check has run yet.';

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">DNS Proxy</h1>
          <p className="mt-2 max-w-3xl text-sm text-muted-foreground">
            Connect AdGuard Home as a lightweight evidence source for DNS visibility, attribution checks, and campaign signals.
          </p>
        </div>
        <Button
          variant="outline"
          onClick={() => syncMutation.mutate()}
          disabled={!configured || syncMutation.isPending}
        >
          {syncMutation.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <RefreshCw className="mr-2 h-4 w-4" />}
          Sync now
        </Button>
      </div>

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <StatusMetric
          label="AdGuard"
          value={
            !configured
              ? 'Not configured'
              : status?.adguard?.reachable
                ? 'Reachable'
                : status?.adguard?.error
                  ? 'Unreachable'
                  : 'Configured'
          }
          detail={status?.adguard?.version ? `Version ${status.adguard.version}` : status?.adguard?.error}
          icon={Server}
        />
        <StatusMetric
          label="Query Log"
          value={boolLabel(status?.adguard?.queryLogConfig?.enabled ?? settings?.queryLogEnabled)}
          detail={status?.stats.lastQueryAt ? `Last query ${formatDate(status.stats.lastQueryAt)}` : 'Waiting for query output'}
          icon={Database}
        />
        <StatusMetric
          label="Attribution Check"
          value={attributionLabel(attributionStatus)}
          detail={`${attribution?.matchedClientCount || 0}/${attribution?.uniqueClientCount || 0} clients match UniFi`}
          icon={ShieldCheck}
        />
        <StatusMetric
          label="Recent DNS"
          value={`${status?.stats.recentQueries || 0} queries`}
          detail={`${status?.stats.blockedQueries || 0} blocked, ${status?.stats.suspiciousQueries || 0} suspicious`}
          icon={Search}
        />
      </div>

      <div className="grid gap-6 xl:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-xl">
              <Server className="h-5 w-5" />
              AdGuard Home connection
            </CardTitle>
            <CardDescription>
              ZeroProof uses the AdGuard Home control API to verify logging and poll recent DNS queries.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form className="space-y-4" onSubmit={handleSubmit}>
              <div className="rounded-md border border-blue-500/30 bg-blue-500/10 p-3 text-sm">
                <p className="font-medium">Home Assistant add-on note</p>
                <p className="mt-1 text-muted-foreground">
                  If you only open AdGuard through Home Assistant Ingress, ZeroProof cannot reuse that browser session.
                  Point this form at the add-on's direct AdGuard Home host and port instead. Leave credentials blank when
                  that API is reachable without AdGuard's own login.
                </p>
              </div>

              <div className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_7rem]">
                <div className="space-y-2">
                  <Label htmlFor="adguard-host">Host or IP</Label>
                  <Input
                    id="adguard-host"
                    value={form.host}
                    placeholder="192.168.1.10"
                    onChange={(event) => setForm((current) => ({ ...current, host: event.target.value }))}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="adguard-port">Port</Label>
                  <Input
                    id="adguard-port"
                    type="number"
                    min={1}
                    max={65535}
                    value={form.port}
                    onChange={(event) => setForm((current) => ({ ...current, port: Number(event.target.value) }))}
                  />
                </div>
              </div>

              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="adguard-username">Username optional</Label>
                  <Input
                    id="adguard-username"
                    value={form.username}
                    placeholder="Leave blank for no AdGuard auth"
                    onChange={(event) => setForm((current) => ({ ...current, username: event.target.value }))}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="adguard-password">Password optional</Label>
                  <Input
                    id="adguard-password"
                    type="password"
                    value={form.password}
                    placeholder={settings?.id && form.username ? 'Use saved password' : 'Leave blank for no AdGuard auth'}
                    onChange={(event) => setForm((current) => ({ ...current, password: event.target.value }))}
                  />
                </div>
              </div>

              <div className="grid gap-3 rounded-md border border-border/60 p-3 sm:grid-cols-2">
                <label className="flex items-center gap-3 text-sm">
                  <input
                    type="checkbox"
                    className="h-4 w-4 rounded border-border"
                    checked={form.useHttps}
                    onChange={(event) => setForm((current) => ({ ...current, useHttps: event.target.checked }))}
                  />
                  Use HTTPS
                </label>
                <label className="flex items-center gap-3 text-sm">
                  <input
                    type="checkbox"
                    className="h-4 w-4 rounded border-border"
                    checked={form.pollingEnabled}
                    onChange={(event) => setForm((current) => ({ ...current, pollingEnabled: event.target.checked }))}
                  />
                  Poll every 60 seconds
                </label>
              </div>

              <div className="space-y-2">
                <Label htmlFor="retention-days">Raw query retention days</Label>
                <Input
                  id="retention-days"
                  type="number"
                  min={1}
                  max={30}
                  value={form.retentionDays}
                  onChange={(event) => setForm((current) => ({ ...current, retentionDays: Number(event.target.value) }))}
                />
                <p className="text-xs text-muted-foreground">
                  Normalized query rows default to 7 days and are capped at 30 days. Campaign DNS signals are retained separately for 90 days.
                </p>
              </div>

              <div className="flex flex-col gap-2 sm:flex-row">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => testMutation.mutate()}
                  disabled={!form.host || testMutation.isPending}
                >
                  {testMutation.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <CheckCircle2 className="mr-2 h-4 w-4" />}
                  Test
                </Button>
                <Button type="submit" disabled={!form.host || saveMutation.isPending}>
                  {saveMutation.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
                  Save
                </Button>
                <Button
                  type="button"
                  variant="destructive"
                  onClick={() => deleteMutation.mutate()}
                  disabled={!configured || deleteMutation.isPending}
                >
                  {deleteMutation.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Trash2 className="mr-2 h-4 w-4" />}
                  Delete
                </Button>
              </div>
            </form>
          </CardContent>
        </Card>

        <div className="space-y-6">
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
                  <div>
                    <p className="font-medium">{attributionLabel(attributionStatus)} DNS evidence</p>
                    <p className="mt-1 text-muted-foreground">{attributionReason}</p>
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

          <Card>
            <CardHeader>
              <CardTitle className="text-xl">UniFi DNS setup checklist</CardTitle>
              <CardDescription>Use this to choose whether DNS evidence can be device-level or network-level.</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-3 text-sm">
                <div className="rounded-md border border-green-500/30 bg-green-500/10 p-3">
                  <p className="font-medium">Preferred</p>
                  <p className="mt-1 text-muted-foreground">
                    In each UniFi network or VLAN, hand out the AdGuard Home IP directly as the DHCP DNS server.
                  </p>
                </div>
                <div className="rounded-md border border-border/60 p-3">
                  <p className="font-medium">Supported</p>
                  <p className="mt-1 text-muted-foreground">
                    Gateway-forwarded DNS still gives domain visibility, but most queries may appear as the router or gateway IP.
                  </p>
                </div>
                <div className="rounded-md border border-border/60 p-3">
                  <p className="font-medium">Home Assistant hosted</p>
                  <p className="mt-1 text-muted-foreground">
                    Use the add-on's exposed AdGuard Home port/API. The Home Assistant Ingress URL is for your browser,
                    not for a background poller.
                  </p>
                </div>
                <div className="rounded-md border border-border/60 p-3">
                  <p className="font-medium">Later hardening</p>
                  <p className="mt-1 text-muted-foreground">
                    Block or redirect direct external DNS after the basic evidence path is working.
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>

      <Card>
        <CardHeader>
          <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
            <div>
              <CardTitle className="text-xl">Recent DNS query output</CardTitle>
              <CardDescription>
                Query log rows are deduplicated, stripped to normalized fields, and retained for {settings?.retentionDays || form.retentionDays} days.
              </CardDescription>
            </div>
            <Button variant="outline" onClick={() => queriesQuery.refetch()} disabled={queriesQuery.isFetching}>
              {queriesQuery.isFetching ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <RefreshCw className="mr-2 h-4 w-4" />}
              Refresh
            </Button>
          </div>
        </CardHeader>
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
      </Card>
    </div>
  );
}

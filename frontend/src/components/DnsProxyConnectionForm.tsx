import { FormEvent, useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CheckCircle2, Loader2, RefreshCw, Save, Server, Trash2, Wand2 } from 'lucide-react';
import api from '@/api/client';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useToast } from '@/hooks/useToast';
import { formatDate } from '@/lib/utils';
import type { ApiResponse, DnsProxySettings } from '@/types';

type SettingsResponse = { configured: boolean; settings: DnsProxySettings | null };

interface DnsProxyCandidate {
  product: 'adguard_home' | 'pihole';
  host: string;
  port: number;
  confidence: 'high' | 'medium';
  details?: { version?: string; running?: boolean } & Record<string, unknown>;
}

type DiscoverResponse = { candidates: DnsProxyCandidate[] };

const PRODUCT_LABEL: Record<DnsProxyCandidate['product'], string> = {
  adguard_home: 'AdGuard Home',
  pihole: 'Pi-hole',
};

// We keep numeric fields as strings in state so the user can clear and
// retype freely. <input type="number"> coerces "" -> 0 and dredges up
// awkward up/down spinner UI, plus it silently accepts "0443" and similar.
// We parse at submit time below.
interface DnsProxyFormState {
  host: string;
  port: string;
  useHttps: boolean;
  allowSelfSigned: boolean;
  username: string;
  password: string;
  pollingEnabled: boolean;
  /** Sync interval in seconds. UI exposes 60 / 300 / 900 / 3600. */
  pollingIntervalSec: number;
  retentionDays: string;
}

// Shared interval options for both the DNS proxy and UniFi connection
// forms — same vocabulary across the dashboard. DNS proxy needs faster
// options than UniFi because the AdGuard query log rotates faster, but
// both default to hourly and use the same pill-style picker.
const DNS_PROXY_INTERVALS: Array<{ label: string; seconds: number }> = [
  { label: 'Every 1 minute', seconds: 60 },
  { label: 'Every 5 minutes', seconds: 300 },
  { label: 'Every 15 minutes', seconds: 900 },
  { label: 'Hourly', seconds: 3600 },
];

const DEFAULT_POLLING_INTERVAL_SEC = 3600; // hourly — matches UniFi default

const defaultForm: DnsProxyFormState = {
  host: '',
  port: '3000',
  useHttps: false,
  allowSelfSigned: false,
  username: '',
  password: '',
  pollingEnabled: true,
  pollingIntervalSec: DEFAULT_POLLING_INTERVAL_SEC,
  retentionDays: '7',
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
    port: String(settings.port),
    useHttps: settings.useHttps,
    allowSelfSigned: settings.allowSelfSigned,
    username: settings.username,
    password: '',
    pollingEnabled: settings.pollingEnabled,
    // If the saved value isn't one of our presets (e.g. legacy 60s
    // installs), the picker still highlights the closest match below.
    pollingIntervalSec: settings.pollingIntervalSec || DEFAULT_POLLING_INTERVAL_SEC,
    retentionDays: String(settings.retentionDays),
  };
}

export function DnsProxyConnectionForm() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [form, setForm] = useState<DnsProxyFormState>(defaultForm);

  const settingsQuery = useQuery({
    queryKey: ['dns-proxy', 'settings'],
    queryFn: async () => requireData(await api.get<SettingsResponse>('/dns-proxy/settings')),
  });

  useEffect(() => {
    if (settingsQuery.data?.settings) {
      setForm(settingsToForm(settingsQuery.data.settings));
    }
  }, [settingsQuery.data?.settings]);

  const settings = settingsQuery.data?.settings;
  const configured = Boolean(settingsQuery.data?.configured);

  // Auto-discovery: scan DHCP-advertised resolvers for AdGuard/Pi-hole. We
  // never auto-apply — found candidates are surfaced as one-click prefill
  // suggestions and only when the form hasn't been configured yet, so we
  // don't second-guess an operator who has already saved a different proxy.
  const discoverQuery = useQuery({
    queryKey: ['dns-proxy', 'discover'],
    queryFn: async () => requireData(await api.get<DiscoverResponse>('/dns-proxy/discover')),
    enabled: !configured && !settingsQuery.isLoading,
    staleTime: 60_000,
    retry: false,
  });

  const candidates = discoverQuery.data?.candidates ?? [];
  const dismissibleCandidates = candidates.filter((c) => {
    // Hide a candidate once the user has typed it into the form so the banner
    // doesn't keep nagging them about something they've already accepted.
    return !(form.host === c.host && form.port === String(c.port));
  });

  const applyCandidate = (candidate: DnsProxyCandidate) => {
    setForm((current) => ({
      ...current,
      host: candidate.host,
      port: String(candidate.port),
      // AdGuard's read-only /control/status doesn't require auth, but the
      // write-side endpoints we use for /test do. Leave creds blank — the
      // operator will fill them in if their AdGuard requires login.
      username: '',
      password: '',
    }));
    toast({
      title: `Prefilled ${PRODUCT_LABEL[candidate.product]} settings`,
      description: `${candidate.host}:${candidate.port} — review credentials, then click Test.`,
    });
  };

  const payload = useMemo(
    () => ({
      host: form.host.trim(),
      // Fall back to defaults if the user has cleared the field. Backend
      // zod schema also enforces min/max so a stray value can't escape.
      port: Number(form.port) || 3000,
      useHttps: form.useHttps,
      allowSelfSigned: form.useHttps && form.allowSelfSigned,
      username: form.username.trim(),
      password: form.password || undefined,
      pollingEnabled: form.pollingEnabled,
      pollingIntervalSec: form.pollingIntervalSec || DEFAULT_POLLING_INTERVAL_SEC,
      retentionDays: Number(form.retentionDays) || 7,
    }),
    [form]
  );

  const invalidate = async () => {
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
      await invalidate();
      toast({ title: 'DNS proxy settings saved' });
    },
    onError: (error) => toast({ variant: 'destructive', title: 'Save failed', description: error.message }),
  });

  const deleteMutation = useMutation({
    mutationFn: async () => requireData(await api.delete('/dns-proxy/settings')),
    onSuccess: async () => {
      setForm(defaultForm);
      await invalidate();
      toast({ title: 'DNS proxy connection removed' });
    },
    onError: (error) => toast({ variant: 'destructive', title: 'Delete failed', description: error.message }),
  });

  const syncMutation = useMutation({
    mutationFn: async () => requireData(await api.post('/dns-proxy/sync')),
    onSuccess: async () => {
      await invalidate();
      toast({ title: 'DNS query log synced' });
    },
    onError: (error) => toast({ variant: 'destructive', title: 'Sync failed', description: error.message }),
  });

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    saveMutation.mutate();
  };

  return (
    <Card className="border-border/50">
      <CardHeader>
        <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <CardTitle className="flex items-center gap-2 text-xl">
              <Server className="h-5 w-5" />
              DNS Proxy connection
            </CardTitle>
            <CardDescription>
              Connect your DNS filter so ZeroProof can verify logging, poll recent queries, and surface campaign-relevant signals. AdGuard Home is supported today — Pi-hole and NextDNS are on the roadmap.
            </CardDescription>
          </div>
          {configured && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => syncMutation.mutate()}
              disabled={syncMutation.isPending}
            >
              {syncMutation.isPending ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <RefreshCw className="mr-2 h-4 w-4" />
              )}
              Sync now
            </Button>
          )}
        </div>
      </CardHeader>
      <CardContent>
        <form className="space-y-4" onSubmit={handleSubmit}>
          <div className="space-y-2">
            <Label htmlFor="dns-provider">Provider</Label>
            <select
              id="dns-provider"
              className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
              value="adguard_home"
              onChange={() => {}}
            >
              <option value="adguard_home">AdGuard Home</option>
              <option value="pihole" disabled>
                Pi-hole — coming soon
              </option>
              <option value="nextdns" disabled>
                NextDNS — coming soon
              </option>
            </select>
            <p className="text-xs text-muted-foreground">
              The schema and analyzers are platform-agnostic; only the connection adapter is provider-specific.
            </p>
          </div>

          <div className="rounded-md border border-blue-500/30 bg-blue-500/10 p-3 text-sm">
            <p className="font-medium">Home Assistant add-on note</p>
            <p className="mt-1 text-muted-foreground">
              If you only open AdGuard through Home Assistant Ingress, ZeroProof cannot reuse that browser session.
              Point this form at the add-on's direct AdGuard Home host and port instead. Leave credentials blank when
              that API is reachable without AdGuard's own login.
            </p>
          </div>

          {!configured && dismissibleCandidates.length > 0 && (
            <div className="rounded-md border border-orange-500/30 bg-orange-500/10 p-3 text-sm">
              <div className="flex items-center gap-2 font-medium">
                <Wand2 className="h-4 w-4 text-orange-400" />
                We found a DNS filter on your network
              </div>
              <p className="mt-1 text-xs text-muted-foreground">
                Detected by probing your DHCP-advertised resolvers. Click to prefill — nothing is saved until you Test and Save.
              </p>
              <ul className="mt-3 space-y-2">
                {dismissibleCandidates.map((candidate) => (
                  <li
                    key={`${candidate.product}-${candidate.host}-${candidate.port}`}
                    className="flex flex-col gap-2 rounded-md bg-background/40 p-2 sm:flex-row sm:items-center sm:justify-between"
                  >
                    <div className="text-xs">
                      <span className="font-medium">{PRODUCT_LABEL[candidate.product]}</span>
                      <span className="ml-1 font-mono text-muted-foreground">
                        {candidate.host}:{candidate.port}
                      </span>
                      {candidate.details?.version && (
                        <span className="ml-2 text-muted-foreground">
                          v{String(candidate.details.version)}
                        </span>
                      )}
                    </div>
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      onClick={() => applyCandidate(candidate)}
                    >
                      Use this
                    </Button>
                  </li>
                ))}
              </ul>
            </div>
          )}

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
                type="text"
                inputMode="numeric"
                pattern="[0-9]*"
                maxLength={5}
                value={form.port}
                placeholder="3000"
                onChange={(event) =>
                  setForm((current) => ({
                    ...current,
                    // Strip everything that isn't a digit so users can't end
                    // up with "0443" or "abc" in a port field. Empty string
                    // is allowed so the user can clear and retype.
                    port: event.target.value.replace(/\D/g, ''),
                  }))
                }
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

          {/* TLS options — separate from sync settings */}
          <div className="grid gap-3 rounded-md border border-border/60 p-3 sm:grid-cols-1">
            <label className="flex items-center gap-3 text-sm">
              <input
                type="checkbox"
                className="h-4 w-4 rounded border-border"
                checked={form.useHttps}
                onChange={(event) => setForm((current) => ({ ...current, useHttps: event.target.checked }))}
              />
              Use HTTPS
            </label>
            {form.useHttps && (
              <label className="flex items-start gap-3 text-sm">
                <input
                  type="checkbox"
                  className="mt-1 h-4 w-4 rounded border-border"
                  checked={form.allowSelfSigned}
                  onChange={(event) =>
                    setForm((current) => ({ ...current, allowSelfSigned: event.target.checked }))
                  }
                />
                <span>
                  <span className="font-medium">Allow self-signed certificates</span>
                  <span className="ml-2 text-xs text-yellow-400">
                    Disables TLS verification — only enable for trusted home-lab AdGuard installs.
                  </span>
                </span>
              </label>
            )}
          </div>

          {/* Sync settings — same shape as UniFi → Configuration */}
          <div className="p-4 rounded-lg bg-muted/30 border border-border/50 space-y-4">
            <label className="flex items-center gap-3 text-sm">
              <input
                type="checkbox"
                id="dns-proxy-auto-sync"
                checked={form.pollingEnabled}
                onChange={(event) => setForm((current) => ({ ...current, pollingEnabled: event.target.checked }))}
                className="h-4 w-4 rounded border-border bg-background"
              />
              <span className="font-normal cursor-pointer">Enable automatic sync</span>
            </label>
            {form.pollingEnabled && (
              <div className="space-y-2 pl-7">
                <Label>Sync interval</Label>
                <div className="flex flex-wrap gap-2">
                  {DNS_PROXY_INTERVALS.map((option) => (
                    <Button
                      key={option.seconds}
                      type="button"
                      size="sm"
                      variant={form.pollingIntervalSec === option.seconds ? 'default' : 'outline'}
                      onClick={() =>
                        setForm((current) => ({ ...current, pollingIntervalSec: option.seconds }))
                      }
                      className={
                        form.pollingIntervalSec === option.seconds
                          ? 'bg-orange-600 hover:bg-orange-500'
                          : ''
                      }
                    >
                      {option.label}
                    </Button>
                  ))}
                </div>
                <p className="text-xs text-muted-foreground">
                  Hourly is the default. Pick a faster interval if your dashboard needs near-realtime DNS visibility — AdGuard's query log rotates, so very long intervals can miss queries.
                </p>
              </div>
            )}
          </div>

          <div className="space-y-2">
            <Label htmlFor="retention-days">Raw query retention days</Label>
            <Input
              id="retention-days"
              type="text"
              inputMode="numeric"
              pattern="[0-9]*"
              maxLength={2}
              value={form.retentionDays}
              placeholder="7"
              onChange={(event) =>
                setForm((current) => ({
                  ...current,
                  retentionDays: event.target.value.replace(/\D/g, ''),
                }))
              }
            />
            <p className="text-xs text-muted-foreground">
              Normalized query rows default to 7 days and are capped at 30 days. Campaign DNS signals are retained separately for 90 days.
            </p>
          </div>

          {settings?.lastSyncAt && (
            <p className="text-xs text-muted-foreground">
              Last sync {formatDate(settings.lastSyncAt)} ({settings.lastSyncStatus || 'unknown'}).
            </p>
          )}

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
  );
}

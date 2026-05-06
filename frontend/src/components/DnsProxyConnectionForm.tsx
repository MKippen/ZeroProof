import { FormEvent, useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CheckCircle2, Loader2, RefreshCw, Save, Server, Trash2 } from 'lucide-react';
import api from '@/api/client';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useToast } from '@/hooks/useToast';
import { formatDate } from '@/lib/utils';
import type { ApiResponse, DnsProxySettings } from '@/types';

type SettingsResponse = { configured: boolean; settings: DnsProxySettings | null };

interface DnsProxyFormState {
  host: string;
  port: number;
  useHttps: boolean;
  allowSelfSigned: boolean;
  username: string;
  password: string;
  pollingEnabled: boolean;
  retentionDays: number;
}

const defaultForm: DnsProxyFormState = {
  host: '',
  port: 3000,
  useHttps: false,
  allowSelfSigned: false,
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
    allowSelfSigned: settings.allowSelfSigned,
    username: settings.username,
    password: '',
    pollingEnabled: settings.pollingEnabled,
    retentionDays: settings.retentionDays,
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

  const payload = useMemo(
    () => ({
      host: form.host.trim(),
      port: Number(form.port),
      useHttps: form.useHttps,
      allowSelfSigned: form.useHttps && form.allowSelfSigned,
      username: form.username.trim(),
      password: form.password || undefined,
      pollingEnabled: form.pollingEnabled,
      retentionDays: Number(form.retentionDays),
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
            {form.useHttps && (
              <label className="flex items-start gap-3 text-sm sm:col-span-2">
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

import { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Wifi,
  Eye,
  EyeOff,
  Loader2,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Settings,
  Trash2,
  ShieldCheck,
  Network,
} from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import api from '@/api/client';
import { useToast } from '@/hooks/useToast';
import { cn } from '@/lib/utils';

interface UniFiSettings {
  host: string;
  port: number;
  username: string;
  hasPassword: boolean;
  verifySsl: boolean;
  autoSync: boolean;
  syncInterval: 'hourly' | 'daily' | 'manual';
  selectedSite: string;
}

interface UniFiSite {
  _id: string;
  name: string;
  desc: string;
}

export function ControllerConnectionForm() {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const [unifiHost, setUnifiHost] = useState('');
  const [unifiPort, setUnifiPort] = useState('443');
  const [unifiUsername, setUnifiUsername] = useState('admin');
  const [unifiPassword, setUnifiPassword] = useState('');
  const [showUnifiPassword, setShowUnifiPassword] = useState(false);
  const [verifySsl, setVerifySsl] = useState(true);
  const [autoSync, setAutoSync] = useState(false);
  const [syncInterval, setSyncInterval] = useState<'hourly' | 'daily' | 'manual'>('manual');
  const [selectedSite, setSelectedSite] = useState('default');
  const [availableSites, setAvailableSites] = useState<UniFiSite[]>([]);
  const [connectionTested, setConnectionTested] = useState(false);
  const [showConnectionSettings, setShowConnectionSettings] = useState(false);

  const { data: unifiData, isLoading: loadingUnifi } = useQuery({
    queryKey: ['unifi', 'settings'],
    queryFn: async () => {
      const response = await api.get<{
        settings: (UniFiSettings & { lastSyncStatus?: 'success' | 'error' }) | null;
        configured: boolean;
      }>('/unifi/settings');
      return response.data;
    },
  });

  useEffect(() => {
    if (unifiData?.settings) {
      setUnifiHost(unifiData.settings.host);
      setUnifiPort(String(unifiData.settings.port));
      setUnifiUsername(unifiData.settings.username);
      setVerifySsl(unifiData.settings.verifySsl);
      setAutoSync(unifiData.settings.autoSync);
      setSyncInterval(unifiData.settings.syncInterval);
      setSelectedSite(unifiData.settings.selectedSite);
    }
  }, [unifiData]);

  const testConnectionMutation = useMutation({
    mutationFn: async () => {
      const response = await api.post<{
        connected: boolean;
        sites: UniFiSite[];
        controllerVersion: string;
      }>('/unifi/test', {
        host: unifiHost,
        port: parseInt(unifiPort),
        username: unifiUsername,
        password: unifiPassword || undefined,
        verifySsl,
      });
      if (!response.success) {
        throw new Error(response.error?.message || 'Connection failed');
      }
      return response.data;
    },
    onSuccess: (data) => {
      setAvailableSites(data?.sites || []);
      setConnectionTested(true);
      toast({
        title: 'Connection successful',
        description: `Controller version: ${data?.controllerVersion || 'Unknown'}`,
      });
    },
    onError: (error: Error) => {
      setConnectionTested(false);
      toast({ variant: 'destructive', title: 'Connection failed', description: error.message });
    },
  });

  const saveUnifiSettingsMutation = useMutation({
    mutationFn: async () => {
      const response = await api.post('/unifi/settings', {
        host: unifiHost,
        port: parseInt(unifiPort),
        username: unifiUsername,
        password: unifiPassword || undefined,
        verifySsl,
        autoSync,
        syncInterval,
        selectedSite,
      });
      if (!response.success) {
        throw new Error(response.error?.message || 'Failed to save settings');
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['unifi', 'settings'] });
      setUnifiPassword('');
      toast({ title: 'UniFi settings saved' });
    },
    onError: (error: Error) => {
      toast({ variant: 'destructive', title: 'Error', description: error.message });
    },
  });

  const deleteUnifiSettingsMutation = useMutation({
    mutationFn: async () => {
      const response = await api.delete('/unifi/settings');
      if (!response.success) {
        throw new Error(response.error?.message || 'Failed to delete settings');
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['unifi', 'settings'] });
      setUnifiHost('');
      setUnifiPort('443');
      setUnifiUsername('');
      setUnifiPassword('');
      setVerifySsl(true);
      setAutoSync(false);
      setSyncInterval('manual');
      setSelectedSite('default');
      setAvailableSites([]);
      setConnectionTested(false);
      toast({ title: 'UniFi connection removed' });
    },
    onError: (error: Error) => {
      toast({ variant: 'destructive', title: 'Error', description: error.message });
    },
  });

  const isConfigured = !!unifiData?.configured;
  const isOpen = showConnectionSettings || !isConfigured;

  return (
    <Collapsible open={isOpen} onOpenChange={setShowConnectionSettings}>
      <Card className="border-border/50">
        <CollapsibleTrigger asChild>
          <CardHeader className="cursor-pointer hover:bg-muted/50 transition-colors">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex items-start sm:items-center gap-3">
                {isOpen ? (
                  <ChevronDown className="h-4 w-4" />
                ) : (
                  <ChevronRight className="h-4 w-4" />
                )}
                <Wifi className="h-5 w-5 text-orange-400" />
                <div>
                  <CardTitle className="text-base">Controller Connection Settings</CardTitle>
                  <CardDescription>
                    {isConfigured
                      ? 'Manage your UniFi Controller connection'
                      : 'Configure your UniFi Controller connection'}
                  </CardDescription>
                </div>
              </div>
              {isConfigured && (
                <Badge className="bg-emerald-500/20 text-emerald-400 border-emerald-500/30 self-start sm:self-auto">
                  <CheckCircle2 className="h-3 w-3 mr-1" />
                  Connected
                </Badge>
              )}
            </div>
          </CardHeader>
        </CollapsibleTrigger>
        <CollapsibleContent>
          <CardContent className="pt-0">
            {loadingUnifi ? (
              <div className="flex items-center justify-center h-32">
                <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
              </div>
            ) : (
              <div className="space-y-6">
                {!isConfigured && (
                  <>
                    <div className="rounded-md border border-emerald-500/30 bg-emerald-500/5 p-4 space-y-2">
                      <div className="flex items-start gap-2">
                        <ShieldCheck className="h-4 w-4 text-emerald-400 flex-shrink-0 mt-0.5" />
                        <div className="text-sm">
                          <p className="font-medium text-emerald-300">
                            Use a read-only UniFi account
                          </p>
                          <p className="text-muted-foreground mt-1">
                            ZeroProof only reads your controller configuration
                            — it never writes. Create a dedicated read-only
                            user so even a compromised credential can&apos;t
                            change your network.
                          </p>
                          <details className="mt-2">
                            <summary className="cursor-pointer text-emerald-300 hover:text-emerald-200 select-none text-xs">
                              How to create one in UniFi Network →
                            </summary>
                            <ol className="mt-2 space-y-1 text-xs text-muted-foreground list-decimal list-inside">
                              <li>
                                Open the UniFi Network UI →{' '}
                                <span className="font-mono">Settings</span> →{' '}
                                <span className="font-mono">Admins &amp; Users</span>.
                              </li>
                              <li>
                                Click{' '}
                                <span className="font-mono">Add New Admin</span>{' '}
                                (or{' '}
                                <span className="font-mono">+ Invite Admin</span>{' '}
                                on UniFi OS).
                              </li>
                              <li>
                                Choose{' '}
                                <span className="font-mono">Restrict to local access only</span>{' '}
                                and set a username (e.g.{' '}
                                <span className="font-mono">zeroproof</span>) and a strong password.
                              </li>
                              <li>
                                For the role, pick{' '}
                                <span className="font-mono">Limited Admin</span>{' '}
                                (UniFi OS) or{' '}
                                <span className="font-mono">Read Only</span>{' '}
                                (legacy controller).
                              </li>
                              <li>
                                Save, then enter those credentials below.
                              </li>
                            </ol>
                          </details>
                        </div>
                      </div>
                    </div>

                    <div className="rounded-md border border-amber-500/30 bg-amber-500/5 p-4">
                      <div className="flex items-start gap-2">
                        <Network className="h-4 w-4 text-amber-400 flex-shrink-0 mt-0.5" />
                        <div className="text-sm">
                          <p className="font-medium text-amber-300">
                            Network reachability
                          </p>
                          <p className="text-muted-foreground mt-1">
                            ZeroProof must be able to reach your controller on
                            the host and port below. If this server runs on a
                            different VLAN than your controller (e.g. a Server
                            VLAN reaching a Mgmt VLAN), allow that traffic in
                            UniFi → <span className="font-mono">Settings →
                            Security → Traffic Rules</span>. UniFi OS uses{' '}
                            <span className="font-mono">443</span>; legacy
                            self-hosted controllers use{' '}
                            <span className="font-mono">8443</span>.
                          </p>
                        </div>
                      </div>
                    </div>
                  </>
                )}
                <div className="grid gap-4 md:grid-cols-2">
                  <div className="space-y-2">
                    <Label htmlFor="unifi-host">Controller Host / IP</Label>
                    <Input
                      id="unifi-host"
                      placeholder="192.168.1.1 or unifi.local"
                      value={unifiHost}
                      onChange={(e) => {
                        setUnifiHost(e.target.value);
                        setConnectionTested(false);
                      }}
                      className="font-mono"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="unifi-port">Port</Label>
                    <Input
                      id="unifi-port"
                      placeholder="443"
                      value={unifiPort}
                      onChange={(e) => {
                        setUnifiPort(e.target.value);
                        setConnectionTested(false);
                      }}
                      className="font-mono"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="unifi-username">Username</Label>
                    <Input
                      id="unifi-username"
                      placeholder="admin"
                      value={unifiUsername}
                      onChange={(e) => {
                        setUnifiUsername(e.target.value);
                        setConnectionTested(false);
                      }}
                      className="font-mono"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="unifi-password">
                      Password
                      {unifiData?.settings?.hasPassword && !unifiPassword && (
                        <span className="text-muted-foreground ml-2">(saved)</span>
                      )}
                    </Label>
                    <div className="relative">
                      <Input
                        id="unifi-password"
                        type={showUnifiPassword ? 'text' : 'password'}
                        placeholder={unifiData?.settings?.hasPassword ? '••••••••' : 'Enter password'}
                        value={unifiPassword}
                        onChange={(e) => {
                          setUnifiPassword(e.target.value);
                          setConnectionTested(false);
                        }}
                      />
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="absolute right-0 top-0 h-full px-3 hover:bg-transparent"
                        onClick={() => setShowUnifiPassword(!showUnifiPassword)}
                      >
                        {showUnifiPassword ? (
                          <EyeOff className="h-4 w-4 text-muted-foreground" />
                        ) : (
                          <Eye className="h-4 w-4 text-muted-foreground" />
                        )}
                      </Button>
                    </div>
                    <p className="text-xs text-muted-foreground">Password for the admin account</p>
                  </div>
                </div>

                <div className="grid gap-4 md:grid-cols-2">
                  <div className="flex items-center gap-3">
                    <input
                      type="checkbox"
                      id="verify-ssl"
                      checked={verifySsl}
                      onChange={(e) => setVerifySsl(e.target.checked)}
                      className="h-4 w-4 rounded border-border bg-background"
                    />
                    <Label htmlFor="verify-ssl" className="font-normal cursor-pointer">
                      Verify SSL certificate
                    </Label>
                  </div>
                  {availableSites.length > 0 && (
                    <div className="space-y-2">
                      <Label htmlFor="site-select">Site</Label>
                      <select
                        id="site-select"
                        value={selectedSite}
                        onChange={(e) => setSelectedSite(e.target.value)}
                        className="w-full h-10 px-3 rounded-md border border-border bg-background text-foreground"
                      >
                        {availableSites.map((site) => (
                          <option key={site._id} value={site.name}>
                            {site.desc || site.name}
                          </option>
                        ))}
                      </select>
                    </div>
                  )}
                </div>

                {connectionTested && (
                  <div className="p-4 rounded-lg bg-muted/30 border border-border/50 space-y-4">
                    <div className="flex items-center gap-3">
                      <input
                        type="checkbox"
                        id="auto-sync"
                        checked={autoSync}
                        onChange={(e) => setAutoSync(e.target.checked)}
                        className="h-4 w-4 rounded border-border bg-background"
                      />
                      <Label htmlFor="auto-sync" className="font-normal cursor-pointer">
                        Enable automatic sync
                      </Label>
                    </div>
                    {autoSync && (
                      <div className="space-y-2 pl-7">
                        <Label>Sync Interval</Label>
                        <div className="flex gap-2">
                          {(['hourly', 'daily'] as const).map((interval) => (
                            <Button
                              key={interval}
                              type="button"
                              variant={syncInterval === interval ? 'default' : 'outline'}
                              size="sm"
                              onClick={() => setSyncInterval(interval)}
                              className={cn(
                                syncInterval === interval && 'bg-orange-600 hover:bg-orange-500'
                              )}
                            >
                              {interval.charAt(0).toUpperCase() + interval.slice(1)}
                            </Button>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                )}

                <div className="flex flex-wrap gap-3">
                  <Button
                    onClick={() => testConnectionMutation.mutate()}
                    disabled={!unifiHost || testConnectionMutation.isPending}
                    variant="outline"
                  >
                    {testConnectionMutation.isPending ? (
                      <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    ) : connectionTested ? (
                      <CheckCircle2 className="h-4 w-4 mr-2 text-emerald-400" />
                    ) : (
                      <Wifi className="h-4 w-4 mr-2" />
                    )}
                    Test Connection
                  </Button>

                  <Button
                    onClick={() => saveUnifiSettingsMutation.mutate()}
                    disabled={!unifiHost || saveUnifiSettingsMutation.isPending}
                    className="bg-orange-600 hover:bg-orange-500"
                  >
                    {saveUnifiSettingsMutation.isPending ? (
                      <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    ) : (
                      <Settings className="h-4 w-4 mr-2" />
                    )}
                    Save Settings
                  </Button>

                  {isConfigured && (
                    <Button
                      onClick={() => deleteUnifiSettingsMutation.mutate()}
                      disabled={deleteUnifiSettingsMutation.isPending}
                      variant="outline"
                      className="text-red-400 hover:text-red-300 hover:bg-red-500/10"
                    >
                      <Trash2 className="h-4 w-4 mr-2" />
                      Remove Connection
                    </Button>
                  )}
                </div>
              </div>
            )}
          </CardContent>
        </CollapsibleContent>
      </Card>
    </Collapsible>
  );
}

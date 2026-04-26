import { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Settings,
  Lock,
  Bell,
  Database,
  Wifi,
  CheckCircle2,
  Eye,
  EyeOff,
  Loader2,
  Trash2,
  FileJson,
  FileText,
  Wand2,
  ChevronDown,
  ChevronRight,
} from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import api from '@/api/client';
import { useToast } from '@/hooks/useToast';
import { useAuthStore } from '@/stores/authStore';
import { cn } from '@/lib/utils';
import { ConfigContent } from './ConfigPage';
import { WizardContent } from './NetworkWizardPage';
import { RulesContent } from './RulesPage';

interface UniFiSettings {
  host: string;
  port: number;
  username: string;
  hasPassword: boolean;
  verifySsl: boolean;
  autoSync: boolean;
  syncInterval: 'hourly' | 'daily' | 'manual';
  selectedSite: string;
  lastSyncAt?: string;
  lastSyncStatus?: 'success' | 'error';
  lastSyncError?: string;
}

interface UniFiSite {
  _id: string;
  name: string;
  desc: string;
}

export function SettingsPage() {
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const { toast } = useToast();
  const { mustChangePassword, setMustChangePassword } = useAuthStore();
  const queryClient = useQueryClient();

  // UniFi connection state
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

  // Fetch existing UniFi settings
  const { data: unifiData, isLoading: loadingUnifi } = useQuery({
    queryKey: ['unifi', 'settings'],
    queryFn: async () => {
      const response = await api.get<{
        settings: UniFiSettings | null;
        configured: boolean;
      }>('/unifi/settings');
      return response.data;
    },
  });

  // Populate form with existing settings
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

  const changePasswordMutation = useMutation({
    mutationFn: async () => {
      if (newPassword !== confirmPassword) {
        throw new Error('Passwords do not match');
      }
      if (newPassword.length < 8) {
        throw new Error('Password must be at least 8 characters');
      }
      const response = await api.post('/auth/change-password', {
        currentPassword,
        newPassword,
      });
      if (!response.success) {
        throw new Error(response.error?.message || 'Failed to change password');
      }
    },
    onSuccess: () => {
      toast({ title: 'Password changed successfully' });
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
      setMustChangePassword(false);
    },
    onError: (error: Error) => {
      toast({ variant: 'destructive', title: 'Error', description: error.message });
    },
  });

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

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl sm:text-3xl font-bold">Settings</h1>
        <p className="text-muted-foreground">Manage your account and application settings</p>
      </div>

      {mustChangePassword && (
        <Card className="border-yellow-500/50 bg-yellow-500/10">
          <CardContent className="pt-6">
            <div className="flex items-center gap-2 text-yellow-400">
              <Lock className="h-5 w-5" />
              <span className="font-medium">Please change your password</span>
            </div>
            <p className="text-sm text-yellow-400/80 mt-1">
              You are using the default password. Please change it for security.
            </p>
          </CardContent>
        </Card>
      )}

      <Tabs defaultValue="general" className="space-y-4">
        <TabsList className="w-full sm:w-auto">
          <TabsTrigger value="general" className="flex items-center gap-2">
            <Settings className="h-4 w-4" />
            General
          </TabsTrigger>
          <TabsTrigger value="configuration" className="flex items-center gap-2">
            <FileJson className="h-4 w-4" />
            UniFi Configuration
          </TabsTrigger>
          <TabsTrigger value="wizard" className="flex items-center gap-2">
            <Wand2 className="h-4 w-4" />
            Security Wizard
          </TabsTrigger>
          <TabsTrigger value="rules" className="flex items-center gap-2">
            <FileText className="h-4 w-4" />
            Rules
          </TabsTrigger>
        </TabsList>

        <TabsContent value="general" className="space-y-6">
      {/* Change Password */}
      <Card className="border-border/50">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Lock className="h-5 w-5" />
            Change Password
          </CardTitle>
          <CardDescription>Update your account password</CardDescription>
        </CardHeader>
        <CardContent>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              changePasswordMutation.mutate();
            }}
            className="space-y-4 max-w-md"
          >
            <div className="space-y-2">
              <Label htmlFor="currentPassword">Current Password</Label>
              <Input
                id="currentPassword"
                type="password"
                value={currentPassword}
                onChange={(e) => setCurrentPassword(e.target.value)}
                required
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="newPassword">New Password</Label>
              <Input
                id="newPassword"
                type="password"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                required
                minLength={8}
              />
              <p className="text-xs text-muted-foreground">Minimum 8 characters</p>
            </div>
            <div className="space-y-2">
              <Label htmlFor="confirmPassword">Confirm New Password</Label>
              <Input
                id="confirmPassword"
                type="password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                required
              />
            </div>
            <Button type="submit" disabled={changePasswordMutation.isPending}>
              {changePasswordMutation.isPending ? 'Changing...' : 'Change Password'}
            </Button>
          </form>
        </CardContent>
      </Card>

      {/* Notifications (placeholder) */}
      <Card className="border-border/50">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Bell className="h-5 w-5" />
            Notifications
          </CardTitle>
          <CardDescription>Configure alert notifications</CardDescription>
        </CardHeader>
        <CardContent>
          <p className="text-muted-foreground">
            Email and Slack notifications will be available in a future update.
          </p>
        </CardContent>
      </Card>

      {/* System Info */}
      <Card className="border-border/50">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Database className="h-5 w-5" />
            System Information
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid gap-2 text-sm">
            <div className="flex items-center justify-between gap-3">
              <span className="text-muted-foreground">Version</span>
              <span className="font-mono">1.0.0</span>
            </div>
            <div className="flex items-center justify-between gap-3">
              <span className="text-muted-foreground">API Endpoint</span>
              <span className="font-mono text-xs">/api/v1</span>
            </div>
            <div className="flex items-center justify-between gap-3">
              <span className="text-muted-foreground">Data Storage</span>
              <span className="text-emerald-400">100% Local</span>
            </div>
            <div className="flex items-center justify-between gap-3">
              <span className="text-muted-foreground">Telemetry</span>
              <span className="text-emerald-400">None</span>
            </div>
          </div>
        </CardContent>
      </Card>
        </TabsContent>

        <TabsContent value="configuration" className="space-y-6">
          <ConfigContent />

          {/* Controller Connection Settings - Collapsible */}
          <Collapsible
            open={showConnectionSettings || !unifiData?.configured}
            onOpenChange={setShowConnectionSettings}
          >
            <Card className="border-border/50">
              <CollapsibleTrigger asChild>
                <CardHeader className="cursor-pointer hover:bg-muted/50 transition-colors">
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                    <div className="flex items-start sm:items-center gap-3">
                      {showConnectionSettings || !unifiData?.configured ? (
                        <ChevronDown className="h-4 w-4" />
                      ) : (
                        <ChevronRight className="h-4 w-4" />
                      )}
                      <Wifi className="h-5 w-5 text-orange-400" />
                      <div>
                        <CardTitle className="text-base">Controller Connection Settings</CardTitle>
                        <CardDescription>
                          {unifiData?.configured
                            ? 'Manage your UniFi Controller connection'
                            : 'Configure your UniFi Controller connection'}
                        </CardDescription>
                      </div>
                    </div>
                    {unifiData?.configured && (
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
                      {/* Connection Form */}
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

                      {/* SSL and Site Options */}
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

                      {/* Auto Sync Options */}
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
                                      syncInterval === interval &&
                                        'bg-orange-600 hover:bg-orange-500'
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

                      {/* Action Buttons */}
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

                        {unifiData?.configured && (
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
        </TabsContent>

        <TabsContent value="wizard">
          <WizardContent />
        </TabsContent>

        <TabsContent value="rules">
          <RulesContent />
        </TabsContent>
      </Tabs>
    </div>
  );
}

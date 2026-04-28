import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Check,
  Clock,
  AlertTriangle,
  RefreshCw,
  Loader2,
  Server,
  CheckCircle2,
  XCircle,
  ChevronDown,
  ChevronRight,
  History,
} from 'lucide-react';
import { ControllerConnectionForm } from '@/components/ControllerConnectionForm';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import api from '@/api/client';
import type { Configuration } from '@/types';
import { formatDate } from '@/lib/utils';
import { useToast } from '@/hooks/useToast';

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

// Compact history summary component
function ConfigHistorySummary({
  configHistory,
  isLoading,
  onActivate,
}: {
  configHistory: Configuration[];
  isLoading: boolean;
  onActivate: (id: string) => void;
}) {
  const [isExpanded, setIsExpanded] = useState(false);

  if (isLoading) {
    return null;
  }

  // Filter out active config from history display
  const inactiveConfigs = configHistory.filter(c => !c.isActive);

  if (inactiveConfigs.length === 0) {
    return null;
  }

  // Get the most recent inactive config for the summary
  const mostRecent = inactiveConfigs[0];

  return (
    <Card className="border-border/50">
      <Collapsible open={isExpanded} onOpenChange={setIsExpanded}>
        <CollapsibleTrigger asChild>
          <CardHeader className="cursor-pointer hover:bg-muted/30 transition-colors py-4">
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex items-start sm:items-center gap-3">
                {isExpanded ? (
                  <ChevronDown className="h-4 w-4 text-muted-foreground" />
                ) : (
                  <ChevronRight className="h-4 w-4 text-muted-foreground" />
                )}
                <History className="h-4 w-4 text-muted-foreground" />
                <div>
                  <CardTitle className="text-sm font-medium">
                    {inactiveConfigs.length} Previous Configuration{inactiveConfigs.length !== 1 ? 's' : ''}
                  </CardTitle>
                  <CardDescription className="text-xs">
                    Most recent: {mostRecent.siteName} - {formatDate(mostRecent.importedAt)}
                  </CardDescription>
                </div>
              </div>
              <Badge variant="outline" className="text-xs self-start sm:self-auto">
                {isExpanded ? 'Click to collapse' : 'Click to expand'}
              </Badge>
            </div>
          </CardHeader>
        </CollapsibleTrigger>
        <CollapsibleContent>
          <CardContent className="pt-0 pb-4">
            <div className="space-y-2">
              {inactiveConfigs.slice(0, 5).map((config) => (
                <div
                  key={config.id}
                  className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between p-2 rounded-lg bg-muted/30 text-sm"
                >
                  <div className="flex flex-wrap items-center gap-2 min-w-0">
                    <Clock className="h-3 w-3 text-muted-foreground flex-shrink-0" />
                    <span className="truncate">{config.siteName || 'Unknown Site'}</span>
                    <span className="text-muted-foreground text-xs">
                      v{config.controllerVersion}
                    </span>
                    <span className="text-muted-foreground text-xs">
                      {formatDate(config.importedAt)}
                    </span>
                  </div>
                  <div className="flex items-center gap-2 flex-shrink-0">
                    {config.vulnerabilityCount !== undefined && config.vulnerabilityCount > 0 && (
                      <Badge variant="outline" className="text-xs flex items-center gap-1">
                        <AlertTriangle className="h-3 w-3" />
                        {config.vulnerabilityCount}
                      </Badge>
                    )}
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-7 text-xs"
                      onClick={(e) => {
                        e.stopPropagation();
                        onActivate(config.id);
                      }}
                    >
                      Restore
                    </Button>
                  </div>
                </div>
              ))}
              {inactiveConfigs.length > 5 && (
                <p className="text-xs text-muted-foreground text-center pt-2">
                  +{inactiveConfigs.length - 5} older configurations
                </p>
              )}
            </div>
          </CardContent>
        </CollapsibleContent>
      </Collapsible>
    </Card>
  );
}

// Embeddable content component (without page header)
export function ConfigContent() {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  // Fetch UniFi settings
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

  const { data: currentConfig } = useQuery({
    queryKey: ['config', 'current'],
    queryFn: async () => {
      const response = await api.get<{ config: Configuration | null }>('/config/current');
      return response.data?.config;
    },
  });

  const { data: configHistory, isLoading } = useQuery({
    queryKey: ['config', 'history'],
    queryFn: async () => {
      const response = await api.get<{ configs: Configuration[] }>('/config/history');
      return response.data?.configs || [];
    },
  });

  const syncNowMutation = useMutation({
    mutationFn: async () => {
      const response = await api.post<{
        synced: boolean;
        message?: string;
        config?: { id: string; siteName: string };
        analysis?: { vulnerabilitiesFound: number };
      }>('/unifi/sync', { site: unifiData?.settings?.selectedSite || 'default' });
      if (!response.success) {
        throw new Error(response.error?.message || 'Sync failed');
      }
      return response.data;
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['unifi', 'settings'] });
      queryClient.invalidateQueries({ queryKey: ['config'] });
      queryClient.invalidateQueries({ queryKey: ['vulnerabilities'] });
      queryClient.invalidateQueries({ queryKey: ['dashboard'] });

      if (data?.synced) {
        toast({
          title: 'Configuration synced',
          description: `Found ${data.analysis?.vulnerabilitiesFound || 0} security issues`,
        });
      } else {
        toast({
          title: 'No changes detected',
          description: data?.message || 'Configuration is up to date',
        });
      }
    },
    onError: (error: Error) => {
      queryClient.invalidateQueries({ queryKey: ['unifi', 'settings'] });
      toast({ variant: 'destructive', title: 'Sync failed', description: error.message });
    },
  });

  const activateMutation = useMutation({
    mutationFn: async (configId: string) => {
      const response = await api.post(`/config/${configId}/activate`);
      if (!response.success) {
        throw new Error(response.error?.message || 'Activation failed');
      }
    },
    onSuccess: () => {
      toast({ title: 'Configuration activated' });
      queryClient.invalidateQueries({ queryKey: ['config'] });
    },
    onError: (error: Error) => {
      toast({ variant: 'destructive', title: 'Error', description: error.message });
    },
  });

  const isUnifiConfigured = unifiData?.configured;

  return (
    <div className="space-y-6">
      {/* UniFi Connection Status & Sync */}
      <Card className="border-border/50">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Server className="h-5 w-5 text-orange-400" />
            UniFi Controller
          </CardTitle>
          <CardDescription>
            Sync configuration directly from your connected UniFi Controller
          </CardDescription>
        </CardHeader>
        <CardContent>
          {loadingUnifi ? (
            <div className="flex items-center justify-center h-20">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : isUnifiConfigured ? (
            <div className="space-y-4">
              {/* Connection Info */}
              <div className="p-4 rounded-lg bg-muted/30 border border-border/50">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                  <div className="flex items-center gap-3 min-w-0">
                    <Server className="h-5 w-5 text-muted-foreground" />
                    <div>
                      <p className="font-medium">{unifiData?.settings?.host}</p>
                      <p className="text-sm text-muted-foreground">
                        Site: {unifiData?.settings?.selectedSite || 'default'}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    {unifiData?.settings?.lastSyncStatus === 'success' ? (
                      <Badge className="bg-emerald-500/20 text-emerald-400 border-emerald-500/30">
                        <CheckCircle2 className="h-3 w-3 mr-1" />
                        Connected
                      </Badge>
                    ) : unifiData?.settings?.lastSyncStatus === 'error' ? (
                      <Badge className="bg-red-500/20 text-red-400 border-red-500/30">
                        <XCircle className="h-3 w-3 mr-1" />
                        Error
                      </Badge>
                    ) : (
                      <Badge variant="outline">Not synced</Badge>
                    )}
                  </div>
                </div>
                {unifiData?.settings?.lastSyncAt && (
                  <p className="text-xs text-muted-foreground mt-2">
                    Last sync: {formatDate(unifiData.settings.lastSyncAt)}
                    {unifiData.settings.lastSyncError && (
                      <span className="text-red-400 ml-2">
                        ({unifiData.settings.lastSyncError})
                      </span>
                    )}
                  </p>
                )}
              </div>

              {/* Sync Button */}
              <Button
                onClick={() => syncNowMutation.mutate()}
                disabled={syncNowMutation.isPending}
                className="bg-orange-600 hover:bg-orange-500"
              >
                {syncNowMutation.isPending ? (
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                ) : (
                  <RefreshCw className="h-4 w-4 mr-2" />
                )}
                Sync Configuration Now
              </Button>
            </div>
          ) : (
            <div className="text-center py-6">
              <Server className="h-10 w-10 mx-auto mb-3 text-muted-foreground/50" />
              <p className="text-muted-foreground mb-2">No UniFi Controller connected</p>
              <p className="text-sm text-muted-foreground">
                Add your controller details below to enable automatic sync.
              </p>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Active Configuration */}
      {currentConfig && (
        <Card className="border-border/50">
          <CardHeader>
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
              <CardTitle className="flex items-center gap-2">
                <Check className="h-5 w-5 text-green-500" />
                Active Configuration
              </CardTitle>
              <Badge variant="success">Active</Badge>
            </div>
          </CardHeader>
          <CardContent>
            <div className="grid gap-2 text-sm">
              <div className="flex items-center justify-between gap-3">
                <span className="text-muted-foreground">Site Name</span>
                <span className="font-medium text-right">{currentConfig.siteName || 'Unknown'}</span>
              </div>
              <div className="flex items-center justify-between gap-3">
                <span className="text-muted-foreground">Controller Version</span>
                <span>{currentConfig.controllerVersion || 'Unknown'}</span>
              </div>
              <div className="flex items-center justify-between gap-3">
                <span className="text-muted-foreground">Imported</span>
                <span>{formatDate(currentConfig.importedAt)}</span>
              </div>
              <div className="flex items-center justify-between gap-3">
                <span className="text-muted-foreground">Vulnerabilities</span>
                <Badge variant={currentConfig.vulnerabilityCount ? 'destructive' : 'success'}>
                  {currentConfig.vulnerabilityCount || 0}
                </Badge>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Controller Connection Form */}
      <ControllerConnectionForm />

      {/* Config History - Compact Summary */}
      <ConfigHistorySummary
        configHistory={configHistory || []}
        isLoading={isLoading}
        onActivate={(id) => activateMutation.mutate(id)}
      />
    </div>
  );
}

export function ConfigPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl sm:text-3xl font-bold">UniFi Configuration</h1>
        <p className="text-muted-foreground">Manage and sync your UniFi configurations</p>
      </div>
      <ConfigContent />
    </div>
  );
}

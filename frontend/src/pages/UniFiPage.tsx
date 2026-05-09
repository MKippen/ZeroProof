import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Server,
  Plus,
  RefreshCw,
  Trash2,
  CheckCircle,
  XCircle,
  Loader2,
  Shield,
  History,
  Edit,
  Zap,
} from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import api from '@/api/client';
import { useToast } from '@/hooks/useToast';
import { formatDate, cn } from '@/lib/utils';

interface UniFiConnection {
  id: string;
  name: string;
  host: string;
  port: number;
  siteId: string;
  isActive: boolean;
  autoSync: boolean;
  syncIntervalMin: number;
  lastSyncAt: string | null;
  lastSyncStatus: 'SUCCESS' | 'FAILED' | 'IN_PROGRESS' | null;
  lastSyncError: string | null;
  allowSelfSigned: boolean;
  canWrite: boolean;
  createdAt: string;
  _count?: { syncHistory: number; configChanges: number };
}

interface SyncHistory {
  id: string;
  status: string;
  startedAt: string;
  completedAt: string | null;
  devicesFound: number | null;
  networksFound: number | null;
  rulesFound: number | null;
  wlansFound: number | null;
  changesDetected: number | null;
  vulnerabilitiesFound: number | null;
  errorMessage: string | null;
}

interface SyncResult {
  stats?: {
    vulnerabilitiesFound?: number;
  };
}

interface ConnectionTestResult {
  success?: boolean;
  message?: string;
}

export function UniFiPage() {
  const [showAddForm, setShowAddForm] = useState(false);
  const [editingConnection, setEditingConnection] = useState<UniFiConnection | null>(null);
  const [selectedConnection, setSelectedConnection] = useState<string | null>(null);
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const { data: connectionsData, isLoading } = useQuery({
    queryKey: ['unifi-connections'],
    queryFn: async () => {
      const response = await api.get<{ connections: UniFiConnection[] }>('/unifi/connections');
      if (response.success && response.data) {
        return response.data.connections;
      }
      return [];
    },
  });

  const { data: historyData } = useQuery({
    queryKey: ['unifi-history', selectedConnection],
    queryFn: async () => {
      if (!selectedConnection) return [];
      const response = await api.get<{ history: SyncHistory[] }>(
        `/unifi/connections/${selectedConnection}/history`
      );
      if (response.success && response.data) {
        return response.data.history;
      }
      return [];
    },
    enabled: !!selectedConnection,
  });

  const connections = connectionsData || [];
  const history = historyData || [];

  const syncMutation = useMutation({
    mutationFn: async (connectionId: string) => {
      const response = await api.post<SyncResult>(`/unifi/connections/${connectionId}/sync`);
      if (!response.success) {
        throw new Error(response.error?.message || 'Sync failed');
      }
      return response.data;
    },
    onSuccess: (data) => {
      toast({ title: 'Sync completed', description: `Found ${data?.stats?.vulnerabilitiesFound ?? 0} vulnerabilities` });
      queryClient.invalidateQueries({ queryKey: ['unifi-connections'] });
      queryClient.invalidateQueries({ queryKey: ['unifi-history'] });
      queryClient.invalidateQueries({ queryKey: ['dashboard'] });
    },
    onError: (error: Error) => {
      toast({ variant: 'destructive', title: 'Sync failed', description: error.message });
    },
  });

  const testMutation = useMutation({
    mutationFn: async (connectionId: string) => {
      const response = await api.post<ConnectionTestResult>(`/unifi/connections/${connectionId}/test`);
      if (!response.success) {
        throw new Error(response.error?.message || 'Test failed');
      }
      return response.data;
    },
    onSuccess: (data) => {
      if (data?.success) {
        toast({ title: 'Connection successful', description: data?.message });
      } else {
        toast({ variant: 'destructive', title: 'Connection failed', description: data?.message });
      }
    },
    onError: (error: Error) => {
      toast({ variant: 'destructive', title: 'Test failed', description: error.message });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (connectionId: string) => {
      const response = await api.delete(`/unifi/connections/${connectionId}`);
      if (!response.success) {
        throw new Error(response.error?.message || 'Delete failed');
      }
    },
    onSuccess: () => {
      toast({ title: 'Connection deleted' });
      queryClient.invalidateQueries({ queryKey: ['unifi-connections'] });
    },
    onError: (error: Error) => {
      toast({ variant: 'destructive', title: 'Delete failed', description: error.message });
    },
  });

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="h-8 w-8 animate-spin" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl sm:text-3xl font-bold">UniFi Integration</h1>
          <p className="text-muted-foreground">Connect directly to your UniFi Controller for real-time monitoring</p>
        </div>
        <Button onClick={() => setShowAddForm(true)}>
          <Plus className="h-4 w-4 mr-2" />
          Add Connection
        </Button>
      </div>

      {/* Add/Edit Form */}
      {(showAddForm || editingConnection) && (
        <ConnectionForm
          connection={editingConnection}
          onClose={() => {
            setShowAddForm(false);
            setEditingConnection(null);
          }}
          onSuccess={() => {
            setShowAddForm(false);
            setEditingConnection(null);
            queryClient.invalidateQueries({ queryKey: ['unifi-connections'] });
          }}
        />
      )}

      {/* Connections List */}
      {connections.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-12">
            <Server className="h-12 w-12 text-muted-foreground mb-4" />
            <h3 className="text-lg font-medium">No UniFi Controllers Connected</h3>
            <p className="text-sm text-muted-foreground mt-1">
              Add a connection to sync your UniFi configuration automatically
            </p>
            <Button className="mt-4" onClick={() => setShowAddForm(true)}>
              <Plus className="h-4 w-4 mr-2" />
              Add Connection
            </Button>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4">
          {connections.map((conn) => (
            <Card key={conn.id} className={cn(!conn.isActive && 'opacity-60')}>
              <CardHeader className="pb-2">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                  <div className="flex items-center gap-3 min-w-0">
                    <Server className="h-5 w-5" />
                    <div className="min-w-0">
                      <CardTitle className="text-lg">{conn.name}</CardTitle>
                      <CardDescription className="truncate">
                        {conn.host}:{conn.port} (Site: {conn.siteId})
                      </CardDescription>
                    </div>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    {conn.canWrite && (
                      <Badge variant="default" className="bg-purple-500">
                        <Zap className="h-3 w-3 mr-1" />
                        Write Access
                      </Badge>
                    )}
                    {conn.autoSync && (
                      <Badge variant="secondary">
                        <RefreshCw className="h-3 w-3 mr-1" />
                        Auto-sync ({conn.syncIntervalMin}m)
                      </Badge>
                    )}
                    <SyncStatusBadge status={conn.lastSyncStatus} />
                  </div>
                </div>
              </CardHeader>
              <CardContent>
                <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                  <div className="text-sm text-muted-foreground">
                    {conn.lastSyncAt ? (
                      <span>Last synced: {formatDate(conn.lastSyncAt)}</span>
                    ) : (
                      <span>Never synced</span>
                    )}
                    {conn.lastSyncError && (
                      <span className="text-red-500 ml-0 sm:ml-2 block sm:inline">Error: {conn.lastSyncError}</span>
                    )}
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setSelectedConnection(selectedConnection === conn.id ? null : conn.id)}
                    >
                      <History className="h-4 w-4 mr-1" />
                      History
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => testMutation.mutate(conn.id)}
                      disabled={testMutation.isPending}
                    >
                      {testMutation.isPending ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        <CheckCircle className="h-4 w-4 mr-1" />
                      )}
                      Test
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => syncMutation.mutate(conn.id)}
                      disabled={syncMutation.isPending || conn.lastSyncStatus === 'IN_PROGRESS'}
                    >
                      {syncMutation.isPending || conn.lastSyncStatus === 'IN_PROGRESS' ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        <RefreshCw className="h-4 w-4 mr-1" />
                      )}
                      Sync Now
                    </Button>
                    <Button variant="outline" size="sm" onClick={() => setEditingConnection(conn)}>
                      <Edit className="h-4 w-4" />
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => {
                        if (confirm('Delete this connection?')) {
                          deleteMutation.mutate(conn.id);
                        }
                      }}
                    >
                      <Trash2 className="h-4 w-4 text-red-500" />
                    </Button>
                  </div>
                </div>

                {/* History Panel */}
                {selectedConnection === conn.id && history.length > 0 && (
                  <div className="mt-4 pt-4 border-t">
                    <h4 className="font-medium mb-2">Sync History</h4>
                    <div className="space-y-2 max-h-64 overflow-y-auto">
                      {history.map((h) => (
                        <div key={h.id} className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between p-2 bg-muted/50 rounded text-sm">
                          <div className="flex items-center gap-2">
                            <SyncStatusBadge status={h.status} />
                            <span>{formatDate(h.startedAt)}</span>
                          </div>
                          <div className="flex flex-wrap items-center gap-2 sm:gap-4 text-muted-foreground">
                            {h.devicesFound !== null && <span>{h.devicesFound} devices</span>}
                            {h.rulesFound !== null && <span>{h.rulesFound} rules</span>}
                            {h.vulnerabilitiesFound !== null && (
                              <span className="text-orange-500">{h.vulnerabilitiesFound} vulnerabilities</span>
                            )}
                            {h.errorMessage && <span className="text-red-500 truncate max-w-xs">{h.errorMessage}</span>}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* Info Card */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Shield className="h-5 w-5" />
            About UniFi Integration
          </CardTitle>
        </CardHeader>
        <CardContent className="prose prose-sm max-w-none">
          <p className="text-muted-foreground">
            Direct integration with your UniFi Controller allows the Security Auditor to:
          </p>
          <ul className="list-disc list-inside text-muted-foreground space-y-1 mt-2">
            <li>Automatically sync configuration changes</li>
            <li>Detect when firewall rules are added, modified, or deleted</li>
            <li>Track configuration drift over time</li>
            <li>Apply recommended security rules directly (with write access)</li>
          </ul>
          <p className="text-muted-foreground mt-4">
            <strong>Recommended:</strong> Create a dedicated local admin user in UniFi for this integration.
            For read-only access, a viewer role is sufficient. Enable write access only if you want to apply
            remediation rules automatically.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}

function SyncStatusBadge({ status }: { status: string | null }) {
  if (!status) {
    return <Badge variant="secondary">Never synced</Badge>;
  }

  switch (status) {
    case 'SUCCESS':
      return (
        <Badge variant="success" className="bg-green-500">
          <CheckCircle className="h-3 w-3 mr-1" />
          Success
        </Badge>
      );
    case 'FAILED':
      return (
        <Badge variant="destructive">
          <XCircle className="h-3 w-3 mr-1" />
          Failed
        </Badge>
      );
    case 'IN_PROGRESS':
      return (
        <Badge variant="default">
          <Loader2 className="h-3 w-3 mr-1 animate-spin" />
          Syncing
        </Badge>
      );
    default:
      return <Badge variant="secondary">{status}</Badge>;
  }
}

function ConnectionForm({
  connection,
  onClose,
  onSuccess,
}: {
  connection: UniFiConnection | null;
  onClose: () => void;
  onSuccess: () => void;
}) {
  const [formData, setFormData] = useState({
    name: connection?.name || '',
    host: connection?.host || '',
    port: connection?.port || 443,
    username: '',
    password: '',
    siteId: connection?.siteId || 'default',
    autoSync: connection?.autoSync || false,
    syncIntervalMin: connection?.syncIntervalMin || 60,
    verifySsl: connection ? !connection.allowSelfSigned : false,
    canWrite: connection?.canWrite || false,
  });
  const { toast } = useToast();

  const mutation = useMutation({
    mutationFn: async () => {
      const endpoint = connection
        ? `/unifi/connections/${connection.id}`
        : '/unifi/connections';

      const response = connection
        ? await api.patch(endpoint, formData)
        : await api.post(endpoint, formData);

      if (!response.success) {
        throw new Error(response.error?.message || 'Failed to save connection');
      }
      return response;
    },
    onSuccess: () => {
      toast({ title: connection ? 'Connection updated' : 'Connection created' });
      onSuccess();
    },
    onError: (error: Error) => {
      toast({ variant: 'destructive', title: 'Error', description: error.message });
    },
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle>{connection ? 'Edit Connection' : 'Add UniFi Connection'}</CardTitle>
        <CardDescription>
          Enter your UniFi Controller credentials. Create a local admin user for best security.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            mutation.mutate();
          }}
          className="space-y-4"
        >
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="name">Connection Name</Label>
              <Input
                id="name"
                value={formData.name}
                onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                placeholder="My UniFi Controller"
                required
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="host">Host / IP Address</Label>
              <Input
                id="host"
                value={formData.host}
                onChange={(e) => setFormData({ ...formData, host: e.target.value })}
                placeholder="192.168.1.1 or unifi.local"
                required
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="port">Port</Label>
              <Input
                id="port"
                type="number"
                value={formData.port}
                onChange={(e) => setFormData({ ...formData, port: parseInt(e.target.value) })}
                placeholder="443"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="siteId">Site ID</Label>
              <Input
                id="siteId"
                value={formData.siteId}
                onChange={(e) => setFormData({ ...formData, siteId: e.target.value })}
                placeholder="default"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="username">Username</Label>
              <Input
                id="username"
                value={formData.username}
                onChange={(e) => setFormData({ ...formData, username: e.target.value })}
                placeholder={connection ? '(unchanged)' : 'admin'}
                required={!connection}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="password">Password</Label>
              <Input
                id="password"
                type="password"
                value={formData.password}
                onChange={(e) => setFormData({ ...formData, password: e.target.value })}
                placeholder={connection ? '(unchanged)' : 'Enter password'}
                required={!connection}
              />
            </div>
          </div>

          <div className="flex flex-col gap-3 pt-4 border-t">
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={formData.autoSync}
                onChange={(e) => setFormData({ ...formData, autoSync: e.target.checked })}
                className="rounded"
              />
              <span>Enable auto-sync</span>
            </label>

            {formData.autoSync && (
              <div className="flex items-center gap-2 flex-wrap">
                <Label htmlFor="syncInterval">Interval (minutes):</Label>
                <Input
                  id="syncInterval"
                  type="number"
                  min="5"
                  max="1440"
                  value={formData.syncIntervalMin}
                  onChange={(e) => setFormData({ ...formData, syncIntervalMin: parseInt(e.target.value) })}
                  className="w-20"
                />
              </div>
            )}

            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={formData.verifySsl}
                onChange={(e) => setFormData({ ...formData, verifySsl: e.target.checked })}
                className="rounded"
              />
              <span>Verify SSL certificate</span>
            </label>

            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={formData.canWrite}
                onChange={(e) => setFormData({ ...formData, canWrite: e.target.checked })}
                className="rounded"
              />
              <span>Enable write access (apply rules)</span>
            </label>
          </div>

          <div className="flex flex-col-reverse sm:flex-row sm:justify-end gap-2 pt-4">
            <Button type="button" variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={mutation.isPending}>
              {mutation.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
              {connection ? 'Save Changes' : 'Add Connection'}
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}

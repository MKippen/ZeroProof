import { useState, useEffect, useRef } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Cpu,
  Wifi,
  RefreshCw,
  Trash2,
  Power,
  Download,
  Usb,
  Pencil,
  Check,
  X,
  Network,
  ArrowRight,
  CheckCircle2,
  Circle,
  Play,
} from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Input } from '@/components/ui/input';
import api from '@/api/client';
import type { Device, FirmwareInfo } from '@/types';
import { formatDate, cn } from '@/lib/utils';
import { useToast } from '@/hooks/useToast';
import { ESP32SetupContent } from './ESP32SetupPage';
import { TestsPage } from './TestsPage';
import { VLANCoverageBar } from '@/components/devices/VLANCoverageBar';
import { VLANCard } from '@/components/devices/VLANCard';
import { POLL_INTERVALS } from '@/config/polling';

interface NetworkInfo {
  _id: string;
  name: string;
  purpose: string;
  vlan?: number;
  subnet?: string;
}

interface VLANInfo {
  networkId: string;
  name: string;
  vlanId: number | null;
  subnet: string | null;
  ssids: string[];
  testDevices: Array<{
    id: string;
    deviceId: string;
    name: string;
    ipAddress: string | null;
    status: string;
  }>;
  hasCoverage: boolean;
  hasHostValidation: boolean;
  hostValidationDevice: {
    id: string;
    deviceId: string;
    name: string;
    ipAddress: string | null;
    status: string;
  } | null;
  intentCategory: string | null;
  validation: {
    lastTestRunId: string | null;
    lastTestDate: string | null;
    sourceDeviceId: string | null;
    sourceType: 'esp32' | 'server-local' | 'unknown';
    partialEvidence: boolean;
    internetAccess: boolean | null;
    dnsFiltering: boolean | null;
    vlanReachability: Array<{
      targetVlan: string;
      targetVlanName: string;
      expected: 'allow' | 'block' | 'unknown';
      verdict: 'pass' | 'fail' | 'unknown' | 'conflict';
      confidence: number;
      reason: string;
      evidenceCount: number;
      evidenceSource: 'esp32' | 'server-local';
      direction: 'src_to_dst';
      canReach: boolean;
      shouldBeBlocked: boolean;
    }>;
    deviceReachability: Array<{
      deviceName: string;
      deviceIp: string;
      canReach: boolean;
    }>;
  } | null;
  accessRules?: Array<{
    ruleName: string;
    sourceNetwork: string;
    targetDevice: string;
    targetIp: string;
    ports: number[];
    action: 'allow' | 'deny';
  }>;
  isCaptivePortal?: boolean;
}

interface VLANCoverageResponse {
  vlans: VLANInfo[];
  summary: {
    totalVlans: number;
    coveredVlans: number;
    hostValidatedVlans: number;
  };
}

// Check if an IP address belongs to a subnet (e.g., "192.168.2.1/24")
const ipInSubnet = (ip: string, subnet: string): boolean => {
  if (!subnet || !ip) return false;

  const [subnetIp, cidrStr] = subnet.split('/');
  if (!subnetIp || !cidrStr) return false;

  const cidr = parseInt(cidrStr, 10);
  if (isNaN(cidr)) return false;

  const ipToInt = (ipStr: string): number => {
    const parts = ipStr.split('.').map(Number);
    if (parts.length !== 4 || parts.some(isNaN)) return 0;
    return (parts[0] << 24) | (parts[1] << 16) | (parts[2] << 8) | parts[3];
  };

  const mask = cidr === 0 ? 0 : (~0 << (32 - cidr)) >>> 0;
  const ipInt = ipToInt(ip) >>> 0;
  const subnetInt = ipToInt(subnetIp) >>> 0;

  return (ipInt & mask) === (subnetInt & mask);
};

// Find which network an IP belongs to
const findNetworkForIP = (ip: string | null, networks: NetworkInfo[]): string | null => {
  if (!ip || !networks?.length) return null;

  for (const network of networks) {
    if (network.subnet && ipInSubnet(ip, network.subnet)) {
      return network.name;
    }
  }
  return null;
};

export function DevicesPage() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [searchParams, setSearchParams] = useSearchParams();
  const wsRef = useRef<WebSocket | null>(null);
  const [otaProgress, setOtaProgress] = useState<Record<string, number>>({});
  const [otaStatus, setOtaStatus] = useState<Record<string, string>>({});
  const [editingDevice, setEditingDevice] = useState<string | null>(null);
  const [editName, setEditName] = useState('');
  const [usbFlashTarget, setUsbFlashTarget] = useState<Device | null>(null);

  // Get tab from URL or default to 'vlans'
  const tabFromUrl = searchParams.get('tab');
  const [activeTab, setActiveTab] = useState(tabFromUrl || 'vlans');

  // Update URL when tab changes
  const handleTabChange = (tab: string) => {
    setActiveTab(tab);
    if (tab === 'vlans') {
      searchParams.delete('tab');
    } else {
      searchParams.set('tab', tab);
    }
    setSearchParams(searchParams, { replace: true });
  };

  // Sync tab from URL on mount and URL changes
  useEffect(() => {
    const tab = searchParams.get('tab');
    if (tab && ['vlans', 'all-devices', 'tests', 'setup'].includes(tab)) {
      setActiveTab(tab);
    }
  }, [searchParams]);

  // VLAN Coverage query
  const { data: vlanCoverageData, isLoading: isLoadingVlans } = useQuery({
    queryKey: ['vlan-coverage'],
    queryFn: async () => {
      const response = await api.get<VLANCoverageResponse>('/devices/vlan-coverage');
      if (response.success && response.data) {
        return response.data;
      }
      throw new Error(response.error?.message || 'Failed to fetch VLAN coverage');
    },
    refetchInterval: POLL_INTERVALS.vlanCoverage,
  });

  const { data: devices, isLoading: isLoadingDevices } = useQuery({
    queryKey: ['devices'],
    queryFn: async () => {
      const response = await api.get<{ devices: Device[] }>('/devices');
      if (response.success && response.data) {
        return response.data.devices;
      }
      throw new Error(response.error?.message || 'Failed to fetch devices');
    },
    refetchInterval: POLL_INTERVALS.devices,
  });

  const { data: firmwareData } = useQuery({
    queryKey: ['firmware-info'],
    queryFn: async () => {
      const response = await api.get<{ firmware: FirmwareInfo; available: boolean }>(
        '/esp32/firmware/info'
      );
      if (response.success && response.data) {
        return response.data;
      }
      return null;
    },
  });

  const { data: networksData } = useQuery({
    queryKey: ['networks'],
    queryFn: async () => {
      const response = await api.get<{ networks: NetworkInfo[]; hasConfig: boolean }>(
        '/intent/networks'
      );
      if (response.success && response.data) {
        return response.data.networks;
      }
      return [];
    },
  });

  // Check prerequisites
  const { data: intentData } = useQuery({
    queryKey: ['intent-profile'],
    queryFn: async () => {
      const response = await api.get<{ profile: unknown; configured: boolean }>('/intent');
      if (response.success && response.data) {
        return { hasIntent: response.data.configured };
      }
      return { hasIntent: false };
    },
  });

  const { data: configData } = useQuery({
    queryKey: ['config-status'],
    queryFn: async () => {
      const response = await api.get<{ configurations: unknown[] }>('/config');
      if (response.success && response.data) {
        return { hasConfig: response.data.configurations.length > 0 };
      }
      return { hasConfig: false };
    },
  });

  const hasConfig = configData?.hasConfig ?? false;
  const hasIntent = intentData?.hasIntent ?? false;

  // WebSocket for real-time OTA progress
  useEffect(() => {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${protocol}//${window.location.host}/ws`;

    const connect = () => {
      const ws = new WebSocket(wsUrl);

      ws.onmessage = (event) => {
        try {
          const message = JSON.parse(event.data);
          if (message.type === 'ota_progress') {
            setOtaProgress((prev) => ({ ...prev, [message.deviceId]: message.percent }));
            setOtaStatus((prev) => ({ ...prev, [message.deviceId]: message.status }));

            // Refresh devices list on completion or error
            if (
              message.status === 'Success' ||
              (message.percent === 0 &&
                message.status !== 'Starting' &&
                message.status !== 'Downloading')
            ) {
              queryClient.invalidateQueries({ queryKey: ['devices'] });
              queryClient.invalidateQueries({ queryKey: ['vlan-coverage'] });
              // Clear progress after a delay
              setTimeout(() => {
                setOtaProgress((prev) => {
                  const newProgress = { ...prev };
                  delete newProgress[message.deviceId];
                  return newProgress;
                });
                setOtaStatus((prev) => {
                  const newStatus = { ...prev };
                  delete newStatus[message.deviceId];
                  return newStatus;
                });
              }, 3000);
            }
          } else if (message.type === 'device_status') {
            queryClient.invalidateQueries({ queryKey: ['devices'] });
            queryClient.invalidateQueries({ queryKey: ['vlan-coverage'] });
          }
        } catch {
          // Ignore parse errors
        }
      };

      ws.onclose = () => {
        // Reconnect after 3 seconds
        setTimeout(connect, 3000);
      };

      wsRef.current = ws;
    };

    connect();

    return () => {
      wsRef.current?.close();
    };
  }, [queryClient]);

  const [refreshingDevice, setRefreshingDevice] = useState<string | null>(null);

  const handleRefreshDevice = async (deviceId: string) => {
    setRefreshingDevice(deviceId);
    await queryClient.invalidateQueries({ queryKey: ['devices'] });
    await queryClient.invalidateQueries({ queryKey: ['vlan-coverage'] });
    setTimeout(() => setRefreshingDevice(null), 500);
  };

  const rebootMutation = useMutation({
    mutationFn: async (deviceId: string) => {
      const response = await api.post(`/devices/${deviceId}/reboot`);
      if (!response.success) {
        throw new Error(response.error?.message || 'Failed to reboot device');
      }
    },
    onSuccess: () => {
      toast({ title: 'Device reboot initiated' });
      queryClient.invalidateQueries({ queryKey: ['devices'] });
      queryClient.invalidateQueries({ queryKey: ['vlan-coverage'] });
    },
    onError: (error: Error) => {
      toast({ variant: 'destructive', title: 'Error', description: error.message });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (deviceId: string) => {
      const response = await api.delete(`/devices/${deviceId}`);
      if (!response.success) {
        throw new Error(response.error?.message || 'Failed to delete device');
      }
    },
    onSuccess: () => {
      toast({ title: 'Device removed' });
      queryClient.invalidateQueries({ queryKey: ['devices'] });
      queryClient.invalidateQueries({ queryKey: ['vlan-coverage'] });
    },
    onError: (error: Error) => {
      toast({ variant: 'destructive', title: 'Error', description: error.message });
    },
  });

  const startUsbFlashFlow = (device: Device) => {
    setUsbFlashTarget(device);
    handleTabChange('setup');
    toast({
      title: 'USB flash required',
      description: `Connect ${device.name} by USB in Step 1, then continue to Flash in Step 2.`,
    });
  };

  const renameMutation = useMutation({
    mutationFn: async ({ deviceId, name }: { deviceId: string; name: string }) => {
      const response = await api.patch(`/devices/${deviceId}`, { name });
      if (!response.success) {
        throw new Error(response.error?.message || 'Failed to rename device');
      }
    },
    onSuccess: () => {
      toast({ title: 'Device renamed' });
      queryClient.invalidateQueries({ queryKey: ['devices'] });
      queryClient.invalidateQueries({ queryKey: ['vlan-coverage'] });
      setEditingDevice(null);
      setEditName('');
    },
    onError: (error: Error) => {
      toast({ variant: 'destructive', title: 'Error', description: error.message });
    },
  });

  const startEditing = (device: Device) => {
    setEditingDevice(device.id);
    setEditName(device.name);
  };

  const cancelEditing = () => {
    setEditingDevice(null);
    setEditName('');
  };

  const saveEdit = (deviceId: string) => {
    if (editName.trim()) {
      renameMutation.mutate({ deviceId, name: editName.trim() });
    }
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'ONLINE':
        return 'bg-green-500';
      case 'TESTING':
        return 'bg-blue-500';
      case 'UPDATING':
        return 'bg-yellow-500';
      case 'ERROR':
        return 'bg-red-500';
      default:
        return 'bg-gray-400';
    }
  };

  // Check if device needs update (firmware version differs from available)
  const needsUpdate = (device: Device) => {
    if (!firmwareData?.available || !firmwareData?.firmware?.version) return false;
    if (!device.firmwareVersion) return true;
    return device.firmwareVersion !== firmwareData.firmware.version;
  };

  const handleSetupDevice = () => {
    handleTabChange('setup');
  };

  const isLoading = isLoadingVlans || isLoadingDevices;

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl sm:text-3xl font-bold">Devices</h1>
        <p className="text-muted-foreground">
          Manage ESP32 test devices across your VLANs
        </p>
      </div>

      <Tabs value={activeTab} onValueChange={handleTabChange} className="space-y-4">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
          <TabsList className="w-full sm:w-auto">
            <TabsTrigger value="vlans" className="flex items-center gap-2">
              <Network className="h-4 w-4" />
              VLAN Coverage
            </TabsTrigger>
            <TabsTrigger value="all-devices" className="flex items-center gap-2">
              <Cpu className="h-4 w-4" />
              All Devices
            </TabsTrigger>
            <TabsTrigger value="tests" className="flex items-center gap-2">
              <Play className="h-4 w-4" />
              Tests
            </TabsTrigger>
            <TabsTrigger value="setup" className="flex items-center gap-2">
              <Usb className="h-4 w-4" />
              Setup New Device
            </TabsTrigger>
          </TabsList>
          <Button
            variant="ghost"
            size="sm"
            className="self-end sm:self-auto"
            onClick={() => {
              queryClient.invalidateQueries({ queryKey: ['devices'] });
              queryClient.invalidateQueries({ queryKey: ['vlan-coverage'] });
            }}
          >
            <RefreshCw className="h-4 w-4" />
          </Button>
        </div>

        {/* VLAN Coverage Tab */}
        <TabsContent value="vlans" className="space-y-4">
          {/* Coverage Summary Bar */}
          {vlanCoverageData && (
            <VLANCoverageBar
              totalVlans={vlanCoverageData.summary.totalVlans}
              coveredVlans={vlanCoverageData.summary.coveredVlans}
              hostValidatedVlans={vlanCoverageData.summary.hostValidatedVlans}
            />
          )}

          {/* VLAN Grid */}
          {vlanCoverageData && vlanCoverageData.vlans.length > 0 ? (
            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
              {vlanCoverageData.vlans.map((vlan) => (
                <VLANCard
                  key={vlan.networkId}
                  vlan={vlan}
                  onSetupDevice={handleSetupDevice}
                />
              ))}
            </div>
          ) : (
            <Card>
              <CardContent className="flex flex-col items-center py-12 px-6">
                <Network className="h-16 w-16 text-muted-foreground mb-4" />
                <h3 className="text-lg font-medium mb-2">Setup Required</h3>
                <p className="text-muted-foreground text-center max-w-md mb-6">
                  Complete the following steps to see your network VLANs and deploy test devices.
                </p>

                {/* Prerequisites Checklist */}
                <div className="w-full max-w-md space-y-3">
                  {/* Step 1: UniFi Config */}
                  <Link
                    to="/settings"
                    className={`flex items-center gap-3 p-4 rounded-lg border transition-colors ${
                      hasConfig
                        ? 'bg-green-500/10 border-green-500/30'
                        : 'bg-muted/50 border-border hover:border-primary/50 hover:bg-muted'
                    }`}
                  >
                    {hasConfig ? (
                      <CheckCircle2 className="h-5 w-5 text-green-500 flex-shrink-0" />
                    ) : (
                      <Circle className="h-5 w-5 text-muted-foreground flex-shrink-0" />
                    )}
                    <div className="flex-1 min-w-0">
                      <p className={`font-medium ${hasConfig ? 'text-green-500' : ''}`}>
                        1. Connect to UniFi Controller
                      </p>
                      <p className="text-sm text-muted-foreground">
                        {hasConfig
                          ? 'Configuration synced'
                          : 'Sync your UniFi network configuration'}
                      </p>
                    </div>
                    {!hasConfig && <ArrowRight className="h-4 w-4 text-muted-foreground" />}
                  </Link>

                  {/* Step 2: Intent Setup */}
                  <Link
                    to="/wizard"
                    className={`flex items-center gap-3 p-4 rounded-lg border transition-colors ${
                      hasIntent
                        ? 'bg-green-500/10 border-green-500/30'
                        : hasConfig
                          ? 'bg-muted/50 border-border hover:border-primary/50 hover:bg-muted'
                          : 'bg-muted/30 border-border/50 opacity-60 pointer-events-none'
                    }`}
                  >
                    {hasIntent ? (
                      <CheckCircle2 className="h-5 w-5 text-green-500 flex-shrink-0" />
                    ) : (
                      <Circle className="h-5 w-5 text-muted-foreground flex-shrink-0" />
                    )}
                    <div className="flex-1 min-w-0">
                      <p className={`font-medium ${hasIntent ? 'text-green-500' : ''}`}>
                        2. Complete Intent Setup
                      </p>
                      <p className="text-sm text-muted-foreground">
                        {hasIntent
                          ? 'Network intent configured'
                          : 'Define your network security goals'}
                      </p>
                    </div>
                    {!hasIntent && hasConfig && <ArrowRight className="h-4 w-4 text-muted-foreground" />}
                  </Link>

                  {/* Step 3: Deploy Devices */}
                  <div
                    className={`flex items-center gap-3 p-4 rounded-lg border ${
                      hasConfig && hasIntent
                        ? 'bg-muted/50 border-border'
                        : 'bg-muted/30 border-border/50 opacity-60'
                    }`}
                  >
                    <Circle className="h-5 w-5 text-muted-foreground flex-shrink-0" />
                    <div className="flex-1 min-w-0">
                      <p className="font-medium">3. Deploy Test Devices</p>
                      <p className="text-sm text-muted-foreground">
                        Flash ESP32 devices to test each VLAN
                      </p>
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>
          )}
        </TabsContent>

        {/* All Devices Tab */}
        <TabsContent value="all-devices" className="space-y-4">
          {devices && devices.length > 0 ? (
            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
              {devices.map((device) => (
                <Card
                  key={device.id}
                  className={cn(
                    (device.status === 'ONLINE' || device.status === 'TESTING') && device.ipAddress && 'border-green-500 border-2'
                  )}
                >
                  <CardHeader className="pb-2">
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex items-center gap-2 min-w-0 flex-1">
                        <Cpu className="h-5 w-5 text-muted-foreground flex-shrink-0" />
                        {editingDevice === device.id ? (
                          <div className="flex items-center gap-1 flex-1">
                            <Input
                              value={editName}
                              onChange={(e) => setEditName(e.target.value)}
                              onKeyDown={(e) => {
                                if (e.key === 'Enter') saveEdit(device.id);
                                if (e.key === 'Escape') cancelEditing();
                              }}
                              className="h-7 text-sm"
                              autoFocus
                            />
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-7 w-7 p-0"
                              onClick={() => saveEdit(device.id)}
                              disabled={renameMutation.isPending}
                            >
                              <Check className="h-4 w-4 text-green-600" />
                            </Button>
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-7 w-7 p-0"
                              onClick={cancelEditing}
                            >
                              <X className="h-4 w-4 text-muted-foreground" />
                            </Button>
                          </div>
                        ) : (
                          <div className="flex items-center gap-1 min-w-0">
                            <CardTitle className="text-base truncate" title={device.name}>
                              {device.name}
                            </CardTitle>
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-6 w-6 p-0 flex-shrink-0"
                              onClick={() => startEditing(device)}
                            >
                              <Pencil className="h-3 w-3 text-muted-foreground" />
                            </Button>
                          </div>
                        )}
                      </div>
                      <div className="flex items-center gap-1 flex-shrink-0">
                        <span className={cn('w-2 h-2 rounded-full', getStatusColor(device.status))} />
                        <Badge
                          variant={
                            device.status === 'ONLINE'
                              ? 'success'
                              : device.status === 'TESTING'
                              ? 'default'
                              : device.status === 'UPDATING'
                              ? 'medium'
                              : device.status === 'ERROR'
                              ? 'destructive'
                              : 'secondary'
                          }
                        >
                          {device.status}
                        </Badge>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <CardDescription className="font-mono text-xs truncate">
                        {device.deviceId}
                      </CardDescription>
                      {(() => {
                        const networkName = findNetworkForIP(
                          device.ipAddress ?? null,
                          networksData || []
                        );
                        return networkName ? (
                          <Badge variant="outline" className="text-xs flex-shrink-0">
                            <Network className="h-3 w-3 mr-1" />
                            {networkName}
                          </Badge>
                        ) : null;
                      })()}
                    </div>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-sm">
                      <div>
                        <p className="text-muted-foreground">IP Address</p>
                        <p className="font-mono">{device.ipAddress || '-'}</p>
                      </div>
                      <div>
                        <p className="text-muted-foreground">MAC Address</p>
                        <p className="font-mono text-xs">{device.macAddress || '-'}</p>
                      </div>
                      <div>
                        <p className="text-muted-foreground">Firmware</p>
                        <p>{device.firmwareVersion || '-'}</p>
                      </div>
                      <div>
                        <p className="text-muted-foreground">Tests Run</p>
                        <p>{device.testRunCount || 0}</p>
                      </div>
                    </div>

                    {device.configuredNetworks && device.configuredNetworks.length > 0 && (
                      <div>
                        <p className="text-sm text-muted-foreground mb-1">Networks</p>
                        <div className="flex flex-wrap gap-1">
                          {device.configuredNetworks.map((ssid) => (
                            <Badge key={ssid} variant="outline" className="text-xs">
                              <Wifi className="h-3 w-3 mr-1" />
                              {ssid}
                            </Badge>
                          ))}
                        </div>
                      </div>
                    )}

                    {device.lastSeen && (
                      <p className="text-xs text-muted-foreground">
                        Last seen: {formatDate(device.lastSeen)}
                      </p>
                    )}

                    {/* OTA Progress Display - prominent inline progress */}
                    {(device.status === 'UPDATING' ||
                      otaProgress[device.deviceId] !== undefined) && (
                      <div className="rounded-lg border bg-muted/50 p-3 space-y-2">
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-2">
                            <Download className="h-4 w-4 text-primary animate-pulse" />
                            <span className="text-sm font-medium">Firmware Update</span>
                          </div>
                          <span className="text-sm font-bold text-primary">
                            {otaProgress[device.deviceId] ?? 0}%
                          </span>
                        </div>
                        <Progress value={otaProgress[device.deviceId] ?? 0} className="h-2" />
                        <p className="text-xs text-muted-foreground">
                          {otaStatus[device.deviceId] === 'Success' ? (
                            <span className="text-green-600 font-medium">
                              Update complete! Rebooting...
                            </span>
                          ) : otaStatus[device.deviceId]?.includes('Error') ||
                            (otaProgress[device.deviceId] === 0 &&
                              otaStatus[device.deviceId] &&
                              otaStatus[device.deviceId] !== 'Starting' &&
                              otaStatus[device.deviceId] !== 'Downloading') ? (
                            <span className="text-red-600 font-medium">
                              {otaStatus[device.deviceId]}
                            </span>
                          ) : (
                            otaStatus[device.deviceId] || 'Starting update...'
                          )}
                        </p>
                      </div>
                    )}

                    <div className="flex flex-wrap gap-2 pt-2">
                      {/* Refresh button for all devices */}
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => handleRefreshDevice(device.id)}
                        disabled={refreshingDevice === device.id}
                        title="Refresh device status"
                      >
                        <RefreshCw className={cn("h-4 w-4", refreshingDevice === device.id && "animate-spin")} />
                      </Button>
                      {/* Server device doesn't need update/reboot - it runs latest code while online */}
                      {device.deviceId !== 'server-local' && (
                        <>
                          <Button
                            variant="default"
                            size="sm"
                            onClick={() => startUsbFlashFlow(device)}
                            className="bg-primary whitespace-normal h-auto py-2"
                          >
                            <Usb className="h-4 w-4 mr-1" />
                            {needsUpdate(device)
                              ? `Flash via USB (v${firmwareData?.firmware?.version})`
                              : 'Flash via USB'}
                          </Button>
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => rebootMutation.mutate(device.id)}
                            disabled={device.status !== 'ONLINE'}
                          >
                            <Power className="h-4 w-4 mr-1" />
                            Reboot
                          </Button>
                        </>
                      )}
                      <Button
                        variant="outline"
                        size="sm"
                        className="text-destructive hover:text-destructive"
                        onClick={() => {
                          if (confirm('Are you sure you want to remove this device?')) {
                            deleteMutation.mutate(device.id);
                          }
                        }}
                      >
                        <Trash2 className="h-4 w-4 mr-1" />
                        Remove
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          ) : (
            <Card>
              <CardContent className="flex flex-col items-center justify-center py-12">
                <Cpu className="h-16 w-16 text-muted-foreground mb-4" />
                <h3 className="text-lg font-medium mb-2">No Devices Connected</h3>
                <p className="text-muted-foreground text-center max-w-md mb-4">
                  ESP32 devices will appear here once they connect to the MQTT broker. Flash the
                  firmware and configure your device to get started.
                </p>
                <p className="text-sm text-muted-foreground">
                  Use "Flash via USB" on a device card, or switch to "Setup New Device" to flash
                  and configure an ESP32.
                </p>
              </CardContent>
            </Card>
          )}
        </TabsContent>

        {/* Tests Tab */}
        <TabsContent value="tests">
          <TestsPage />
        </TabsContent>

        {/* Setup Tab */}
        <TabsContent value="setup">
          {usbFlashTarget && (
            <Card className="mb-4 border-blue-500/40 bg-blue-500/5">
              <CardContent className="py-3 text-sm text-blue-200">
                Updating <span className="font-medium">{usbFlashTarget.name}</span>:
                connect it over USB in Step 1, then flash firmware in Step 2.
              </CardContent>
            </Card>
          )}
          <ESP32SetupContent />
        </TabsContent>
      </Tabs>
    </div>
  );
}

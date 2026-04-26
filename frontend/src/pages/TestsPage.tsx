import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Play, Square, Clock, CheckCircle, XCircle, AlertCircle, ChevronRight, Wifi, Globe, Server, Network, ShieldAlert, Check, Users, ArrowRight } from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import api from '@/api/client';
import type { TestRun, Device, Honeypot } from '@/types';
import { formatDate, formatDuration, cn } from '@/lib/utils';
import { useToast } from '@/hooks/useToast';
import { useDeviceLookup } from '@/hooks/useDeviceLookup';
import { POLL_INTERVALS } from '@/config/polling';

interface MeshDevice {
  deviceId: string;
  name: string;
  ip: string;
  network?: string;
}

interface TestType {
  type: string;
  name: string;
  description: string;
  isMeshTest?: boolean;
}

type ConnectivityExpectation = 'allow' | 'block' | 'unknown';

interface TopologyTarget {
  ip: string;
  port?: number;
  network?: string;
  deviceName?: string;
  expected?: string;
  shouldBeBlocked?: boolean;
  confidence?: number;
  policySource?: string;
  reason?: string;
  verdict?: string;
  conflict?: boolean;
}

interface TopologyCommandResult {
  op?: string;
  success?: boolean;
  data?: {
    host?: string;
    ip?: string;
    port?: number;
    open?: boolean;
    reachable?: boolean;
  };
}

interface TopologyMetadata {
  testTargets?: TopologyTarget[];
  deviceNetwork?: string;
}

interface TopologyResultsJson {
  commandResults?: TopologyCommandResult[];
  results?: TopologyCommandResult[];
  metadata?: {
    topologyMetadata?: TopologyMetadata;
  };
  topologyMetadata?: TopologyMetadata;
}

interface MeshPath {
  source: { name: string; network?: string };
  target: { name: string; network?: string };
  pingSuccess?: boolean;
  tcpSuccess?: boolean;
  pingLatency?: number;
}

interface MeshResultsJson {
  matrix?: MeshPath[];
  summary?: {
    totalPaths?: number;
    successfulPaths?: number;
    failedPaths?: number;
    crossNetworkSuccesses?: number;
    crossNetworkPaths?: number;
  };
  meshDevices?: MeshDevice[];
}

// Fallback test types if API fails
const fallbackTestTypes: TestType[] = [
  { type: 'connectivity', name: 'Connectivity Test', description: 'Quick verification of device communication' },
  { type: 'quick_scan', name: 'Quick Scan', description: 'Fast scan of gateway and internet' },
  { type: 'device_mesh', name: 'Device Mesh Test', description: 'Test all ESP32 devices against each other', isMeshTest: true },
];

// Helper to get icon for operation type
function getOpIcon(op: string) {
  switch (op) {
    case 'get_network_info':
      return <Wifi className="h-4 w-4 text-blue-500" />;
    case 'ping':
      return <Globe className="h-4 w-4 text-green-500" />;
    case 'dns_lookup':
      return <Server className="h-4 w-4 text-purple-500" />;
    case 'tcp_connect':
    case 'tcp_banner':
      return <Network className="h-4 w-4 text-orange-500" />;
    case 'arp_scan':
      return <Server className="h-4 w-4 text-cyan-500" />;
    default:
      return <AlertCircle className="h-4 w-4 text-gray-500" />;
  }
}

// Format result data for display
function formatResultData(
  op: string,
  data: Record<string, unknown>,
  getDeviceLabel?: (ip: string) => string
) {
  if (!data) return null;

  // Helper to show IP with device name
  const formatHost = (ip: string) => getDeviceLabel ? getDeviceLabel(ip) : ip;

  switch (op) {
    case 'get_network_info':
      return (
        <div className="grid grid-cols-2 gap-2 text-sm">
          <div><span className="text-muted-foreground">IP:</span> {String(data.localIP)}</div>
          <div><span className="text-muted-foreground">Gateway:</span> {formatHost(String(data.gateway))}</div>
          <div><span className="text-muted-foreground">SSID:</span> {String(data.ssid)}</div>
          <div><span className="text-muted-foreground">RSSI:</span> {String(data.rssi)} dBm</div>
        </div>
      );
    case 'ping':
      return (
        <div className="text-sm">
          <span className="text-muted-foreground">Host:</span> {formatHost(String(data.host))} -
          {data.reachable ? (
            <span className="text-green-600 ml-1">Reachable ({String(data.latency)}ms)</span>
          ) : (
            <span className="text-red-600 ml-1">Unreachable</span>
          )}
        </div>
      );
    case 'dns_lookup':
      return (
        <div className="text-sm">
          <span className="text-muted-foreground">{String(data.hostname)}:</span>{' '}
          {data.resolved ? (
            <span className="text-green-600">{formatHost(String(data.ip))}</span>
          ) : (
            <span className="text-red-600">Failed to resolve</span>
          )}
        </div>
      );
    case 'tcp_connect':
      return (
        <div className="text-sm">
          <span className="text-muted-foreground">{formatHost(String(data.host))}:{String(data.port)}</span> -
          {data.open ? (
            <span className="text-green-600 ml-1">Open</span>
          ) : (
            <span className="text-gray-500 ml-1">Closed</span>
          )}
        </div>
      );
    case 'arp_scan':
      const hosts = data.hosts as string[] || [];
      return (
        <div className="text-sm">
          <span className="text-muted-foreground">Found {hosts.length} hosts:</span>
          <div className="mt-2 space-y-1">
            {hosts.map((host, i) => (
              <Badge key={i} variant="outline" className="text-xs mr-1 mb-1">
                {formatHost(host)}
              </Badge>
            ))}
          </div>
        </div>
      );
    default:
      return <pre className="text-xs bg-muted p-2 rounded">{JSON.stringify(data, null, 2)}</pre>;
  }
}

export function TestsPage() {
  const [selectedDevice, setSelectedDevice] = useState<string>('');
  const [selectedTestType, setSelectedTestType] = useState<string>('connectivity');
  const [selectedTest, setSelectedTest] = useState<TestRun | null>(null);
  const [excludeHoneypots, setExcludeHoneypots] = useState<boolean>(false);
  const [selectedMeshDevices, setSelectedMeshDevices] = useState<string[]>([]);
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const { getDeviceLabel } = useDeviceLookup();

  const { data: devices } = useQuery({
    queryKey: ['devices'],
    queryFn: async () => {
      const response = await api.get<{ devices: Device[] }>('/devices');
      return response.data?.devices || [];
    },
  });

  const { data: honeypots } = useQuery({
    queryKey: ['honeypots'],
    queryFn: async () => {
      const response = await api.get<{ honeypots: Honeypot[] }>('/config/honeypots');
      return response.data?.honeypots || [];
    },
  });

  const { data: testTypes } = useQuery({
    queryKey: ['test-types'],
    queryFn: async () => {
      const response = await api.get<{ tests: TestType[] }>('/tests/types');
      return response.data?.tests || fallbackTestTypes;
    },
  });

  // Fetch mesh devices when mesh test is selected
  const { data: meshDevicesData } = useQuery({
    queryKey: ['mesh-devices'],
    queryFn: async () => {
      const response = await api.get<{ devices: MeshDevice[]; canRunTest: boolean; error?: string }>('/tests/mesh-devices');
      return response.data;
    },
    enabled: selectedTestType === 'device_mesh',
  });

  const { data: tests, isLoading } = useQuery({
    queryKey: ['tests'],
    queryFn: async () => {
      const response = await api.get<{ tests: TestRun[] }>('/tests?limit=20');
      return response.data?.tests || [];
    },
    refetchInterval: POLL_INTERVALS.tests,
  });

  const enabledHoneypots = honeypots?.filter(hp => hp.enabled && hp.ipAddress) || [];
  const isHoneypotTest = selectedTestType === 'honeypot_validation';

  const startTestMutation = useMutation({
    mutationFn: async ({ deviceId, testType, options }: { deviceId: string; testType: string; options?: { excludeHoneypots?: boolean } }) => {
      const response = await api.post('/tests/start', { deviceId, testType, options });
      if (!response.success) {
        throw new Error(response.error?.message || 'Failed to start test');
      }
      return response.data;
    },
    onSuccess: () => {
      toast({ title: 'Test started successfully' });
      queryClient.invalidateQueries({ queryKey: ['tests'] });
      queryClient.invalidateQueries({ queryKey: ['devices'] });
    },
    onError: (error: Error) => {
      toast({ variant: 'destructive', title: 'Error', description: error.message });
    },
  });

  const cancelTestMutation = useMutation({
    mutationFn: async (testId: string) => {
      const response = await api.post(`/tests/${testId}/cancel`);
      if (!response.success) {
        throw new Error(response.error?.message || 'Failed to cancel test');
      }
    },
    onSuccess: () => {
      toast({ title: 'Test cancelled' });
      queryClient.invalidateQueries({ queryKey: ['tests'] });
    },
    onError: (error: Error) => {
      toast({ variant: 'destructive', title: 'Error', description: error.message });
    },
  });

  const startMeshTestMutation = useMutation({
    mutationFn: async ({ deviceIds }: { deviceIds?: string[] }) => {
      const response = await api.post('/tests/start-mesh', { deviceIds });
      if (!response.success) {
        throw new Error(response.error?.message || 'Failed to start mesh test');
      }
      return response.data;
    },
    onSuccess: () => {
      toast({ title: 'Mesh test started', description: 'Testing connectivity between all devices' });
      queryClient.invalidateQueries({ queryKey: ['tests'] });
      queryClient.invalidateQueries({ queryKey: ['devices'] });
    },
    onError: (error: Error) => {
      toast({ variant: 'destructive', title: 'Error', description: error.message });
    },
  });

  const onlineDevices = devices?.filter((d) => d.status === 'ONLINE') || [];
  const isMeshTest = (testTypes || fallbackTestTypes).find(t => t.type === selectedTestType)?.isMeshTest;
  const meshDevices = meshDevicesData?.devices || [];

  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'COMPLETED':
        return <CheckCircle className="h-4 w-4 text-green-500" />;
      case 'FAILED':
        return <XCircle className="h-4 w-4 text-red-500" />;
      case 'RUNNING':
        return <div className="h-4 w-4 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />;
      case 'QUEUED':
        return <Clock className="h-4 w-4 text-yellow-500" />;
      case 'CANCELLED':
        return <AlertCircle className="h-4 w-4 text-gray-500" />;
      default:
        return null;
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl sm:text-3xl font-bold">Tests</h1>
        <p className="text-muted-foreground">Run security tests on your network</p>
      </div>

      {/* Start New Test */}
      <Card>
        <CardHeader>
          <CardTitle>Start New Test</CardTitle>
          <CardDescription>
            {isMeshTest
              ? 'Test connectivity between all ESP32 devices'
              : 'Select a device and test type to begin'}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid gap-4 md:grid-cols-3">
            {/* Device Selection - Different for mesh tests */}
            {isMeshTest ? (
              <div className="md:col-span-2">
                <label className="text-sm font-medium mb-2 block flex items-center gap-2">
                  <Users className="h-4 w-4" />
                  Devices ({meshDevices.length} available)
                </label>
                {meshDevices.length >= 2 ? (
                  <div className="space-y-2">
                    <div className="flex flex-wrap gap-2">
                      {meshDevices.map((device) => {
                        const isSelected = selectedMeshDevices.length === 0 || selectedMeshDevices.includes(device.deviceId);
                        return (
                          <button
                            key={device.deviceId}
                            type="button"
                            onClick={() => {
                              if (selectedMeshDevices.length === 0) {
                                // First click - select only this one (deselect "all")
                                setSelectedMeshDevices([device.deviceId]);
                              } else if (selectedMeshDevices.includes(device.deviceId)) {
                                // Remove from selection
                                const newSelection = selectedMeshDevices.filter(id => id !== device.deviceId);
                                setSelectedMeshDevices(newSelection);
                              } else {
                                // Add to selection
                                setSelectedMeshDevices([...selectedMeshDevices, device.deviceId]);
                              }
                            }}
                            className={cn(
                              'flex items-center gap-2 px-3 py-2 rounded-lg border text-sm transition-all',
                              isSelected
                                ? 'border-orange-500 bg-orange-500/10 text-orange-400'
                                : 'border-border hover:border-muted-foreground/50 text-muted-foreground'
                            )}
                          >
                            <div className={cn(
                              'w-4 h-4 rounded border flex items-center justify-center flex-shrink-0',
                              isSelected ? 'bg-orange-500 border-orange-500' : 'border-muted-foreground/50'
                            )}>
                              {isSelected && <Check className="h-3 w-3 text-white" />}
                            </div>
                            <div className="text-left">
                              <div className="font-medium">{device.name}</div>
                              <div className="text-xs opacity-70">{device.network || device.ip}</div>
                            </div>
                          </button>
                        );
                      })}
                    </div>
                    <div className="flex items-center gap-2 text-xs text-muted-foreground">
                      <button
                        type="button"
                        onClick={() => setSelectedMeshDevices([])}
                        className="text-orange-400 hover:underline"
                      >
                        Select All
                      </button>
                      <span>|</span>
                      <span>
                        {selectedMeshDevices.length === 0
                          ? `Testing all ${meshDevices.length} devices`
                          : `Testing ${selectedMeshDevices.length} devices`}
                      </span>
                    </div>
                  </div>
                ) : (
                  <div className="p-4 rounded-lg bg-muted/50 border border-border">
                    <p className="text-sm text-muted-foreground">
                      {meshDevicesData?.error || 'Need at least 2 online ESP32 devices for mesh testing.'}
                    </p>
                  </div>
                )}
              </div>
            ) : (
              <div>
                <label className="text-sm font-medium mb-2 block">Device</label>
                <select
                  className="w-full h-10 px-3 rounded-md border border-input bg-background"
                  value={selectedDevice}
                  onChange={(e) => setSelectedDevice(e.target.value)}
                >
                  <option value="">Select a device...</option>
                  {onlineDevices.map((device) => (
                    <option key={device.id} value={device.id}>
                      {device.name} ({device.ipAddress})
                    </option>
                  ))}
                </select>
                {onlineDevices.length === 0 && (
                  <p className="text-xs text-muted-foreground mt-1">
                    No devices online. Connect an ESP32 device first.
                  </p>
                )}
              </div>
            )}

            {/* Test Type Selection */}
            <div className={isMeshTest ? '' : ''}>
              <label className="text-sm font-medium mb-2 block">Test Type</label>
              <select
                className="w-full h-10 px-3 rounded-md border border-input bg-background"
                value={selectedTestType}
                onChange={(e) => {
                  setSelectedTestType(e.target.value);
                  setSelectedMeshDevices([]); // Reset device selection
                }}
              >
                {(testTypes || fallbackTestTypes).map((t) => (
                  <option key={t.type} value={t.type}>
                    {t.name}
                  </option>
                ))}
              </select>
              <p className="text-xs text-muted-foreground mt-1">
                {(testTypes || fallbackTestTypes).find((t) => t.type === selectedTestType)?.description}
              </p>
            </div>

            {/* Start Button */}
            <div className="flex items-end">
              {isMeshTest ? (
                <Button
                  className="w-full"
                  onClick={() => startMeshTestMutation.mutate({
                    deviceIds: selectedMeshDevices.length > 0 ? selectedMeshDevices : undefined,
                  })}
                  disabled={meshDevices.length < 2 || startMeshTestMutation.isPending}
                >
                  <Users className="h-4 w-4 mr-2" />
                  {startMeshTestMutation.isPending ? 'Starting...' : 'Start Mesh Test'}
                </Button>
              ) : (
                <Button
                  className="w-full"
                  onClick={() =>
                    startTestMutation.mutate({
                      deviceId: selectedDevice,
                      testType: selectedTestType,
                      options: excludeHoneypots ? { excludeHoneypots: true } : undefined,
                    })
                  }
                  disabled={!selectedDevice || startTestMutation.isPending || (isHoneypotTest && enabledHoneypots.length === 0)}
                >
                  <Play className="h-4 w-4 mr-2" />
                  {startTestMutation.isPending ? 'Starting...' : 'Start Test'}
                </Button>
              )}
            </div>
          </div>

          {/* Honeypot Options */}
          {enabledHoneypots.length > 0 && !isHoneypotTest && (
            <div className="mt-4 pt-4 border-t">
              <div className="flex items-center gap-3">
                <button
                  type="button"
                  onClick={() => setExcludeHoneypots(!excludeHoneypots)}
                  className={cn(
                    'flex items-center gap-2 px-3 py-2 rounded-md border text-sm transition-colors',
                    excludeHoneypots
                      ? 'border-orange-500 bg-orange-500/10 text-orange-400'
                      : 'border-border hover:border-muted-foreground/50'
                  )}
                >
                  <div
                    className={cn(
                      'w-4 h-4 rounded border flex items-center justify-center',
                      excludeHoneypots ? 'bg-orange-500 border-orange-500' : 'border-muted-foreground/50'
                    )}
                  >
                    {excludeHoneypots && <Check className="h-3 w-3 text-white" />}
                  </div>
                  <ShieldAlert className="h-4 w-4" />
                  Exclude honeypots from scan
                </button>
                <span className="text-xs text-muted-foreground">
                  {enabledHoneypots.length} honeypot{enabledHoneypots.length !== 1 ? 's' : ''} configured
                </span>
              </div>
              {!excludeHoneypots && (
                <p className="text-xs text-yellow-500 mt-2">
                  Warning: This scan may trigger honeypot alerts
                </p>
              )}
            </div>
          )}

          {/* Honeypot Validation Info */}
          {isHoneypotTest && (
            <div className="mt-4 pt-4 border-t">
              <div className="flex items-start gap-3 p-3 rounded-lg bg-muted/50">
                <ShieldAlert className="h-5 w-5 text-orange-400 mt-0.5" />
                <div>
                  <p className="font-medium text-sm">Honeypot Validation Test</p>
                  {enabledHoneypots.length > 0 ? (
                    <>
                      <p className="text-xs text-muted-foreground mt-1">
                        This test will verify that your {enabledHoneypots.length} honeypot{enabledHoneypots.length !== 1 ? 's are' : ' is'} responding correctly.
                      </p>
                      <div className="mt-2 flex flex-wrap gap-1">
                        {enabledHoneypots.map((hp) => (
                          <Badge key={hp.id} variant="outline" className="text-xs">
                            {hp.ipAddress} {hp.networkName && `(${hp.networkName})`}
                          </Badge>
                        ))}
                      </div>
                    </>
                  ) : (
                    <p className="text-xs text-red-500 mt-1">
                      No honeypots configured. Import a UniFi configuration with honeypots enabled.
                    </p>
                  )}
                </div>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Test History */}
      <Card>
        <CardHeader>
          <CardTitle>Test History</CardTitle>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="flex items-center justify-center h-32">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
            </div>
          ) : tests && tests.length > 0 ? (
            <div className="space-y-3">
              {tests.map((test) => (
                <div
                  key={test.id}
                  className="flex items-center gap-4 p-4 rounded-lg border bg-card hover:bg-accent/50 cursor-pointer transition-colors"
                  onClick={() => setSelectedTest(test)}
                >
                  {getStatusIcon(test.status)}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="font-medium">
                        {test.testType.replace('_', ' ').toUpperCase()}
                      </span>
                      <Badge
                        variant={
                          test.status === 'COMPLETED'
                            ? 'success'
                            : test.status === 'FAILED'
                            ? 'destructive'
                            : test.status === 'RUNNING' || test.status === 'QUEUED'
                            ? 'default'
                            : 'secondary'
                        }
                      >
                        {test.status}
                      </Badge>
                    </div>
                    <p className="text-sm text-muted-foreground">
                      {test.device?.name || 'Unknown device'} - {formatDate(test.startedAt)}
                    </p>
                    {test.status === 'RUNNING' && (
                      <div className="mt-2">
                        <div className="flex items-center justify-between text-xs text-muted-foreground mb-1">
                          <span>{test.currentStep || 'Running...'}</span>
                          <span>{test.progress}%</span>
                        </div>
                        <Progress value={test.progress} className="h-2" />
                      </div>
                    )}
                    {test.errorMessage && (
                      <p className="text-sm text-red-500 mt-1">{test.errorMessage}</p>
                    )}
                  </div>
                  <div className="text-right">
                    {test.duration && (
                      <p className="text-sm text-muted-foreground">
                        {formatDuration(test.duration)}
                      </p>
                    )}
                    {test.vulnerabilityCount !== undefined && test.vulnerabilityCount > 0 && (
                      <Badge variant="destructive" className="mt-1">
                        {test.vulnerabilityCount} issues
                      </Badge>
                    )}
                  </div>
                  {(test.status === 'RUNNING' || test.status === 'QUEUED') ? (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={(e) => {
                        e.stopPropagation();
                        cancelTestMutation.mutate(test.id);
                      }}
                    >
                      <Square className="h-4 w-4" />
                    </Button>
                  ) : (
                    <ChevronRight className="h-5 w-5 text-muted-foreground" />
                  )}
                </div>
              ))}
            </div>
          ) : (
            <div className="text-center py-8 text-muted-foreground">
              <Play className="h-12 w-12 mx-auto mb-2 opacity-50" />
              <p>No tests run yet. Start a test above.</p>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Test Details Dialog */}
      <Dialog open={!!selectedTest} onOpenChange={(open) => !open && setSelectedTest(null)}>
        <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              {selectedTest && getStatusIcon(selectedTest.status)}
              {selectedTest?.testType.replace('_', ' ').toUpperCase()}
            </DialogTitle>
            <DialogDescription>
              {selectedTest?.device?.name || 'Unknown device'} - {selectedTest && formatDate(selectedTest.startedAt)}
              {selectedTest?.duration && ` - Duration: ${formatDuration(selectedTest.duration)}`}
            </DialogDescription>
          </DialogHeader>

          {selectedTest?.resultsJson !== null && selectedTest?.resultsJson !== undefined && (
            <div className="space-y-4">
              {/* Special display for topology validation tests */}
              {selectedTest.testType === 'topology_validation' && (() => {
                const raw = selectedTest.resultsJson as TopologyResultsJson;
                const results = raw.commandResults || raw.results || [];
                const metadata = raw.metadata?.topologyMetadata || raw.topologyMetadata || {};
                const testTargets = metadata.testTargets || [];

                const parseExpected = (target: TopologyTarget): ConnectivityExpectation => {
                  if (target.expected === 'allow' || target.expected === 'block' || target.expected === 'unknown') {
                    return target.expected;
                  }
                  if (target.shouldBeBlocked === true) return 'block';
                  if (target.shouldBeBlocked === false) return 'allow';
                  return 'unknown';
                };

                const targetExpectations = new Map<
                  string,
                  {
                    network: string;
                    deviceName: string;
                    expected: 'allow' | 'block' | 'unknown';
                    confidence: number;
                    policySource?: string;
                    reason?: string;
                    conflict: boolean;
                  }
                >();
                testTargets.forEach((t) => {
                  targetExpectations.set(`${t.ip}:${t.port || 0}`, {
                    network: t.network || 'Unknown',
                    deviceName: t.deviceName || t.ip,
                    expected: parseExpected(t),
                    confidence: typeof t.confidence === 'number' ? t.confidence : 0,
                    policySource: t.policySource,
                    reason: t.reason,
                    conflict: t.verdict === 'conflict' || t.conflict === true,
                  });
                });

                const observedByTarget = new Map<
                  string,
                  { reachable: boolean; host: string; port?: number }
                >();
                results.forEach((result) => {
                  if (result.op !== 'tcp_connect' && result.op !== 'ping') return;
                  const host = result.data?.host || result.data?.ip;
                  if (!host) return;
                  const port = result.data?.port || 0;
                  const reachable = result.success === true && (result.data?.open === true || result.data?.reachable === true);
                  observedByTarget.set(`${host}:${port}`, { reachable, host, port });
                });

                const analyses: Array<{
                  verdict: 'pass' | 'fail' | 'unknown' | 'conflict';
                  network: string;
                  deviceName: string;
                  host: string;
                  port?: number;
                  reachable: boolean;
                  expected: 'allow' | 'block' | 'unknown';
                  confidence: number;
                  policySource?: string;
                  reason?: string;
                  message: string;
                }> = [];

                targetExpectations.forEach((expectation, key) => {
                  const observed = observedByTarget.get(key);
                  const [host, portRaw] = key.split(':');
                  const port = Number(portRaw || '0');
                  const isReachable = observed?.reachable === true;
                  let verdict: 'pass' | 'fail' | 'unknown' | 'conflict' = 'unknown';
                  if (expectation.conflict) {
                    verdict = 'conflict';
                  } else if (!observed) {
                    verdict = 'unknown';
                  } else if (expectation.expected === 'allow') {
                    verdict = isReachable ? 'pass' : 'fail';
                  } else if (expectation.expected === 'block') {
                    verdict = isReachable ? 'fail' : 'pass';
                  }

                  const message =
                    verdict === 'conflict'
                      ? `Policy conflict for ${expectation.deviceName}: intent and inferred policy disagree.`
                      : verdict === 'unknown'
                      ? `No reliable evidence for ${expectation.deviceName}.`
                      : verdict === 'pass'
                      ? `Expected ${expectation.expected} confirmed for ${expectation.deviceName}.`
                      : `Expected ${expectation.expected}, observed ${isReachable ? 'reachable' : 'blocked'} for ${expectation.deviceName}.`;
                  analyses.push({
                    verdict,
                    network: expectation.network,
                    deviceName: expectation.deviceName,
                    host,
                    port,
                    reachable: isReachable,
                    expected: expectation.expected,
                    confidence: expectation.confidence,
                    policySource: expectation.policySource,
                    reason: expectation.reason,
                    message,
                  });
                });

                const passCount = analyses.filter(a => a.verdict === 'pass').length;
                const failCount = analyses.filter(a => a.verdict === 'fail').length;
                const unknownCount = analyses.filter(a => a.verdict === 'unknown').length;
                const conflictCount = analyses.filter(a => a.verdict === 'conflict').length;
                const securityIssues = analyses.filter(a => a.verdict === 'fail' && a.expected === 'block');

                return (
                  <div className="space-y-4">
                    {/* Summary */}
                    <div className="flex gap-4">
                      <div className={cn(
                        "flex-1 p-4 rounded-lg border",
                        failCount === 0
                          ? (unknownCount > 0 || conflictCount > 0
                              ? "bg-amber-50 border-amber-200 dark:bg-amber-950/20 dark:border-amber-800"
                              : "bg-green-50 border-green-200 dark:bg-green-950/20 dark:border-green-800")
                          : "bg-red-50 border-red-200 dark:bg-red-950/20 dark:border-red-800"
                      )}>
                        <div className="flex items-center gap-2">
                          {failCount === 0 ? (
                            unknownCount > 0 || conflictCount > 0 ? (
                              <AlertCircle className="h-6 w-6 text-amber-600" />
                            ) : (
                              <CheckCircle className="h-6 w-6 text-green-600" />
                            )
                          ) : (
                            <XCircle className="h-6 w-6 text-red-600" />
                          )}
                          <div>
                            <div className="font-bold text-lg">
                              {failCount === 0
                                ? (unknownCount > 0 || conflictCount > 0 ? 'Validation Incomplete' : 'All Tests Passed')
                                : `${failCount} Issue${failCount > 1 ? 's' : ''} Found`}
                            </div>
                            <div className="text-sm text-muted-foreground">
                              {passCount} passed, {failCount} failed, {unknownCount} unknown, {conflictCount} conflict of {analyses.length} checks
                            </div>
                          </div>
                        </div>
                      </div>
                    </div>

                    {/* Security Issues (if any) */}
                    {securityIssues.length > 0 && (
                      <div className="space-y-2">
                        <h4 className="font-medium text-red-600 flex items-center gap-2">
                          <AlertCircle className="h-4 w-4" />
                          Security Issues
                        </h4>
                        {securityIssues.map((issue, i) => (
                          <div key={i} className="p-3 rounded-lg bg-red-50 border border-red-200 dark:bg-red-950/30 dark:border-red-800">
                            <div className="font-medium text-red-700 dark:text-red-400">
                              Can reach "{issue.deviceName}" on {issue.network}
                            </div>
                            <div className="text-sm text-red-600 dark:text-red-300">
                              Connected to {issue.host}{issue.port ? `:${issue.port}` : ''} - expected blocked.
                            </div>
                            <div className="text-xs text-muted-foreground mt-1">
                              Fix: Add a firewall rule to block traffic from this device's network to {issue.network}
                            </div>
                          </div>
                        ))}
                      </div>
                    )}

                    {/* All Results */}
                    <div className="space-y-2">
                      <h4 className="font-medium text-sm text-muted-foreground uppercase tracking-wide">
                        Isolation Test Results
                      </h4>
                      <div className="space-y-1">
                        {analyses.map((a, i) => (
                          <div key={i} className={cn(
                            "flex items-center gap-3 p-2 rounded text-sm",
                            a.verdict === 'pass'
                              ? "bg-green-50 dark:bg-green-950/20"
                              : a.verdict === 'fail'
                              ? "bg-red-50 dark:bg-red-950/20"
                              : "bg-amber-50 dark:bg-amber-950/20"
                          )}>
                            {a.verdict === 'pass' ? (
                              <CheckCircle className="h-4 w-4 text-green-600 flex-shrink-0" />
                            ) : a.verdict === 'fail' ? (
                              <XCircle className="h-4 w-4 text-red-600 flex-shrink-0" />
                            ) : (
                              <AlertCircle className="h-4 w-4 text-amber-600 flex-shrink-0" />
                            )}
                            <div className="flex-1 min-w-0">
                              <div className="font-medium truncate">{a.deviceName}</div>
                              <div className="text-xs text-muted-foreground">
                                {a.network} • {a.host}{a.port ? `:${a.port}` : ''} • expected {a.expected}
                              </div>
                              <div className="text-[11px] text-muted-foreground/80">
                                {a.policySource || 'unknown source'} • confidence {(a.confidence * 100).toFixed(0)}%
                              </div>
                            </div>
                            <Badge
                              variant={a.verdict === 'pass' ? 'default' : a.verdict === 'fail' ? 'destructive' : 'secondary'}
                              className="text-xs flex-shrink-0"
                            >
                              {a.verdict.toUpperCase()}
                            </Badge>
                            <span className={cn(
                              "text-xs flex-shrink-0",
                              a.reachable ? "text-orange-600" : "text-green-600"
                            )}>
                              {a.reachable ? 'reachable' : 'blocked'}
                            </span>
                          </div>
                        ))}
                      </div>
                    </div>

                    {/* Device Network Info */}
                    {metadata.deviceNetwork && (
                      <div className="text-sm text-muted-foreground">
                        Test device is on: <span className="font-medium">{metadata.deviceNetwork}</span>
                      </div>
                    )}
                  </div>
                );
              })()}

              {/* Mesh test display */}
              {selectedTest.testType === 'device_mesh' && (() => {
                const raw = selectedTest.resultsJson as MeshResultsJson;
                const matrix = raw?.matrix || [];
                const summary = raw?.summary || {};
                const meshDevices = raw?.meshDevices || [];

                // Get unique devices
                const deviceNames = [...new Set(meshDevices.map((d) => d.name))];

                if (matrix.length === 0) {
                  return (
                    <div className="text-center py-4 text-muted-foreground">
                      {selectedTest.status === 'RUNNING'
                        ? 'Mesh test in progress...'
                        : 'No results available yet'}
                    </div>
                  );
                }

                return (
                  <div className="space-y-4">
                    {/* Summary */}
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                      <div className="p-3 rounded-lg bg-muted/50 border border-border text-center">
                        <div className="text-2xl font-bold">{summary.totalPaths || 0}</div>
                        <div className="text-xs text-muted-foreground">Total Paths</div>
                      </div>
                      <div className="p-3 rounded-lg bg-green-500/10 border border-green-500/30 text-center">
                        <div className="text-2xl font-bold text-green-500">{summary.successfulPaths || 0}</div>
                        <div className="text-xs text-muted-foreground">Connected</div>
                      </div>
                      <div className="p-3 rounded-lg bg-red-500/10 border border-red-500/30 text-center">
                        <div className="text-2xl font-bold text-red-500">{summary.failedPaths || 0}</div>
                        <div className="text-xs text-muted-foreground">Blocked</div>
                      </div>
                      <div className="p-3 rounded-lg bg-orange-500/10 border border-orange-500/30 text-center">
                        <div className="text-2xl font-bold text-orange-500">{summary.crossNetworkSuccesses || 0}/{summary.crossNetworkPaths || 0}</div>
                        <div className="text-xs text-muted-foreground">Cross-Network</div>
                      </div>
                    </div>

                    {/* Connectivity Matrix */}
                    <div>
                      <h4 className="font-medium text-sm text-muted-foreground uppercase tracking-wide mb-3">
                        Connectivity Matrix
                      </h4>
                      <div className="space-y-2">
                        {matrix.map((path, i) => {
                          const success = path.pingSuccess || path.tcpSuccess;
                          const isCrossNetwork = path.source.network !== path.target.network;

                          return (
                            <div
                              key={i}
                              className={cn(
                                'flex items-center gap-3 p-3 rounded-lg border',
                                success
                                  ? 'bg-green-50 border-green-200 dark:bg-green-950/20 dark:border-green-800'
                                  : 'bg-red-50 border-red-200 dark:bg-red-950/20 dark:border-red-800'
                              )}
                            >
                              {/* Source */}
                              <div className="flex-1 min-w-0">
                                <div className="font-medium text-sm truncate">{path.source.name}</div>
                                <div className="text-xs text-muted-foreground">{path.source.network || 'Unknown'}</div>
                              </div>

                              {/* Arrow */}
                              <ArrowRight className={cn(
                                'h-5 w-5 flex-shrink-0',
                                success ? 'text-green-500' : 'text-red-500'
                              )} />

                              {/* Target */}
                              <div className="flex-1 min-w-0">
                                <div className="font-medium text-sm truncate">{path.target.name}</div>
                                <div className="text-xs text-muted-foreground">{path.target.network || 'Unknown'}</div>
                              </div>

                              {/* Status */}
                              <div className="flex items-center gap-2 flex-shrink-0">
                                {isCrossNetwork && (
                                  <Badge variant="outline" className="text-xs">
                                    Cross-VLAN
                                  </Badge>
                                )}
                                {success ? (
                                  <Badge variant="default" className="bg-green-500">
                                    <CheckCircle className="h-3 w-3 mr-1" />
                                    Connected
                                    {path.pingLatency && ` (${path.pingLatency}ms)`}
                                  </Badge>
                                ) : (
                                  <Badge variant="destructive">
                                    <XCircle className="h-3 w-3 mr-1" />
                                    Blocked
                                  </Badge>
                                )}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>

                    {/* Devices summary */}
                    <div className="text-sm text-muted-foreground">
                      Tested {deviceNames.length} devices: {deviceNames.join(', ')}
                    </div>
                  </div>
                );
              })()}

              {/* Standard display for other tests */}
              {selectedTest.testType !== 'topology_validation' && selectedTest.testType !== 'device_mesh' && (
                <>
                  <h4 className="font-medium text-sm text-muted-foreground uppercase tracking-wide">
                    Command Results
                  </h4>
                  <div className="space-y-3">
                    {(() => {
                      // resultsJson can be either:
                      // 1. { results: [...] } - nested structure from command executor
                      // 2. Direct array [...] - some older formats
                      type ResultItem = { op: string; success: boolean; data?: Record<string, unknown>; error?: string };
                      let results: ResultItem[];

                      const raw = selectedTest.resultsJson as ResultItem[] | { results?: ResultItem[] };
                      if (Array.isArray(raw)) {
                        results = raw;
                      } else if (raw && Array.isArray(raw.results)) {
                        results = raw.results;
                      } else {
                        return <p className="text-sm text-muted-foreground">No results data</p>;
                      }

                      return results.map((result, index) => (
                        <div
                          key={index}
                          className={`p-3 rounded-lg border ${
                            result.success ? 'bg-green-50 border-green-200 dark:bg-green-950/20 dark:border-green-900' : 'bg-red-50 border-red-200 dark:bg-red-950/20 dark:border-red-900'
                          }`}
                        >
                          <div className="flex items-center gap-2 mb-2">
                            {getOpIcon(result.op)}
                            <span className="font-medium text-sm">{result.op}</span>
                            {result.success ? (
                              <CheckCircle className="h-4 w-4 text-green-600 ml-auto" />
                            ) : (
                              <XCircle className="h-4 w-4 text-red-600 ml-auto" />
                            )}
                          </div>
                          {result.success && result.data && formatResultData(result.op, result.data, getDeviceLabel)}
                          {!result.success && result.error && (
                            <p className="text-sm text-red-600">{result.error}</p>
                          )}
                        </div>
                      ));
                    })()}
                  </div>
                </>
              )}
            </div>
          )}

          {!selectedTest?.resultsJson && selectedTest?.status === 'COMPLETED' && (
            <p className="text-sm text-muted-foreground">No results data available for this test.</p>
          )}

          {selectedTest?.errorMessage && (
            <div className="mt-4 p-3 rounded-lg bg-red-50 border border-red-200 dark:bg-red-950/20 dark:border-red-900">
              <p className="text-sm text-red-600">{selectedTest.errorMessage}</p>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Network,
  Cpu,
  AlertTriangle,
  Play,
  Settings,
  ChevronDown,
  ChevronUp,
  Wifi,
  ShieldOff,
} from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { cn } from '@/lib/utils';
import { VLANValidationResults } from './VLANValidationResults';
import api from '@/api/client';
import { useToast } from '@/hooks/useToast';

interface TestDeviceInfo {
  id: string;
  deviceId: string;
  name: string;
  ipAddress: string | null;
  status: string;
}

interface DeviceAccessRule {
  ruleName: string;
  sourceNetwork: string;
  targetDevice: string;
  targetIp: string;
  ports: number[];
  action: 'allow' | 'deny';
}

interface VLANValidation {
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
}

interface VLANInfo {
  networkId: string;
  name: string;
  vlanId: number | null;
  subnet: string | null;
  ssids: string[];
  testDevices: TestDeviceInfo[];
  hasCoverage: boolean;
  hasHostValidation: boolean;
  hostValidationDevice: TestDeviceInfo | null;
  intentCategory: string | null;
  validation: VLANValidation | null;
  accessRules?: DeviceAccessRule[];
  isCaptivePortal?: boolean;
}

interface VLANCardProps {
  vlan: VLANInfo;
  onSetupDevice?: () => void;
}

function getStatusColor(status: string) {
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
}

function getCategoryColor(category: string | null) {
  switch (category?.toLowerCase()) {
    case 'iot':
      return 'text-cyan-400 border-cyan-500/30 bg-cyan-500/10';
    case 'work':
      return 'text-blue-400 border-blue-500/30 bg-blue-500/10';
    case 'guest':
      return 'text-purple-400 border-purple-500/30 bg-purple-500/10';
    case 'trusted':
      return 'text-green-400 border-green-500/30 bg-green-500/10';
    case 'nas':
      return 'text-orange-400 border-orange-500/30 bg-orange-500/10';
    case 'server':
      return 'text-red-400 border-red-500/30 bg-red-500/10';
    default:
      return 'text-gray-400 border-gray-500/30 bg-gray-500/10';
  }
}

export function VLANCard({ vlan, onSetupDevice }: VLANCardProps) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [isExpanded, setIsExpanded] = useState(false);

  const onlineDevices = vlan.testDevices.filter((d) => d.status === 'ONLINE');
  const hasOnlineDevice = onlineDevices.length > 0;
  const hasOnlineDeviceWithIP = onlineDevices.some((d) => d.ipAddress);
  const hostValidationDevice = vlan.hostValidationDevice;
  const hasHostRunner =
    Boolean(hostValidationDevice?.ipAddress) && hostValidationDevice?.status === 'ONLINE';

  // Captive portal networks can't be tested by ESP32 devices
  const isCaptivePortal = vlan.isCaptivePortal;

  const runTestMutation = useMutation({
    mutationFn: async () => {
      const candidates: TestDeviceInfo[] = [
        ...onlineDevices,
        ...(onlineDevices.length === 0 && hostValidationDevice ? [hostValidationDevice] : []),
      ];

      let sawBusyDevice = false;
      for (const candidate of candidates) {
        const response = await api.post('/tests/start', {
          deviceId: candidate.id,
          testType: 'topology_validation',
        });
        if (response.success) {
          return response;
        }

        if (response.error?.code === 'TEST_IN_PROGRESS') {
          sawBusyDevice = true;
          continue;
        }

        throw new Error(response.error?.message || 'Failed to start test');
      }

      if (sawBusyDevice) {
        throw new Error('All available devices for this VLAN are already running tests. Try again in a minute.');
      }

      throw new Error('No available test device for this VLAN');
    },
    onSuccess: () => {
      toast({ title: 'Validation test started' });
      queryClient.invalidateQueries({ queryKey: ['vlan-coverage'] });
      queryClient.invalidateQueries({ queryKey: ['devices'] });
    },
    onError: (error: Error) => {
      toast({ variant: 'destructive', title: 'Error', description: error.message });
    },
  });

  const handleRunTests = () => {
    runTestMutation.mutate();
  };

  return (
    <Card
      className={cn('relative', {
        'border-green-500 border-2': hasOnlineDeviceWithIP && !isCaptivePortal,
        'border-blue-500/60 border-2': !hasOnlineDeviceWithIP && Boolean(hasHostRunner) && !isCaptivePortal,
        'border-yellow-500/50': !vlan.hasCoverage && !hasOnlineDeviceWithIP && !hasHostRunner && !isCaptivePortal,
        'opacity-60 border-gray-500/30': isCaptivePortal,
      })}
    >
      <CardHeader className="pb-2">
        <div className="flex items-start justify-between gap-2">
          <div className="flex items-center gap-2 min-w-0 flex-1">
            <Network className="h-5 w-5 text-muted-foreground flex-shrink-0" />
            <div className="min-w-0">
              <CardTitle className="text-base truncate flex items-center gap-2">
                {vlan.name}
                {vlan.vlanId !== null && (
                  <span className="text-sm font-normal text-muted-foreground">
                    (VLAN {vlan.vlanId})
                  </span>
                )}
              </CardTitle>
              {vlan.subnet && (
                <p className="text-xs text-muted-foreground font-mono">
                  {vlan.subnet}
                </p>
              )}
            </div>
          </div>
          {vlan.intentCategory && (
            <Badge variant="outline" className={cn('text-xs flex-shrink-0', getCategoryColor(vlan.intentCategory))}>
              {vlan.intentCategory}
            </Badge>
          )}
        </div>
        {/* Always render SSIDs row with fixed height to keep cards aligned */}
        <div className="flex flex-wrap gap-1 mt-2 min-h-[22px]">
          {vlan.ssids.map((ssid) => (
            <Badge key={ssid} variant="secondary" className="text-xs">
              <Wifi className="h-3 w-3 mr-1" />
              {ssid}
            </Badge>
          ))}
        </div>
      </CardHeader>

      <CardContent className="space-y-3">
        {/* Captive Portal Notice */}
        {isCaptivePortal ? (
          <div className="p-4 rounded-lg border border-dashed border-gray-500/50 bg-gray-500/5 text-center">
            <ShieldOff className="h-6 w-6 mx-auto mb-2 text-gray-400" />
            <p className="text-sm font-medium text-gray-400">Captive Portal Network</p>
            <p className="text-xs text-muted-foreground mt-1">
              ESP32 devices cannot authenticate to captive portal guest networks. This VLAN cannot be tested automatically.
            </p>
          </div>
        ) : vlan.hasCoverage ? (
          /* Test Devices */
          <div className="space-y-2">
            {vlan.testDevices.map((device) => (
              <div
                key={device.id}
                className="flex items-center justify-between p-2 rounded-lg bg-muted/50"
              >
                <div className="flex items-center gap-2 min-w-0">
                  <Cpu className="h-4 w-4 text-muted-foreground flex-shrink-0" />
                  <div className="min-w-0">
                    <p className="text-sm font-medium truncate">{device.name}</p>
                    <p className="text-xs text-muted-foreground font-mono">
                      {device.ipAddress || 'No IP'}
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <span className={cn('w-2 h-2 rounded-full', getStatusColor(device.status))} />
                  <Badge
                    variant={
                      device.status === 'ONLINE'
                        ? 'success'
                        : device.status === 'TESTING'
                        ? 'default'
                        : 'secondary'
                    }
                    className="text-xs"
                  >
                    {device.status}
                  </Badge>
                </div>
              </div>
            ))}
          </div>
        ) : vlan.hasHostValidation ? (
          <div className="p-4 rounded-lg border border-dashed border-blue-500/50 bg-blue-500/5 text-center">
            <Network className="h-6 w-6 mx-auto mb-2 text-blue-400" />
            <p className="text-sm font-medium text-blue-400">Host-based validation available</p>
            <p className="text-xs text-muted-foreground mt-1">
              Using <span className="font-mono">{vlan.hostValidationDevice?.deviceId || 'server-local'}</span> on this VLAN for directional validation.
            </p>
            <p className="text-xs text-muted-foreground">
              This is partial coverage; deploy an ESP32 on this VLAN for full proof.
            </p>
          </div>
        ) : (
          <div className="p-4 rounded-lg border border-dashed border-yellow-500/50 bg-yellow-500/5 text-center">
            <AlertTriangle className="h-6 w-6 mx-auto mb-2 text-yellow-500" />
            <p className="text-sm font-medium text-yellow-500">No test device</p>
            <p className="text-xs text-muted-foreground mt-1">
              Setup a device on this VLAN for testing
            </p>
            {onSetupDevice && (
              <Button
                variant="outline"
                size="sm"
                className="mt-3 border-yellow-500/50 text-yellow-500 hover:bg-yellow-500/10"
                onClick={onSetupDevice}
              >
                <Settings className="h-4 w-4 mr-1" />
                Setup Device
              </Button>
            )}
          </div>
        )}

        {/* Validation Results - Collapsible (not shown for captive portal networks) */}
        {(vlan.hasCoverage || vlan.hasHostValidation) && !isCaptivePortal && (
          <Collapsible open={isExpanded} onOpenChange={setIsExpanded}>
            <CollapsibleTrigger asChild>
              <button className="flex items-center justify-between w-full p-2 rounded-lg hover:bg-muted/50 transition-colors text-sm">
                <span className="text-muted-foreground">Validation Results</span>
                {isExpanded ? (
                  <ChevronUp className="h-4 w-4 text-muted-foreground" />
                ) : (
                  <ChevronDown className="h-4 w-4 text-muted-foreground" />
                )}
              </button>
            </CollapsibleTrigger>
            <CollapsibleContent>
              <div className="pt-2 border-t">
                <VLANValidationResults validation={vlan.validation} />
              </div>
            </CollapsibleContent>
          </Collapsible>
        )}

        {/* Access Rules Summary (not shown for captive portal networks) */}
        {!isCaptivePortal && vlan.accessRules && vlan.accessRules.length > 0 && (
          <Collapsible>
            <CollapsibleTrigger asChild>
              <button className="flex items-center justify-between w-full p-2 rounded-lg hover:bg-muted/50 transition-colors text-sm">
                <span className="text-muted-foreground">
                  Access Rules ({vlan.accessRules.length})
                </span>
                <ChevronDown className="h-4 w-4 text-muted-foreground" />
              </button>
            </CollapsibleTrigger>
            <CollapsibleContent>
              <div className="space-y-1 pt-2 border-t">
                {vlan.accessRules.map((rule, idx) => (
                  <div
                    key={idx}
                    className="flex items-center justify-between text-xs px-2"
                  >
                    <span className="text-muted-foreground truncate">
                      {rule.targetDevice}
                    </span>
                    <Badge
                      variant={rule.action === 'allow' ? 'success' : 'destructive'}
                      className="text-xs"
                    >
                      {rule.action === 'allow' ? 'ALLOWED' : 'BLOCKED'}
                      {rule.ports.length > 0 && ` (${rule.ports.slice(0, 3).join(', ')}${rule.ports.length > 3 ? '...' : ''})`}
                    </Badge>
                  </div>
                ))}
              </div>
            </CollapsibleContent>
          </Collapsible>
        )}

        {/* Run Tests Button (not shown for captive portal networks) */}
        {(hasOnlineDevice || hasHostRunner) && !isCaptivePortal && (
          <Button
            variant="outline"
            size="sm"
            className="w-full"
            onClick={handleRunTests}
            disabled={runTestMutation.isPending}
          >
            <Play className="h-4 w-4 mr-1" />
            {runTestMutation.isPending
              ? 'Running...'
              : hasOnlineDevice
                ? 'Run Tests'
                : 'Run Host Validation'}
          </Button>
        )}
      </CardContent>
    </Card>
  );
}

import { useState, useRef, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import {
  Shield,
  CheckCircle2,
  XCircle,
  AlertCircle,
  Minus,
  Briefcase,
  Cpu,
  Users,
  Settings,
  Network,
  ArrowRight,
  Wand2,
  RefreshCw,
  ChevronRight,
  Info,
  Wrench,
  Eye,
  EyeOff,
  Search,
  ChevronDown,
  X,
  Clock,
  MessageSquare,
  AlertTriangle,
} from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { useToast } from '@/hooks/useToast';
import api from '@/api/client';
import type {
  NetworkIntentProfile,
  IntentAnalysisResult,
  IntentSettingEvaluation,
  IntentSettingStatus,
  UniFiNetwork,
  NetworkMappings,
  DeviceMappings,
  DiscoveredDevice,
  DeviceMapping,
  FindingDismissal,
  ConfigRequirement,
} from '@/types';
import { cn, filterInternalNetworks } from '@/lib/utils';

const categoryIcons = {
  work: Briefcase,
  devices: Cpu,
  guest: Users,
  security: Shield,
};

const categoryLabels = {
  work: 'Work & Business',
  devices: 'Devices',
  guest: 'Guest Access',
  security: 'Security',
};

const statusConfig: Record<IntentSettingStatus, { icon: typeof CheckCircle2; color: string; label: string }> = {
  configured: { icon: CheckCircle2, color: 'text-green-500', label: 'Configured' },
  not_configured: { icon: XCircle, color: 'text-red-500', label: 'Not Configured' },
  partial: { icon: AlertCircle, color: 'text-yellow-500', label: 'Partial' },
  not_applicable: { icon: Minus, color: 'text-muted-foreground', label: 'N/A' },
};

interface NetworkSelectProps {
  value?: string;
  networks: UniFiNetwork[];
  onValueChange: (value: string) => void;
  placeholder?: string;
  disabled?: boolean;
}

function NetworkSelect({ value, networks, onValueChange, placeholder, disabled }: NetworkSelectProps) {
  const handleChange = (newValue: string) => {
    onValueChange(newValue === '__none__' ? '' : newValue);
  };

  // Filter out WAN/Internet networks
  const internalNetworks = filterInternalNetworks(networks);

  return (
    <Select value={value || '__none__'} onValueChange={handleChange} disabled={disabled}>
      <SelectTrigger className="w-full">
        <SelectValue placeholder={placeholder || 'Select network...'} />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="__none__">Not mapped</SelectItem>
        {internalNetworks.map((network) => (
          <SelectItem key={network._id} value={network._id}>
            <div className="flex items-center gap-2">
              <span>{network.name}</span>
              {network.vlan_enabled && network.vlan && (
                <Badge variant="secondary" className="text-xs">
                  VLAN {network.vlan}
                </Badge>
              )}
            </div>
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

interface DeviceSelectProps {
  value?: DeviceMapping;
  devices: DiscoveredDevice[];
  onValueChange: (device: DeviceMapping | undefined) => void;
  placeholder?: string;
}

function DeviceSelect({ value, devices, onValueChange, placeholder }: DeviceSelectProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [search, setSearch] = useState('');
  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Close dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // Focus input when dropdown opens
  useEffect(() => {
    if (isOpen && inputRef.current) {
      inputRef.current.focus();
    }
  }, [isOpen]);

  const handleSelect = (device: DiscoveredDevice | null) => {
    if (device === null) {
      onValueChange(undefined);
    } else {
      onValueChange({
        mac: device.mac,
        ip: device.ip,
        name: device.name || device.hostname,
        networkId: device.networkId,
      });
    }
    setIsOpen(false);
    setSearch('');
  };

  // Filter devices based on search
  const filteredDevices = devices.filter((device) => {
    const searchLower = search.toLowerCase();
    return (
      device.name?.toLowerCase().includes(searchLower) ||
      device.hostname?.toLowerCase().includes(searchLower) ||
      device.ip?.toLowerCase().includes(searchLower) ||
      device.mac.toLowerCase().includes(searchLower)
    );
  });

  const displayValue = value
    ? value.name || value.ip || value.mac
    : placeholder || 'Select device...';

  return (
    <div ref={containerRef} className="relative w-full">
      <button
        type="button"
        onClick={() => setIsOpen(!isOpen)}
        className={cn(
          'flex h-10 w-full items-center justify-between rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background',
          'focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2',
          !value && 'text-muted-foreground'
        )}
      >
        <span className="truncate">{displayValue}</span>
        <div className="flex items-center gap-1">
          {value && (
            <X
              className="h-4 w-4 opacity-50 hover:opacity-100"
              onClick={(e) => {
                e.stopPropagation();
                handleSelect(null);
              }}
            />
          )}
          <ChevronDown className="h-4 w-4 opacity-50" />
        </div>
      </button>

      {isOpen && (
        <div className="absolute z-50 mt-1 w-full rounded-md border border-border bg-zinc-900 shadow-lg">
          {/* Search input */}
          <div className="flex items-center border-b border-border px-3 py-2">
            <Search className="h-4 w-4 text-muted-foreground mr-2" />
            <input
              ref={inputRef}
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search devices..."
              className="flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
            />
          </div>

          {/* Device list */}
          <div className="max-h-64 overflow-y-auto p-1">
            <button
              type="button"
              onClick={() => handleSelect(null)}
              className="flex w-full items-center rounded-sm px-2 py-1.5 text-sm hover:bg-zinc-800"
            >
              <span className="text-muted-foreground">Not selected</span>
            </button>

            {filteredDevices.length === 0 ? (
              <div className="px-2 py-4 text-center text-sm text-muted-foreground">
                No devices found
              </div>
            ) : (
              filteredDevices.map((device) => (
                <button
                  key={device.mac}
                  type="button"
                  onClick={() => handleSelect(device)}
                  className={cn(
                    'flex w-full flex-col items-start rounded-sm px-2 py-1.5 text-sm hover:bg-zinc-800',
                    value?.mac === device.mac && 'bg-zinc-800'
                  )}
                >
                  <span className="font-medium">
                    {device.name || device.hostname || device.mac}
                  </span>
                  <div className="flex items-center gap-2 text-xs text-muted-foreground">
                    {device.ip && <span>{device.ip}</span>}
                    {device.networkName && <span>• {device.networkName}</span>}
                    {!device.ip && !device.networkName && <span>{device.mac}</span>}
                  </div>
                </button>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}

interface SettingCardProps {
  setting: IntentSettingEvaluation;
  networks: UniFiNetwork[];
  devices: DiscoveredDevice[];
  mappings: NetworkMappings;
  deviceMappings: DeviceMappings;
  onMappingChange: (field: keyof NetworkMappings, value: string) => void;
  onDeviceMappingChange: (field: keyof DeviceMappings, device: DeviceMapping | undefined) => void;
  onDismiss?: (setting: IntentSettingEvaluation) => void;
  onReopen?: (dismissalId: string) => void;
}

function SettingCard({
  setting,
  networks,
  devices,
  mappings,
  deviceMappings,
  onMappingChange,
  onDeviceMappingChange,
  onDismiss,
  onReopen,
}: SettingCardProps) {
  const [showDetails, setShowDetails] = useState(false);
  const StatusIcon = setting.isDismissed ? EyeOff : statusConfig[setting.status].icon;

  // Determine which network mapping field this setting corresponds to
  const getNetworkMappingField = (): keyof NetworkMappings | null => {
    switch (setting.id) {
      case 'work_vlan':
        return 'workNetworkId';
      case 'iot_vlan':
        return 'iotNetworkId';
      case 'guest_network':
      case 'guest_isolation':
        return 'guestNetworkId';
      case 'server_vlan':
        return 'serverNetworkId';
      case 'trusted_network':
        return 'trustedNetworkId';
      default:
        return null;
    }
  };

  // Determine which device mapping field this setting corresponds to
  const getDeviceMappingField = (): keyof DeviceMappings | null => {
    switch (setting.id) {
      case 'nas_access':
        return 'nasDevice';
      case 'server_access':
        return 'serverDevice';
      default:
        return null;
    }
  };

  const networkMappingField = getNetworkMappingField();
  const deviceMappingField = getDeviceMappingField();
  const showNetworkSelector = networkMappingField && setting.status !== 'not_applicable';
  const showDeviceSelector = setting.requiresDeviceMapping && deviceMappingField;

  // Get detailed remediation steps based on setting type
  const getDetailedRemediation = () => {
    const steps: string[] = [];

    switch (setting.id) {
      case 'work_vlan':
        steps.push(
          '1. Log into your UniFi Controller',
          '2. Go to Settings → Networks',
          '3. Create a new network called "Work" or similar',
          '4. Enable VLAN and assign a unique VLAN ID (e.g., 20)',
          '5. Configure DHCP range if needed',
          '6. Create a separate WiFi SSID for work devices',
          '7. Map the network above to track compliance'
        );
        break;
      case 'iot_vlan':
        steps.push(
          '1. Log into your UniFi Controller',
          '2. Go to Settings → Networks',
          '3. Create a new network called "IoT" or "Smart Home"',
          '4. Enable VLAN and assign a unique VLAN ID (e.g., 30)',
          '5. Go to Settings → Firewall & Security → Firewall Rules',
          '6. Create rules to block IoT → Main network traffic',
          '7. Allow only necessary ports (e.g., DNS, NTP)',
          '8. Map the network above to track compliance'
        );
        break;
      case 'guest_network':
      case 'guest_isolation':
        steps.push(
          '1. Log into your UniFi Controller',
          '2. Go to Settings → Networks',
          '3. Create a Guest network with VLAN enabled',
          '4. Go to Settings → WiFi and create a Guest SSID',
          '5. Enable "Guest Network" option on the SSID',
          '6. Enable client isolation if available',
          '7. Consider adding bandwidth limits for guests',
          '8. Map the network above to track compliance'
        );
        break;
      case 'guest_firewall':
        steps.push(
          '1. Go to Settings → Firewall & Security → Firewall Rules',
          '2. Create a new LAN In rule',
          '3. Action: Block/Reject',
          '4. Source: Guest network/VLAN',
          '5. Destination: All internal RFC1918 networks',
          '6. This prevents guests from accessing your devices',
          '7. Optionally allow specific services (printer, Chromecast)'
        );
        break;
      case 'nas_access':
        steps.push(
          '1. First, select your NAS device from the dropdown',
          '2. Note the NAS IP address shown',
          '3. Go to Settings → Firewall & Security → Firewall Rules',
          '4. Create rules allowing access only from trusted VLANs',
          '5. Block access from Guest and IoT networks to the NAS IP',
          '6. Consider using firewall groups for easier management'
        );
        break;
      case 'intervlan_deny':
        steps.push(
          '1. Go to Settings → Firewall & Security → Firewall Rules',
          '2. Create a new LAN In rule (will be the last rule)',
          '3. Name: "Block Inter-VLAN" or similar',
          '4. Action: Block',
          '5. Source: All RFC1918 (or specific VLANs)',
          '6. Destination: All RFC1918 (or specific VLANs)',
          '7. Place this rule LAST so specific allows take precedence',
          '8. Then add ALLOW rules above for needed traffic'
        );
        break;
      case 'dns_filtering':
        steps.push(
          '1. Set up a DNS filtering solution:',
          '   - AdGuard Home (self-hosted, e.g., on Home Assistant)',
          '   - Pi-hole (self-hosted on Raspberry Pi or Docker)',
          '   - NextDNS (cloud-based, easy setup)',
          '   - Cloudflare for Families (1.1.1.3)',
          '2. In UniFi, go to Settings → Networks',
          '3. Select each network you want to filter',
          '4. Under DHCP, enable "DHCP Name Server" and enter your filter IP',
          '5. Note: You can leave some networks (like Work) on default DNS',
          '6. Optional: Block DNS (port 53) to WAN to prevent bypassing'
        );
        break;
      case 'wlan_security':
        steps.push(
          '1. Go to Settings → WiFi',
          '2. Edit each wireless network',
          '3. Change Security to WPA2 or WPA3',
          '4. Use WPA3 if all your devices support it',
          '5. Avoid WPA1, WEP, or Open networks',
          '6. Consider enabling PMF (Protected Management Frames)'
        );
        break;
      default:
        if (setting.remediation) {
          steps.push(setting.remediation);
        }
    }

    return steps;
  };

  // Border color based on status - green for configured, severity color for issues
  const getBorderColor = () => {
    if (setting.isDismissed) return 'border-gray-400';
    if (setting.status === 'configured') return 'border-green-500';
    // Use severity color for issues
    return {
      CRITICAL: 'border-red-600',
      HIGH: 'border-red-500',
      MEDIUM: 'border-yellow-500',
      LOW: 'border-blue-500',
      INFO: 'border-gray-500',
    }[setting.severity] || 'border-gray-500';
  };

  return (
    <>
      <div
        className={cn(
          "p-4 rounded-lg border border-l-4 bg-card hover:bg-accent/50 cursor-pointer transition-colors",
          setting.isDismissed && "opacity-60",
          getBorderColor()
        )}
        onClick={() => setShowDetails(true)}
      >
        <div className="flex items-start justify-between gap-4">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-1">
              <StatusIcon className={cn('h-5 w-5', setting.isDismissed ? 'text-gray-400' : statusConfig[setting.status].color)} />
              <h4 className={cn("font-medium", setting.isDismissed && "text-muted-foreground")}>{setting.name}</h4>
              {setting.required && (
                <Badge variant="outline" className="text-xs">
                  Required
                </Badge>
              )}
              {setting.isDismissed && (
                <Badge variant="outline" className="text-xs bg-gray-500/10 text-gray-400 border-gray-500/30">
                  <EyeOff className="h-3 w-3 mr-1" />
                  Dismissed
                </Badge>
              )}
            </div>
            <p className="text-sm text-muted-foreground mb-2">{setting.description}</p>

            <div className="flex flex-wrap gap-4 text-sm">
              <div>
                <span className="text-muted-foreground">Current: </span>
                <span className={setting.status === 'configured' ? 'text-green-600' : 'text-yellow-600'}>
                  {setting.currentValue || 'Not set'}
                </span>
              </div>
              {setting.expectedValue && (
                <div>
                  <span className="text-muted-foreground">Expected: </span>
                  <span>{setting.expectedValue}</span>
                </div>
              )}
            </div>

            {setting.mappedDevice && (
              <div className="mt-2 text-sm">
                <span className="text-muted-foreground">Device: </span>
                <span className="font-mono">
                  {setting.mappedDevice.name || setting.mappedDevice.ip || setting.mappedDevice.mac}
                </span>
              </div>
            )}

            {setting.isDismissed && setting.dismissalReason && (
              <div className="flex items-center gap-1 mt-2 text-xs text-gray-400">
                <MessageSquare className="h-3 w-3" />
                <span className="truncate max-w-xs">{setting.dismissalReason}</span>
              </div>
            )}
          </div>

          <div className="flex flex-col items-end gap-2">
            <div className="flex items-center gap-2">
              <Badge
                variant={
                  setting.severity === 'CRITICAL'
                    ? 'critical'
                    : setting.severity === 'HIGH'
                    ? 'high'
                    : setting.severity === 'MEDIUM'
                    ? 'medium'
                    : setting.severity === 'LOW'
                    ? 'low'
                    : 'secondary'
                }
              >
                {setting.severity}
              </Badge>
              <ChevronRight className="h-5 w-5 text-muted-foreground" />
            </div>

            {showDeviceSelector && (
              <div className="w-56" onClick={(e) => e.stopPropagation()}>
                <DeviceSelect
                  value={deviceMappings[deviceMappingField]}
                  devices={devices}
                  onValueChange={(device) => onDeviceMappingChange(deviceMappingField, device)}
                  placeholder="Select device..."
                />
              </div>
            )}

            {showNetworkSelector && !showDeviceSelector && (
              <div className="w-48" onClick={(e) => e.stopPropagation()}>
                <NetworkSelect
                  value={mappings[networkMappingField]}
                  networks={networks}
                  onValueChange={(value) => onMappingChange(networkMappingField, value)}
                  placeholder="Map network..."
                />
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Details Dialog */}
      <Dialog open={showDetails} onOpenChange={setShowDetails}>
        <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <StatusIcon className={cn('h-5 w-5', statusConfig[setting.status].color)} />
              {setting.name}
              <Badge
                variant={
                  setting.severity === 'CRITICAL'
                    ? 'critical'
                    : setting.severity === 'HIGH'
                    ? 'high'
                    : setting.severity === 'MEDIUM'
                    ? 'medium'
                    : setting.severity === 'LOW'
                    ? 'low'
                    : 'secondary'
                }
                className="ml-2"
              >
                {setting.severity}
              </Badge>
            </DialogTitle>
            <DialogDescription>{setting.description}</DialogDescription>
          </DialogHeader>

          <div className="space-y-6 mt-4">
            {/* Current Status */}
            <div className="p-4 rounded-lg bg-muted/50">
              <div className="flex items-center gap-2 mb-2">
                <Eye className="h-4 w-4 text-muted-foreground" />
                <h4 className="font-medium">Current Status</h4>
              </div>
              <div className="grid gap-2 text-sm">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Status:</span>
                  <span className={cn('font-medium', statusConfig[setting.status].color)}>
                    {statusConfig[setting.status].label}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Current Value:</span>
                  <span>{setting.currentValue || 'Not set'}</span>
                </div>
                {setting.expectedValue && (
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Expected:</span>
                    <span>{setting.expectedValue}</span>
                  </div>
                )}
                {setting.mappedNetwork && (
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Mapped Network:</span>
                    <span>
                      {setting.mappedNetwork.name}
                      {setting.mappedNetwork.hasVlan && ` (VLAN ${setting.mappedNetwork.vlan})`}
                    </span>
                  </div>
                )}
                {setting.mappedDevice && (
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Mapped Device:</span>
                    <span className="font-mono text-xs">
                      {setting.mappedDevice.name || setting.mappedDevice.ip || setting.mappedDevice.mac}
                      {setting.mappedDevice.ip && setting.mappedDevice.name && ` (${setting.mappedDevice.ip})`}
                    </span>
                  </div>
                )}
              </div>
            </div>

            {/* What This Checks */}
            <div className="p-4 rounded-lg border">
              <div className="flex items-center gap-2 mb-2">
                <Info className="h-4 w-4 text-blue-500" />
                <h4 className="font-medium">What We Check</h4>
              </div>
              <p className="text-sm text-muted-foreground">
                {setting.id === 'work_vlan' &&
                  'We verify that a dedicated network with VLAN tagging exists for work devices. This ensures work traffic is isolated from personal devices for security and compliance.'}
                {setting.id === 'iot_vlan' &&
                  'We check for a separate network for IoT/smart home devices with VLAN isolation. This protects your main network from potentially vulnerable IoT devices.'}
                {setting.id === 'guest_network' &&
                  'We look for a guest WiFi network that provides internet access to visitors without exposing your internal network.'}
                {setting.id === 'guest_isolation' &&
                  'We verify that guest network traffic cannot reach your internal devices through VLAN isolation and firewall rules.'}
                {setting.id === 'guest_firewall' &&
                  'We check for firewall rules that explicitly block guest network traffic from accessing internal RFC1918 addresses.'}
                {setting.id === 'nas_access' &&
                  'We look for firewall rules that restrict which networks can access your NAS device, protecting your data from unauthorized access.'}
                {setting.id === 'intervlan_deny' &&
                  'We check for a default-deny firewall rule that blocks all inter-VLAN traffic unless explicitly allowed.'}
                {setting.id === 'dns_filtering' &&
                  'We check if custom DNS servers are configured for ad/tracker blocking and malware protection.'}
                {setting.id === 'wlan_security' &&
                  'We verify all WiFi networks use strong encryption (WPA2 or WPA3) to prevent unauthorized access.'}
                {setting.id === 'network_segmentation' &&
                  'We check that you have multiple VLANs configured for proper network segmentation.'}
                {setting.id === 'trusted_network' &&
                  'We identify your primary trusted network for personal devices.'}
                {!['work_vlan', 'iot_vlan', 'guest_network', 'guest_isolation', 'guest_firewall', 'nas_access', 'intervlan_deny', 'dns_filtering', 'wlan_security', 'network_segmentation', 'trusted_network'].includes(setting.id) &&
                  setting.description}
              </p>
            </div>

            {/* Security Recommendation */}
            <div className="p-4 rounded-lg border border-blue-500/30 bg-blue-500/5">
              <div className="flex items-center gap-2 mb-2">
                <Shield className="h-4 w-4 text-blue-500" />
                <h4 className="font-medium">Security Recommendation</h4>
              </div>
              <p className="text-sm text-muted-foreground">
                {setting.id === 'work_vlan' &&
                  'Create a dedicated Work VLAN (e.g., VLAN 20) completely isolated from your home network. If you use a work VPN, ensure the Work VLAN has unrestricted internet access. Block all traffic between Work and other VLANs to protect corporate data.'}
                {setting.id === 'iot_vlan' &&
                  'IoT devices are frequent attack targets. Place them on an isolated VLAN (e.g., VLAN 30) with NO access to your main network. Consider blocking internet access entirely for local-only devices like sensors. Only allow specific cloud connections if needed.'}
                {setting.id === 'guest_network' &&
                  'For maximum security, consider putting guest devices on the same network as IoT devices since both are untrusted. Alternatively, create a dedicated Guest VLAN with bandwidth limits and time-based access controls.'}
                {setting.id === 'guest_isolation' &&
                  'Enable "Guest Network" mode in UniFi which automatically isolates guests from your LAN. Add explicit firewall rules blocking RFC1918 (192.168.x.x, 10.x.x.x, 172.16-31.x.x) to ensure complete isolation.'}
                {setting.id === 'guest_firewall' &&
                  'Create a "Block All" firewall rule for Guest → LAN traffic. Place this rule high in priority. Even with guest isolation enabled, explicit firewall rules provide defense in depth.'}
                {setting.id === 'nas_access' &&
                  'Only allow NAS access from your trusted/main network. Block access from Guest and IoT networks. Consider requiring VPN for remote NAS access. Use firewall groups to manage NAS access rules easily.'}
                {setting.id === 'intervlan_deny' &&
                  'Implement a default-deny policy: block all inter-VLAN traffic by default, then create specific ALLOW rules only for required traffic (e.g., main network → NAS). This follows the principle of least privilege.'}
                {setting.id === 'dns_filtering' &&
                  'Use AdGuard Home, Pi-hole, or NextDNS for DNS filtering. Apply to Home and IoT networks for ad/malware blocking. Consider NOT applying to Work network if your employer requires direct DNS access.'}
                {setting.id === 'wlan_security' &&
                  'Use WPA3 if all your devices support it, otherwise WPA2 with a strong password (16+ characters). Never use WPA or WEP. Enable PMF (Protected Management Frames) for additional security.'}
                {setting.id === 'network_segmentation' &&
                  'Aim for at least 3-4 VLANs: Trusted (personal devices), Work (if WFH), IoT (smart devices), and Guest. More segmentation = better security, but also more complexity to manage.'}
                {setting.id === 'trusted_network' &&
                  'Your trusted network should contain only devices you fully control: personal computers, phones, tablets. Keep IoT and guest devices on separate networks even if they seem trustworthy.'}
                {!['work_vlan', 'iot_vlan', 'guest_network', 'guest_isolation', 'guest_firewall', 'nas_access', 'intervlan_deny', 'dns_filtering', 'wlan_security', 'network_segmentation', 'trusted_network'].includes(setting.id) &&
                  'Follow security best practices for this configuration. When in doubt, apply the principle of least privilege - only allow what is explicitly needed.'}
              </p>
            </div>

            {/* How to Fix */}
            {setting.status !== 'configured' && setting.status !== 'not_applicable' && (
              <div className="p-4 rounded-lg border border-orange-500/30 bg-orange-500/5">
                <div className="flex items-center gap-2 mb-3">
                  <Wrench className="h-4 w-4 text-orange-500" />
                  <h4 className="font-medium">How to Fix</h4>
                </div>
                <div className="space-y-2 text-sm">
                  {getDetailedRemediation().map((step, i) => (
                    <p key={i} className={step.startsWith('   ') ? 'pl-4 text-muted-foreground' : ''}>
                      {step}
                    </p>
                  ))}
                </div>
              </div>
            )}

            {/* Mapping Controls */}
            {(showNetworkSelector || showDeviceSelector) && (
              <div className="p-4 rounded-lg border">
                <div className="flex items-center gap-2 mb-3">
                  <Network className="h-4 w-4 text-muted-foreground" />
                  <h4 className="font-medium">Map Configuration</h4>
                </div>
                <p className="text-sm text-muted-foreground mb-3">
                  Select the network or device in your UniFi configuration that corresponds to this setting.
                </p>
                {showDeviceSelector && deviceMappingField && (
                  <DeviceSelect
                    value={deviceMappings[deviceMappingField]}
                    devices={devices}
                    onValueChange={(device) => onDeviceMappingChange(deviceMappingField, device)}
                    placeholder="Select device..."
                  />
                )}
                {showNetworkSelector && !showDeviceSelector && networkMappingField && (
                  <NetworkSelect
                    value={mappings[networkMappingField]}
                    networks={networks}
                    onValueChange={(value) => onMappingChange(networkMappingField, value)}
                    placeholder="Map network..."
                  />
                )}
              </div>
            )}

            {/* Dismiss/Reopen controls */}
            {setting.status !== 'configured' && setting.status !== 'not_applicable' && (
              <div className="pt-4 border-t flex justify-end gap-2">
                {setting.isDismissed ? (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      if (setting.dismissalId && onReopen) {
                        onReopen(setting.dismissalId);
                        setShowDetails(false);
                      }
                    }}
                  >
                    <Eye className="h-4 w-4 mr-1" />
                    Reopen
                  </Button>
                ) : (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      if (onDismiss) {
                        onDismiss(setting);
                        setShowDetails(false);
                      }
                    }}
                  >
                    <EyeOff className="h-4 w-4 mr-1" />
                    Dismiss
                  </Button>
                )}
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}

export function IntentDashboardPage() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [showDismissed, setShowDismissed] = useState(false);
  const [dismissDialogOpen, setDismissDialogOpen] = useState(false);
  const [dismissingSetting, setDismissingSetting] = useState<IntentSettingEvaluation | null>(null);
  const [dismissReason, setDismissReason] = useState('');

  // Fetch intent profile
  const { data: intentData, isLoading: isLoadingIntent, error: intentError } = useQuery({
    queryKey: ['intent-profile'],
    queryFn: async () => {
      const response = await api.get<{ profile: NetworkIntentProfile | null; configured: boolean }>(
        '/intent'
      );
      if (response.success && response.data) {
        return response.data;
      }
      // Return default even on error so page doesn't break
      return { profile: null, configured: false };
    },
    staleTime: 0, // Always refetch on mount
    refetchOnMount: 'always',
  });

  // Fetch intent analysis - runs in parallel, backend handles missing config
  const { data: analysisData } = useQuery({
    queryKey: ['intent-analysis'],
    queryFn: async () => {
      const response = await api.get<IntentAnalysisResult>('/intent/analysis');
      if (response.success && response.data) {
        return response.data;
      }
      return null;
    },
    staleTime: 0,
    refetchOnMount: 'always',
    retry: false, // Don't retry if no intent/config
  });

  // Fetch available networks
  const { data: networksData } = useQuery({
    queryKey: ['intent-networks'],
    queryFn: async () => {
      const response = await api.get<{ networks: UniFiNetwork[]; hasConfig: boolean }>(
        '/intent/networks'
      );
      if (response.success && response.data) {
        return response.data;
      }
      return { networks: [], hasConfig: false };
    },
    staleTime: 0,
    refetchOnMount: 'always',
  });

  // Fetch discovered devices
  const { data: devicesData } = useQuery({
    queryKey: ['intent-devices'],
    queryFn: async () => {
      const response = await api.get<{ devices: DiscoveredDevice[]; hasConfig: boolean }>(
        '/intent/devices'
      );
      if (response.success && response.data) {
        return response.data;
      }
      return { devices: [], hasConfig: false };
    },
    staleTime: 0,
    refetchOnMount: 'always',
  });

  // Refresh mutation - syncs from UniFi (if configured) and re-analyzes
  const refreshMutation = useMutation({
    mutationFn: async () => {
      // First try to sync from UniFi if configured
      try {
        await api.post('/unifi/sync');
      } catch {
        // Sync may fail if UniFi isn't configured, that's okay
      }
      // Then fetch fresh analysis
      const response = await api.get<IntentAnalysisResult>('/intent/analysis');
      if (!response.success) {
        throw new Error(response.error?.message || 'Failed to refresh analysis');
      }
      return response.data;
    },
    onSuccess: () => {
      toast({ title: 'Analysis refreshed' });
      queryClient.invalidateQueries({ queryKey: ['intent-analysis'] });
      queryClient.invalidateQueries({ queryKey: ['intent-networks'] });
      queryClient.invalidateQueries({ queryKey: ['intent-devices'] });
    },
    onError: (error: Error) => {
      toast({ variant: 'destructive', title: 'Error', description: error.message });
    },
  });

  // Update mappings mutation (handles both network and device mappings)
  const updateMappingsMutation = useMutation({
    mutationFn: async (data: { networkMappings?: Partial<NetworkMappings>; deviceMappings?: Partial<DeviceMappings> }) => {
      const response = await api.patch<{
        profile: NetworkIntentProfile;
        analysis: IntentAnalysisResult | null;
      }>('/intent/mappings', {
        ...data.networkMappings,
        deviceMappings: data.deviceMappings,
      });
      if (!response.success) {
        throw new Error(response.error?.message || 'Failed to update mappings');
      }
      return response.data;
    },
    onSuccess: (_, variables) => {
      const msg = variables.deviceMappings ? 'Device mapping updated' : 'Network mapping updated';
      toast({ title: msg });
      queryClient.invalidateQueries({ queryKey: ['intent-profile'] });
      queryClient.invalidateQueries({ queryKey: ['intent-analysis'] });
    },
    onError: (error: Error) => {
      toast({ variant: 'destructive', title: 'Error', description: error.message });
    },
  });

  // Dismiss mutation
  const dismissMutation = useMutation({
    mutationFn: async ({
      findingType,
      findingId,
      affectedResource,
      reason,
    }: {
      findingType: 'RULE' | 'INTENT_GAP';
      findingId: string;
      affectedResource?: string;
      reason: string;
    }) => {
      const response = await api.post<{ dismissal: FindingDismissal }>('/dismissals', {
        findingType,
        findingId,
        affectedResource,
        reason,
      });
      if (!response.success) {
        throw new Error(response.error?.message || 'Failed to dismiss');
      }
      return response.data;
    },
    onSuccess: () => {
      toast({ title: 'Setting dismissed' });
      queryClient.invalidateQueries({ queryKey: ['intent-analysis'] });
      setDismissDialogOpen(false);
      setDismissingSetting(null);
      setDismissReason('');
    },
    onError: (error: Error) => {
      toast({ variant: 'destructive', title: 'Error', description: error.message });
    },
  });

  // Reopen mutation
  const reopenMutation = useMutation({
    mutationFn: async (dismissalId: string) => {
      const response = await api.post(`/dismissals/${dismissalId}/reopen`);
      if (!response.success) {
        throw new Error(response.error?.message || 'Failed to reopen');
      }
    },
    onSuccess: () => {
      toast({ title: 'Setting reopened' });
      queryClient.invalidateQueries({ queryKey: ['intent-analysis'] });
    },
    onError: (error: Error) => {
      toast({ variant: 'destructive', title: 'Error', description: error.message });
    },
  });

  const handleMappingChange = (field: keyof NetworkMappings, value: string) => {
    updateMappingsMutation.mutate({ networkMappings: { [field]: value || undefined } });
  };

  const handleDeviceMappingChange = (field: keyof DeviceMappings, device: DeviceMapping | undefined) => {
    updateMappingsMutation.mutate({ deviceMappings: { [field]: device } });
  };

  const handleDismiss = (setting: IntentSettingEvaluation) => {
    setDismissingSetting(setting);
    setDismissReason('');
    setDismissDialogOpen(true);
  };

  const handleConfirmDismiss = () => {
    if (!dismissingSetting || dismissReason.trim().length < 10) return;

    dismissMutation.mutate({
      findingType: 'INTENT_GAP',
      findingId: dismissingSetting.id,
      reason: dismissReason.trim(),
    });
  };

  const handleReopen = (dismissalId: string) => {
    reopenMutation.mutate(dismissalId);
  };

  if (isLoadingIntent) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
      </div>
    );
  }

  if (intentError) {
    return (
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl sm:text-3xl font-bold">Intent Analysis</h1>
          <p className="text-muted-foreground">View and manage your network security goals</p>
        </div>
        <Card className="border-red-500/30">
          <CardContent className="pt-6">
            <div className="text-center py-8 text-red-500">
              <Shield className="h-12 w-12 mx-auto mb-2 opacity-50" />
              <p>Error loading intent profile</p>
              <p className="text-sm text-muted-foreground mt-2">
                {intentError instanceof Error ? intentError.message : 'Unknown error'}
              </p>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (!intentData?.configured) {
    return (
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl sm:text-3xl font-bold">Intent Analysis</h1>
          <p className="text-muted-foreground">View and manage your network security goals</p>
        </div>

        <Card className="border-orange-500/30 bg-gradient-to-r from-orange-500/5 to-transparent">
          <CardContent className="pt-6">
            <div className="flex flex-col items-center text-center py-8">
              <div className="p-4 rounded-full bg-orange-500/20 mb-4">
                <Wand2 className="h-8 w-8 text-orange-400" />
              </div>
              <h3 className="font-semibold text-xl mb-2">No Intent Profile Configured</h3>
              <p className="text-muted-foreground mb-6 max-w-md">
                Use the Security Wizard to define your network security goals.
                We&apos;ll then show you how your actual configuration compares.
              </p>
              <Button asChild size="lg">
                <Link to="/wizard">
                  Start Security Wizard
                  <ArrowRight className="ml-2 h-4 w-4" />
                </Link>
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  const profile = intentData.profile!;
  const analysis = analysisData;
  const networks = networksData?.networks || [];
  const devices = devicesData?.devices || [];
  const mappings = profile.networkMappings || {};
  const deviceMappings = profile.deviceMappings || {};

  // Check if any network mappings are configured
  const hasMappingsConfigured = Object.values(mappings).some(v => v);

  // Count dismissed settings
  const dismissedCount = analysis?.settings.filter(s => s.isDismissed).length || 0;

  // Filter settings based on showDismissed state
  const filteredSettings = analysis?.settings.filter(s => showDismissed || !s.isDismissed) || [];

  // Group settings by category
  const settingsByCategory = filteredSettings.reduce(
    (acc, setting) => {
      if (!acc[setting.category]) {
        acc[setting.category] = [];
      }
      acc[setting.category].push(setting);
      return acc;
    },
    {} as Record<string, IntentSettingEvaluation[]>
  );

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl sm:text-3xl font-bold">Intent Analysis</h1>
          <p className="text-muted-foreground">View and manage your network security goals</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button
            variant="outline"
            onClick={() => refreshMutation.mutate()}
            disabled={refreshMutation.isPending}
          >
            <RefreshCw className={cn('h-4 w-4 mr-2', refreshMutation.isPending && 'animate-spin')} />
            Refresh
          </Button>
          <Button variant="outline" asChild>
            <Link to="/wizard">
              <Settings className="h-4 w-4 mr-2" />
              Edit Intent
            </Link>
          </Button>
        </div>
      </div>

      {/* Timestamps */}
      {analysis && (analysis.configImportedAt || analysis.analyzedAt) && (
        <div className="flex flex-wrap gap-4 text-sm text-muted-foreground">
          {analysis.configImportedAt && (
            <div className="flex items-center gap-1.5">
              <Clock className="h-4 w-4" />
              <span>Config loaded: {new Date(analysis.configImportedAt).toLocaleString()}</span>
              {analysis.configSiteName && (
                <Badge variant="secondary" className="ml-1">{analysis.configSiteName}</Badge>
              )}
            </div>
          )}
          {analysis.analyzedAt && (
            <div className="flex items-center gap-1.5">
              <Shield className="h-4 w-4" />
              <span>Last analyzed: {new Date(analysis.analyzedAt).toLocaleString()}</span>
            </div>
          )}
        </div>
      )}

      {/* Summary Card */}
      {analysis && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-lg flex items-center gap-2">
              <Shield className="h-5 w-5 text-orange-400" />
              Compliance Overview
            </CardTitle>
            <CardDescription>
              How well your configuration matches your security goals
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid gap-6 md:grid-cols-2">
              <div className="flex items-center gap-4">
                <div
                  className={cn(
                    'text-5xl font-bold',
                    analysis.score >= 80
                      ? 'text-green-500'
                      : analysis.score >= 60
                      ? 'text-yellow-500'
                      : analysis.score >= 40
                      ? 'text-orange-500'
                      : 'text-red-500'
                  )}
                >
                  {analysis.score}%
                </div>
                <div className="flex-1">
                  <Progress value={analysis.score} className="h-3 mb-2" />
                  <p className="text-sm text-muted-foreground">
                    {analysis.compliant ? 'All requirements met' : `${analysis.gaps.length} issue(s) to address`}
                  </p>
                </div>
              </div>

              <div className="grid grid-cols-4 gap-4 text-center">
                <div className="p-2 rounded-lg bg-green-500/10">
                  <div className="text-2xl font-bold text-green-500">{analysis.summary.configured}</div>
                  <div className="text-xs text-muted-foreground">Configured</div>
                </div>
                <div className="p-2 rounded-lg bg-yellow-500/10">
                  <div className="text-2xl font-bold text-yellow-500">{analysis.summary.partial}</div>
                  <div className="text-xs text-muted-foreground">Partial</div>
                </div>
                <div className="p-2 rounded-lg bg-red-500/10">
                  <div className="text-2xl font-bold text-red-500">{analysis.summary.notConfigured}</div>
                  <div className="text-xs text-muted-foreground">Missing</div>
                </div>
                <div className="p-2 rounded-lg bg-muted">
                  <div className="text-2xl font-bold text-muted-foreground">{analysis.summary.notApplicable}</div>
                  <div className="text-xs text-muted-foreground">N/A</div>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Configuration Requirements Banner */}
      {analysis?.configRequirements && analysis.configRequirements.length > 0 && (
        <Card className="border-amber-500/30 bg-gradient-to-r from-amber-500/5 to-transparent">
          <CardContent className="pt-6">
            <div className="flex items-start gap-4">
              <div className="p-3 rounded-lg bg-amber-500/20">
                <AlertTriangle className="h-6 w-6 text-amber-400" />
              </div>
              <div className="flex-1">
                <h3 className="font-semibold text-lg">Network Mappings Needed</h3>
                <p className="text-sm text-muted-foreground mt-1">
                  {analysis.configRequirements.length} setting{analysis.configRequirements.length !== 1 ? 's need' : ' needs'} a network mapped before we can evaluate {analysis.configRequirements.length !== 1 ? 'them' : 'it'}. Use the dropdown selectors on the settings below to assign your UniFi networks.
                </p>
                <ul className="mt-2 space-y-1">
                  {analysis.configRequirements.map((req: ConfigRequirement) => (
                    <li key={req.id} className="text-sm text-muted-foreground flex items-center gap-2">
                      <span className="h-1.5 w-1.5 rounded-full bg-amber-400 flex-shrink-0" />
                      {req.message}
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Network Mappings Help - only show when no mappings at all and no configRequirements already showing */}
      {networks.length > 0 && !hasMappingsConfigured && !(analysis?.configRequirements && analysis.configRequirements.length > 0) && (
        <Card className="bg-muted/30">
          <CardContent className="pt-6">
            <div className="flex items-start gap-3">
              <Network className="h-5 w-5 text-orange-400 mt-0.5" />
              <div>
                <h4 className="font-medium">Network Mappings</h4>
                <p className="text-sm text-muted-foreground">
                  Use the dropdown selectors on each setting to map your UniFi networks to your
                  intended purposes. This helps us accurately evaluate your configuration.
                </p>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Your Intent Profile Summary - always show */}
      {!analysis && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Wand2 className="h-5 w-5 text-orange-400" />
              Your Security Goals
            </CardTitle>
            <CardDescription>
              What you configured in the Security Wizard
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid gap-4 md:grid-cols-2">
              <div className="space-y-2">
                <h4 className="font-medium flex items-center gap-2">
                  <Briefcase className="h-4 w-4" /> Work & Business
                </h4>
                <ul className="text-sm text-muted-foreground space-y-1 pl-6">
                  <li>{profile.workFromHome ? '✓ Work from home' : '✗ No work from home'}</li>
                  {profile.workFromHome && (
                    <li>{profile.workDeviceIsolation ? '✓ Work device isolation' : '✗ No work isolation'}</li>
                  )}
                  {profile.homeServer && <li>✓ Home server</li>}
                </ul>
              </div>
              <div className="space-y-2">
                <h4 className="font-medium flex items-center gap-2">
                  <Cpu className="h-4 w-4" /> Devices
                </h4>
                <ul className="text-sm text-muted-foreground space-y-1 pl-6">
                  {profile.hasIoT ? (
                    <>
                      <li>✓ IoT devices</li>
                      <li>{profile.iotIsolation ? '✓ IoT isolation' : '✗ No IoT isolation'}</li>
                    </>
                  ) : (
                    <li>✗ No IoT devices</li>
                  )}
                  {profile.hasNAS && <li>✓ NAS storage</li>}
                  {profile.hasGaming && <li>✓ Gaming devices</li>}
                </ul>
              </div>
              <div className="space-y-2">
                <h4 className="font-medium flex items-center gap-2">
                  <Users className="h-4 w-4" /> Guest Access
                </h4>
                <ul className="text-sm text-muted-foreground space-y-1 pl-6">
                  {profile.guestNetwork ? (
                    <>
                      <li>✓ Guest network</li>
                      <li>{profile.guestIsolation ? '✓ Guest isolation' : '✗ No guest isolation'}</li>
                    </>
                  ) : (
                    <li>✗ No guest network</li>
                  )}
                </ul>
              </div>
              <div className="space-y-2">
                <h4 className="font-medium flex items-center gap-2">
                  <Shield className="h-4 w-4" /> Security
                </h4>
                <ul className="text-sm text-muted-foreground space-y-1 pl-6">
                  <li>Security level: {profile.securityLevel}</li>
                  <li>Inter-VLAN: {profile.interVlanDefault}</li>
                  {profile.dnsFiltering && <li>✓ DNS filtering</li>}
                  {profile.malwareBlocking && <li>✓ Malware blocking</li>}
                </ul>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Import Config Prompt */}
      {!analysis && (
        <Card className="border-orange-500/30 bg-gradient-to-r from-orange-500/5 to-transparent">
          <CardContent className="pt-6">
            <div className="flex items-start gap-4">
              <div className="p-3 rounded-lg bg-orange-500/20">
                <Shield className="h-6 w-6 text-orange-400" />
              </div>
              <div className="flex-1">
                <h3 className="font-semibold text-lg">Import Your UniFi Configuration</h3>
                <p className="text-sm text-muted-foreground mt-1">
                  To see how your actual network compares to your goals, import your UniFi configuration.
                  We&apos;ll analyze it and show you what matches and what needs attention.
                </p>
                <Button asChild className="mt-4">
                  <Link to="/config">
                    Import Configuration
                    <ArrowRight className="ml-2 h-4 w-4" />
                  </Link>
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Dismiss Dialog */}
      <Dialog open={dismissDialogOpen} onOpenChange={setDismissDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Dismiss Setting</DialogTitle>
            <DialogDescription>
              Dismissing "{dismissingSetting?.name}"
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <label className="text-sm font-medium">
                Reason for dismissal <span className="text-red-500">*</span>
              </label>
              <Textarea
                placeholder="Explain why this setting is being dismissed (min 10 characters)..."
                value={dismissReason}
                onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) => setDismissReason(e.target.value)}
                className="mt-1"
                rows={3}
              />
              <p className="text-xs text-muted-foreground mt-1">
                {dismissReason.trim().length}/10 characters minimum
              </p>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDismissDialogOpen(false)}>
              Cancel
            </Button>
            <Button
              onClick={handleConfirmDismiss}
              disabled={dismissReason.trim().length < 10 || dismissMutation.isPending}
            >
              {dismissMutation.isPending ? 'Dismissing...' : 'Dismiss Setting'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Show Dismissed Toggle */}
      {analysis && dismissedCount > 0 && (
        <div className="flex justify-end">
          <Button
            variant={showDismissed ? 'default' : 'outline'}
            size="sm"
            onClick={() => setShowDismissed(!showDismissed)}
            className="text-gray-400"
          >
            <EyeOff className="h-4 w-4 mr-1" />
            {showDismissed ? 'Hide' : 'Show'} Dismissed ({dismissedCount})
          </Button>
        </div>
      )}

      {/* Settings by Category - only when analysis exists */}
      {analysis && (
        Object.entries(settingsByCategory).map(([category, settings]) => {
          const CategoryIcon = categoryIcons[category as keyof typeof categoryIcons] || Shield;
          const categoryLabel = categoryLabels[category as keyof typeof categoryLabels] || category;

          if (settings.length === 0) return null;

          // Split into issues and passed
          const issues = settings.filter(s => s.status !== 'configured' && s.status !== 'not_applicable');
          const passed = settings.filter(s => s.status === 'configured');

          // Don't render category if no issues and no passed items
          if (issues.length === 0 && passed.length === 0) return null;

          return (
            <Card key={category}>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <CategoryIcon className="h-5 w-5 text-orange-400" />
                  {categoryLabel}
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                {/* Show issues first */}
                {issues.map((setting) => (
                  <SettingCard
                    key={setting.id}
                    setting={setting}
                    networks={networks}
                    devices={devices}
                    mappings={mappings}
                    deviceMappings={deviceMappings}
                    onMappingChange={handleMappingChange}
                    onDeviceMappingChange={handleDeviceMappingChange}
                    onDismiss={handleDismiss}
                    onReopen={handleReopen}
                  />
                ))}

                {/* Collapsible Checks Passed section */}
                {passed.length > 0 && (
                  <Collapsible>
                    <CollapsibleTrigger asChild>
                      <button className="flex items-center gap-2 w-full p-3 rounded-lg border border-green-500/30 bg-green-500/5 hover:bg-green-500/10 transition-colors text-left">
                        <CheckCircle2 className="h-4 w-4 text-green-500" />
                        <span className="text-sm font-medium text-green-500">
                          {passed.length} Check{passed.length !== 1 ? 's' : ''} Passed
                        </span>
                        <ChevronRight className="h-4 w-4 text-green-500 ml-auto transition-transform [[data-state=open]>&]:rotate-90" />
                      </button>
                    </CollapsibleTrigger>
                    <CollapsibleContent className="pt-3 space-y-3">
                      {passed.map((setting) => (
                        <SettingCard
                          key={setting.id}
                          setting={setting}
                          networks={networks}
                          devices={devices}
                          mappings={mappings}
                          deviceMappings={deviceMappings}
                          onMappingChange={handleMappingChange}
                          onDeviceMappingChange={handleDeviceMappingChange}
                          onDismiss={handleDismiss}
                          onReopen={handleReopen}
                        />
                      ))}
                    </CollapsibleContent>
                  </Collapsible>
                )}

              </CardContent>
            </Card>
          );
        })
      )}

      {/* Quick Actions */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Quick Actions</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex flex-wrap gap-3">
            <Button variant="outline" asChild>
              <Link to="/wizard">
                <Wand2 className="h-4 w-4 mr-2" />
                Re-run Wizard
              </Link>
            </Button>
            <Button variant="outline" asChild>
              <Link to="/config">
                <Settings className="h-4 w-4 mr-2" />
                Import Config
              </Link>
            </Button>
            <Button variant="outline" asChild>
              <Link to="/vulnerabilities">
                <Shield className="h-4 w-4 mr-2" />
                View Vulnerabilities
              </Link>
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

import { useState } from 'react';
import { Wifi, AlertCircle, CheckCircle2, Loader2, Eye, EyeOff, Lock, Usb, Cpu, ArrowRight, Signal, Radio, AlertTriangle, Network } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import type { WlanInfo } from '@/types';

export type WifiStatus = 'idle' | 'configuring' | 'connecting' | 'connected' | 'failed' | 'reconnecting';

// Extended WLAN info with VLAN coverage
interface EnhancedWlanInfo extends WlanInfo {
  networkId?: string;
  vlanId?: number;
  vlanName?: string;
  intentCategory?: string;
  isVlanCovered?: boolean;
  isCaptivePortal?: boolean;
}

interface ConfigureWifiStepProps {
  wlans: (WlanInfo | EnhancedWlanInfo)[];
  isLoadingWlans: boolean;
  wifiStatus: WifiStatus;
  wifiError: string | null;
  connectedIp: string | null;
  isDeviceConnected: boolean;
  isBootloaderMode?: boolean;
  mqttConfiguring?: boolean;
  mqttConfigured?: boolean;
  // Device's current WiFi connection info (from GET_INFO)
  deviceWifiConnected?: boolean;
  deviceWifiSsid?: string | null;
  deviceWifiIp?: string | null;
  deviceWifiRssi?: number | null;
  // VLAN coverage info
  vlanCoverageSummary?: { totalVlans: number; coveredVlans: number };
  onConfigure: (ssid: string, password: string) => void;
  onReconnect: () => Promise<boolean>;
  onConfigureMqtt?: () => void;
  onNext: () => void;
  onBack: () => void;
  onSkipToVerify?: () => void;
}

export function ConfigureWifiStep({
  wlans,
  isLoadingWlans,
  wifiStatus,
  wifiError,
  connectedIp,
  isDeviceConnected,
  isBootloaderMode,
  mqttConfiguring,
  mqttConfigured,
  deviceWifiConnected,
  deviceWifiSsid,
  deviceWifiIp,
  deviceWifiRssi,
  vlanCoverageSummary,
  onConfigure,
  onReconnect,
  onConfigureMqtt,
  onNext,
  onBack,
  onSkipToVerify,
}: ConfigureWifiStepProps) {
  const [selectedSsid, setSelectedSsid] = useState<string | null>(null);
  const [isReconnecting, setIsReconnecting] = useState(false);

  const handleReconnect = async () => {
    setIsReconnecting(true);
    await onReconnect();
    setIsReconnecting(false);
  };
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [passwordAutoFilled, setPasswordAutoFilled] = useState(false);

  const isConfiguring = wifiStatus === 'configuring' || wifiStatus === 'connecting';
  const isConnected = wifiStatus === 'connected';

  // Auto-fill password when SSID is selected and password is available from UniFi
  const handleSelectSsid = (wlan: WlanInfo) => {
    setSelectedSsid(wlan.ssid);
    if (wlan.password) {
      setPassword(wlan.password);
      setPasswordAutoFilled(true);
    } else {
      setPassword('');
      setPasswordAutoFilled(false);
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (selectedSsid && password) {
      onConfigure(selectedSsid, password);
    }
  };

  const getSecurityLabel = (security: string) => {
    const upper = security.toUpperCase();
    if (upper.includes('WPA3')) return 'WPA3';
    if (upper.includes('WPA2')) return 'WPA2';
    if (upper.includes('WPA')) return 'WPA';
    if (upper.includes('WEP')) return 'WEP';
    return 'Open';
  };

  // Check if a network is likely an IoT/device network
  const isIoTNetwork = (ssid: string) => {
    const lower = ssid.toLowerCase();
    return lower.includes('iot') ||
           lower.includes('device') ||
           lower.includes('sensor') ||
           lower.includes('management') ||
           lower.includes('mgmt') ||
           lower.includes('secure') ||
           lower.includes('internal');
  };

  // Check if a WLAN needs coverage (has VLAN info and is not covered)
  const needsCoverage = (wlan: WlanInfo | EnhancedWlanInfo): boolean => {
    const enhanced = wlan as EnhancedWlanInfo;
    return enhanced.isVlanCovered === false && enhanced.intentCategory !== undefined;
  };

  // Check if a WLAN has captive portal (can't be used by ESP32)
  const hasCaptivePortal = (wlan: WlanInfo | EnhancedWlanInfo): boolean => {
    const enhanced = wlan as EnhancedWlanInfo;
    return enhanced.isCaptivePortal === true;
  };

  // Filter out captive portal networks - ESP32 can't authenticate through them
  const usableWlans = wlans.filter((wlan) => !hasCaptivePortal(wlan));

  // Sort networks: Uncovered VLANs first, then IoT networks, then alphabetically
  const sortedWlans = [...usableWlans].sort((a, b) => {
    // Uncovered VLANs first (highest priority)
    const aUncovered = needsCoverage(a);
    const bUncovered = needsCoverage(b);
    if (aUncovered && !bUncovered) return -1;
    if (!aUncovered && bUncovered) return 1;

    // Then IoT networks
    const aIsIoT = isIoTNetwork(a.ssid);
    const bIsIoT = isIoTNetwork(b.ssid);
    if (aIsIoT && !bIsIoT) return -1;
    if (!aIsIoT && bIsIoT) return 1;

    // Guest networks last
    if (a.isGuest && !b.isGuest) return 1;
    if (!a.isGuest && b.isGuest) return -1;

    return a.ssid.localeCompare(b.ssid);
  });

  // Check if any VLANs need coverage (only from usable networks)
  const hasUncoveredVlans = usableWlans.some(needsCoverage);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Wifi className="h-5 w-5" />
          Select Device Network
        </CardTitle>
        <CardDescription>
          Choose the network this ESP32 will use to communicate with your ZeroProof server.
          For security testing devices, an IoT or management network is recommended.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        {/* Bootloader Mode Warning */}
        {isBootloaderMode && (
          <Alert variant="destructive">
            <Cpu className="h-4 w-4" />
            <AlertTitle>No Firmware Installed</AlertTitle>
            <AlertDescription>
              <p className="mb-2">
                The ESP32 is in bootloader mode and has no firmware installed.
                WiFi configuration requires firmware to be flashed first.
              </p>
              <Button size="sm" variant="outline" onClick={onBack}>
                Go Back to Flash Firmware
              </Button>
            </AlertDescription>
          </Alert>
        )}

        {/* Already Connected to WiFi */}
        {deviceWifiConnected && deviceWifiSsid && !isBootloaderMode && wifiStatus === 'idle' && (
          <Alert className="border-green-500/50 bg-green-500/10">
            <CheckCircle2 className="h-4 w-4 text-green-500" />
            <AlertTitle className="text-green-500">Already Connected to WiFi</AlertTitle>
            <AlertDescription>
              <div className="space-y-3">
                <div className="grid grid-cols-2 gap-2 text-sm">
                  <div>
                    <span className="text-muted-foreground">Network:</span>{' '}
                    <span className="font-medium">{deviceWifiSsid}</span>
                  </div>
                  <div>
                    <span className="text-muted-foreground">IP Address:</span>{' '}
                    <span className="font-mono">{deviceWifiIp || 'N/A'}</span>
                  </div>
                  {deviceWifiRssi && (
                    <div className="flex items-center gap-1">
                      <Signal className="h-3 w-3 text-muted-foreground" />
                      <span className="text-muted-foreground">Signal:</span>{' '}
                      <span className={cn(
                        'font-mono',
                        deviceWifiRssi > -50 ? 'text-green-500' :
                        deviceWifiRssi > -70 ? 'text-yellow-500' : 'text-red-500'
                      )}>
                        {deviceWifiRssi} dBm
                      </span>
                    </div>
                  )}
                  <div className="flex items-center gap-1">
                    <Radio className="h-3 w-3 text-muted-foreground" />
                    <span className="text-muted-foreground">MQTT:</span>{' '}
                    {mqttConfiguring ? (
                      <span className="flex items-center gap-1 text-yellow-500">
                        <Loader2 className="h-3 w-3 animate-spin" />
                        Configuring...
                      </span>
                    ) : mqttConfigured ? (
                      <span className="text-green-500 flex items-center gap-1">
                        <CheckCircle2 className="h-3 w-3" />
                        Configured
                      </span>
                    ) : (
                      <span className="text-yellow-500">Not configured</span>
                    )}
                  </div>
                </div>

                {/* MQTT Configuration */}
                {!mqttConfigured && !mqttConfiguring && onConfigureMqtt && (
                  <div className="pt-2 border-t border-border/30">
                    <p className="text-sm text-yellow-500 mb-2">
                      MQTT is required for the device to communicate with the server.
                    </p>
                    <Button onClick={onConfigureMqtt} size="sm" variant="outline" className="border-yellow-500/50 text-yellow-500 hover:bg-yellow-500/10">
                      <Radio className="mr-2 h-4 w-4" />
                      Configure MQTT
                    </Button>
                  </div>
                )}

                {/* Skip to Verification (only if MQTT is configured) */}
                {mqttConfigured && onSkipToVerify && (
                  <div className="pt-2">
                    <Button onClick={onSkipToVerify} size="sm">
                      <Wifi className="mr-2 h-4 w-4" />
                      Skip to Verification
                      <ArrowRight className="ml-2 h-4 w-4" />
                    </Button>
                  </div>
                )}
              </div>
            </AlertDescription>
          </Alert>
        )}

        {/* Device Connection Warning */}
        {!isDeviceConnected && !isConnected && !isBootloaderMode && (
          <Alert variant="destructive">
            <Usb className="h-4 w-4" />
            <AlertTitle>Device Disconnected</AlertTitle>
            <AlertDescription className="flex items-center justify-between">
              <span>The ESP32 device is not connected. Please reconnect to continue.</span>
              <Button
                size="sm"
                variant="outline"
                onClick={handleReconnect}
                disabled={isReconnecting}
                className="ml-4"
              >
                {isReconnecting ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Reconnecting...
                  </>
                ) : (
                  <>
                    <Usb className="mr-2 h-4 w-4" />
                    Reconnect
                  </>
                )}
              </Button>
            </AlertDescription>
          </Alert>
        )}

        {/* VLAN Coverage Info */}
        {hasUncoveredVlans && vlanCoverageSummary && (
          <Alert className="border-yellow-500/50 bg-yellow-500/10">
            <AlertTriangle className="h-4 w-4 text-yellow-500" />
            <AlertTitle className="text-yellow-500">VLANs Need Coverage</AlertTitle>
            <AlertDescription>
              <p className="text-sm">
                {vlanCoverageSummary.totalVlans - vlanCoverageSummary.coveredVlans} of{' '}
                {vlanCoverageSummary.totalVlans} VLANs don't have test devices.
                Networks marked with "Needs Test Device" are shown first.
              </p>
            </AlertDescription>
          </Alert>
        )}

        {/* Network Selection */}
        <div className="space-y-3">
          <Label>Select Network</Label>
          {isLoadingWlans ? (
            <div className="flex items-center gap-2 text-sm text-muted-foreground p-4 border rounded-lg">
              <Loader2 className="h-4 w-4 animate-spin" />
              Loading available networks...
            </div>
          ) : sortedWlans.length > 0 ? (
            <div className="grid gap-2 max-h-64 overflow-y-auto">
              {sortedWlans.map((wlan) => {
                const enhanced = wlan as EnhancedWlanInfo;
                const isRecommended = isIoTNetwork(wlan.ssid);
                const hasPassword = Boolean(wlan.password);
                const wlanNeedsCoverage = needsCoverage(wlan);
                return (
                  <button
                    key={wlan.ssid}
                    type="button"
                    onClick={() => handleSelectSsid(wlan)}
                    disabled={isConfiguring || isConnected}
                    className={cn(
                      'flex items-center justify-between p-3 rounded-lg border text-left transition-all',
                      selectedSsid === wlan.ssid
                        ? 'border-orange-500 bg-orange-500/10'
                        : wlanNeedsCoverage
                          ? 'border-yellow-500/50 bg-yellow-500/10 hover:border-yellow-500'
                          : isRecommended
                            ? 'border-green-500/30 bg-green-500/5 hover:border-green-500/50'
                            : 'border-border/50 hover:border-border hover:bg-muted/50',
                      (isConfiguring || isConnected) && 'opacity-50 cursor-not-allowed'
                    )}
                  >
                    <div className="flex items-center gap-3">
                      <Wifi className={cn('h-4 w-4',
                        wlanNeedsCoverage ? 'text-yellow-500' :
                        isRecommended ? 'text-green-500' : 'text-muted-foreground'
                      )} />
                      <div>
                        <div className="flex items-center gap-2 flex-wrap">
                          <p className="font-medium">{wlan.ssid}</p>
                          {wlanNeedsCoverage && (
                            <Badge className="text-xs bg-yellow-500/20 text-yellow-400 border-yellow-500/30">
                              <AlertTriangle className="h-3 w-3 mr-1" />
                              Needs Test Device
                            </Badge>
                          )}
                          {!wlanNeedsCoverage && isRecommended && (
                            <Badge className="text-xs bg-green-500/20 text-green-400 border-green-500/30">
                              Recommended
                            </Badge>
                          )}
                        </div>
                        <div className="flex items-center gap-2 mt-1 flex-wrap">
                          <Badge variant="outline" className="text-xs">
                            <Lock className="h-3 w-3 mr-1" />
                            {getSecurityLabel(wlan.security)}
                          </Badge>
                          {enhanced.intentCategory && (
                            <Badge variant="outline" className="text-xs">
                              <Network className="h-3 w-3 mr-1" />
                              {enhanced.intentCategory}
                            </Badge>
                          )}
                          {wlan.isGuest && (
                            <Badge variant="secondary" className="text-xs text-yellow-500">
                              Guest
                            </Badge>
                          )}
                          {hasPassword && (
                            <Badge variant="outline" className="text-xs text-blue-400 border-blue-500/30">
                              Password saved
                            </Badge>
                          )}
                        </div>
                      </div>
                    </div>
                    {selectedSsid === wlan.ssid && (
                      <CheckCircle2 className="h-5 w-5 text-orange-500" />
                    )}
                  </button>
                );
              })}
            </div>
          ) : wlans.length > 0 ? (
            <div className="p-4 border rounded-lg text-center text-muted-foreground">
              <Wifi className="h-8 w-8 mx-auto mb-2 opacity-50" />
              <p>No compatible networks available</p>
              <p className="text-xs mt-1">All available networks use captive portal authentication which ESP32 devices cannot use</p>
            </div>
          ) : (
            <div className="p-4 border rounded-lg text-center text-muted-foreground">
              <Wifi className="h-8 w-8 mx-auto mb-2 opacity-50" />
              <p>No networks found in UniFi configuration</p>
              <p className="text-xs mt-1">Import a UniFi config with WLANs to see available networks</p>
            </div>
          )}
        </div>

        {/* Password Input */}
        {selectedSsid && !isConnected && (
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label htmlFor="wifi-password">
                  Password for "{selectedSsid}"
                </Label>
                {passwordAutoFilled && (
                  <Badge variant="secondary" className="text-xs bg-green-500/20 text-green-400">
                    <CheckCircle2 className="h-3 w-3 mr-1" />
                    Auto-filled from UniFi
                  </Badge>
                )}
              </div>
              <div className="relative">
                <Input
                  id="wifi-password"
                  type={showPassword ? 'text' : 'password'}
                  value={password}
                  onChange={(e) => {
                    setPassword(e.target.value);
                    setPasswordAutoFilled(false);
                  }}
                  placeholder="Enter WiFi password"
                  disabled={isConfiguring}
                  className="pr-10"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                >
                  {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
            </div>
          </form>
        )}

        {/* Status Messages */}
        {wifiStatus === 'connecting' && (
          <Alert>
            <Loader2 className="h-4 w-4 animate-spin" />
            <AlertTitle>Connecting...</AlertTitle>
            <AlertDescription>
              The ESP32 is connecting to {selectedSsid}. This may take a moment.
            </AlertDescription>
          </Alert>
        )}

        {wifiError && (
          <Alert variant="destructive">
            <AlertCircle className="h-4 w-4" />
            <AlertTitle>Connection Failed</AlertTitle>
            <AlertDescription>
              {wifiError}
              <p className="mt-2 text-sm">Please check the password and try again.</p>
            </AlertDescription>
          </Alert>
        )}

        {isConnected && (
          <Alert className="border-green-500/50 bg-green-500/10">
            <CheckCircle2 className="h-4 w-4 text-green-500" />
            <AlertTitle className="text-green-500">Connected to WiFi</AlertTitle>
            <AlertDescription>
              <div className="mt-1 space-y-2 text-sm">
                <p>
                  <span className="text-muted-foreground">Network:</span>{' '}
                  <span className="font-medium">{selectedSsid}</span>
                </p>
                {connectedIp && (
                  <p>
                    <span className="text-muted-foreground">IP Address:</span>{' '}
                    <span className="font-mono">{connectedIp}</span>
                  </p>
                )}
                <p className="flex items-center gap-2">
                  <span className="text-muted-foreground">MQTT:</span>{' '}
                  {mqttConfiguring ? (
                    <span className="flex items-center gap-1 text-yellow-500">
                      <Loader2 className="h-3 w-3 animate-spin" />
                      Configuring...
                    </span>
                  ) : mqttConfigured ? (
                    <span className="text-green-500 flex items-center gap-1">
                      <CheckCircle2 className="h-3 w-3" />
                      Configured
                    </span>
                  ) : (
                    <span className="text-muted-foreground">Pending</span>
                  )}
                </p>
              </div>
            </AlertDescription>
          </Alert>
        )}

        {/* Action Buttons */}
        <div className="flex justify-between gap-3">
          <Button variant="outline" onClick={onBack} disabled={isConfiguring}>
            Back
          </Button>
          {isConnected ? (
            <Button onClick={onNext}>
              Continue to Verification
            </Button>
          ) : (
            <Button
              onClick={() => selectedSsid && password && onConfigure(selectedSsid, password)}
              disabled={!selectedSsid || !password || password.length < 8 || isConfiguring}
            >
              {isConfiguring ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Configuring...
                </>
              ) : (
                <>
                  <Wifi className="mr-2 h-4 w-4" />
                  Connect to WiFi
                </>
              )}
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

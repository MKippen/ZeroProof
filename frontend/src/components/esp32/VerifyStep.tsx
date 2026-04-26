import { useNavigate } from 'react-router-dom';
import { useEffect, useState } from 'react';
import { CheckCircle2, AlertCircle, Loader2, Radio, ArrowRight, Wifi, Shield, Server, ShieldCheck, ShieldAlert } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Progress } from '@/components/ui/progress';
import { Badge } from '@/components/ui/badge';
import type { ESP32VerifyResponse, ConnectivityValidationResult } from '@/types';
import api from '@/api/client';

export type VerifyStatus = 'waiting' | 'checking' | 'online' | 'timeout' | 'error';

interface VerifyStepProps {
  deviceId: string;
  deviceName: string;
  deviceMac?: string | null;
  verifyStatus: VerifyStatus;
  verifyData: ESP32VerifyResponse | null;
  verifyError: string | null;
  elapsedSeconds: number;
  timeoutSeconds: number;
  connectedSsid?: string | null;
  connectedIp?: string | null;
  mqttBrokerHost?: string;
  onRetry: () => void;
  onBack: () => void;
}

export function VerifyStep({
  deviceId,
  deviceName,
  deviceMac,
  verifyStatus,
  verifyData,
  verifyError,
  elapsedSeconds,
  timeoutSeconds,
  connectedSsid,
  connectedIp,
  mqttBrokerHost = 'your MQTT broker',
  onRetry,
  onBack,
}: VerifyStepProps) {
  const navigate = useNavigate();
  const isWaiting = verifyStatus === 'waiting' || verifyStatus === 'checking';
  const isOnline = verifyStatus === 'online';
  const isTimeout = verifyStatus === 'timeout';

  const progressPercent = Math.min((elapsedSeconds / timeoutSeconds) * 100, 100);

  // Connectivity validation state
  const [connectivityValidation, setConnectivityValidation] = useState<ConnectivityValidationResult | null>(null);
  const [isValidatingConnectivity, setIsValidatingConnectivity] = useState(false);

  // Validate connectivity when we have a device IP
  useEffect(() => {
    if (!connectedIp || isOnline) {
      return;
    }

    const validateConnectivity = async () => {
      setIsValidatingConnectivity(true);
      try {
        const response = await api.post<ConnectivityValidationResult>(
          '/esp32/validate-device-connectivity',
          { deviceIp: connectedIp, deviceMac }
        );
        if (response.success && response.data) {
          setConnectivityValidation(response.data);
        }
      } catch (error) {
        console.error('Failed to validate connectivity:', error);
      } finally {
        setIsValidatingConnectivity(false);
      }
    };

    validateConnectivity();
  }, [connectedIp, deviceMac, isOnline]);

  // Check if likely on an IoT/isolated network
  const isLikelyIoTNetwork = connectedSsid?.toLowerCase().includes('iot') ||
    connectedSsid?.toLowerCase().includes('device') ||
    connectedSsid?.toLowerCase().includes('sensor') ||
    connectedSsid?.toLowerCase().includes('guest');

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Radio className="h-5 w-5" />
          Verify Connection
        </CardTitle>
        <CardDescription>
          Waiting for the ESP32 to connect via MQTT and appear online
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        {/* Device Info */}
        <div className="rounded-lg border border-border/50 p-4 space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-sm text-muted-foreground">Device Name</span>
            <span className="font-medium">{deviceName}</span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-sm text-muted-foreground">Device ID</span>
            <span className="font-mono text-sm">{deviceId}</span>
          </div>
          {deviceMac && (
            <div className="flex items-center justify-between">
              <span className="text-sm text-muted-foreground">MAC Address</span>
              <span className="font-mono text-sm">{deviceMac}</span>
            </div>
          )}
          {connectedSsid && (
            <div className="flex items-center justify-between">
              <span className="text-sm text-muted-foreground flex items-center gap-1">
                <Wifi className="h-3 w-3" /> WiFi Network
              </span>
              <span className="font-medium">{connectedSsid}</span>
            </div>
          )}
          {connectedIp && (
            <div className="flex items-center justify-between">
              <span className="text-sm text-muted-foreground">Device IP</span>
              <span className="font-mono text-sm">{connectedIp}</span>
            </div>
          )}
        </div>

        {/* Connectivity Validation - Loading */}
        {isWaiting && connectedIp && isValidatingConnectivity && (
          <Alert className="border-blue-500/50 bg-blue-500/10">
            <Loader2 className="h-4 w-4 animate-spin text-blue-500" />
            <AlertTitle className="text-blue-500">Checking Network Connectivity</AlertTitle>
            <AlertDescription>
              <p className="text-sm">
                Validating firewall rules between device ({connectedIp}) and server...
              </p>
            </AlertDescription>
          </Alert>
        )}

        {/* Connectivity Validation - Allowed with device policy */}
        {isWaiting && connectivityValidation && connectivityValidation.canReachServer && connectivityValidation.hasDeviceOverride && (
          <Alert className="border-green-500/50 bg-green-500/10">
            <ShieldCheck className="h-4 w-4 text-green-500" />
            <AlertTitle className="text-green-500">Device Policy Active</AlertTitle>
            <AlertDescription>
              <div className="space-y-2">
                <p className="text-sm">
                  Your device-specific firewall policy allows this ESP32 to connect to the server.
                </p>
                {connectivityValidation.devicePolicies && connectivityValidation.devicePolicies.length > 0 && (
                  <div className="flex items-center gap-2 text-sm">
                    <span className="text-muted-foreground">Policy:</span>
                    {connectivityValidation.devicePolicies.map((p, i) => (
                      <Badge key={i} variant="outline" className="text-xs bg-green-500/10 text-green-400 border-green-500/30">
                        {p.name}
                      </Badge>
                    ))}
                  </div>
                )}
                <div className="flex items-center gap-4 text-xs">
                  <div className="flex items-center gap-1">
                    <Wifi className="h-3 w-3" />
                    <span>{connectivityValidation.sourceNetwork?.name}</span>
                    {connectivityValidation.sourceNetwork?.vlanId && (
                      <Badge variant="outline" className="text-xs px-1 py-0">
                        VLAN {connectivityValidation.sourceNetwork.vlanId}
                      </Badge>
                    )}
                  </div>
                  <span className="text-muted-foreground">→</span>
                  <div className="flex items-center gap-1">
                    <Server className="h-3 w-3" />
                    <span>{connectivityValidation.serverNetwork?.name}</span>
                    {connectivityValidation.serverNetwork?.vlanId && (
                      <Badge variant="outline" className="text-xs px-1 py-0">
                        VLAN {connectivityValidation.serverNetwork.vlanId}
                      </Badge>
                    )}
                  </div>
                </div>
              </div>
            </AlertDescription>
          </Alert>
        )}

        {/* Connectivity Validation - Allowed (same network) */}
        {isWaiting && connectivityValidation && connectivityValidation.canReachServer && connectivityValidation.blockedReason === 'same_network' && (
          <Alert className="border-green-500/50 bg-green-500/10">
            <ShieldCheck className="h-4 w-4 text-green-500" />
            <AlertTitle className="text-green-500">Same Network as Server</AlertTitle>
            <AlertDescription>
              <p className="text-sm">
                Device is on the same network ({connectivityValidation.serverNetwork?.name}) as the ZeroProof server.
              </p>
            </AlertDescription>
          </Alert>
        )}

        {/* Connectivity Validation - Allowed (cross-network) */}
        {isWaiting && connectivityValidation && connectivityValidation.canReachServer && !connectivityValidation.hasDeviceOverride && connectivityValidation.blockedReason !== 'same_network' && connectivityValidation.sourceNetwork && connectivityValidation.serverNetwork && (
          <Alert className="border-green-500/50 bg-green-500/10">
            <ShieldCheck className="h-4 w-4 text-green-500" />
            <AlertTitle className="text-green-500">Network Connectivity Verified</AlertTitle>
            <AlertDescription>
              <p className="text-sm">
                Firewall rules allow traffic from <strong>{connectivityValidation.sourceNetwork.name}</strong> to <strong>{connectivityValidation.serverNetwork.name}</strong>.
              </p>
            </AlertDescription>
          </Alert>
        )}

        {/* Connectivity Validation - Blocked */}
        {isWaiting && connectivityValidation && !connectivityValidation.canReachServer && (
          <Alert variant="destructive" className="border-red-500/50 bg-red-500/10">
            <ShieldAlert className="h-4 w-4" />
            <AlertTitle>Network Connectivity Issue</AlertTitle>
            <AlertDescription>
              <div className="space-y-2">
                <p className="text-sm">
                  Firewall rules may block this device from reaching the server.
                </p>
                {connectivityValidation.blockDetails && (
                  <p className="text-sm text-muted-foreground">
                    {connectivityValidation.blockDetails}
                  </p>
                )}
                {connectivityValidation.recommendation && (
                  <div className="mt-2 p-2 rounded bg-muted/30 border border-border/50">
                    <p className="text-xs font-medium text-orange-400 mb-1">Recommendation:</p>
                    <p className="text-xs">{connectivityValidation.recommendation}</p>
                  </div>
                )}
                <div className="flex items-center gap-4 text-xs">
                  {connectivityValidation.sourceNetwork && (
                    <div className="flex items-center gap-1">
                      <Wifi className="h-3 w-3" />
                      <span>{connectivityValidation.sourceNetwork.name}</span>
                      {connectivityValidation.sourceNetwork.vlanId && (
                        <Badge variant="outline" className="text-xs px-1 py-0">
                          VLAN {connectivityValidation.sourceNetwork.vlanId}
                        </Badge>
                      )}
                    </div>
                  )}
                  {connectivityValidation.serverNetwork && (
                    <div className="flex items-center gap-1">
                      <Server className="h-3 w-3" />
                      <span>{connectivityValidation.serverNetwork.name}</span>
                      {connectivityValidation.serverNetwork.vlanId && (
                        <Badge variant="outline" className="text-xs px-1 py-0">
                          VLAN {connectivityValidation.serverNetwork.vlanId}
                        </Badge>
                      )}
                    </div>
                  )}
                </div>
              </div>
            </AlertDescription>
          </Alert>
        )}

        {/* IoT Network Warning (fallback if no validation result) */}
        {isLikelyIoTNetwork && isWaiting && !connectivityValidation && !isValidatingConnectivity && (
          <Alert className="border-yellow-500/50 bg-yellow-500/10">
            <Shield className="h-4 w-4 text-yellow-500" />
            <AlertTitle className="text-yellow-500">IoT Network Detected</AlertTitle>
            <AlertDescription className="text-sm">
              <p className="mb-2">
                The device is connected to what appears to be an IoT/isolated network ({connectedSsid}).
                If verification times out, you may need to configure firewall rules in UniFi.
              </p>
            </AlertDescription>
          </Alert>
        )}

        {/* Waiting Status */}
        {isWaiting && (
          <div className="space-y-4">
            <div className="flex items-center gap-3">
              <div className="relative">
                <Loader2 className="h-8 w-8 animate-spin text-orange-500" />
                <div className="absolute inset-0 animate-ping">
                  <Radio className="h-8 w-8 text-orange-500/30" />
                </div>
              </div>
              <div>
                <p className="font-medium">Waiting for device connection...</p>
                <p className="text-sm text-muted-foreground">
                  The ESP32 should connect via MQTT within {timeoutSeconds} seconds
                </p>
              </div>
            </div>
            <div className="space-y-2">
              <div className="flex justify-between text-sm">
                <span>Time elapsed</span>
                <span className="font-mono">{elapsedSeconds}s / {timeoutSeconds}s</span>
              </div>
              <Progress value={progressPercent} className="h-2" />
            </div>
          </div>
        )}

        {/* Success */}
        {isOnline && verifyData && (
          <Alert className="border-green-500/50 bg-green-500/10">
            <CheckCircle2 className="h-4 w-4 text-green-500" />
            <AlertTitle className="text-green-500">Device Online!</AlertTitle>
            <AlertDescription>
              <p>Your ESP32 has successfully connected and is now online.</p>
              <div className="mt-3 grid grid-cols-2 gap-2 text-sm">
                <div>
                  <span className="text-muted-foreground">IP Address:</span>{' '}
                  <span className="font-mono">{verifyData.ipAddress || 'N/A'}</span>
                </div>
                <div>
                  <span className="text-muted-foreground">Firmware:</span>{' '}
                  <span className="font-mono">{verifyData.firmwareVersion || 'N/A'}</span>
                </div>
              </div>
            </AlertDescription>
          </Alert>
        )}

        {/* Timeout */}
        {isTimeout && (
          <div className="space-y-4">
            <Alert variant="destructive">
              <AlertCircle className="h-4 w-4" />
              <AlertTitle>Connection Timeout</AlertTitle>
              <AlertDescription>
                <p>The device did not connect to the MQTT broker within {timeoutSeconds} seconds.</p>
                {connectedIp && (
                  <p className="mt-2 text-sm">
                    The device has IP <span className="font-mono">{connectedIp}</span> on network "{connectedSsid}".
                  </p>
                )}
              </AlertDescription>
            </Alert>

            {/* Network Isolation Info */}
            <div className="rounded-lg border border-border/50 p-4 space-y-4">
              <h4 className="font-medium flex items-center gap-2">
                <Shield className="h-4 w-4 text-orange-500" />
                Network Isolation Troubleshooting
              </h4>

              <div className="space-y-3 text-sm">
                <p className="text-muted-foreground">
                  If the ESP32 is on an IoT or guest network, it may be isolated from the network where
                  the MQTT broker ({mqttBrokerHost}) is running.
                </p>

                <div className="space-y-2">
                  <p className="font-medium">To fix this in UniFi:</p>
                  <ol className="list-decimal list-inside space-y-2 text-muted-foreground">
                    <li>
                      Open UniFi Network → <strong>Settings</strong> → <strong>Traffic & Security</strong> → <strong>Traffic Rules</strong>
                    </li>
                    <li>
                      Create a new rule to <strong>Allow</strong> traffic from the IoT network to the MQTT broker
                      <ul className="list-disc list-inside ml-4 mt-1">
                        <li>Source: IoT network (or the device IP: {connectedIp || 'device IP'})</li>
                        <li>Destination: MQTT broker IP on port <strong>1883</strong> (or 8883 for TLS)</li>
                        <li>Protocol: TCP</li>
                      </ul>
                    </li>
                    <li>
                      Alternatively, move the device to a network that can reach the MQTT broker
                    </li>
                  </ol>
                </div>

                <div className="pt-2 border-t border-border/50">
                  <p className="font-medium mb-2">Other things to check:</p>
                  <ul className="list-disc list-inside space-y-1 text-muted-foreground">
                    <li>MQTT broker is running and accepting connections</li>
                    <li>Firewall on the MQTT broker host allows incoming connections</li>
                    <li>Device has correct MQTT broker address configured</li>
                    <li>Try pressing the EN/RST button on the ESP32 to restart it</li>
                  </ul>
                </div>
              </div>
            </div>

            {/* Debug Info */}
            <details className="text-sm">
              <summary className="cursor-pointer text-muted-foreground hover:text-foreground">
                Debug Information
              </summary>
              <div className="mt-2 p-3 rounded bg-muted/50 font-mono text-xs space-y-1">
                <div>Device ID: {deviceId}</div>
                <div>MAC Address: {deviceMac || 'Unknown'}</div>
                <div>WiFi Network: {connectedSsid || 'Unknown'}</div>
                <div>Device IP: {connectedIp || 'Unknown'}</div>
                <div>Expected MQTT topic: zeroproof/devices/{deviceId}/status</div>
                <div>Timeout: {timeoutSeconds}s</div>
              </div>
            </details>
          </div>
        )}

        {/* Error */}
        {verifyError && verifyStatus === 'error' && (
          <Alert variant="destructive">
            <AlertCircle className="h-4 w-4" />
            <AlertTitle>Verification Error</AlertTitle>
            <AlertDescription>{verifyError}</AlertDescription>
          </Alert>
        )}

        {/* Action Buttons */}
        <div className="flex justify-between gap-3">
          <Button variant="outline" onClick={onBack} disabled={isWaiting}>
            Back
          </Button>
          {isOnline ? (
            <Button onClick={() => navigate('/devices?tab=all-devices')}>
              Go to Devices
              <ArrowRight className="ml-2 h-4 w-4" />
            </Button>
          ) : isTimeout ? (
            <div className="flex gap-2">
              <Button variant="outline" onClick={onRetry}>
                Retry Verification
              </Button>
              <Button onClick={() => navigate('/devices?tab=all-devices')}>
                Go to Devices Anyway
              </Button>
            </div>
          ) : null}
        </div>

        {/* Success celebration */}
        {isOnline && (
          <div className="text-center pt-4 border-t border-border/50">
            <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-green-500/10 text-green-500">
              <CheckCircle2 className="h-5 w-5" />
              <span className="font-medium">Setup Complete!</span>
            </div>
            <p className="text-sm text-muted-foreground mt-2">
              Your ESP32 is ready to perform security tests on your network.
            </p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

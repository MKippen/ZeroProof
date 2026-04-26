import { useState, useEffect, useCallback, useRef } from 'react';
import { useQuery, useMutation } from '@tanstack/react-query';
import { ArrowLeft } from 'lucide-react';
import { Link } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { useToast } from '@/hooks/useToast';
import { useWebSerial } from '@/hooks/useWebSerial';
import { useESP32Flasher } from '@/hooks/useESP32Flasher';
import { StepProgress, type Step } from '@/components/esp32/StepProgress';
import { ConnectStep } from '@/components/esp32/ConnectStep';
import { FlashStep } from '@/components/esp32/FlashStep';
import { ConfigureWifiStep, type WifiStatus } from '@/components/esp32/ConfigureWifiStep';
import { VerifyStep, type VerifyStatus } from '@/components/esp32/VerifyStep';
import api from '@/api/client';
import type { FirmwareInfo, WlanInfo, ESP32VerifyResponse, MqttConfig } from '@/types';

const STEPS: Step[] = [
  { id: 1, title: 'Connect', description: 'Connect via USB' },
  { id: 2, title: 'Flash', description: 'Flash firmware' },
  { id: 3, title: 'Configure', description: 'Setup WiFi' },
  { id: 4, title: 'Verify', description: 'Confirm online' },
];

const VERIFY_TIMEOUT_SECONDS = 60;
const VERIFY_POLL_INTERVAL = 2000;

export function ESP32SetupPage() {
  const { toast } = useToast();
  const [currentStep, setCurrentStep] = useState(1);
  const [deviceName] = useState('ESP32 Device');

  // Web Serial hook
  const webSerial = useWebSerial();
  const refreshDeviceInfo = webSerial.refreshDeviceInfo;
  const webSerialStatus = webSerial.status;

  // Flasher hook
  const flasher = useESP32Flasher();

  // WiFi configuration state
  const [wifiStatus, setWifiStatus] = useState<WifiStatus>('idle');
  const [wifiError, setWifiError] = useState<string | null>(null);
  const [connectedIp, setConnectedIp] = useState<string | null>(null);
  const [connectedSsid, setConnectedSsid] = useState<string | null>(null);

  // MQTT configuration state
  const [mqttConfigured, setMqttConfigured] = useState(false);
  const [mqttConfiguring, setMqttConfiguring] = useState(false);

  // Verification state
  const [verifyStatus, setVerifyStatus] = useState<VerifyStatus>('waiting');
  const [verifyData, setVerifyData] = useState<ESP32VerifyResponse | null>(null);
  const [verifyError, setVerifyError] = useState<string | null>(null);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const verifyIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const hasShownOnlineToastRef = useRef(false);

  // Device info refresh state
  const [isRefreshingDeviceInfo, setIsRefreshingDeviceInfo] = useState(false);

  // Fetch firmware info (needed for version comparison on step 1)
  const { data: firmwareData, isLoading: isLoadingFirmware } = useQuery({
    queryKey: ['esp32-firmware-info'],
    queryFn: async () => {
      const response = await api.get<{ firmware: FirmwareInfo; available: boolean }>('/esp32/firmware/info');
      if (response.success && response.data) {
        return response.data;
      }
      throw new Error(response.error?.message || 'Failed to fetch firmware info');
    },
    enabled: currentStep <= 2, // Fetch on step 1 and 2
  });

  // Fetch available WLANs with passwords and VLAN coverage (for auto-fill)
  const { data: wlansData, isLoading: isLoadingWlans } = useQuery({
    queryKey: ['esp32-wlans-with-coverage'],
    queryFn: async () => {
      const response = await api.get<{
        wlans: WlanInfo[];
        vlanCoverageSummary?: { totalVlans: number; coveredVlans: number };
      }>('/esp32/wlans?includePassword=true&includeVlanCoverage=true');
      if (response.success && response.data) {
        return response.data;
      }
      throw new Error(response.error?.message || 'Failed to fetch WLANs');
    },
    enabled: currentStep === 3,
  });

  // Provision device mutation
  const provisionMutation = useMutation({
    mutationFn: async (data: { deviceId: string; name: string; macAddress: string }) => {
      const response = await api.post('/esp32/provision', data);
      if (!response.success) {
        throw new Error(response.error?.message || 'Failed to provision device');
      }
      return response;
    },
  });

  // Handle serial connection
  const handleConnect = useCallback(async () => {
    const success = await webSerial.connect();
    if (success) {
      toast({ title: 'Device connected successfully' });
    }
  }, [webSerial, toast]);

  // Handle manual refresh of device info
  const handleRefreshDeviceInfo = useCallback(async () => {
    setIsRefreshingDeviceInfo(true);
    try {
      await webSerial.refreshDeviceInfo();
    } finally {
      setIsRefreshingDeviceInfo(false);
    }
  }, [webSerial]);

  // Handle firmware flash
  const handleFlash = useCallback(async () => {
    const port = webSerial.getPort();
    if (!port) {
      toast({ variant: 'destructive', title: 'Error', description: 'No device connected' });
      return;
    }

    // Disconnect from normal serial mode before flashing
    await webSerial.disconnect();

    // Flash firmware
    const success = await flasher.flash(port, '/api/v1/esp32/firmware');

    if (success) {
      toast({ title: 'Firmware flashed successfully' });
      // Reconnect after flash using reconnect() which doesn't require user gesture
      // Give ESP32 time to boot into new firmware
      setTimeout(async () => {
        const reconnected = await webSerial.reconnect();
        if (!reconnected) {
          toast({
            title: 'Please reconnect device',
            description: 'Click Connect on Step 1 to reconnect after flashing'
          });
        }
      }, 3000);
    } else {
      toast({ variant: 'destructive', title: 'Flash failed', description: flasher.error || 'Unknown error' });
    }
  }, [webSerial, flasher, toast]);

  // Handle WiFi configuration
  const handleConfigureWifi = useCallback(async (ssid: string, password: string) => {
    setWifiStatus('configuring');
    setWifiError(null);
    setConnectedSsid(ssid); // Track the SSID we're connecting to

    try {
      // First ensure we're connected to serial
      if (webSerial.status !== 'connected') {
        // Wait a moment for ESP32 to boot after flashing
        await new Promise(resolve => setTimeout(resolve, 3000));

        // Try to reconnect using previously granted port
        let connected = await webSerial.reconnect();

        if (!connected) {
          // If reconnect fails, prompt user to select port again
          toast({ title: 'Please select the device again' });
          connected = await webSerial.connect();
        }

        if (!connected) {
          throw new Error('Failed to reconnect to device. Please try again.');
        }

        // Wait for ESP32 to be ready
        await new Promise(resolve => setTimeout(resolve, 1000));
      }

      // Use sendCommand which clears the buffer before sending
      // This helps avoid reading old startup messages
      let ackResponse: string;
      try {
        ackResponse = await webSerial.sendCommand(`WIFI_CONFIG:${ssid}:${password}`);
      } catch {
        // If sendCommand times out, the device might still be processing
        // Try reading for a response
        throw new Error('Device did not respond. Try disconnecting and reconnecting the USB cable.');
      }

      // Check for acknowledgment
      if (ackResponse.includes('WIFI_ACK')) {
        setWifiStatus('connecting');
      } else if (ackResponse.includes('ERROR')) {
        throw new Error(`Device error: ${ackResponse}`);
      }

      // Wait for connection result
      // WiFi connection can take up to 30 seconds on ESP32, use 60 second timeout
      const maxWaitTime = 60000;
      const lineTimeout = 5000; // Shorter line timeout, but keep trying
      const startTime = Date.now();
      let sawConnectedMessage = false;
      let detectedIp: string | null = null;

      while (Date.now() - startTime < maxWaitTime) {
        try {
          const response = await webSerial.readLine(lineTimeout);

          // Skip empty lines or lines with just dots
          if (!response || response.match(/^\.+$/)) {
            continue;
          }

          // Primary success indicator
          if (response.startsWith('WIFI_CONNECTED:')) {
            const ip = response.substring(15).trim();
            setConnectedIp(ip);
            setWifiStatus('connected');
            toast({ title: 'WiFi connected', description: `IP: ${ip}` });
            return;
          }

          // Failure indicator
          if (response.startsWith('WIFI_FAILED:')) {
            const reason = response.substring(12).trim();
            throw new Error(reason || 'Connection failed');
          }

          // Also check for "Connection failed" from wifiManager
          if (response === 'Connection failed') {
            throw new Error('WiFi connection failed - check password and signal');
          }

          // Secondary success indicators from wifiManager debug output
          if (response.startsWith('IP:') || response.startsWith('IP Address:')) {
            detectedIp = response.replace(/^IP[^:]*:\s*/, '').trim();
          }

          if (response === 'Connected!' || response.includes('WiFi connected')) {
            sawConnectedMessage = true;
            // Keep reading to get WIFI_CONNECTED with IP
          }

          // If we saw "Connected!" and have an IP, but haven't received WIFI_CONNECTED yet
          // Give it a bit more time, but we can be optimistic
          if (sawConnectedMessage && detectedIp) {
            // Wait a bit more for WIFI_CONNECTED, but set a shorter sub-timeout
            const subTimeout = 3000;
            const subStart = Date.now();
            while (Date.now() - subStart < subTimeout) {
              try {
                const finalResponse = await webSerial.readLine(1000);
                if (finalResponse.startsWith('WIFI_CONNECTED:')) {
                  const ip = finalResponse.substring(15).trim();
                  setConnectedIp(ip);
                  setWifiStatus('connected');
                  toast({ title: 'WiFi connected', description: `IP: ${ip}` });
                  return;
                }
              } catch {
                break;
              }
            }
            // If we got here with sawConnectedMessage and IP, consider it success
            setConnectedIp(detectedIp);
            setWifiStatus('connected');
            toast({ title: 'WiFi connected', description: `IP: ${detectedIp}` });
            return;
          }

          // Status updates
          if (response.includes('WIFI_CONNECTING') || response.includes('Connecting to WiFi')) {
            setWifiStatus('connecting');
          }
        } catch (readErr) {
          const errMsg = readErr instanceof Error ? readErr.message : '';
          // If read timeout, check if we're still within overall timeout
          if (errMsg.includes('timeout') && Date.now() - startTime < maxWaitTime) {
            // If we already saw connected message, might be done
            if (sawConnectedMessage && detectedIp) {
              setConnectedIp(detectedIp);
              setWifiStatus('connected');
              toast({ title: 'WiFi connected', description: `IP: ${detectedIp}` });
              return;
            }
            continue;
          }
          if (Date.now() - startTime >= maxWaitTime) {
            break;
          }
        }
      }

      // Final check - if we saw connection indicators but missed WIFI_CONNECTED
      if (sawConnectedMessage || detectedIp) {
        setConnectedIp(detectedIp || 'Unknown');
        setWifiStatus('connected');
        toast({ title: 'WiFi connected', description: detectedIp ? `IP: ${detectedIp}` : 'Connected' });
        return;
      }

      throw new Error('Connection timeout - check WiFi password and signal strength');
    } catch (err) {
      const message = err instanceof Error ? err.message : 'WiFi configuration failed';
      setWifiError(message);
      setWifiStatus('failed');
      toast({ variant: 'destructive', title: 'WiFi Error', description: message });
    }
  }, [webSerial, toast]);

  // Configure MQTT on the device after WiFi connects
  const configureMqtt = useCallback(async () => {
    if (mqttConfiguring || mqttConfigured) return;
    // Allow if WiFi was configured in this session OR if device reports WiFi connected
    const deviceWifiConnected = webSerial.deviceInfo?.isWifiConnected;
    if (wifiStatus !== 'connected' && !deviceWifiConnected) return;
    if (webSerial.status !== 'connected') return;

    setMqttConfiguring(true);
    try {
      // Fetch MQTT config from backend
      const response = await api.get<MqttConfig>('/esp32/mqtt-config');
      if (!response.success || !response.data) {
        throw new Error('Failed to get MQTT configuration');
      }

      const { broker, port, username, password } = response.data;

      // Send MQTT_CONFIG command to ESP32
      // Format: MQTT_CONFIG:broker:port:username:password
      const mqttCommand = `MQTT_CONFIG:${broker}:${port}:${username}:${password}`;
      const mqttResponse = await webSerial.sendCommand(mqttCommand);

      if (mqttResponse.includes('MQTT_CONNECTED')) {
        setMqttConfigured(true);
        toast({ title: 'MQTT configured', description: `Connected to ${broker}:${port}` });
      } else if (mqttResponse.includes('MQTT_ACK')) {
        // Command acknowledged, wait for connection
        const timeout = 10000;
        const startTime = Date.now();
        while (Date.now() - startTime < timeout) {
          try {
            const line = await webSerial.readLine(2000);
            if (line.includes('MQTT_CONNECTED')) {
              setMqttConfigured(true);
              toast({ title: 'MQTT configured', description: `Connected to ${broker}:${port}` });
              return;
            }
            if (line.includes('MQTT_FAILED')) {
              throw new Error(line.replace('MQTT_FAILED:', '').trim() || 'MQTT connection failed');
            }
          } catch {
            // Continue waiting
          }
        }
        // Timeout waiting for MQTT connection - might still work
        setMqttConfigured(true);
        toast({
          title: 'MQTT configuration sent',
          description: 'Device will attempt to connect to MQTT broker',
        });
      } else if (mqttResponse.includes('MQTT_FAILED')) {
        throw new Error(mqttResponse.replace('MQTT_FAILED:', '').trim() || 'MQTT connection failed');
      } else {
        // Unknown response, continue anyway
        setMqttConfigured(true);
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : 'MQTT configuration failed';
      console.error('[MQTT Config] Error:', message);
      toast({ variant: 'destructive', title: 'MQTT Error', description: message });
      // Still mark as configured so user can proceed
      setMqttConfigured(true);
    } finally {
      setMqttConfiguring(false);
    }
  }, [webSerial, wifiStatus, mqttConfiguring, mqttConfigured, toast]);

  // Auto-configure MQTT when WiFi connects
  useEffect(() => {
    if (wifiStatus === 'connected' && !mqttConfigured && !mqttConfiguring) {
      // Small delay to let the device settle
      const timer = setTimeout(() => {
        configureMqtt();
      }, 2000);
      return () => clearTimeout(timer);
    }
  }, [wifiStatus, mqttConfigured, mqttConfiguring, configureMqtt]);

  // Start verification polling
  const startVerification = useCallback(async () => {
    if (!webSerial.deviceInfo) return;

    const deviceId = webSerial.deviceInfo.deviceId;
    const macAddress = webSerial.deviceInfo.macAddress;

    // First, provision the device
    try {
      await provisionMutation.mutateAsync({
        deviceId,
        name: deviceName,
        macAddress,
      });
    } catch (err) {
      setVerifyError('Failed to provision device');
      setVerifyStatus('error');
      return;
    }

    setVerifyStatus('checking');
    setElapsedSeconds(0);

    // Start polling
    const startTime = Date.now();

    verifyIntervalRef.current = setInterval(async () => {
      const elapsed = Math.floor((Date.now() - startTime) / 1000);
      setElapsedSeconds(elapsed);

      if (elapsed >= VERIFY_TIMEOUT_SECONDS) {
        if (verifyIntervalRef.current) {
          clearInterval(verifyIntervalRef.current);
          verifyIntervalRef.current = null;
        }
        setVerifyStatus('timeout');
        return;
      }

      try {
        const response = await api.get<ESP32VerifyResponse>(`/esp32/verify/${deviceId}`);
        if (response.success && response.data?.isOnline) {
          if (verifyIntervalRef.current) {
            clearInterval(verifyIntervalRef.current);
            verifyIntervalRef.current = null;
          }
          setVerifyData(response.data);
          setVerifyStatus('online');
          // Only show toast once
          if (!hasShownOnlineToastRef.current) {
            hasShownOnlineToastRef.current = true;
            toast({ title: 'Device is online!', description: 'Setup completed successfully' });
          }
        }
      } catch {
        // Continue polling
      }
    }, VERIFY_POLL_INTERVAL);
  }, [webSerial.deviceInfo, deviceName, provisionMutation, toast]);

  // Clean up verification interval on unmount
  useEffect(() => {
    return () => {
      if (verifyIntervalRef.current) {
        clearInterval(verifyIntervalRef.current);
      }
    };
  }, []);

  // Refresh device info when entering step 2 (to check firmware version)
  useEffect(() => {
    if (currentStep === 2 && webSerialStatus === 'connected') {
      // Refresh device info to get firmware version
      refreshDeviceInfo();
    }
  }, [currentStep, webSerialStatus, refreshDeviceInfo]);

  // Auto-start verification when entering step 4
  useEffect(() => {
    if (currentStep === 4 && verifyStatus === 'waiting') {
      startVerification();
    }
  }, [currentStep, verifyStatus, startVerification]);

  // Navigation handlers
  const goToStep = (step: number) => {
    if (step < 1 || step > 4) return;
    setCurrentStep(step);
  };

  const handleRetryVerification = () => {
    setVerifyStatus('waiting');
    setVerifyData(null);
    setVerifyError(null);
    setElapsedSeconds(0);
    hasShownOnlineToastRef.current = false; // Reset toast guard for retry
    startVerification();
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-start gap-3 sm:items-center sm:gap-4">
        <Button variant="ghost" size="icon" asChild>
          <Link to="/devices">
            <ArrowLeft className="h-5 w-5" />
          </Link>
        </Button>
        <div className="min-w-0">
          <h1 className="text-2xl sm:text-3xl font-bold">ESP32 Device Setup</h1>
          <p className="text-muted-foreground">
            Connect, flash, and configure your ESP32 testing device
          </p>
        </div>
      </div>

      {/* Step Progress */}
      <div className="py-2 sm:py-4">
        <StepProgress steps={STEPS} currentStep={currentStep} />
      </div>

      {/* Step Content */}
      <div className="max-w-2xl">
        {currentStep === 1 && (
          <ConnectStep
            status={webSerial.status}
            error={webSerial.error}
            deviceInfo={webSerial.deviceInfo}
            isSupported={webSerial.isSupported}
            latestFirmware={firmwareData?.firmware || null}
            onConnect={handleConnect}
            onNext={() => goToStep(2)}
            onSkipToWifi={() => goToStep(3)}
            onSkipToVerify={() => goToStep(4)}
          />
        )}

        {currentStep === 2 && (
          <FlashStep
            firmwareInfo={firmwareData?.firmware || null}
            firmwareAvailable={firmwareData?.available || false}
            deviceFirmwareVersion={webSerial.deviceInfo?.firmwareVersion || null}
            isBootloaderMode={webSerial.isBootloaderMode}
            flashStatus={flasher.status}
            flashProgress={flasher.progress}
            flashMessage={flasher.message}
            flashError={flasher.error}
            isLoadingFirmware={isLoadingFirmware}
            isRefreshingDeviceInfo={isRefreshingDeviceInfo}
            onFlash={handleFlash}
            onNext={() => goToStep(3)}
            onSkipToWifi={() => goToStep(3)}
            onBack={() => goToStep(1)}
            onRefreshDeviceInfo={handleRefreshDeviceInfo}
          />
        )}

        {currentStep === 3 && (
          <ConfigureWifiStep
            wlans={wlansData?.wlans || []}
            isLoadingWlans={isLoadingWlans}
            wifiStatus={wifiStatus}
            wifiError={wifiError}
            connectedIp={connectedIp}
            isDeviceConnected={webSerial.status === 'connected'}
            isBootloaderMode={webSerial.isBootloaderMode}
            mqttConfiguring={mqttConfiguring}
            mqttConfigured={mqttConfigured}
            deviceWifiConnected={webSerial.deviceInfo?.isWifiConnected}
            deviceWifiSsid={webSerial.deviceInfo?.ssid}
            deviceWifiIp={webSerial.deviceInfo?.ipAddress}
            deviceWifiRssi={webSerial.deviceInfo?.rssi}
            vlanCoverageSummary={wlansData?.vlanCoverageSummary}
            onConfigure={handleConfigureWifi}
            onReconnect={webSerial.reconnect}
            onConfigureMqtt={configureMqtt}
            onNext={() => goToStep(4)}
            onBack={() => goToStep(2)}
            onSkipToVerify={() => {
              // Set connected state from device info when skipping
              if (webSerial.deviceInfo?.ssid) {
                setConnectedSsid(webSerial.deviceInfo.ssid);
              }
              if (webSerial.deviceInfo?.ipAddress) {
                setConnectedIp(webSerial.deviceInfo.ipAddress);
              }
              setWifiStatus('connected');
              goToStep(4);
            }}
          />
        )}

        {currentStep === 4 && webSerial.deviceInfo && (
          <VerifyStep
            deviceId={webSerial.deviceInfo.deviceId}
            deviceName={deviceName}
            deviceMac={webSerial.deviceInfo.macAddress}
            verifyStatus={verifyStatus}
            verifyData={verifyData}
            verifyError={verifyError}
            elapsedSeconds={elapsedSeconds}
            timeoutSeconds={VERIFY_TIMEOUT_SECONDS}
            connectedSsid={connectedSsid}
            connectedIp={connectedIp}
            onRetry={handleRetryVerification}
            onBack={() => goToStep(3)}
          />
        )}
      </div>
    </div>
  );
}

// Embeddable content component (without page header)
export function ESP32SetupContent() {
  const { toast } = useToast();
  const [currentStep, setCurrentStep] = useState(1);
  const [deviceName] = useState('ESP32 Device');

  // Web Serial hook
  const webSerial = useWebSerial();
  const refreshDeviceInfo = webSerial.refreshDeviceInfo;
  const webSerialStatus = webSerial.status;

  // Flasher hook
  const flasher = useESP32Flasher();

  // WiFi configuration state
  const [wifiStatus, setWifiStatus] = useState<WifiStatus>('idle');
  const [wifiError, setWifiError] = useState<string | null>(null);
  const [connectedIp, setConnectedIp] = useState<string | null>(null);
  const [connectedSsid, setConnectedSsid] = useState<string | null>(null);

  // MQTT configuration state
  const [mqttConfigured, setMqttConfigured] = useState(false);
  const [mqttConfiguring, setMqttConfiguring] = useState(false);

  // Verification state
  const [verifyStatus, setVerifyStatus] = useState<VerifyStatus>('waiting');
  const [verifyData, setVerifyData] = useState<ESP32VerifyResponse | null>(null);
  const [verifyError, setVerifyError] = useState<string | null>(null);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const verifyIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const hasShownOnlineToastRef = useRef(false);

  // Device info refresh state
  const [isRefreshingDeviceInfo, setIsRefreshingDeviceInfo] = useState(false);

  // Fetch firmware info
  const { data: firmwareData, isLoading: isLoadingFirmware } = useQuery({
    queryKey: ['esp32-firmware-info'],
    queryFn: async () => {
      const response = await api.get<{ firmware: FirmwareInfo; available: boolean }>('/esp32/firmware/info');
      if (response.success && response.data) {
        return response.data;
      }
      throw new Error(response.error?.message || 'Failed to fetch firmware info');
    },
    enabled: currentStep <= 2,
  });

  // Fetch available WLANs with passwords and VLAN coverage
  const { data: wlansData, isLoading: isLoadingWlans } = useQuery({
    queryKey: ['esp32-wlans-with-coverage'],
    queryFn: async () => {
      const response = await api.get<{
        wlans: WlanInfo[];
        vlanCoverageSummary?: { totalVlans: number; coveredVlans: number };
      }>('/esp32/wlans?includePassword=true&includeVlanCoverage=true');
      if (response.success && response.data) {
        return response.data;
      }
      throw new Error(response.error?.message || 'Failed to fetch WLANs');
    },
    enabled: currentStep === 3,
  });

  // Provision device mutation
  const provisionMutation = useMutation({
    mutationFn: async (data: { deviceId: string; name: string; macAddress: string }) => {
      const response = await api.post('/esp32/provision', data);
      if (!response.success) {
        throw new Error(response.error?.message || 'Failed to provision device');
      }
      return response;
    },
  });

  // Handle serial connection
  const handleConnect = useCallback(async () => {
    const success = await webSerial.connect();
    if (success) {
      toast({ title: 'Device connected successfully' });
    }
  }, [webSerial, toast]);

  // Handle manual refresh of device info
  const handleRefreshDeviceInfo = useCallback(async () => {
    setIsRefreshingDeviceInfo(true);
    try {
      await webSerial.refreshDeviceInfo();
    } finally {
      setIsRefreshingDeviceInfo(false);
    }
  }, [webSerial]);

  // Handle firmware flash
  const handleFlash = useCallback(async () => {
    const port = webSerial.getPort();
    if (!port) {
      toast({ variant: 'destructive', title: 'Error', description: 'No device connected' });
      return;
    }

    await webSerial.disconnect();

    const success = await flasher.flash(port, '/api/v1/esp32/firmware');

    if (success) {
      toast({ title: 'Firmware flashed successfully' });
      setTimeout(async () => {
        const reconnected = await webSerial.reconnect();
        if (!reconnected) {
          toast({
            title: 'Please reconnect device',
            description: 'Click Connect on Step 1 to reconnect after flashing'
          });
        }
      }, 3000);
    } else {
      toast({ variant: 'destructive', title: 'Flash failed', description: flasher.error || 'Unknown error' });
    }
  }, [webSerial, flasher, toast]);

  // Handle WiFi configuration
  const handleConfigureWifi = useCallback(async (ssid: string, password: string) => {
    setWifiStatus('configuring');
    setWifiError(null);
    setConnectedSsid(ssid);

    try {
      if (webSerial.status !== 'connected') {
        await new Promise(resolve => setTimeout(resolve, 3000));

        let connected = await webSerial.reconnect();

        if (!connected) {
          toast({ title: 'Please select the device again' });
          connected = await webSerial.connect();
        }

        if (!connected) {
          throw new Error('Failed to reconnect to device. Please try again.');
        }

        await new Promise(resolve => setTimeout(resolve, 1000));
      }

      let ackResponse: string;
      try {
        ackResponse = await webSerial.sendCommand(`WIFI_CONFIG:${ssid}:${password}`);
      } catch {
        throw new Error('Device did not respond. Try disconnecting and reconnecting the USB cable.');
      }

      if (ackResponse.includes('WIFI_ACK')) {
        setWifiStatus('connecting');
      } else if (ackResponse.includes('ERROR')) {
        throw new Error(`Device error: ${ackResponse}`);
      }

      const maxWaitTime = 60000;
      const lineTimeout = 5000;
      const startTime = Date.now();
      let sawConnectedMessage = false;
      let detectedIp: string | null = null;

      while (Date.now() - startTime < maxWaitTime) {
        try {
          const response = await webSerial.readLine(lineTimeout);

          if (!response || response.match(/^\.+$/)) {
            continue;
          }

          if (response.startsWith('WIFI_CONNECTED:')) {
            const ip = response.substring(15).trim();
            setConnectedIp(ip);
            setWifiStatus('connected');
            toast({ title: 'WiFi connected', description: `IP: ${ip}` });
            return;
          }

          if (response.startsWith('WIFI_FAILED:')) {
            const reason = response.substring(12).trim();
            throw new Error(reason || 'Connection failed');
          }

          if (response === 'Connection failed') {
            throw new Error('WiFi connection failed - check password and signal');
          }

          if (response.startsWith('IP:') || response.startsWith('IP Address:')) {
            detectedIp = response.replace(/^IP[^:]*:\s*/, '').trim();
          }

          if (response === 'Connected!' || response.includes('WiFi connected')) {
            sawConnectedMessage = true;
          }

          if (sawConnectedMessage && detectedIp) {
            const subTimeout = 3000;
            const subStart = Date.now();
            while (Date.now() - subStart < subTimeout) {
              try {
                const finalResponse = await webSerial.readLine(1000);
                if (finalResponse.startsWith('WIFI_CONNECTED:')) {
                  const ip = finalResponse.substring(15).trim();
                  setConnectedIp(ip);
                  setWifiStatus('connected');
                  toast({ title: 'WiFi connected', description: `IP: ${ip}` });
                  return;
                }
              } catch {
                break;
              }
            }
            setConnectedIp(detectedIp);
            setWifiStatus('connected');
            toast({ title: 'WiFi connected', description: `IP: ${detectedIp}` });
            return;
          }

          if (response.includes('WIFI_CONNECTING') || response.includes('Connecting to WiFi')) {
            setWifiStatus('connecting');
          }
        } catch (readErr) {
          const errMsg = readErr instanceof Error ? readErr.message : '';
          if (errMsg.includes('timeout') && Date.now() - startTime < maxWaitTime) {
            if (sawConnectedMessage && detectedIp) {
              setConnectedIp(detectedIp);
              setWifiStatus('connected');
              toast({ title: 'WiFi connected', description: `IP: ${detectedIp}` });
              return;
            }
            continue;
          }
          if (Date.now() - startTime >= maxWaitTime) {
            break;
          }
        }
      }

      if (sawConnectedMessage || detectedIp) {
        setConnectedIp(detectedIp || 'Unknown');
        setWifiStatus('connected');
        toast({ title: 'WiFi connected', description: detectedIp ? `IP: ${detectedIp}` : 'Connected' });
        return;
      }

      throw new Error('Connection timeout - check WiFi password and signal strength');
    } catch (err) {
      const message = err instanceof Error ? err.message : 'WiFi configuration failed';
      setWifiError(message);
      setWifiStatus('failed');
      toast({ variant: 'destructive', title: 'WiFi Error', description: message });
    }
  }, [webSerial, toast]);

  // Configure MQTT
  const configureMqtt = useCallback(async () => {
    if (mqttConfiguring || mqttConfigured) return;
    const deviceWifiConnected = webSerial.deviceInfo?.isWifiConnected;
    if (wifiStatus !== 'connected' && !deviceWifiConnected) return;
    if (webSerial.status !== 'connected') return;

    setMqttConfiguring(true);
    try {
      const response = await api.get<MqttConfig>('/esp32/mqtt-config');
      if (!response.success || !response.data) {
        throw new Error('Failed to get MQTT configuration');
      }

      const { broker, port, username, password } = response.data;
      const mqttCommand = `MQTT_CONFIG:${broker}:${port}:${username}:${password}`;
      const mqttResponse = await webSerial.sendCommand(mqttCommand);

      if (mqttResponse.includes('MQTT_CONNECTED')) {
        setMqttConfigured(true);
        toast({ title: 'MQTT configured', description: `Connected to ${broker}:${port}` });
      } else if (mqttResponse.includes('MQTT_ACK')) {
        const timeout = 10000;
        const startTime = Date.now();
        while (Date.now() - startTime < timeout) {
          try {
            const line = await webSerial.readLine(2000);
            if (line.includes('MQTT_CONNECTED')) {
              setMqttConfigured(true);
              toast({ title: 'MQTT configured', description: `Connected to ${broker}:${port}` });
              return;
            }
            if (line.includes('MQTT_FAILED')) {
              throw new Error(line.replace('MQTT_FAILED:', '').trim() || 'MQTT connection failed');
            }
          } catch {
            // Continue waiting
          }
        }
        setMqttConfigured(true);
        toast({
          title: 'MQTT configuration sent',
          description: 'Device will attempt to connect to MQTT broker',
        });
      } else if (mqttResponse.includes('MQTT_FAILED')) {
        throw new Error(mqttResponse.replace('MQTT_FAILED:', '').trim() || 'MQTT connection failed');
      } else {
        setMqttConfigured(true);
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : 'MQTT configuration failed';
      toast({ variant: 'destructive', title: 'MQTT Error', description: message });
      setMqttConfigured(true);
    } finally {
      setMqttConfiguring(false);
    }
  }, [webSerial, wifiStatus, mqttConfiguring, mqttConfigured, toast]);

  // Auto-configure MQTT when WiFi connects
  useEffect(() => {
    if (wifiStatus === 'connected' && !mqttConfigured && !mqttConfiguring) {
      const timer = setTimeout(() => {
        configureMqtt();
      }, 2000);
      return () => clearTimeout(timer);
    }
  }, [wifiStatus, mqttConfigured, mqttConfiguring, configureMqtt]);

  // Start verification polling
  const startVerification = useCallback(async () => {
    if (!webSerial.deviceInfo) return;

    const deviceId = webSerial.deviceInfo.deviceId;
    const macAddress = webSerial.deviceInfo.macAddress;

    try {
      await provisionMutation.mutateAsync({
        deviceId,
        name: deviceName,
        macAddress,
      });
    } catch {
      setVerifyError('Failed to provision device');
      setVerifyStatus('error');
      return;
    }

    setVerifyStatus('checking');
    setElapsedSeconds(0);

    const startTime = Date.now();

    verifyIntervalRef.current = setInterval(async () => {
      const elapsed = Math.floor((Date.now() - startTime) / 1000);
      setElapsedSeconds(elapsed);

      if (elapsed >= VERIFY_TIMEOUT_SECONDS) {
        if (verifyIntervalRef.current) {
          clearInterval(verifyIntervalRef.current);
          verifyIntervalRef.current = null;
        }
        setVerifyStatus('timeout');
        return;
      }

      try {
        const response = await api.get<ESP32VerifyResponse>(`/esp32/verify/${deviceId}`);
        if (response.success && response.data?.isOnline) {
          if (verifyIntervalRef.current) {
            clearInterval(verifyIntervalRef.current);
            verifyIntervalRef.current = null;
          }
          setVerifyData(response.data);
          setVerifyStatus('online');
          if (!hasShownOnlineToastRef.current) {
            hasShownOnlineToastRef.current = true;
            toast({ title: 'Device is online!', description: 'Setup completed successfully' });
          }
        }
      } catch {
        // Continue polling
      }
    }, VERIFY_POLL_INTERVAL);
  }, [webSerial.deviceInfo, deviceName, provisionMutation, toast]);

  // Clean up verification interval on unmount
  useEffect(() => {
    return () => {
      if (verifyIntervalRef.current) {
        clearInterval(verifyIntervalRef.current);
      }
    };
  }, []);

  // Refresh device info when entering step 2
  useEffect(() => {
    if (currentStep === 2 && webSerialStatus === 'connected') {
      refreshDeviceInfo();
    }
  }, [currentStep, webSerialStatus, refreshDeviceInfo]);

  // Auto-start verification when entering step 4
  useEffect(() => {
    if (currentStep === 4 && verifyStatus === 'waiting') {
      startVerification();
    }
  }, [currentStep, verifyStatus, startVerification]);

  // Navigation handlers
  const goToStep = (step: number) => {
    if (step < 1 || step > 4) return;
    setCurrentStep(step);
  };

  const handleRetryVerification = () => {
    setVerifyStatus('waiting');
    setVerifyData(null);
    setVerifyError(null);
    setElapsedSeconds(0);
    hasShownOnlineToastRef.current = false;
    startVerification();
  };

  return (
    <div className="space-y-6">
      {/* Step Progress */}
      <div className="py-4">
        <StepProgress steps={STEPS} currentStep={currentStep} />
      </div>

      {/* Step Content */}
      <div className="max-w-2xl">
        {currentStep === 1 && (
          <ConnectStep
            status={webSerial.status}
            error={webSerial.error}
            deviceInfo={webSerial.deviceInfo}
            isSupported={webSerial.isSupported}
            latestFirmware={firmwareData?.firmware || null}
            onConnect={handleConnect}
            onNext={() => goToStep(2)}
            onSkipToWifi={() => goToStep(3)}
            onSkipToVerify={() => goToStep(4)}
          />
        )}

        {currentStep === 2 && (
          <FlashStep
            firmwareInfo={firmwareData?.firmware || null}
            firmwareAvailable={firmwareData?.available || false}
            deviceFirmwareVersion={webSerial.deviceInfo?.firmwareVersion || null}
            isBootloaderMode={webSerial.isBootloaderMode}
            flashStatus={flasher.status}
            flashProgress={flasher.progress}
            flashMessage={flasher.message}
            flashError={flasher.error}
            isLoadingFirmware={isLoadingFirmware}
            isRefreshingDeviceInfo={isRefreshingDeviceInfo}
            onFlash={handleFlash}
            onNext={() => goToStep(3)}
            onSkipToWifi={() => goToStep(3)}
            onBack={() => goToStep(1)}
            onRefreshDeviceInfo={handleRefreshDeviceInfo}
          />
        )}

        {currentStep === 3 && (
          <ConfigureWifiStep
            wlans={wlansData?.wlans || []}
            isLoadingWlans={isLoadingWlans}
            wifiStatus={wifiStatus}
            wifiError={wifiError}
            connectedIp={connectedIp}
            isDeviceConnected={webSerial.status === 'connected'}
            isBootloaderMode={webSerial.isBootloaderMode}
            mqttConfiguring={mqttConfiguring}
            mqttConfigured={mqttConfigured}
            deviceWifiConnected={webSerial.deviceInfo?.isWifiConnected}
            deviceWifiSsid={webSerial.deviceInfo?.ssid}
            deviceWifiIp={webSerial.deviceInfo?.ipAddress}
            deviceWifiRssi={webSerial.deviceInfo?.rssi}
            vlanCoverageSummary={wlansData?.vlanCoverageSummary}
            onConfigure={handleConfigureWifi}
            onReconnect={webSerial.reconnect}
            onConfigureMqtt={configureMqtt}
            onNext={() => goToStep(4)}
            onBack={() => goToStep(2)}
            onSkipToVerify={() => {
              if (webSerial.deviceInfo?.ssid) {
                setConnectedSsid(webSerial.deviceInfo.ssid);
              }
              if (webSerial.deviceInfo?.ipAddress) {
                setConnectedIp(webSerial.deviceInfo.ipAddress);
              }
              setWifiStatus('connected');
              goToStep(4);
            }}
          />
        )}

        {currentStep === 4 && webSerial.deviceInfo && (
          <VerifyStep
            deviceId={webSerial.deviceInfo.deviceId}
            deviceName={deviceName}
            deviceMac={webSerial.deviceInfo.macAddress}
            verifyStatus={verifyStatus}
            verifyData={verifyData}
            verifyError={verifyError}
            elapsedSeconds={elapsedSeconds}
            timeoutSeconds={VERIFY_TIMEOUT_SECONDS}
            connectedSsid={connectedSsid}
            connectedIp={connectedIp}
            onRetry={handleRetryVerification}
            onBack={() => goToStep(3)}
          />
        )}
      </div>
    </div>
  );
}

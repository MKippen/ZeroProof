import { Usb, AlertCircle, CheckCircle2, Loader2, Wifi, ArrowRight, Cpu } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import type { WebSerialStatus } from '@/hooks/useWebSerial';
import type { ESP32DeviceInfo, FirmwareInfo } from '@/types';

interface ConnectStepProps {
  status: WebSerialStatus;
  error: string | null;
  deviceInfo: ESP32DeviceInfo | null;
  isSupported: boolean;
  latestFirmware: FirmwareInfo | null;
  onConnect: () => void;
  onNext: () => void;
  onSkipToWifi: () => void;
  onSkipToVerify: () => void;
}

export function ConnectStep({
  status,
  error,
  deviceInfo,
  isSupported,
  latestFirmware,
  onConnect,
  onNext,
  onSkipToWifi,
  onSkipToVerify,
}: ConnectStepProps) {
  // Check if device has latest firmware
  const hasLatestFirmware = deviceInfo?.firmwareVersion && latestFirmware?.version
    ? deviceInfo.firmwareVersion === latestFirmware.version
    : false;

  // Check if device already has WiFi configured
  const hasWifiConfigured = deviceInfo?.isWifiConnected === true;
  if (!isSupported) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <AlertCircle className="h-5 w-5 text-destructive" />
            Browser Not Supported
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <Alert variant="destructive">
            <AlertCircle className="h-4 w-4" />
            <AlertTitle>Web Serial API Required</AlertTitle>
            <AlertDescription>
              Your browser does not support the Web Serial API required for ESP32 flashing.
              Please use one of the following browsers:
            </AlertDescription>
          </Alert>
          <div className="grid gap-2 text-sm">
            <div className="flex items-center gap-2">
              <CheckCircle2 className="h-4 w-4 text-green-500" />
              <span>Google Chrome 89+</span>
            </div>
            <div className="flex items-center gap-2">
              <CheckCircle2 className="h-4 w-4 text-green-500" />
              <span>Microsoft Edge 89+</span>
            </div>
            <div className="flex items-center gap-2">
              <AlertCircle className="h-4 w-4 text-muted-foreground" />
              <span className="text-muted-foreground">Firefox - Not supported</span>
            </div>
            <div className="flex items-center gap-2">
              <AlertCircle className="h-4 w-4 text-muted-foreground" />
              <span className="text-muted-foreground">Safari - Not supported</span>
            </div>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Usb className="h-5 w-5" />
          Connect ESP32 Device
        </CardTitle>
        <CardDescription>
          Connect your ESP32 device via USB to begin the setup process
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        <div className="space-y-4">
          <div className="rounded-lg border border-border/50 p-4 space-y-3">
            <h4 className="font-medium">Before connecting:</h4>
            <ol className="list-decimal list-inside space-y-2 text-sm text-muted-foreground">
              <li>Connect your ESP32 to your computer via USB</li>
              <li>Ensure the device is powered on (LED should be lit)</li>
              <li>If this is a new device, it may be in bootloader mode</li>
            </ol>
          </div>

          {error && (
            <Alert variant="destructive">
              <AlertCircle className="h-4 w-4" />
              <AlertTitle>Connection Error</AlertTitle>
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}

          {status === 'connected' && deviceInfo && (
            <Alert className="border-green-500/50 bg-green-500/10">
              <CheckCircle2 className="h-4 w-4 text-green-500" />
              <AlertTitle className="text-green-500">Device Connected</AlertTitle>
              <AlertDescription>
                <div className="mt-2 space-y-2 text-sm">
                  <p>
                    <span className="text-muted-foreground">Device ID:</span>{' '}
                    <span className="font-mono">{deviceInfo.deviceId}</span>
                  </p>
                  <p>
                    <span className="text-muted-foreground">MAC Address:</span>{' '}
                    <span className="font-mono">{deviceInfo.macAddress}</span>
                  </p>
                  {deviceInfo.firmwareVersion && (
                    <div className="flex items-center gap-2">
                      <span className="text-muted-foreground">Firmware:</span>
                      <span className="font-mono">{deviceInfo.firmwareVersion}</span>
                      {hasLatestFirmware ? (
                        <Badge className="bg-green-500/20 text-green-400 border-green-500/30">
                          <CheckCircle2 className="h-3 w-3 mr-1" />
                          Up to date
                        </Badge>
                      ) : latestFirmware && (
                        <Badge variant="outline" className="text-yellow-400 border-yellow-500/30">
                          Update available: {latestFirmware.version}
                        </Badge>
                      )}
                    </div>
                  )}
                  {!deviceInfo.firmwareVersion && (
                    <div className="flex items-center gap-2">
                      <span className="text-muted-foreground">Firmware:</span>
                      <Badge variant="outline" className="text-orange-400 border-orange-500/30">
                        <Cpu className="h-3 w-3 mr-1" />
                        Not detected - Flash required
                      </Badge>
                    </div>
                  )}
                  {deviceInfo.isWifiConnected && (
                    <div className="flex items-center gap-2">
                      <Wifi className="h-4 w-4 text-green-500" />
                      <span className="text-green-400">
                        Connected to {deviceInfo.ssid || 'WiFi'}
                        {deviceInfo.ipAddress && ` (${deviceInfo.ipAddress})`}
                      </span>
                    </div>
                  )}
                </div>
              </AlertDescription>
            </Alert>
          )}
        </div>

        <div className="flex flex-col gap-3">
          {status !== 'connected' ? (
            <Button
              onClick={onConnect}
              disabled={status === 'connecting'}
              className="w-full"
            >
              {status === 'connecting' ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Connecting...
                </>
              ) : (
                <>
                  <Usb className="mr-2 h-4 w-4" />
                  Select Device
                </>
              )}
            </Button>
          ) : (
            <div className="flex gap-3">
              {hasLatestFirmware ? (
                <>
                  {!hasWifiConfigured ? (
                    <Button onClick={onSkipToWifi} className="flex-1">
                      <Wifi className="mr-2 h-4 w-4" />
                      Configure WiFi
                      <ArrowRight className="ml-2 h-4 w-4" />
                    </Button>
                  ) : (
                    <Button onClick={onSkipToVerify} className="flex-1">
                      <CheckCircle2 className="mr-2 h-4 w-4" />
                      Device Ready - Verify Connection
                      <ArrowRight className="ml-2 h-4 w-4" />
                    </Button>
                  )}
                  <Button onClick={onNext} variant="outline">
                    <Cpu className="mr-2 h-4 w-4" />
                    Reflash Anyway
                  </Button>
                </>
              ) : (
                <Button onClick={onNext} className="flex-1">
                  <Cpu className="mr-2 h-4 w-4" />
                  {deviceInfo?.firmwareVersion ? 'Update Firmware' : 'Flash Firmware'}
                  <ArrowRight className="ml-2 h-4 w-4" />
                </Button>
              )}
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

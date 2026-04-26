import { Cpu, AlertCircle, CheckCircle2, Loader2, Download, Wifi, ArrowRight, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Progress } from '@/components/ui/progress';
import { Badge } from '@/components/ui/badge';
import type { FlashStatus } from '@/hooks/useESP32Flasher';
import type { FirmwareInfo } from '@/types';

interface FlashStepProps {
  firmwareInfo: FirmwareInfo | null;
  firmwareAvailable: boolean;
  deviceFirmwareVersion: string | null;
  isBootloaderMode?: boolean;
  flashStatus: FlashStatus;
  flashProgress: number;
  flashMessage: string;
  flashError: string | null;
  isLoadingFirmware: boolean;
  isRefreshingDeviceInfo?: boolean;
  onFlash: () => void;
  onNext: () => void;
  onSkipToWifi: () => void;
  onBack: () => void;
  onRefreshDeviceInfo?: () => void;
}

export function FlashStep({
  firmwareInfo,
  firmwareAvailable,
  deviceFirmwareVersion,
  isBootloaderMode,
  flashStatus,
  flashProgress,
  flashMessage,
  flashError,
  isLoadingFirmware,
  isRefreshingDeviceInfo,
  onFlash,
  onNext,
  onSkipToWifi,
  onBack,
  onRefreshDeviceInfo,
}: FlashStepProps) {
  const isFlashing = ['downloading', 'connecting', 'erasing', 'flashing', 'verifying'].includes(flashStatus);
  const isComplete = flashStatus === 'complete';

  // Check if device already has the latest firmware
  const hasLatestFirmware = deviceFirmwareVersion && firmwareInfo?.version
    ? deviceFirmwareVersion === firmwareInfo.version
    : false;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Cpu className="h-5 w-5" />
          Flash Firmware
        </CardTitle>
        <CardDescription>
          Flash the ZeroProof firmware to your ESP32 device
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        {/* Bootloader Mode Detected */}
        {isBootloaderMode && flashStatus === 'idle' && (
          <Alert className="border-blue-500/50 bg-blue-500/10">
            <Cpu className="h-4 w-4 text-blue-400" />
            <AlertTitle className="text-blue-400">Device Ready for Flashing</AlertTitle>
            <AlertDescription>
              <p>
                Your ESP32 is in bootloader mode (no firmware installed or firmware is not running).
                Click "Flash Firmware" below to install the ZeroProof firmware.
              </p>
            </AlertDescription>
          </Alert>
        )}

        {/* Firmware Already Up To Date */}
        {hasLatestFirmware && flashStatus === 'idle' && (
          <Alert className="border-green-500/50 bg-green-500/10">
            <CheckCircle2 className="h-4 w-4 text-green-500" />
            <AlertTitle className="text-green-500">Firmware Up To Date</AlertTitle>
            <AlertDescription>
              <p className="mb-3">
                Your device is already running the latest firmware (v{deviceFirmwareVersion}).
                You can skip to WiFi configuration.
              </p>
              <Button onClick={onSkipToWifi} size="sm">
                <Wifi className="mr-2 h-4 w-4" />
                Skip to WiFi Configuration
                <ArrowRight className="ml-2 h-4 w-4" />
              </Button>
            </AlertDescription>
          </Alert>
        )}

        {/* Firmware Info */}
        <div className="rounded-lg border border-border/50 p-4 space-y-3">
          <h4 className="font-medium">Firmware Details</h4>
          {isLoadingFirmware ? (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              Loading firmware info...
            </div>
          ) : firmwareInfo ? (
            <div className="grid grid-cols-2 gap-2 text-sm">
              <div>
                <span className="text-muted-foreground">Latest Version:</span>{' '}
                <span className="font-mono">{firmwareInfo.version}</span>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-muted-foreground">Device Version:</span>{' '}
                <span className="font-mono">
                  {deviceFirmwareVersion || (isBootloaderMode ? 'No firmware' : 'Unknown')}
                </span>
                {hasLatestFirmware && (
                  <Badge className="ml-2 bg-green-500/20 text-green-400 border-green-500/30 text-xs">
                    Up to date
                  </Badge>
                )}
                {deviceFirmwareVersion && !hasLatestFirmware && (
                  <Badge variant="outline" className="ml-2 text-yellow-400 border-yellow-500/30 text-xs">
                    Update available
                  </Badge>
                )}
                {isBootloaderMode && !deviceFirmwareVersion && (
                  <Badge variant="outline" className="ml-2 text-blue-400 border-blue-500/30 text-xs">
                    Ready to flash
                  </Badge>
                )}
                {!deviceFirmwareVersion && !isBootloaderMode && onRefreshDeviceInfo && (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={onRefreshDeviceInfo}
                    disabled={isRefreshingDeviceInfo || isFlashing}
                    className="h-6 px-2"
                  >
                    <RefreshCw className={`h-3 w-3 mr-1 ${isRefreshingDeviceInfo ? 'animate-spin' : ''}`} />
                    {isRefreshingDeviceInfo ? 'Detecting...' : 'Detect'}
                  </Button>
                )}
              </div>
              <div>
                <span className="text-muted-foreground">Size:</span>{' '}
                <span className="font-mono">
                  {firmwareInfo.size > 0 ? `${(firmwareInfo.size / 1024).toFixed(1)} KB` : 'N/A'}
                </span>
              </div>
              <div>
                <span className="text-muted-foreground">Released:</span>{' '}
                <span>{firmwareInfo.releaseDate}</span>
              </div>
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">No firmware information available</p>
          )}
        </div>

        {/* Flash Progress */}
        {(isFlashing || isComplete) && (
          <div className="space-y-3">
            <div className="flex items-center justify-between text-sm">
              <span>{flashMessage}</span>
              <span className="font-mono">{flashProgress}%</span>
            </div>
            <Progress value={flashProgress} className="h-2" />

            {/* Show bootloader help during connecting phase */}
            {flashStatus === 'connecting' && (
              <div className="rounded-lg border border-blue-500/30 bg-blue-500/10 p-3 space-y-2 mt-3">
                <p className="text-sm font-medium text-blue-400">
                  Waiting for bootloader... Try these steps if stuck:
                </p>
                <ol className="list-decimal list-inside space-y-1 text-sm text-muted-foreground">
                  <li><strong>Hold</strong> the BOOT button on the ESP32</li>
                  <li><strong>Press and release</strong> the EN/RST button while holding BOOT</li>
                  <li><strong>Release</strong> the BOOT button after 1-2 seconds</li>
                </ol>
              </div>
            )}
          </div>
        )}

        {/* Error Alert */}
        {flashError && (
          <Alert variant="destructive">
            <AlertCircle className="h-4 w-4" />
            <AlertTitle>Flash Error</AlertTitle>
            <AlertDescription>
              <p>{flashError}</p>
              <div className="mt-3 text-sm space-y-2">
                <p className="font-medium">Troubleshooting steps:</p>
                <ol className="list-decimal list-inside space-y-1">
                  <li>Hold the BOOT button on the ESP32</li>
                  <li>Press and release the EN/RST button while holding BOOT</li>
                  <li>Release the BOOT button after 1 second</li>
                  <li>Try flashing again</li>
                </ol>
              </div>
            </AlertDescription>
          </Alert>
        )}

        {/* Success Alert */}
        {isComplete && (
          <Alert className="border-green-500/50 bg-green-500/10">
            <CheckCircle2 className="h-4 w-4 text-green-500" />
            <AlertTitle className="text-green-500">Firmware Flashed Successfully</AlertTitle>
            <AlertDescription>
              The firmware has been written to your ESP32. The device will now restart.
            </AlertDescription>
          </Alert>
        )}

        {/* Bootloader Instructions */}
        {flashStatus === 'idle' && (
          <div className="rounded-lg border border-yellow-500/30 bg-yellow-500/10 p-4 space-y-2">
            <h4 className="font-medium text-yellow-500 flex items-center gap-2">
              <AlertCircle className="h-4 w-4" />
              Manual Bootloader Mode
            </h4>
            <p className="text-sm text-muted-foreground">
              If flashing fails, you may need to manually enter bootloader mode:
            </p>
            <ol className="list-decimal list-inside space-y-1 text-sm text-muted-foreground">
              <li>Hold the BOOT button (GPIO0)</li>
              <li>Press and release the EN/RST button</li>
              <li>Release the BOOT button after 1 second</li>
            </ol>
          </div>
        )}

        {/* Action Buttons */}
        <div className="flex justify-between gap-3">
          <Button variant="outline" onClick={onBack} disabled={isFlashing}>
            Back
          </Button>
          {isComplete ? (
            <Button onClick={onNext}>
              Continue to WiFi Configuration
            </Button>
          ) : (
            <Button
              onClick={onFlash}
              disabled={isFlashing || !firmwareAvailable}
            >
              {isFlashing ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Flashing...
                </>
              ) : (
                <>
                  <Download className="mr-2 h-4 w-4" />
                  Flash Firmware
                </>
              )}
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

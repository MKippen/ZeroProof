import { useState, useCallback, useRef } from 'react';

// esptool-js types (library doesn't have proper type declarations)
// These are used by refs below
interface Transport {
  disconnect(): Promise<void>;
}

interface ESPLoader {
  chip: { CHIP_NAME: string };
  main(): Promise<void>;
  writeFlash(options: unknown): Promise<void>;
  hardReset(): Promise<void>;
}

interface EsptoolModule {
  ESPLoader: new (options: {
    transport: Transport | null;
    baudrate: number;
    romBaudrate: number;
    terminal: {
      clean(): void;
      writeLine(data: string): void;
      write(data: string): void;
    };
  }) => ESPLoader;
  Transport: new (port: SerialPort, debug: boolean) => Transport;
}

// Convert ArrayBuffer to binary string (required by esptool-js)
function arrayBufferToBinaryString(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binaryString = '';
  // Process in chunks to avoid stack overflow for large files
  const chunkSize = 8192;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    const chunk = bytes.subarray(i, Math.min(i + chunkSize, bytes.length));
    binaryString += String.fromCharCode.apply(null, Array.from(chunk));
  }
  return binaryString;
}


let esptoolModule: EsptoolModule | null = null;

async function loadEsptool(): Promise<EsptoolModule> {
  if (!esptoolModule) {
    esptoolModule = await import('esptool-js') as unknown as EsptoolModule;
  }
  return esptoolModule;
}

export type FlashStatus = 'idle' | 'downloading' | 'connecting' | 'erasing' | 'flashing' | 'verifying' | 'complete' | 'error';

export interface FlashProgress {
  status: FlashStatus;
  progress: number; // 0-100
  message: string;
  error: string | null;
}

export interface UseESP32FlasherReturn extends FlashProgress {
  flash: (port: SerialPort, firmwareUrl: string) => Promise<boolean>;
  reset: () => void;
}

// Using merged firmware binary that includes bootloader + partition table + app
// Merged binary starts at 0x0 and contains:
// - 0x1000: Second stage bootloader
// - 0x8000: Partition table
// - 0x10000: Application
const FLASH_ADDRESS = 0x0;

export function useESP32Flasher(): UseESP32FlasherReturn {
  const [status, setStatus] = useState<FlashStatus>('idle');
  const [progress, setProgress] = useState(0);
  const [message, setMessage] = useState('');
  const [error, setError] = useState<string | null>(null);

  const transportRef = useRef<Transport | null>(null);
  const loaderRef = useRef<ESPLoader | null>(null);

  const reset = useCallback(() => {
    setStatus('idle');
    setProgress(0);
    setMessage('');
    setError(null);
  }, []);

  const flash = useCallback(async (port: SerialPort, firmwareUrl: string): Promise<boolean> => {
    try {
      reset();

      // Step 1: Download firmware
      setStatus('downloading');
      setMessage('Downloading firmware...');
      setProgress(5);

      const response = await fetch(firmwareUrl, { credentials: 'include' });
      if (!response.ok) {
        throw new Error('Failed to download firmware');
      }

      const firmwareBlob = await response.blob();
      const firmwareData = await firmwareBlob.arrayBuffer();
      const firmwareVersion = response.headers.get('X-Firmware-Version') || 'unknown';

      setProgress(15);
      setMessage(`Downloaded firmware v${firmwareVersion} (${(firmwareData.byteLength / 1024).toFixed(1)} KB)`);

      // Step 2: Create transport and connect to ESP
      setStatus('connecting');
      setMessage('Connecting to ESP32...');
      setProgress(20);

      // Load esptool-js dynamically
      const { ESPLoader, Transport } = await loadEsptool();

      // Create transport from the serial port
      transportRef.current = new Transport(port, true);

      // Create ESP loader
      loaderRef.current = new ESPLoader({
        transport: transportRef.current,
        baudrate: 115200,
        romBaudrate: 115200,
        terminal: {
          clean: () => {},
          writeLine: (_data: string) => {},
          write: (_data: string) => {},
        },
      });

      // Connect to bootloader
      setMessage('Entering bootloader mode... (Hold BOOT, press EN/RST if stuck)');
      setProgress(25);

      // Add timeout for bootloader connection
      const bootloaderTimeout = new Promise<never>((_, reject) => {
        setTimeout(() => reject(new Error('Bootloader timeout - Hold BOOT button, press EN/RST, then release BOOT')), 30000);
      });

      try {
        await Promise.race([
          loaderRef.current!.main(),
          bootloaderTimeout
        ]);
      } catch (err) {
        if (err instanceof Error && err.message.includes('Bootloader timeout')) {
          throw err;
        }
        throw new Error('Failed to connect to bootloader. Try: Hold BOOT, press EN/RST, release BOOT');
      }

      setProgress(30);
      setMessage(`Connected to ${loaderRef.current!.chip.CHIP_NAME}`);

      // Step 3: Erase flash
      setStatus('erasing');
      setMessage('Erasing flash memory...');
      setProgress(35);

      // Step 4: Flash firmware
      setStatus('flashing');
      setMessage('Writing firmware...');

      // Convert firmware to binary string format required by esptool-js
      const firmwareBinaryString = arrayBufferToBinaryString(firmwareData);

      const flashOptions = {
        fileArray: [
          {
            data: firmwareBinaryString,
            address: FLASH_ADDRESS,
          },
        ],
        flashSize: 'keep',
        flashMode: 'keep',
        flashFreq: 'keep',
        eraseAll: false,
        compress: true,
        reportProgress: (_fileIndex: number, written: number, total: number) => {
          const flashProgress = Math.round((written / total) * 100);
          setProgress(40 + Math.round(flashProgress * 0.5)); // 40-90%
          setMessage(`Writing firmware: ${flashProgress}%`);
        },
      };

      await loaderRef.current!.writeFlash(flashOptions);

      // Step 5: Verify and reset
      setStatus('verifying');
      setMessage('Verifying firmware...');
      setProgress(92);

      // Hard reset to run the new firmware
      setMessage('Resetting device...');
      setProgress(95);
      await loaderRef.current!.hardReset();

      setStatus('complete');
      setProgress(100);
      setMessage('Firmware flashed successfully!');

      return true;
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Flash failed';
      setStatus('error');
      setError(errorMessage);
      setMessage('Flash failed');
      console.error('Flash error:', err);
      return false;
    } finally {
      // Clean up
      if (transportRef.current) {
        try {
          await transportRef.current.disconnect();
        } catch {
          // Ignore disconnect errors
        }
        transportRef.current = null;
      }
      loaderRef.current = null;
    }
  }, [reset]);

  return {
    status,
    progress,
    message,
    error,
    flash,
    reset,
  };
}

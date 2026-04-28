import { useState, useCallback, useRef } from 'react';
import type { ESP32DeviceInfo } from '@/types';
import api from '@/api/client';

// Debug logger that sends browser-safe diagnostics to the backend.
const debugLog = (message: string, data?: Record<string, unknown>, level: 'info' | 'warn' | 'error' = 'info') => {
  const consoleMsg = `[WebSerial] ${message}`;
  if (level === 'error') {
    console.error(consoleMsg, data || '');
  } else if (level === 'warn') {
    console.warn(consoleMsg, data || '');
  }

  // Send to backend (fire and forget)
  api.post('/esp32/debug', { level, message, data }).catch(() => {
    // Ignore errors from debug logging
  });
};

// Extend Navigator interface for Web Serial API
declare global {
  interface Navigator {
    serial: {
      requestPort(options?: SerialPortRequestOptions): Promise<SerialPort>;
      getPorts(): Promise<SerialPort[]>;
    };
  }

  interface SerialPortRequestOptions {
    filters?: SerialPortFilter[];
  }

  interface SerialPortFilter {
    usbVendorId?: number;
    usbProductId?: number;
  }

  interface SerialPort {
    open(options: SerialOptions): Promise<void>;
    close(): Promise<void>;
    readable: ReadableStream<Uint8Array> | null;
    writable: WritableStream<Uint8Array> | null;
    getInfo(): SerialPortInfo;
  }

  interface SerialOptions {
    baudRate: number;
    dataBits?: number;
    stopBits?: number;
    parity?: 'none' | 'even' | 'odd';
    bufferSize?: number;
    flowControl?: 'none' | 'hardware';
  }

  interface SerialPortInfo {
    usbVendorId?: number;
    usbProductId?: number;
  }
}

export type WebSerialStatus = 'idle' | 'connecting' | 'connected' | 'error' | 'unsupported';

export interface WebSerialState {
  status: WebSerialStatus;
  error: string | null;
  deviceInfo: ESP32DeviceInfo | null;
  isSupported: boolean;
  isSecureContext: boolean;
  isChromium: boolean;
  isBootloaderMode: boolean;
}

export interface UseWebSerialReturn extends WebSerialState {
  connect: () => Promise<boolean>;
  reconnect: () => Promise<boolean>;
  disconnect: () => Promise<void>;
  write: (data: string) => Promise<void>;
  readLine: (timeoutMs?: number) => Promise<string>;
  sendCommand: (command: string) => Promise<string>;
  getPort: () => SerialPort | null;
  refreshDeviceInfo: () => Promise<void>;
}

const ESP32_FILTERS: SerialPortFilter[] = [
  { usbVendorId: 0x10c4 }, // Silicon Labs CP210x
  { usbVendorId: 0x1a86 }, // CH340
  { usbVendorId: 0x0403 }, // FTDI
  { usbVendorId: 0x303a }, // Espressif USB
];

export function useWebSerial(): UseWebSerialReturn {
  const [status, setStatus] = useState<WebSerialStatus>('idle');
  const [error, setError] = useState<string | null>(null);
  const [deviceInfo, setDeviceInfo] = useState<ESP32DeviceInfo | null>(null);
  const [isBootloaderMode, setIsBootloaderMode] = useState<boolean>(false);

  const portRef = useRef<SerialPort | null>(null);
  const readerRef = useRef<ReadableStreamDefaultReader<Uint8Array> | null>(null);
  const writerRef = useRef<WritableStreamDefaultWriter<Uint8Array> | null>(null);
  const readBufferRef = useRef<string>('');

  // Web Serial requires a secure context (HTTPS or localhost). Chrome
  // silently omits navigator.serial on insecure LAN-IP origins, which
  // makes the bare 'serial' in navigator check look like the browser
  // isn't supported when the real cause is the origin. Track both
  // conditions separately so the UI can explain what's actually wrong.
  const isSecureContext = typeof window !== 'undefined' && window.isSecureContext === true;
  const isChromium = typeof navigator !== 'undefined' &&
    /Chrome|Edg|Edge/.test(navigator.userAgent) &&
    !/Firefox|FxiOS/.test(navigator.userAgent);
  const isSupported = typeof navigator !== 'undefined' && 'serial' in navigator;

  const connect = useCallback(async (): Promise<boolean> => {
    if (!isSupported) {
      setStatus('unsupported');
      setError('Web Serial API is not supported in this browser. Use Chrome or Edge.');
      return false;
    }

    try {
      setStatus('connecting');
      setError(null);
      debugLog('Requesting serial port...');

      // Request port with ESP32 USB filters
      const port = await navigator.serial.requestPort({ filters: ESP32_FILTERS });
      portRef.current = port;

      const portInfo = port.getInfo();
      debugLog('Port selected', { vendorId: portInfo.usbVendorId, productId: portInfo.usbProductId });

      // Open port at 115200 baud - handle already open case
      try {
        debugLog('Opening port at 115200 baud...');
        await port.open({
          baudRate: 115200,
          dataBits: 8,
          stopBits: 1,
          parity: 'none',
          flowControl: 'none',
        });
        debugLog('Port opened successfully');
      } catch (openErr) {
        const openMessage = openErr instanceof Error ? openErr.message : '';
        // If port is already open, that's fine - we'll use it
        if (!openMessage.includes('already open') && !openMessage.includes('ALREADY_OPEN')) {
          throw openErr;
        }
        debugLog('Port was already open, reusing', undefined, 'warn');
      }

      // Set up reader and writer if not already set
      if (port.readable && !readerRef.current) {
        readerRef.current = port.readable.getReader();
        debugLog('Reader created');
      }
      if (port.writable && !writerRef.current) {
        writerRef.current = port.writable.getWriter();
        debugLog('Writer created');
      }

      setStatus('connected');
      debugLog('Connection established, waiting 2s for device to settle...');

      // Give the ESP32 a moment to finish booting and outputting startup messages
      await new Promise(resolve => setTimeout(resolve, 2000));

      // Try to get device info via GET_INFO command with retries
      debugLog('Starting device info retrieval...');
      await refreshDeviceInfoInternal();

      return true;
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to connect';
      if (message.includes('cancelled') || message.includes('canceled')) {
        setStatus('idle');
        setError(null);
        debugLog('Connection cancelled by user');
      } else {
        setStatus('error');
        setError(message);
        debugLog(`Connection failed: ${message}`, undefined, 'error');
      }
      return false;
    }
  }, [isSupported]);

  const disconnect = useCallback(async () => {
    try {
      if (readerRef.current) {
        await readerRef.current.cancel();
        readerRef.current.releaseLock();
        readerRef.current = null;
      }
      if (writerRef.current) {
        writerRef.current.releaseLock();
        writerRef.current = null;
      }
      if (portRef.current) {
        await portRef.current.close();
        portRef.current = null;
      }
    } catch {
      // Ignore close errors
    }
    setStatus('idle');
    setDeviceInfo(null);
    readBufferRef.current = '';
  }, []);

  const write = useCallback(async (data: string) => {
    if (!writerRef.current) {
      throw new Error('Serial port not connected');
    }
    const encoder = new TextEncoder();
    await writerRef.current.write(encoder.encode(data));
  }, []);

  const readLine = useCallback(async (timeoutMs: number = 10000): Promise<string> => {
    if (!readerRef.current) {
      throw new Error('Serial port not connected');
    }

    const decoder = new TextDecoder();
    const startTime = Date.now();

    while (Date.now() - startTime < timeoutMs) {
      // Check if we have a complete line in buffer
      const newlineIndex = readBufferRef.current.indexOf('\n');
      if (newlineIndex !== -1) {
        const line = readBufferRef.current.substring(0, newlineIndex).trim();
        readBufferRef.current = readBufferRef.current.substring(newlineIndex + 1);
        return line;
      }

      // Read more data
      const { value, done } = await readerRef.current.read();
      if (done) {
        throw new Error('Serial port closed');
      }
      if (value) {
        readBufferRef.current += decoder.decode(value);
      }
    }

    throw new Error('Read timeout');
  }, []);

  const sendCommandInternal = async (command: string): Promise<string> => {
    if (!writerRef.current || !readerRef.current) {
      throw new Error('Serial port not connected');
    }

    // Clear buffer
    readBufferRef.current = '';

    // Send command with newline
    const encoder = new TextEncoder();
    await writerRef.current.write(encoder.encode(command + '\n'));

    // Wait for response
    const decoder = new TextDecoder();
    const timeout = 5000;
    const startTime = Date.now();

    while (Date.now() - startTime < timeout) {
      const newlineIndex = readBufferRef.current.indexOf('\n');
      if (newlineIndex !== -1) {
        const line = readBufferRef.current.substring(0, newlineIndex).trim();
        readBufferRef.current = readBufferRef.current.substring(newlineIndex + 1);
        return line;
      }

      const { value, done } = await readerRef.current.read();
      if (done) break;
      if (value) {
        readBufferRef.current += decoder.decode(value);
      }
    }

    throw new Error('Command timeout');
  };

  const sendCommand = useCallback(async (command: string): Promise<string> => {
    return sendCommandInternal(command);
  }, []);

  const getPort = useCallback(() => portRef.current, []);

  // Reconnect to an existing port without prompting (uses getPorts API)
  const reconnect = useCallback(async (): Promise<boolean> => {
    if (!isSupported) {
      setStatus('unsupported');
      setError('Web Serial API is not supported in this browser.');
      return false;
    }

    try {
      setStatus('connecting');
      setError(null);
      debugLog('Reconnecting to device...');

      // Clear any stale refs first
      if (readerRef.current) {
        try {
          readerRef.current.releaseLock();
        } catch {
          // Ignore
        }
        readerRef.current = null;
      }
      if (writerRef.current) {
        try {
          writerRef.current.releaseLock();
        } catch {
          // Ignore
        }
        writerRef.current = null;
      }
      readBufferRef.current = '';

      // Try to get previously granted ports
      const ports = await navigator.serial.getPorts();
      debugLog(`Found ${ports.length} previously granted ports`);

      // Find an ESP32 port
      let port: SerialPort | null = null;
      for (const p of ports) {
        const info = p.getInfo();
        if (ESP32_FILTERS.some(f => f.usbVendorId === info.usbVendorId)) {
          port = p;
          debugLog('Found ESP32 port', { vendorId: info.usbVendorId });
          break;
        }
      }

      if (!port && ports.length > 0) {
        // Use first available port if no ESP32 filter match
        port = ports[0];
        debugLog('Using first available port');
      }

      if (!port) {
        // No previously granted ports, need to prompt user
        setStatus('idle');
        setError('No device found. Please click Connect to reconnect.');
        debugLog('No ports available', undefined, 'warn');
        return false;
      }

      // Close the port first if it might be in a weird state
      try {
        await port.close();
        debugLog('Closed existing port connection');
      } catch {
        // Port wasn't open, that's fine
      }

      // Small delay after closing
      await new Promise(resolve => setTimeout(resolve, 500));

      portRef.current = port;

      // Open the port fresh
      debugLog('Opening port at 115200 baud...');
      await port.open({
        baudRate: 115200,
        dataBits: 8,
        stopBits: 1,
        parity: 'none',
        flowControl: 'none',
      });
      debugLog('Port opened successfully');

      // Create fresh reader and writer
      if (port.readable) {
        readerRef.current = port.readable.getReader();
        debugLog('Reader created');
      }
      if (port.writable) {
        writerRef.current = port.writable.getWriter();
        debugLog('Writer created');
      }

      setStatus('connected');

      // Give the ESP32 time to output boot messages
      debugLog('Waiting for device to settle...');
      await new Promise(resolve => setTimeout(resolve, 2000));

      // Get device info
      await refreshDeviceInfoInternal();

      return true;
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to reconnect';
      setStatus('error');
      setError(message);
      debugLog(`Reconnect failed: ${message}`, undefined, 'error');
      return false;
    }
  }, [isSupported]);


  // Internal function to refresh device info with retries
  const refreshDeviceInfoInternal = async () => {
    if (!writerRef.current || !readerRef.current) {
      debugLog('Cannot refresh device info - no connection', undefined, 'warn');
      return;
    }

    debugLog('Refreshing device info...');
    const encoder = new TextEncoder();
    const decoder = new TextDecoder();

    // Reset bootloader mode detection
    setIsBootloaderMode(false);
    let detectedBootloader = false;

    // First, send a few newlines to clear any partial commands and wake up the device
    await writerRef.current.write(encoder.encode('\n\n\n'));
    await new Promise(resolve => setTimeout(resolve, 100));

    // Try up to 3 times to get device info
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        // Clear the string buffer
        readBufferRef.current = '';

        // Delay between attempts
        await new Promise(resolve => setTimeout(resolve, attempt === 0 ? 300 : 800));

        // Send GET_INFO command
        debugLog(`Sending GET_INFO command (attempt ${attempt + 1})`);
        await writerRef.current.write(encoder.encode('GET_INFO\n'));

        // Small delay to let the device process
        await new Promise(resolve => setTimeout(resolve, 100));

        const timeout = 5000;
        const startTime = Date.now();

        // Read responses, looking for INFO: line
        while (Date.now() - startTime < timeout) {
          const { value, done } = await readerRef.current.read();
          if (done) {
            debugLog('Reader done/closed');
            break;
          }

          if (value) {
            const chunk = decoder.decode(value);
            readBufferRef.current += chunk;
            const displayChunk = chunk.replace(/\n/g, '\\n').replace(/\r/g, '\\r').substring(0, 150);
            debugLog(`Received chunk: "${displayChunk}"`, { length: chunk.length });

            // Process complete lines
            let newlineIndex;
            while ((newlineIndex = readBufferRef.current.indexOf('\n')) !== -1) {
              const line = readBufferRef.current.substring(0, newlineIndex).trim();
              readBufferRef.current = readBufferRef.current.substring(newlineIndex + 1);

              // Skip empty lines
              if (!line) continue;

              // Check for bootloader mode indicators
              // "invalid header: 0x..." means ESP32 bootloader is trying to parse text as firmware
              // "ets Jul 29 2019" or similar is the ESP32 ROM boot message
              if (line.includes('invalid header:') ||
                  line.match(/^ets\s+(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s+\d+/) ||
                  line.includes('rst:0x') && line.includes('boot:0x')) {
                detectedBootloader = true;
                debugLog('Detected bootloader mode indicator', { line: line.substring(0, 80) }, 'warn');
                continue;
              }

              // Check for INFO: response first (most important)
              if (line.startsWith('INFO:')) {
                const jsonStr = line.substring(5).trim();
                debugLog(`Found INFO response: ${jsonStr}`);
                try {
                  const info = JSON.parse(jsonStr);
                  setDeviceInfo({
                    deviceId: info.deviceId || '',
                    macAddress: info.mac || '',
                    firmwareVersion: info.firmware || undefined,
                    isWifiConnected: info.connected === true,
                    ipAddress: info.ip || undefined,
                    ssid: info.ssid || undefined,
                    rssi: typeof info.rssi === 'number' ? info.rssi : undefined,
                  });
                  setIsBootloaderMode(false);
                  debugLog('Device info updated successfully', { firmware: info.firmware, deviceId: info.deviceId });
                  return; // Success!
                } catch (parseErr) {
                  debugLog(`JSON parse failed from: ${jsonStr}`, { error: String(parseErr) }, 'error');
                }
              }

              // Check for PONG (from PING) - indicates device is responsive
              if (line.startsWith('PONG:')) {
                debugLog('Device is responsive (PONG received)', { pong: line });
              }

              // Log other lines for debugging
              debugLog(`Line: ${line.substring(0, 100)}`);
            }
          }
        }

        debugLog(`GET_INFO attempt ${attempt + 1} timed out`, undefined, 'warn');
      } catch (err) {
        debugLog(`GET_INFO attempt ${attempt + 1} failed`, { error: String(err) }, 'error');
        await new Promise(resolve => setTimeout(resolve, 300));
      }
    }

    // If we detected bootloader mode, set the flag
    if (detectedBootloader) {
      setIsBootloaderMode(true);
      debugLog('Device is in bootloader mode - needs firmware flash', undefined, 'warn');
    }

    debugLog('Failed to get device info after 3 attempts', { remainingBuffer: readBufferRef.current.substring(0, 200), bootloaderMode: detectedBootloader }, 'error');
  };

  // Public function to refresh device info
  const refreshDeviceInfo = useCallback(async () => {
    if (status !== 'connected') return;
    await refreshDeviceInfoInternal();
  }, [status]);

  return {
    status,
    error,
    deviceInfo,
    isSupported,
    isSecureContext,
    isChromium,
    isBootloaderMode,
    connect,
    reconnect,
    disconnect,
    write,
    readLine,
    sendCommand,
    getPort,
    refreshDeviceInfo,
  };
}

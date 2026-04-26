declare module 'esptool-js' {
  export interface ESPLoaderOptions {
    transport: Transport;
    baudrate: number;
    romBaudrate: number;
    terminal?: {
      clean: () => void;
      writeLine: (data: string) => void;
      write: (data: string) => void;
    };
  }

  export interface FlashOptions {
    fileArray: Array<{
      data: Uint8Array;
      address: number;
    }>;
    flashSize: string;
    flashMode: string;
    flashFreq: string;
    eraseAll: boolean;
    compress: boolean;
    reportProgress?: (fileIndex: number, written: number, total: number) => void;
  }

  export class Transport {
    constructor(port: SerialPort, debug: boolean);
    disconnect(): Promise<void>;
  }

  export class ESPLoader {
    chip: { CHIP_NAME: string };
    constructor(options: ESPLoaderOptions);
    main(): Promise<void>;
    writeFlash(options: FlashOptions): Promise<void>;
    hardReset(): Promise<void>;
  }
}

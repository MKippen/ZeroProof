import { useQuery } from '@tanstack/react-query';
import api from '@/api/client';

interface DeviceInfo {
  mac: string;
  ip?: string;
  name?: string;
  hostname?: string;
  oui?: string;
  networkId?: string;
  networkName?: string;
  isWired?: boolean;
}

interface DeviceLookupResult {
  devices: Map<string, DeviceInfo>;
  getDeviceName: (ipOrMac: string) => string | undefined;
  getDeviceLabel: (ipOrMac: string) => string;
  isLoading: boolean;
}

/**
 * Hook to look up device names from UniFi config
 * Returns a map and helper functions to get device names by IP or MAC
 */
export function useDeviceLookup(): DeviceLookupResult {
  const { data, isLoading } = useQuery({
    queryKey: ['all-devices'],
    queryFn: async () => {
      const response = await api.get<{ devices: DeviceInfo[] }>('/intent/all-devices');
      return response.data?.devices || [];
    },
    staleTime: 5 * 60 * 1000, // Cache for 5 minutes
  });

  // Build lookup maps
  const devices = new Map<string, DeviceInfo>();
  if (data) {
    for (const device of data) {
      if (device.ip) {
        devices.set(device.ip, device);
      }
      if (device.mac) {
        devices.set(device.mac.toLowerCase(), device);
      }
    }
  }

  const getDeviceName = (ipOrMac: string): string | undefined => {
    const device = devices.get(ipOrMac) || devices.get(ipOrMac.toLowerCase());
    return device?.name || device?.hostname;
  };

  const getDeviceLabel = (ipOrMac: string): string => {
    const name = getDeviceName(ipOrMac);
    if (name) {
      return `${name} (${ipOrMac})`;
    }
    return ipOrMac;
  };

  return {
    devices,
    getDeviceName,
    getDeviceLabel,
    isLoading,
  };
}

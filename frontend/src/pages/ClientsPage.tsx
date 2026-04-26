import { useState, useMemo, useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  Users,
  Search,
  Wifi,
  Cable,
  ShieldCheck,
  ShieldAlert,
  Shield,
  Smartphone,
  Tablet,
  Laptop,
  Monitor,
  Tv,
  Camera,
  Speaker,
  Printer,
  Gamepad2,
  Router,
  Server,
  HardDrive,
  Thermometer,
  Lightbulb,
  Lock,
  Cpu,
  type LucideIcon,
} from 'lucide-react';
import { ClientDetailPanel } from '@/components/clients/ClientDetailPanel';
import api from '@/api/client';
import type { ClientsByNetworkData, NetworkGroup, NetworkGroupClient, TrustLevel } from '@/types';

function useDebounce(value: string, delay: number) {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(timer);
  }, [value, delay]);
  return debounced;
}

const trustOrder: Record<TrustLevel, number> = { trusted: 0, untrusted: 1, unknown: 2 };

// Keyword-to-icon rules, checked in order. First match wins.
// Each rule: [keywords to match, icon component]
const DEVICE_ICON_RULES: [string[], LucideIcon][] = [
  // Phones
  [['iphone', 'phone', 'pixel', 'galaxy s', 'android phone', 'oneplus', 'motorola phone'], Smartphone],
  // Tablets
  [['ipad', 'tablet', 'kindle', 'fire hd', 'galaxy tab', 'surface go'], Tablet],
  // Laptops
  [['macbook', 'laptop', 'thinkpad', 'chromebook', 'notebook', 'surface pro', 'surface laptop'], Laptop],
  // Desktops / PCs
  [['imac', 'mac mini', 'mac pro', 'mac studio', 'desktop', 'workstation', 'windows pc', 'nuc'], Monitor],
  // TVs & streaming
  [['tv', 'television', 'roku', 'fire stick', 'chromecast', 'appletv', 'apple tv', 'nvidia shield', 'firestick'], Tv],
  // Cameras
  [['camera', 'doorbell', 'ring', 'nest cam', 'arlo', 'wyze cam', 'unifi protect', 'g4', 'g5'], Camera],
  // Speakers & voice assistants
  [['speaker', 'homepod', 'echo', 'alexa', 'sonos', 'google home', 'nest hub', 'harman'], Speaker],
  // Printers
  [['printer', 'print', 'laserjet', 'inkjet', 'officejet', 'brother', 'epson printer'], Printer],
  // Gaming
  [['playstation', 'xbox', 'nintendo', 'switch', 'steam deck', 'gaming', 'ps5', 'ps4'], Gamepad2],
  // Network gear
  [['router', 'switch', 'access point', 'ap ', 'gateway', 'ubiquiti', 'unifi', 'mesh', 'beacon'], Router],
  // Servers / NAS
  [['server', 'nas', 'synology', 'qnap', 'truenas', 'proxmox', 'plex', 'unraid'], Server],
  // Storage
  [['hard drive', 'storage', 'backup'], HardDrive],
  // Thermostats / HVAC
  [['thermostat', 'ecobee', 'nest thermostat', 'hvac', 'climate'], Thermometer],
  // Lighting
  [['light', 'bulb', 'hue', 'lifx', 'wiz', 'nanoleaf', 'meross lighting', 'lamp'], Lightbulb],
  // Locks & security
  [['lock', 'alarm', 'security sensor', 'contact sensor'], Lock],
  // IoT / embedded / generic smart
  [['sensor', 'hub', 'bridge', 'espressif', 'esp32', 'esp8266', 'embedded', 'zigbee', 'z-wave', 'tuya', 'smart home', 'smart plug', 'plug', 'outlet', 'yolink', 'shelly'], Cpu],
];

/**
 * Infer a device icon by matching keywords against all available text
 * about the device (name, hostname, manufacturer, device_name from UniFi fingerprint).
 */
const GENERIC_HOSTNAMES = new Set([
  'watch', 'iphone', 'ipad', 'mac', 'macbook', 'samsung', 'android',
  'desktop', 'laptop', 'espressif', 'lwip0', 'unknown',
]);

/**
 * Strip common manufacturer suffixes to produce a short, readable name.
 * "Amazon Technologies Inc." → "Amazon", "Ubiquiti Inc" → "Ubiquiti"
 */
function cleanOui(oui: string): string {
  return oui
    .replace(/\s+(Inc\.?|LLC|Ltd\.?|Co\.?,?\s*Ltd\.?|Corp\.?|Corporation|Technologies|Electronics|Devices|International|Semiconductor|Communications?)\s*/gi, ' ')
    .replace(/,\s*/g, ' ')
    .trim();
}

/**
 * Build a display name with disambiguation for generic hostnames.
 * Returns [primaryName, subtitle].
 */
function clientDisplayInfo(client: NetworkGroupClient): [string, string | null] {
  // Fall back through: displayName → hostname → deviceName → cleaned OUI → 'Unknown'
  const name = client.displayName || client.hostname || client.deviceName
    || (client.oui ? cleanOui(client.oui) : null) || 'Unknown';
  const isGenericName = GENERIC_HOSTNAMES.has(name.toLowerCase());

  // If we have a displayName that differs from hostname, show hostname as subtitle
  if (client.displayName && client.hostname && client.displayName !== client.hostname) {
    return [client.displayName, client.hostname];
  }

  // If the name is generic, disambiguate with connected AP/switch name
  if (isGenericName && client.uplinkName) {
    return [name, client.uplinkName];
  }

  // If we have a device_name from UniFi fingerprint, show it as subtitle
  if (client.deviceName && client.deviceName !== name) {
    return [name, client.deviceName];
  }

  // Show AP/switch for any device as extra context
  if (client.uplinkName) {
    return [name, client.uplinkName];
  }

  return [name, null];
}

function inferDeviceIcon(client: NetworkGroupClient): LucideIcon {
  // Build a search corpus from all text fields
  const parts = [
    client.displayName,
    client.hostname,
    client.oui,
    client.deviceName,
  ].filter(Boolean);
  const corpus = parts.join(' ').toLowerCase();

  for (const [keywords, Icon] of DEVICE_ICON_RULES) {
    for (const kw of keywords) {
      if (corpus.includes(kw)) return Icon;
    }
  }

  // Fallback: wired devices get Monitor, wireless get Smartphone
  return client.isWired ? Monitor : Smartphone;
}

function TrustBadge({ level }: { level: TrustLevel }) {
  switch (level) {
    case 'trusted':
      return (
        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-green-500/20 text-green-400">
          <ShieldCheck className="h-3 w-3" />
          Trusted
        </span>
      );
    case 'untrusted':
      return (
        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-amber-500/20 text-amber-400">
          <ShieldAlert className="h-3 w-3" />
          Untrusted
        </span>
      );
    default:
      return (
        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-muted text-muted-foreground">
          <Shield className="h-3 w-3" />
          Unknown
        </span>
      );
  }
}

function NetworkCard({
  group,
  onClientClick,
}: {
  group: NetworkGroup;
  onClientClick: (mac: string) => void;
}) {
  const isUnassigned = group.networkId === null;

  return (
    <div className="rounded-lg border border-border/50 bg-card/50 overflow-hidden">
      {/* Card header */}
      <div className="p-4 border-b border-border/30 space-y-2">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between sm:gap-3">
          <div className="flex flex-wrap items-center gap-2 min-w-0">
            <h3 className="text-base font-semibold truncate">{group.name}</h3>
            {group.vlan !== null && (
              <span className="flex-shrink-0 px-2 py-0.5 rounded text-xs font-mono bg-blue-500/20 text-blue-400 border border-blue-500/30">
                VLAN {group.vlan}
              </span>
            )}
            {!isUnassigned && <TrustBadge level={group.trustLevel} />}
          </div>
          <span className="flex-shrink-0 text-sm text-muted-foreground">
            {group.clientCount} {group.clientCount === 1 ? 'client' : 'clients'}
          </span>
        </div>
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
          {group.subnet && <span>Subnet: {group.subnet}</span>}
          {group.intentPurpose && <span>Purpose: {group.intentPurpose}</span>}
          {group.ssids.length > 0 && (
            <span className="flex items-center gap-1">
              <Wifi className="h-3 w-3" />
              {group.ssids.join(', ')}
            </span>
          )}
        </div>
      </div>

      {/* Client table */}
      {group.clients.length > 0 ? (
        <div className="divide-y divide-border/20">
          {/* Table header */}
          <div className="hidden md:grid grid-cols-[24px_1fr_150px_120px_100px_80px_90px] gap-2 px-4 py-2 text-xs font-medium text-muted-foreground bg-muted/20">
            <span />
            <span>Name</span>
            <span>MAC</span>
            <span>IP</span>
            <span>Manufacturer</span>
            <span>Type</span>
            <span>Last Seen</span>
          </div>
          {group.clients.map((client) => {
            const DeviceIcon = inferDeviceIcon(client);
            const [primaryName, subtitle] = clientDisplayInfo(client);
            return (
              <div key={client.mac}>
                <button
                  className="hidden w-full md:grid grid-cols-[24px_1fr_150px_120px_100px_80px_90px] gap-2 px-4 py-2 text-sm hover:bg-muted/30 transition-colors items-center text-left"
                  onClick={() => onClientClick(client.mac)}
                >
                  <DeviceIcon className="h-4 w-4 text-muted-foreground" />
                  <div className="truncate">
                    <span className="font-medium">{primaryName}</span>
                    {subtitle && (
                      <span className="ml-1.5 text-xs text-muted-foreground">{subtitle}</span>
                    )}
                  </div>
                  <span className="font-mono text-xs text-muted-foreground truncate">{client.mac}</span>
                  <span className="font-mono text-xs truncate">{client.lastIp || '-'}</span>
                  <span className="text-xs text-muted-foreground truncate">{client.oui || '-'}</span>
                  <span>
                    {client.isWired ? (
                      <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
                        <Cable className="h-3 w-3" /> Wired
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
                        <Wifi className="h-3 w-3" /> WiFi
                      </span>
                    )}
                  </span>
                  <span className="text-xs text-muted-foreground">
                    {client.unifiLastSeen
                      ? new Date(client.unifiLastSeen).toLocaleDateString()
                      : '-'}
                  </span>
                </button>

                <button
                  className="w-full md:hidden px-4 py-3 text-left hover:bg-muted/30 transition-colors"
                  onClick={() => onClientClick(client.mac)}
                >
                  <div className="flex items-start gap-2">
                    <DeviceIcon className="h-4 w-4 text-muted-foreground mt-0.5" />
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium truncate">{primaryName}</p>
                      {subtitle && <p className="text-xs text-muted-foreground truncate">{subtitle}</p>}
                      <div className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1 text-xs">
                        <span className="font-mono text-muted-foreground truncate">{client.mac}</span>
                        <span className="font-mono truncate">{client.lastIp || '-'}</span>
                        <span className="text-muted-foreground truncate">{client.oui || '-'}</span>
                        <span className="text-muted-foreground">
                          {client.unifiLastSeen ? new Date(client.unifiLastSeen).toLocaleDateString() : '-'}
                        </span>
                      </div>
                      <div className="mt-2">
                        {client.isWired ? (
                          <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
                            <Cable className="h-3 w-3" /> Wired
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
                            <Wifi className="h-3 w-3" /> WiFi
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                </button>
              </div>
            );
          })}
        </div>
      ) : (
        <div className="px-4 py-6 text-center text-sm text-muted-foreground">
          No clients on this network
        </div>
      )}
    </div>
  );
}

export function ClientsPage() {
  const [search, setSearch] = useState('');
  const [selectedClient, setSelectedClient] = useState<string | null>(null);
  const debouncedSearch = useDebounce(search, 300);

  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ['clients-by-network', debouncedSearch],
    queryFn: async () => {
      const params = debouncedSearch ? `?search=${encodeURIComponent(debouncedSearch)}` : '';
      const res = await api.get<ClientsByNetworkData>(`/timeline/clients/by-network${params}`);
      if (!res.success || !res.data) {
        throw new Error(res.error?.message || 'Failed to fetch clients');
      }
      return res.data;
    },
    staleTime: 0,
    refetchOnMount: 'always',
  });

  // Sort networks: trusted first, then untrusted, then unknown, unassigned last
  const sortedNetworks = useMemo(() => {
    if (!data?.networks) return [];
    return [...data.networks].sort((a, b) => {
      const aIsUnassigned = a.networkId === null ? 1 : 0;
      const bIsUnassigned = b.networkId === null ? 1 : 0;
      if (aIsUnassigned !== bIsUnassigned) return aIsUnassigned - bIsUnassigned;
      const trustDiff = trustOrder[a.trustLevel] - trustOrder[b.trustLevel];
      if (trustDiff !== 0) return trustDiff;
      return a.name.localeCompare(b.name);
    });
  }, [data?.networks]);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Users className="h-6 w-6 text-orange-400" />
            Clients
          </h1>
          {data && (
            <p className="text-sm text-muted-foreground mt-1">
              {data.totalClients} clients across {data.networks.length} networks
            </p>
          )}
        </div>
      </div>

      {/* Search */}
      <div className="relative max-w-md">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <input
          type="text"
          placeholder="Search by name, MAC, IP, manufacturer..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="w-full pl-10 pr-4 py-2 rounded-lg border border-border/50 bg-card/50 text-sm focus:outline-none focus:ring-2 focus:ring-orange-500/30 focus:border-orange-500/50"
        />
      </div>

      {/* Content */}
      {isLoading ? (
        <div className="flex items-center justify-center py-16">
          <div className="animate-spin h-8 w-8 border-2 border-orange-500 border-t-transparent rounded-full" />
        </div>
      ) : isError ? (
        <div className="flex flex-col items-center justify-center py-16 text-muted-foreground">
          <Users className="h-12 w-12 mb-4 opacity-30" />
          <p className="text-lg font-medium">Unable to load clients</p>
          <p className="text-sm mt-1">
            {error instanceof Error ? error.message : 'The request failed. Try again.'}
          </p>
          <button
            onClick={() => refetch()}
            className="mt-4 px-4 py-2 rounded-lg border border-orange-500/40 text-orange-400 hover:bg-orange-500/10 transition-colors text-sm"
          >
            Retry
          </button>
        </div>
      ) : sortedNetworks.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-16 text-muted-foreground">
          <Users className="h-12 w-12 mb-4 opacity-30" />
          <p className="text-lg font-medium">No clients found</p>
          <p className="text-sm mt-1">
            {search
              ? 'Try adjusting your search terms.'
              : 'Sync your UniFi controller to discover network clients.'}
          </p>
        </div>
      ) : (
        <div className="space-y-4">
          {sortedNetworks.map((group) => (
            <NetworkCard
              key={group.networkId || 'unassigned'}
              group={group}
              onClientClick={(mac) => setSelectedClient(mac)}
            />
          ))}
        </div>
      )}

      {/* Client detail side panel */}
      {selectedClient && (
        <>
          <div
            className="fixed inset-0 z-40 bg-black/40 backdrop-blur-sm"
            onClick={() => setSelectedClient(null)}
          />
          <ClientDetailPanel
            mac={selectedClient}
            onClose={() => setSelectedClient(null)}
          />
        </>
      )}
    </div>
  );
}

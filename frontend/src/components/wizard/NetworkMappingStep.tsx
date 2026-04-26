import { Network, Info } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { filterInternalNetworks } from '@/lib/utils';
import type { NetworkIntentProfile, UniFiNetwork, NetworkMappings } from '@/types';

interface NetworkMappingStepProps {
  profile: Partial<NetworkIntentProfile>;
  networks: UniFiNetwork[];
  mappings: NetworkMappings;
  onMappingChange: (mappings: NetworkMappings) => void;
}

interface MappingOption {
  field: keyof NetworkMappings;
  label: string;
  description: string;
  showIf: (profile: Partial<NetworkIntentProfile>) => boolean;
}

const mappingOptions: MappingOption[] = [
  {
    field: 'workNetworkId',
    label: 'Work/Office Network',
    description: 'The network for your work devices that should be isolated',
    showIf: (p) => p.workFromHome === true && p.workDeviceIsolation === true,
  },
  {
    field: 'iotNetworkId',
    label: 'IoT/Smart Home Network',
    description: 'The network for your smart home devices',
    showIf: (p) => p.hasIoT === true,
  },
  {
    field: 'guestNetworkId',
    label: 'Guest Network',
    description: 'The network for guest/visitor access',
    showIf: (p) => p.guestNetwork === true,
  },
  {
    field: 'trustedNetworkId',
    label: 'Trusted/Main Network',
    description: 'Your primary trusted network for personal devices',
    showIf: () => true, // Always show
  },
  {
    field: 'nasNetworkId',
    label: 'NAS/Storage Network',
    description: 'The network where your NAS or storage devices are located',
    showIf: (p) => p.hasNAS === true,
  },
  {
    field: 'serverNetworkId',
    label: 'Server Network',
    description: 'The network for your home server with external access',
    showIf: (p) => p.homeServer === true,
  },
];

export function NetworkMappingStep({
  profile,
  networks,
  mappings,
  onMappingChange,
}: NetworkMappingStepProps) {
  const visibleMappings = mappingOptions.filter((opt) => opt.showIf(profile));

  // Filter out WAN/Internet networks - these aren't internal networks users would map
  const internalNetworks = filterInternalNetworks(networks);

  const handleChange = (field: keyof NetworkMappings, value: string) => {
    onMappingChange({
      ...mappings,
      [field]: value === '__none__' ? undefined : value || undefined,
    });
  };

  if (internalNetworks.length === 0) {
    return (
      <div className="space-y-6">
        <div className="text-center">
          <h2 className="text-2xl font-bold mb-2">Map Your Networks</h2>
          <p className="text-muted-foreground">
            Tell us which UniFi network serves each purpose
          </p>
        </div>

        <Card className="border-yellow-500/30 bg-yellow-500/5">
          <CardContent className="pt-6">
            <div className="flex items-start gap-3">
              <Info className="h-5 w-5 text-yellow-500 mt-0.5" />
              <div>
                <h4 className="font-medium">No UniFi Configuration Found</h4>
                <p className="text-sm text-muted-foreground mt-1">
                  You can skip this step for now. After importing your UniFi configuration,
                  you can map your networks on the Intent Analysis.
                </p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="text-center">
        <h2 className="text-2xl font-bold mb-2">Map Your Networks</h2>
        <p className="text-muted-foreground">
          Tell us which UniFi network serves each purpose so we can validate your setup
        </p>
      </div>

      <Card className="bg-muted/30">
        <CardContent className="pt-6">
          <div className="flex items-start gap-3">
            <Network className="h-5 w-5 text-orange-400 mt-0.5" />
            <div>
              <h4 className="font-medium">Why Map Networks?</h4>
              <p className="text-sm text-muted-foreground mt-1">
                By telling us which network is used for what purpose, we can accurately
                check if your firewall rules and isolation settings match your goals.
              </p>
            </div>
          </div>
        </CardContent>
      </Card>

      <div className="space-y-4">
        {visibleMappings.map((option) => (
          <Card key={option.field}>
            <CardContent className="pt-6">
              <div className="flex items-start justify-between gap-4">
                <div className="flex-1">
                  <h4 className="font-medium">{option.label}</h4>
                  <p className="text-sm text-muted-foreground">{option.description}</p>
                </div>
                <div className="w-64">
                  <Select
                    value={mappings[option.field] || '__none__'}
                    onValueChange={(value) => handleChange(option.field, value)}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Select network..." />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="__none__">Not mapped</SelectItem>
                      {internalNetworks.map((network) => (
                        <SelectItem key={network._id} value={network._id}>
                          <div className="flex items-center gap-2">
                            <span>{network.name}</span>
                            {network.vlan_enabled && network.vlan && (
                              <Badge variant="secondary" className="text-xs">
                                VLAN {network.vlan}
                              </Badge>
                            )}
                          </div>
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {visibleMappings.length === 0 && (
        <Card>
          <CardContent className="pt-6 text-center text-muted-foreground">
            <p>No network mappings needed based on your preferences.</p>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

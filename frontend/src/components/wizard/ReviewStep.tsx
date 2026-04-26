import {
  CheckCircle2,
  Briefcase,
  Cpu,
  Users,
  Shield,
  Network,
} from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import type { NetworkIntentProfile, NetworkMappings, UniFiNetwork } from '@/types';

interface ReviewStepProps {
  profile: Partial<NetworkIntentProfile>;
  mappings?: NetworkMappings;
  networks?: UniFiNetwork[];
  onSubmit: () => void;
  onBack: () => void;
  isSubmitting: boolean;
}

interface SectionProps {
  title: string;
  icon: React.ReactNode;
  items: { label: string; value: string | boolean; highlight?: boolean }[];
}

function ReviewSection({ title, icon, items }: SectionProps) {
  const hasEnabledItems = items.some((item) => item.value === true || item.value !== false);

  if (!hasEnabledItems) return null;

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
        {icon}
        {title}
      </div>
      <div className="pl-6 space-y-1">
        {items
          .filter((item) => item.value !== false)
          .map((item, index) => (
            <div key={index} className="flex items-center gap-2 text-sm">
              <CheckCircle2 className="h-4 w-4 text-green-500" />
              <span>{item.label}</span>
              {typeof item.value === 'string' && (
                <Badge variant="secondary" className={cn(item.highlight && 'bg-orange-500/20 text-orange-400')}>
                  {item.value}
                </Badge>
              )}
            </div>
          ))}
      </div>
    </div>
  );
}

export function ReviewStep({
  profile,
  mappings = {},
  networks = [],
  onSubmit,
  onBack,
  isSubmitting,
}: ReviewStepProps) {
  const securityLevelLabel = {
    maximum: 'Maximum Security',
    balanced: 'Balanced',
    convenience: 'Convenience',
  };

  const iotAccessLabel = {
    full: 'Full Internet',
    limited: 'Limited Internet',
    none: 'Local Only',
  };

  const nasAccessLabel = {
    all: 'All Networks',
    trusted: 'Trusted Only',
    specific_vlans: 'Specific VLANs',
  };

  const interVlanLabel = {
    allow: 'Allow by Default',
    deny: 'Deny by Default',
  };

  // Helper to get network name by ID
  const getNetworkName = (id: string | undefined): string | null => {
    if (!id) return null;
    const network = networks.find((n) => n._id === id);
    return network ? network.name : null;
  };

  // Build DNS filtering network names
  const dnsFilteringNetworkNames = (profile.dnsFilteringNetworks || [])
    .map((id) => getNetworkName(id))
    .filter((name): name is string => name !== null);

  // Build DNS filtering display value
  const getDnsFilteringDisplay = (): string | false => {
    if (!profile.dnsFiltering) return false;
    const parts: string[] = [];
    if (profile.dnsFilteringServerIp) {
      parts.push(`Server: ${profile.dnsFilteringServerIp}`);
    }
    if (dnsFilteringNetworkNames.length > 0) {
      parts.push(`Networks: ${dnsFilteringNetworkNames.join(', ')}`);
    } else if (!profile.dnsFilteringServerIp) {
      parts.push('All networks');
    }
    return parts.join(' | ') || 'Enabled';
  };

  // Build network mapping items
  const networkMappingItems: { label: string; value: string | boolean }[] = [];

  if (mappings.trustedNetworkId) {
    const name = getNetworkName(mappings.trustedNetworkId);
    if (name) networkMappingItems.push({ label: 'Trusted/Main Network', value: name });
  }
  if (profile.workDeviceIsolation && mappings.workNetworkId) {
    const name = getNetworkName(mappings.workNetworkId);
    if (name) networkMappingItems.push({ label: 'Work Network', value: name });
  }
  if (profile.hasIoT && mappings.iotNetworkId) {
    const name = getNetworkName(mappings.iotNetworkId);
    if (name) networkMappingItems.push({ label: 'IoT Network', value: name });
  }
  if (profile.guestNetwork && mappings.guestNetworkId) {
    const name = getNetworkName(mappings.guestNetworkId);
    if (name) networkMappingItems.push({ label: 'Guest Network', value: name });
  }
  if (profile.hasNAS && mappings.nasNetworkId) {
    const name = getNetworkName(mappings.nasNetworkId);
    if (name) networkMappingItems.push({ label: 'NAS Network', value: name });
  }
  if (profile.homeServer && mappings.serverNetworkId) {
    const name = getNetworkName(mappings.serverNetworkId);
    if (name) networkMappingItems.push({ label: 'Server Network', value: name });
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <CheckCircle2 className="h-5 w-5 text-green-500" />
          Review Your Network Intent
        </CardTitle>
        <CardDescription>
          This is your ideal network setup. We&apos;ll check your actual configuration against this.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        <div className="p-4 rounded-lg bg-muted/50 space-y-4">
          <ReviewSection
            title="Work & Business"
            icon={<Briefcase className="h-4 w-4" />}
            items={[
              { label: 'Work from home', value: profile.workFromHome || false },
              { label: 'Work device isolation', value: profile.workDeviceIsolation || false },
              { label: 'Uses work VPN', value: profile.workVpn || false },
              { label: 'Runs home server', value: profile.homeServer || false },
            ]}
          />

          <ReviewSection
            title="Devices"
            icon={<Cpu className="h-4 w-4" />}
            items={[
              { label: 'IoT/Smart Home devices', value: profile.hasIoT || false },
              { label: 'IoT isolation', value: profile.iotIsolation || false },
              {
                label: 'IoT Internet access',
                value: profile.hasIoT ? iotAccessLabel[profile.iotInternetAccess || 'full'] : false,
              },
              { label: 'Gaming/Streaming devices', value: profile.hasGaming || false },
              { label: 'Network storage (NAS)', value: profile.hasNAS || false },
              {
                label: 'NAS accessible from',
                value: profile.hasNAS ? nasAccessLabel[profile.nasAccessibleFrom || 'all'] : false,
              },
            ]}
          />

          <ReviewSection
            title="Guest Access"
            icon={<Users className="h-4 w-4" />}
            items={[
              { label: 'Guest WiFi network', value: profile.guestNetwork || false },
              { label: 'Guest isolation', value: profile.guestIsolation || false },
              { label: 'Guest bandwidth limits', value: profile.guestBandwidthLimit || false },
            ]}
          />

          <ReviewSection
            title="Security"
            icon={<Shield className="h-4 w-4" />}
            items={[
              {
                label: 'Security level',
                value: securityLevelLabel[profile.securityLevel || 'balanced'],
                highlight: true,
              },
              {
                label: 'DNS filtering (ads/trackers)',
                value: getDnsFilteringDisplay(),
              },
              { label: 'Malware blocking', value: profile.malwareBlocking || false },
              {
                label: 'Inter-VLAN default',
                value: interVlanLabel[profile.interVlanDefault || 'allow'],
              },
            ]}
          />

          {networkMappingItems.length > 0 && (
            <ReviewSection
              title="Network Mappings"
              icon={<Network className="h-4 w-4" />}
              items={networkMappingItems}
            />
          )}

          {networks.length > 0 && networkMappingItems.length === 0 && (
            <div className="space-y-2">
              <div className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
                <Network className="h-4 w-4" />
                Network Mappings
              </div>
              <div className="pl-6 text-sm text-muted-foreground">
                No networks mapped. You can map them later on the Intent Analysis.
              </div>
            </div>
          )}
        </div>

        <div className="p-4 rounded-lg border border-orange-500/30 bg-orange-500/5">
          <div className="flex items-start gap-3">
            <Shield className="h-5 w-5 text-orange-400 mt-0.5" />
            <div>
              <p className="font-medium text-orange-400">What happens next?</p>
              <p className="text-sm text-muted-foreground mt-1">
                After saving your intent profile, we&apos;ll analyze your current UniFi configuration
                and show you where your actual setup differs from your goals. You&apos;ll get specific
                recommendations for changes to make.
              </p>
            </div>
          </div>
        </div>

        <div className="flex justify-between pt-4">
          <Button variant="outline" onClick={onBack} disabled={isSubmitting}>
            Back
          </Button>
          <Button onClick={onSubmit} disabled={isSubmitting}>
            {isSubmitting ? 'Saving...' : 'Save Intent Profile'}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

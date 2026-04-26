import { Shield, ShieldAlert, Filter, Bug, Network, Check, Server } from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { cn, filterInternalNetworks } from '@/lib/utils';
import type { UniFiNetwork } from '@/types';

interface SecurityStepProps {
  securityLevel: 'maximum' | 'balanced' | 'convenience';
  dnsFiltering: boolean;
  dnsFilteringNetworks: string[];
  dnsFilteringServerIp: string;
  malwareBlocking: boolean;
  interVlanDefault: 'allow' | 'deny';
  networks: UniFiNetwork[];
  onChange: (field: string, value: boolean | string | string[]) => void;
  onNext: () => void;
  onBack: () => void;
}

interface ToggleCardProps {
  title: string;
  description: string;
  icon: React.ReactNode;
  selected: boolean;
  onToggle: () => void;
  disabled?: boolean;
}

function ToggleCard({ title, description, icon, selected, onToggle, disabled }: ToggleCardProps) {
  return (
    <button
      type="button"
      onClick={onToggle}
      disabled={disabled}
      className={cn(
        'w-full p-4 rounded-lg border-2 text-left transition-all duration-200',
        selected
          ? 'border-orange-500 bg-orange-500/10'
          : 'border-border hover:border-muted-foreground/50',
        disabled && 'opacity-50 cursor-not-allowed'
      )}
    >
      <div className="flex items-start gap-4">
        <div
          className={cn(
            'p-2 rounded-lg',
            selected ? 'bg-orange-500/20 text-orange-400' : 'bg-muted text-muted-foreground'
          )}
        >
          {icon}
        </div>
        <div className="flex-1">
          <p className="font-medium">{title}</p>
          <p className="text-sm text-muted-foreground">{description}</p>
        </div>
        <div
          className={cn(
            'w-6 h-6 rounded-full border-2 flex items-center justify-center',
            selected
              ? 'border-orange-500 bg-orange-500'
              : 'border-muted-foreground/50'
          )}
        >
          {selected && (
            <svg className="w-4 h-4 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
            </svg>
          )}
        </div>
      </div>
    </button>
  );
}

interface SecurityLevelCardProps {
  level: 'maximum' | 'balanced' | 'convenience';
  title: string;
  description: string;
  icon: React.ReactNode;
  selected: boolean;
  onSelect: () => void;
}

function SecurityLevelCard({
  level,
  title,
  description,
  icon,
  selected,
  onSelect,
}: SecurityLevelCardProps) {
  const colors = {
    maximum: 'text-red-400 bg-red-500/20',
    balanced: 'text-orange-400 bg-orange-500/20',
    convenience: 'text-green-400 bg-green-500/20',
  };

  return (
    <button
      type="button"
      onClick={onSelect}
      className={cn(
        'flex-1 p-4 rounded-lg border-2 text-center transition-all duration-200',
        selected
          ? 'border-orange-500 bg-orange-500/10'
          : 'border-border hover:border-muted-foreground/50'
      )}
    >
      <div className={cn('w-12 h-12 rounded-full mx-auto mb-3 flex items-center justify-center', colors[level])}>
        {icon}
      </div>
      <p className={cn('font-medium', selected && 'text-orange-400')}>{title}</p>
      <p className="text-xs text-muted-foreground mt-1">{description}</p>
    </button>
  );
}

export function SecurityStep({
  securityLevel,
  dnsFiltering,
  dnsFilteringNetworks,
  dnsFilteringServerIp,
  malwareBlocking,
  interVlanDefault,
  networks,
  onChange,
  onNext,
  onBack,
}: SecurityStepProps) {
  // Filter to only show internal networks (exclude WAN/Internet)
  const filteredNetworks = filterInternalNetworks(networks);

  const toggleNetworkSelection = (networkId: string) => {
    const current = dnsFilteringNetworks || [];
    if (current.includes(networkId)) {
      onChange('dnsFilteringNetworks', current.filter((id) => id !== networkId));
    } else {
      onChange('dnsFilteringNetworks', [...current, networkId]);
    }
  };

  const selectAllNetworks = () => {
    onChange('dnsFilteringNetworks', filteredNetworks.map((n) => n._id));
  };

  const clearAllNetworks = () => {
    onChange('dnsFilteringNetworks', []);
  };
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Shield className="h-5 w-5 text-orange-400" />
          Security Preferences
        </CardTitle>
        <CardDescription>
          Choose your security posture and additional protections
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        <div className="space-y-3">
          <p className="text-sm font-medium">Security Priority</p>
          <div className="grid grid-cols-3 gap-3">
            <SecurityLevelCard
              level="maximum"
              title="Maximum"
              description="Strictest rules, may require more setup"
              icon={<ShieldAlert className="h-6 w-6" />}
              selected={securityLevel === 'maximum'}
              onSelect={() => onChange('securityLevel', 'maximum')}
            />
            <SecurityLevelCard
              level="balanced"
              title="Balanced"
              description="Good security with reasonable convenience"
              icon={<Shield className="h-6 w-6" />}
              selected={securityLevel === 'balanced'}
              onSelect={() => onChange('securityLevel', 'balanced')}
            />
            <SecurityLevelCard
              level="convenience"
              title="Convenience"
              description="Easier setup, basic protection"
              icon={<Shield className="h-6 w-6" />}
              selected={securityLevel === 'convenience'}
              onSelect={() => onChange('securityLevel', 'convenience')}
            />
          </div>
        </div>

        <div className="space-y-4">
          <ToggleCard
            title="DNS filtering (block ads & trackers)"
            description="Use DNS-based filtering to block advertisements and tracking"
            icon={<Filter className="h-5 w-5" />}
            selected={dnsFiltering}
            onToggle={() => onChange('dnsFiltering', !dnsFiltering)}
          />

          {/* DNS filtering configuration */}
          {dnsFiltering && (
            <div className="ml-6 p-4 rounded-lg border border-border bg-muted/30 space-y-4">
              {/* DNS Server IP input */}
              <div className="space-y-2">
                <div className="flex items-center gap-2">
                  <Server className="h-4 w-4 text-muted-foreground" />
                  <p className="text-sm font-medium">DNS Filtering Server IP</p>
                </div>
                <Input
                  type="text"
                  placeholder="e.g., 192.168.2.250 (AdGuard, Pi-hole)"
                  value={dnsFilteringServerIp || ''}
                  onChange={(e) => onChange('dnsFilteringServerIp', e.target.value)}
                  className="font-mono"
                />
                <p className="text-xs text-muted-foreground">
                  Enter the IP address of your DNS filtering server (AdGuard Home, Pi-hole, NextDNS, etc.)
                </p>
              </div>

              {/* Network selection for DNS filtering */}
              {filteredNetworks.length > 0 && (
                <div className="space-y-3 pt-2 border-t border-border/50">
                  <div className="flex items-center justify-between">
                    <p className="text-sm font-medium">Which networks should use DNS filtering?</p>
                    <div className="flex gap-2">
                      <button
                        type="button"
                        onClick={selectAllNetworks}
                        className="text-xs text-orange-400 hover:text-orange-300"
                      >
                        Select All
                      </button>
                      <span className="text-muted-foreground">|</span>
                      <button
                        type="button"
                        onClick={clearAllNetworks}
                        className="text-xs text-muted-foreground hover:text-foreground"
                      >
                        Clear
                      </button>
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    {filteredNetworks.map((network) => {
                      const isSelected = dnsFilteringNetworks?.includes(network._id);
                      return (
                        <button
                          key={network._id}
                          type="button"
                          onClick={() => toggleNetworkSelection(network._id)}
                          className={cn(
                            'flex items-center gap-2 p-2 rounded border text-sm text-left transition-colors',
                            isSelected
                              ? 'border-orange-500 bg-orange-500/10 text-orange-400'
                              : 'border-border hover:border-muted-foreground/50'
                          )}
                        >
                          <div
                            className={cn(
                              'w-4 h-4 rounded border flex items-center justify-center flex-shrink-0',
                              isSelected
                                ? 'bg-orange-500 border-orange-500'
                                : 'border-muted-foreground/50'
                            )}
                          >
                            {isSelected && <Check className="h-3 w-3 text-white" />}
                          </div>
                          <span className="truncate">{network.name}</span>
                          {network.vlan && (
                            <span className="text-xs text-muted-foreground ml-auto">
                              VLAN {network.vlan}
                            </span>
                          )}
                        </button>
                      );
                    })}
                  </div>
                  {dnsFilteringNetworks?.length === 0 && (
                    <p className="text-xs text-muted-foreground">
                      Select networks that should use your filtering DNS server
                    </p>
                  )}
                </div>
              )}
            </div>
          )}

          <ToggleCard
            title="Block known malicious sites"
            description="Prevent access to known malware, phishing, and other dangerous websites"
            icon={<Bug className="h-5 w-5" />}
            selected={malwareBlocking}
            onToggle={() => onChange('malwareBlocking', !malwareBlocking)}
          />
        </div>

        <div className="space-y-3">
          <p className="text-sm font-medium">Inter-VLAN Communication Default</p>
          <div className="grid grid-cols-2 gap-3">
            <button
              type="button"
              onClick={() => onChange('interVlanDefault', 'deny')}
              className={cn(
                'p-4 rounded-lg border-2 text-left transition-all duration-200',
                interVlanDefault === 'deny'
                  ? 'border-orange-500 bg-orange-500/10'
                  : 'border-border hover:border-muted-foreground/50'
              )}
            >
              <div className="flex items-center gap-3">
                <Network className={cn('h-5 w-5', interVlanDefault === 'deny' && 'text-orange-400')} />
                <div>
                  <p className={cn('font-medium', interVlanDefault === 'deny' && 'text-orange-400')}>
                    Deny by Default
                  </p>
                  <p className="text-xs text-muted-foreground">
                    VLANs cannot talk unless explicitly allowed (more secure)
                  </p>
                </div>
              </div>
            </button>

            <button
              type="button"
              onClick={() => onChange('interVlanDefault', 'allow')}
              className={cn(
                'p-4 rounded-lg border-2 text-left transition-all duration-200',
                interVlanDefault === 'allow'
                  ? 'border-orange-500 bg-orange-500/10'
                  : 'border-border hover:border-muted-foreground/50'
              )}
            >
              <div className="flex items-center gap-3">
                <Network className={cn('h-5 w-5', interVlanDefault === 'allow' && 'text-orange-400')} />
                <div>
                  <p className={cn('font-medium', interVlanDefault === 'allow' && 'text-orange-400')}>
                    Allow by Default
                  </p>
                  <p className="text-xs text-muted-foreground">
                    VLANs can communicate unless blocked (more convenient)
                  </p>
                </div>
              </div>
            </button>
          </div>
        </div>

        <div className="flex justify-between pt-4">
          <Button variant="outline" onClick={onBack}>
            Back
          </Button>
          <Button onClick={onNext}>
            Continue
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

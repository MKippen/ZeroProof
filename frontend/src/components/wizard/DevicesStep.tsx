import { Cpu, Shield, Wifi, Gamepad2, HardDrive } from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

interface DevicesStepProps {
  hasIoT: boolean;
  iotIsolation: boolean;
  iotInternetAccess: 'full' | 'limited' | 'none';
  hasGaming: boolean;
  hasNAS: boolean;
  nasAccessibleFrom: 'all' | 'trusted' | 'specific_vlans';
  onChange: (field: string, value: boolean | string) => void;
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

interface OptionButtonProps {
  label: string;
  description?: string;
  selected: boolean;
  onSelect: () => void;
}

function OptionButton({ label, description, selected, onSelect }: OptionButtonProps) {
  return (
    <button
      type="button"
      onClick={onSelect}
      className={cn(
        'flex-1 p-3 rounded-lg border-2 text-center transition-all duration-200',
        selected
          ? 'border-orange-500 bg-orange-500/10'
          : 'border-border hover:border-muted-foreground/50'
      )}
    >
      <p className={cn('font-medium text-sm', selected && 'text-orange-400')}>{label}</p>
      {description && (
        <p className="text-xs text-muted-foreground mt-1">{description}</p>
      )}
    </button>
  );
}

export function DevicesStep({
  hasIoT,
  iotIsolation,
  iotInternetAccess,
  hasGaming,
  hasNAS,
  nasAccessibleFrom,
  onChange,
  onNext,
  onBack,
}: DevicesStepProps) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Cpu className="h-5 w-5 text-orange-400" />
          Device Categories
        </CardTitle>
        <CardDescription>
          Tell us about the types of devices on your network
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <ToggleCard
          title="IoT / Smart Home Devices"
          description="Cameras, thermostats, smart speakers, smart lights, etc."
          icon={<Wifi className="h-5 w-5" />}
          selected={hasIoT}
          onToggle={() => onChange('hasIoT', !hasIoT)}
        />

        {hasIoT && (
          <div className="ml-6 space-y-4 border-l-2 border-orange-500/30 pl-4">
            <ToggleCard
              title="Isolate IoT devices"
              description="Keep smart devices separate from your main network"
              icon={<Shield className="h-5 w-5" />}
              selected={iotIsolation}
              onToggle={() => onChange('iotIsolation', !iotIsolation)}
            />

            <div className="space-y-2">
              <p className="text-sm font-medium">IoT Internet Access</p>
              <div className="flex gap-2">
                <OptionButton
                  label="Full Access"
                  description="Normal internet"
                  selected={iotInternetAccess === 'full'}
                  onSelect={() => onChange('iotInternetAccess', 'full')}
                />
                <OptionButton
                  label="Limited"
                  description="Restricted ports"
                  selected={iotInternetAccess === 'limited'}
                  onSelect={() => onChange('iotInternetAccess', 'limited')}
                />
                <OptionButton
                  label="Local Only"
                  description="No internet"
                  selected={iotInternetAccess === 'none'}
                  onSelect={() => onChange('iotInternetAccess', 'none')}
                />
              </div>
            </div>
          </div>
        )}

        <ToggleCard
          title="Gaming Consoles / Streaming"
          description="PlayStation, Xbox, Nintendo, Apple TV, Roku, etc."
          icon={<Gamepad2 className="h-5 w-5" />}
          selected={hasGaming}
          onToggle={() => onChange('hasGaming', !hasGaming)}
        />

        <ToggleCard
          title="Network Storage (NAS)"
          description="Synology, QNAP, TrueNAS, or similar network storage"
          icon={<HardDrive className="h-5 w-5" />}
          selected={hasNAS}
          onToggle={() => onChange('hasNAS', !hasNAS)}
        />

        {hasNAS && (
          <div className="ml-6 space-y-2 border-l-2 border-orange-500/30 pl-4">
            <p className="text-sm font-medium">NAS Accessible From</p>
            <div className="flex gap-2">
              <OptionButton
                label="All Networks"
                selected={nasAccessibleFrom === 'all'}
                onSelect={() => onChange('nasAccessibleFrom', 'all')}
              />
              <OptionButton
                label="Trusted Only"
                selected={nasAccessibleFrom === 'trusted'}
                onSelect={() => onChange('nasAccessibleFrom', 'trusted')}
              />
              <OptionButton
                label="Specific VLANs"
                selected={nasAccessibleFrom === 'specific_vlans'}
                onSelect={() => onChange('nasAccessibleFrom', 'specific_vlans')}
              />
            </div>
          </div>
        )}

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

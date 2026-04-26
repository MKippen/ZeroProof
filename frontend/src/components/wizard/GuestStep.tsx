import { Users, Shield, Gauge } from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

interface GuestStepProps {
  guestNetwork: boolean;
  guestIsolation: boolean;
  guestBandwidthLimit: boolean;
  onChange: (field: string, value: boolean) => void;
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

export function GuestStep({
  guestNetwork,
  guestIsolation,
  guestBandwidthLimit,
  onChange,
  onNext,
  onBack,
}: GuestStepProps) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Users className="h-5 w-5 text-orange-400" />
          Guest & Visitor Access
        </CardTitle>
        <CardDescription>
          Configure how guests can access your network
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <ToggleCard
          title="I need a guest WiFi network"
          description="Allow visitors to connect to the internet without accessing your devices"
          icon={<Users className="h-5 w-5" />}
          selected={guestNetwork}
          onToggle={() => onChange('guestNetwork', !guestNetwork)}
        />

        {guestNetwork && (
          <div className="ml-6 space-y-4 border-l-2 border-orange-500/30 pl-4">
            <ToggleCard
              title="Complete guest isolation"
              description="Guests cannot see or access any of your devices or network resources"
              icon={<Shield className="h-5 w-5" />}
              selected={guestIsolation}
              onToggle={() => onChange('guestIsolation', !guestIsolation)}
            />

            <ToggleCard
              title="Limit guest bandwidth"
              description="Prevent guests from using all your internet bandwidth"
              icon={<Gauge className="h-5 w-5" />}
              selected={guestBandwidthLimit}
              onToggle={() => onChange('guestBandwidthLimit', !guestBandwidthLimit)}
            />
          </div>
        )}

        {!guestNetwork && (
          <div className="p-4 rounded-lg bg-muted/50 text-sm text-muted-foreground">
            <p>
              Without a guest network, visitors would need to connect to your main
              network, potentially gaining access to your devices and data.
            </p>
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

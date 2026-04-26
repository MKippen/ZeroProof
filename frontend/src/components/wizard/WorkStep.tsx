import { Briefcase, Shield, Globe, Server } from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

interface WorkStepProps {
  workFromHome: boolean;
  workDeviceIsolation: boolean;
  workVpn: boolean;
  homeServer: boolean;
  onChange: (field: string, value: boolean) => void;
  onNext: () => void;
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

export function WorkStep({
  workFromHome,
  workDeviceIsolation,
  workVpn,
  homeServer,
  onChange,
  onNext,
}: WorkStepProps) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Briefcase className="h-5 w-5 text-orange-400" />
          Work & Business Use
        </CardTitle>
        <CardDescription>
          Tell us about how you use your network for work
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <ToggleCard
          title="I work from home"
          description="You use your home network for work-related tasks"
          icon={<Briefcase className="h-5 w-5" />}
          selected={workFromHome}
          onToggle={() => onChange('workFromHome', !workFromHome)}
        />

        {workFromHome && (
          <div className="ml-6 space-y-4 border-l-2 border-orange-500/30 pl-4">
            <ToggleCard
              title="Isolate work devices"
              description="Keep work devices separate from personal devices for security"
              icon={<Shield className="h-5 w-5" />}
              selected={workDeviceIsolation}
              onToggle={() => onChange('workDeviceIsolation', !workDeviceIsolation)}
            />

            <ToggleCard
              title="I use a work VPN"
              description="Your employer provides a VPN for secure access to work resources"
              icon={<Globe className="h-5 w-5" />}
              selected={workVpn}
              onToggle={() => onChange('workVpn', !workVpn)}
            />
          </div>
        )}

        <ToggleCard
          title="I run a home server"
          description="You host services that need external access (Plex, game servers, etc.)"
          icon={<Server className="h-5 w-5" />}
          selected={homeServer}
          onToggle={() => onChange('homeServer', !homeServer)}
        />

        <div className="flex justify-end pt-4">
          <Button onClick={onNext}>
            Continue
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

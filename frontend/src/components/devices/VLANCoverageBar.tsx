import { AlertTriangle, CheckCircle2, Wifi } from 'lucide-react';
import { Progress } from '@/components/ui/progress';
import { cn } from '@/lib/utils';

interface VLANCoverageBarProps {
  totalVlans: number;
  coveredVlans: number;
  hostValidatedVlans?: number;
  className?: string;
}

export function VLANCoverageBar({
  totalVlans,
  coveredVlans,
  hostValidatedVlans = 0,
  className,
}: VLANCoverageBarProps) {
  if (totalVlans === 0) {
    return (
      <div className={cn('p-4 rounded-lg border bg-muted/50', className)}>
        <div className="flex items-center gap-2 text-muted-foreground">
          <Wifi className="h-4 w-4" />
          <span>No VLANs mapped to intent categories</span>
        </div>
        <p className="text-xs text-muted-foreground mt-1">
          Configure network mappings in the Network Intent Wizard to see VLAN coverage.
        </p>
      </div>
    );
  }

  const percentage = Math.round((coveredVlans / totalVlans) * 100);
  const isFullCoverage = coveredVlans === totalVlans;
  const uncoveredCount = totalVlans - coveredVlans;

  return (
    <div className={cn('p-4 rounded-lg border', className, {
      'bg-green-500/10 border-green-500/30': isFullCoverage,
      'bg-yellow-500/10 border-yellow-500/30': !isFullCoverage,
    })}>
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
          {isFullCoverage ? (
            <CheckCircle2 className="h-4 w-4 text-green-500" />
          ) : (
            <AlertTriangle className="h-4 w-4 text-yellow-500" />
          )}
          <span className="font-medium">
            VLAN Coverage: {coveredVlans}/{totalVlans} VLANs have test devices
          </span>
        </div>
        <span className={cn('text-sm font-medium', {
          'text-green-500': isFullCoverage,
          'text-yellow-500': !isFullCoverage,
        })}>
          {percentage}%
        </span>
      </div>
      <Progress
        value={percentage}
        className={cn('h-2', {
          '[&>div]:bg-green-500': isFullCoverage,
          '[&>div]:bg-yellow-500': !isFullCoverage,
        })}
      />
      {!isFullCoverage && (
        <>
          <p className="text-xs text-muted-foreground mt-2">
            Setup {uncoveredCount === 1 ? 'a device' : `${uncoveredCount} devices`} on{' '}
            {uncoveredCount === 1 ? 'the uncovered VLAN' : 'uncovered VLANs'} for comprehensive testing
          </p>
          {hostValidatedVlans > 0 && (
            <p className="text-xs text-blue-400 mt-1">
              {hostValidatedVlans} VLAN{hostValidatedVlans > 1 ? 's' : ''} currently use host-based (server-local) directional validation.
            </p>
          )}
        </>
      )}
    </div>
  );
}

import { CheckCircle2, Circle, Loader2, XCircle } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { CampaignStepId, CampaignStepState } from '@/types';

const statusIcon = {
  pending: Circle,
  running: Loader2,
  completed: CheckCircle2,
  failed: XCircle,
  skipped: Circle,
};

export function RunbookStepper({
  steps,
  activeStep,
}: {
  steps: CampaignStepState[];
  activeStep?: CampaignStepId;
}) {
  return (
    <div className="overflow-x-auto pb-2">
      <div className="grid min-w-[780px] grid-cols-6 gap-2">
        {steps.map((step) => {
          const Icon = statusIcon[step.status] || Circle;
          const isActive = activeStep === step.id || step.status === 'running';

          return (
            <div
              key={step.id}
              className={cn(
                'min-h-[6.25rem] rounded-lg border p-3 transition-colors',
                isActive
                  ? 'border-orange-500/40 bg-orange-500/10'
                  : step.status === 'completed'
                    ? 'border-emerald-500/30 bg-emerald-500/5'
                    : step.status === 'failed'
                      ? 'border-red-500/30 bg-red-500/5'
                      : 'border-border/60 bg-card/50'
              )}
            >
              <div className="mb-2 flex items-center gap-2">
                <Icon
                  className={cn(
                    'h-4 w-4 shrink-0',
                    step.status === 'running' && 'animate-spin text-orange-400',
                    step.status === 'completed' && 'text-emerald-400',
                    step.status === 'failed' && 'text-red-400',
                    step.status === 'pending' && 'text-muted-foreground'
                  )}
                />
                <div className="text-sm font-medium text-foreground">{step.label}</div>
              </div>
              <p className="text-xs leading-5 text-muted-foreground">{step.description}</p>
              {step.message && (
                <p className="mt-2 text-xs leading-5 text-foreground/80">{step.message}</p>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

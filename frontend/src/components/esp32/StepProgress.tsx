import { Check } from 'lucide-react';
import { cn } from '@/lib/utils';

export interface Step {
  id: number;
  title: string;
  description: string;
}

interface StepProgressProps {
  steps: Step[];
  currentStep: number;
}

export function StepProgress({ steps, currentStep }: StepProgressProps) {
  return (
    <nav aria-label="Progress" className="overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
      <ol className="flex items-center">
        {steps.map((step, index) => (
          <li
            key={step.id}
            className={cn(
              'relative',
              index !== steps.length - 1 ? 'pr-8 sm:pr-20 flex-1' : ''
            )}
          >
            <div className="flex items-center">
              <div
                className={cn(
                  'relative flex h-10 w-10 items-center justify-center rounded-full border-2 transition-all duration-200',
                  currentStep > step.id
                    ? 'border-orange-500 bg-orange-500 text-white'
                    : currentStep === step.id
                    ? 'border-orange-500 bg-orange-500/10 text-orange-500'
                    : 'border-muted-foreground/30 bg-background text-muted-foreground'
                )}
              >
                {currentStep > step.id ? (
                  <Check className="h-5 w-5" />
                ) : (
                  <span className="text-sm font-semibold">{step.id}</span>
                )}
              </div>
              {index !== steps.length - 1 && (
                <div
                  className={cn(
                    'absolute left-10 top-5 -translate-y-1/2 h-0.5 w-full transition-all duration-200',
                    currentStep > step.id ? 'bg-orange-500' : 'bg-muted-foreground/30'
                  )}
                />
              )}
            </div>
            <div className="mt-3 min-w-0">
              <p
                className={cn(
                  'text-sm font-medium',
                  currentStep >= step.id ? 'text-foreground' : 'text-muted-foreground'
                )}
              >
                {step.title}
              </p>
              <p className="text-xs text-muted-foreground hidden sm:block">
                {step.description}
              </p>
            </div>
          </li>
        ))}
      </ol>
    </nav>
  );
}

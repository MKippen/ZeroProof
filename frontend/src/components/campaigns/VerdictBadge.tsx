import {
  AlertTriangle,
  CheckCircle2,
  HelpCircle,
  PauseCircle,
  ShieldAlert,
  ShieldX,
  type LucideIcon,
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import type { CampaignVerdict } from '@/types';

const verdictConfig: Record<CampaignVerdict, { label: string; className: string; icon: LucideIcon }> = {
  NOT_RUN: {
    label: 'Not Run',
    className: 'border-muted-foreground/30 bg-muted/30 text-muted-foreground',
    icon: HelpCircle,
  },
  VALIDATED: {
    label: 'Validated',
    className: 'border-emerald-500/30 bg-emerald-500/10 text-emerald-400',
    icon: CheckCircle2,
  },
  AT_RISK: {
    label: 'At Risk',
    className: 'border-amber-500/30 bg-amber-500/10 text-amber-400',
    icon: AlertTriangle,
  },
  SUSPECTED_COMPROMISE: {
    label: 'Suspected Compromise',
    className: 'border-red-500/30 bg-red-500/10 text-red-400',
    icon: ShieldX,
  },
  INCONCLUSIVE: {
    label: 'Inconclusive',
    className: 'border-sky-500/30 bg-sky-500/10 text-sky-400',
    icon: ShieldAlert,
  },
  DISABLED: {
    label: 'Disabled',
    className: 'border-muted-foreground/30 bg-muted/20 text-muted-foreground',
    icon: PauseCircle,
  },
};

export function getVerdictLabel(verdict: CampaignVerdict): string {
  return verdictConfig[verdict]?.label || verdict;
}

export function VerdictBadge({
  verdict,
  className,
}: {
  verdict: CampaignVerdict;
  className?: string;
}) {
  const config = verdictConfig[verdict] || verdictConfig.NOT_RUN;
  const Icon = config.icon;

  return (
    <Badge variant="outline" className={cn('gap-1.5 whitespace-nowrap', config.className, className)}>
      <Icon className="h-3.5 w-3.5" />
      {config.label}
    </Badge>
  );
}

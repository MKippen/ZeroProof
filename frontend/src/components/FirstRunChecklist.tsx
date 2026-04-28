import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { Check, Circle, ArrowRight, Sparkles } from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import api from '@/api/client';

interface ChecklistStep {
  id: string;
  title: string;
  description: string;
  cta: string;
  href: string;
  done: boolean;
}

// Renders a guided checklist on the dashboard for new operators. Each row
// auto-completes as the operator finishes that step, and the whole card
// disappears once everything's done. Designed to be unintrusive for
// returning users — never shown if all prerequisites are already met.
export function FirstRunChecklist() {
  const { data: unifiData, isLoading: loadingUnifi } = useQuery({
    queryKey: ['unifi', 'settings'],
    queryFn: async () => {
      const response = await api.get<{ configured: boolean }>('/unifi/settings');
      return response.data;
    },
  });

  const { data: intentData, isLoading: loadingIntent } = useQuery({
    queryKey: ['intent', 'profile'],
    queryFn: async () => {
      const response = await api.get<{ configured: boolean }>('/intent');
      return response.data;
    },
  });

  if (loadingUnifi || loadingIntent) return null;

  const steps: ChecklistStep[] = [
    {
      id: 'unifi',
      title: 'Connect your UniFi controller',
      description:
        'Enter read-only credentials so ZeroProof can pull your config. We recommend a dedicated read-only UniFi user.',
      cta: 'Connect UniFi',
      href: '/config',
      done: !!unifiData?.configured,
    },
    {
      id: 'intent',
      title: 'Define your network intent',
      description:
        'Tell ZeroProof what each network is for (Trusted, IoT, Guest, etc.) so it can score real gaps, not just rule violations.',
      cta: 'Set up intent',
      href: '/intent',
      done: !!intentData?.configured,
    },
  ];

  // Hide entirely once everything's done — returning users shouldn't see this.
  const allDone = steps.every((s) => s.done);
  if (allDone) return null;

  const nextStep = steps.find((s) => !s.done) ?? steps[0];

  return (
    <Card className="border-orange-500/30 bg-gradient-to-br from-orange-500/5 to-amber-500/5">
      <CardHeader>
        <div className="flex items-start gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-full bg-orange-500/15 flex-shrink-0">
            <Sparkles className="h-5 w-5 text-orange-400" />
          </div>
          <div>
            <CardTitle className="text-lg">Get started</CardTitle>
            <CardDescription>
              A couple of steps to get ZeroProof producing real signal for your
              network.
            </CardDescription>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        {steps.map((step, idx) => (
          <div
            key={step.id}
            className="flex items-start gap-3 rounded-md border border-border/50 bg-background/40 p-3"
          >
            <div className="flex h-6 w-6 items-center justify-center flex-shrink-0 mt-0.5">
              {step.done ? (
                <Check className="h-5 w-5 text-emerald-400" />
              ) : (
                <Circle className="h-5 w-5 text-muted-foreground/50" />
              )}
            </div>
            <div className="flex-1 min-w-0">
              <p
                className={
                  step.done
                    ? 'text-sm font-medium line-through text-muted-foreground'
                    : 'text-sm font-medium'
                }
              >
                {idx + 1}. {step.title}
              </p>
              {!step.done && (
                <p className="text-xs text-muted-foreground mt-0.5">
                  {step.description}
                </p>
              )}
            </div>
            {!step.done && step.id === nextStep.id && (
              <Button asChild size="sm" className="bg-orange-600 hover:bg-orange-500 flex-shrink-0">
                <Link to={step.href}>
                  {step.cta}
                  <ArrowRight className="h-3 w-3 ml-1" />
                </Link>
              </Button>
            )}
            {!step.done && step.id !== nextStep.id && (
              <Button asChild variant="outline" size="sm" className="flex-shrink-0">
                <Link to={step.href}>{step.cta}</Link>
              </Button>
            )}
          </div>
        ))}
      </CardContent>
    </Card>
  );
}

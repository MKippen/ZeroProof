import { useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, RefreshCw, ShieldAlert } from 'lucide-react';
import api from '@/api/client';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { CampaignCard } from '@/components/campaigns/CampaignCard';
import { ResidentialProxyCampaign } from '@/components/campaigns/ResidentialProxyCampaign';
import { useWebSocketStore } from '@/stores/websocketStore';
import { useToast } from '@/hooks/useToast';
import type {
  CampaignDetail,
  CampaignListItem,
  CampaignRun,
  CampaignStepId,
  ResidentialProxyCampaignOptions,
} from '@/types';

async function fetchCampaigns(): Promise<CampaignListItem[]> {
  const response = await api.get<{ campaigns: CampaignListItem[] }>('/campaigns');
  if (!response.success || !response.data) {
    throw new Error(response.error?.message || 'Failed to fetch campaigns');
  }
  return response.data.campaigns;
}

async function fetchCampaign(campaignId: string): Promise<CampaignDetail> {
  const response = await api.get<{ campaign: CampaignDetail }>(`/campaigns/${campaignId}`);
  if (!response.success || !response.data) {
    throw new Error(response.error?.message || 'Failed to fetch campaign');
  }
  return response.data.campaign;
}

function CampaignOverview() {
  const { data, isLoading, error } = useQuery({
    queryKey: ['campaigns'],
    queryFn: fetchCampaigns,
  });

  if (isLoading) {
    return (
      <div className="flex min-h-[20rem] items-center justify-center text-sm text-muted-foreground">
        <RefreshCw className="mr-2 h-4 w-4 animate-spin" />
        Loading campaigns...
      </div>
    );
  }

  if (error) {
    return (
      <Card>
        <CardContent className="pt-6 text-sm text-red-400">{(error as Error).message}</CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
        <div>
          <div className="mb-2 flex items-center gap-2 text-sm text-orange-400">
            <ShieldAlert className="h-4 w-4" />
            Campaigns
          </div>
          <h1 className="text-3xl font-semibold tracking-normal text-foreground">Campaigns</h1>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-muted-foreground">
            Run code-owned threat and vulnerability workflows with dedicated collection, evaluation, validation, and cleanup.
          </p>
        </div>
      </div>

      <div className="grid gap-4 xl:grid-cols-2">
        {(data || []).map((campaign) => (
          <CampaignCard key={campaign.definition.id} campaign={campaign} />
        ))}
      </div>
    </div>
  );
}

function CampaignDetailView({ campaignId }: { campaignId: string }) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const lastMessage = useWebSocketStore((state) => state.lastMessage);
  const [busyStep, setBusyStep] = useState<CampaignStepId | 'start' | 'settings' | null>(null);

  const campaignQuery = useQuery({
    queryKey: ['campaign', campaignId],
    queryFn: () => fetchCampaign(campaignId),
  });

  useEffect(() => {
    if (!lastMessage || !['campaign_progress', 'campaign_completed'].includes(lastMessage.type)) return;
    if (lastMessage.campaignId !== campaignId) return;
    void queryClient.invalidateQueries({ queryKey: ['campaign', campaignId] });
    void queryClient.invalidateQueries({ queryKey: ['campaigns'] });
  }, [campaignId, lastMessage, queryClient]);

  const startMutation = useMutation({
    mutationFn: async (options: ResidentialProxyCampaignOptions) => {
      const response = await api.post<{ run: CampaignRun }>(`/campaigns/${campaignId}/runs`, { options });
      if (!response.success || !response.data) throw new Error(response.error?.message || 'Failed to start run');
      return response.data.run;
    },
    onMutate: () => setBusyStep('start'),
    onSuccess: () => {
      toast({ title: 'Campaign run started' });
      void queryClient.invalidateQueries({ queryKey: ['campaign', campaignId] });
      void queryClient.invalidateQueries({ queryKey: ['campaigns'] });
    },
    onError: (error) => toast({ title: 'Start failed', description: (error as Error).message, variant: 'destructive' }),
    onSettled: () => setBusyStep(null),
  });

  const stepMutation = useMutation({
    mutationFn: async ({ stepId, body }: { stepId: CampaignStepId; body?: Record<string, unknown> }) => {
      const runId = campaignQuery.data?.latestRun?.id || campaignQuery.data?.runs[0]?.id;
      if (!runId) throw new Error('No campaign run is active');
      const response = await api.post<{ run: CampaignRun }>(
        `/campaigns/${campaignId}/runs/${runId}/steps/${stepId}`,
        body
      );
      if (!response.success || !response.data) throw new Error(response.error?.message || 'Failed to run step');
      return response.data.run;
    },
    onMutate: ({ stepId }) => setBusyStep(stepId),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['campaign', campaignId] });
      void queryClient.invalidateQueries({ queryKey: ['campaigns'] });
    },
    onError: (error) => toast({ title: 'Step failed', description: (error as Error).message, variant: 'destructive' }),
    onSettled: () => setBusyStep(null),
  });

  const settingsMutation = useMutation({
    mutationFn: async (enabled: boolean) => {
      const response = await api.patch<{ settings: { enabled: boolean } }>(
        `/campaigns/${campaignId}/settings`,
        { enabled }
      );
      if (!response.success || !response.data) throw new Error(response.error?.message || 'Failed to update settings');
      return response.data.settings;
    },
    onMutate: () => setBusyStep('settings'),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['campaign', campaignId] });
      void queryClient.invalidateQueries({ queryKey: ['campaigns'] });
    },
    onError: (error) => toast({ title: 'Settings failed', description: (error as Error).message, variant: 'destructive' }),
    onSettled: () => setBusyStep(null),
  });

  const activeRun = useMemo(
    () => campaignQuery.data?.latestRun || campaignQuery.data?.runs[0] || null,
    [campaignQuery.data]
  );

  if (campaignQuery.isLoading) {
    return (
      <div className="flex min-h-[20rem] items-center justify-center text-sm text-muted-foreground">
        <RefreshCw className="mr-2 h-4 w-4 animate-spin" />
        Loading campaign...
      </div>
    );
  }

  if (campaignQuery.error || !campaignQuery.data) {
    return (
      <div className="space-y-4">
        <Button variant="ghost" asChild>
          <Link to="/campaigns">
            <ArrowLeft className="mr-2 h-4 w-4" />
            Campaigns
          </Link>
        </Button>
        <Card>
          <CardContent className="pt-6 text-sm text-red-400">
            {campaignQuery.error ? (campaignQuery.error as Error).message : 'Campaign not found'}
          </CardContent>
        </Card>
      </div>
    );
  }

  const componentProps = {
    campaign: campaignQuery.data,
    activeRun,
    busyStep,
    onStartRun: (options: ResidentialProxyCampaignOptions) => startMutation.mutate(options),
    onExecuteStep: (stepId: CampaignStepId, body?: Record<string, unknown>) => stepMutation.mutate({ stepId, body }),
    onToggleEnabled: (enabled: boolean) => settingsMutation.mutate(enabled),
  };

  return (
    <div className="space-y-4">
      <Button variant="ghost" asChild>
        <Link to="/campaigns">
          <ArrowLeft className="mr-2 h-4 w-4" />
          Campaigns
        </Link>
      </Button>
      {campaignQuery.data.definition.frontendComponent === 'ResidentialProxyCampaign' ? (
        <ResidentialProxyCampaign {...componentProps} />
      ) : (
        <Card>
          <CardContent className="pt-6 text-sm text-muted-foreground">
            This campaign component is not available in this build.
          </CardContent>
        </Card>
      )}
    </div>
  );
}

export function CampaignsPage() {
  const { campaignId } = useParams();
  return campaignId ? <CampaignDetailView campaignId={campaignId} /> : <CampaignOverview />;
}

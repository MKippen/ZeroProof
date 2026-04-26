import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useMutation, useQuery } from '@tanstack/react-query';
import { ArrowLeft, Wand2 } from 'lucide-react';
import { Link } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { useToast } from '@/hooks/useToast';
import {
  WizardProgress,
  WizardStep,
  WorkStep,
  DevicesStep,
  GuestStep,
  SecurityStep,
  ReviewStep,
} from '@/components/wizard';
import { NetworkMappingStep } from '@/components/wizard/NetworkMappingStep';
import api from '@/api/client';
import type { NetworkIntentProfile, IntentAnalysisResult, UniFiNetwork, NetworkMappings } from '@/types';

const STEPS: WizardStep[] = [
  { id: 1, title: 'Work', description: 'Business use' },
  { id: 2, title: 'Devices', description: 'Device types' },
  { id: 3, title: 'Guest', description: 'Visitor access' },
  { id: 4, title: 'Security', description: 'Preferences' },
  { id: 5, title: 'Networks', description: 'Map networks' },
  { id: 6, title: 'Review', description: 'Confirm' },
];

const DEFAULT_PROFILE: Partial<NetworkIntentProfile> = {
  workFromHome: false,
  workDeviceIsolation: false,
  workIsolationMode: 'phased',
  workVpn: false,
  homeServer: false,
  hasIoT: false,
  iotIsolation: true,
  iotInternetAccess: 'full',
  hasGaming: false,
  hasNAS: false,
  nasAccessibleFrom: 'trusted',
  guestNetwork: false,
  guestIsolation: true,
  guestBandwidthLimit: false,
  securityLevel: 'balanced',
  dnsFiltering: false,
  dnsFilteringNetworks: [],
  dnsFilteringServerIp: '',
  malwareBlocking: false,
  interVlanDefault: 'deny',
  reachabilityOverrides: [],
  networkMappings: {},
};

interface WizardContentProps {
  onComplete?: () => void;
}

// Embeddable wizard content (without page header)
export function WizardContent({ onComplete }: WizardContentProps) {
  const { toast } = useToast();
  const navigate = useNavigate();
  const [currentStep, setCurrentStep] = useState(1);
  const [profile, setProfile] = useState<Partial<NetworkIntentProfile>>(DEFAULT_PROFILE);
  const [mappings, setMappings] = useState<NetworkMappings>({});

  // Fetch existing profile to pre-populate
  const { isLoading: isLoadingProfile } = useQuery({
    queryKey: ['intent-profile'],
    queryFn: async () => {
      const response = await api.get<{ profile: NetworkIntentProfile | null; configured: boolean }>(
        '/intent'
      );
      if (response.success && response.data?.profile) {
        setProfile(response.data.profile);
        setMappings(response.data.profile.networkMappings || {});
        return response.data.profile;
      }
      return null;
    },
    staleTime: 0,
    refetchOnMount: 'always',
  });

  // Fetch available networks for mapping
  const { data: networksData, isLoading: isLoadingNetworks } = useQuery({
    queryKey: ['intent-networks'],
    queryFn: async () => {
      const response = await api.get<{ networks: UniFiNetwork[]; hasConfig: boolean }>(
        '/intent/networks'
      );
      if (response.success && response.data) {
        return response.data;
      }
      return { networks: [], hasConfig: false };
    },
    staleTime: 0,
    refetchOnMount: 'always',
  });

  // Save profile mutation
  const saveMutation = useMutation({
    mutationFn: async (data: Partial<NetworkIntentProfile>) => {
      const response = await api.post<{
        profile: NetworkIntentProfile;
        analysis: IntentAnalysisResult | null;
      }>('/intent', data);
      if (!response.success) {
        throw new Error(response.error?.message || 'Failed to save intent profile');
      }
      return response.data;
    },
    onSuccess: (data) => {
      toast({
        title: 'Intent profile saved',
        description: data?.analysis
          ? `Compliance score: ${data.analysis.score}%`
          : 'Your network goals have been recorded.',
      });
      if (onComplete) {
        onComplete();
      } else {
        navigate('/intent');
      }
    },
    onError: (error: Error) => {
      toast({
        variant: 'destructive',
        title: 'Error',
        description: error.message,
      });
    },
  });

  const handleChange = (field: string, value: boolean | string | string[]) => {
    setProfile((prev) => ({ ...prev, [field]: value }));
  };

  const handleMappingsChange = (newMappings: NetworkMappings) => {
    setMappings(newMappings);
  };

  const handleSubmit = () => {
    const finalProfile = {
      ...profile,
      networkMappings: mappings,
    };
    saveMutation.mutate(finalProfile);
  };

  const goToStep = (step: number) => {
    if (step < 1 || step > 6) return;
    setCurrentStep(step);
  };

  const isLoading = isLoadingProfile || isLoadingNetworks;

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
      </div>
    );
  }

  const networks = networksData?.networks || [];

  return (
    <div className="space-y-6">
      {/* Step Progress */}
      <div className="py-2">
        <WizardProgress steps={STEPS} currentStep={currentStep} />
      </div>

      {/* Step Content */}
      <div className="max-w-2xl">
        {currentStep === 1 && (
          <WorkStep
            workFromHome={profile.workFromHome || false}
            workDeviceIsolation={profile.workDeviceIsolation || false}
            workVpn={profile.workVpn || false}
            homeServer={profile.homeServer || false}
            onChange={handleChange}
            onNext={() => goToStep(2)}
          />
        )}

        {currentStep === 2 && (
          <DevicesStep
            hasIoT={profile.hasIoT || false}
            iotIsolation={profile.iotIsolation || false}
            iotInternetAccess={profile.iotInternetAccess || 'full'}
            hasGaming={profile.hasGaming || false}
            hasNAS={profile.hasNAS || false}
            nasAccessibleFrom={profile.nasAccessibleFrom || 'trusted'}
            onChange={handleChange}
            onNext={() => goToStep(3)}
            onBack={() => goToStep(1)}
          />
        )}

        {currentStep === 3 && (
          <GuestStep
            guestNetwork={profile.guestNetwork || false}
            guestIsolation={profile.guestIsolation || false}
            guestBandwidthLimit={profile.guestBandwidthLimit || false}
            onChange={handleChange}
            onNext={() => goToStep(4)}
            onBack={() => goToStep(2)}
          />
        )}

        {currentStep === 4 && (
          <SecurityStep
            securityLevel={profile.securityLevel || 'balanced'}
            dnsFiltering={profile.dnsFiltering || false}
            dnsFilteringNetworks={profile.dnsFilteringNetworks || []}
            dnsFilteringServerIp={profile.dnsFilteringServerIp || ''}
            malwareBlocking={profile.malwareBlocking || false}
            interVlanDefault={profile.interVlanDefault || 'deny'}
            networks={networks}
            onChange={handleChange}
            onNext={() => goToStep(5)}
            onBack={() => goToStep(3)}
          />
        )}

        {currentStep === 5 && (
          <div className="space-y-6">
            <NetworkMappingStep
              profile={profile}
              networks={networks}
              mappings={mappings}
              onMappingChange={handleMappingsChange}
            />
            <div className="flex gap-3">
              <Button variant="outline" onClick={() => goToStep(4)}>
                Back
              </Button>
              <Button onClick={() => goToStep(6)}>
                Next
              </Button>
            </div>
          </div>
        )}

        {currentStep === 6 && (
          <ReviewStep
            profile={profile}
            mappings={mappings}
            networks={networks}
            onSubmit={handleSubmit}
            onBack={() => goToStep(5)}
            isSubmitting={saveMutation.isPending}
          />
        )}
      </div>
    </div>
  );
}

export function NetworkWizardPage() {
  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-start gap-3 sm:items-center sm:gap-4">
        <Button variant="ghost" size="icon" asChild>
          <Link to="/settings">
            <ArrowLeft className="h-5 w-5" />
          </Link>
        </Button>
        <div className="min-w-0">
          <h1 className="text-2xl sm:text-3xl font-bold flex items-center gap-2 flex-wrap">
            <Wand2 className="h-7 w-7 text-orange-400" />
            Network Security Wizard
          </h1>
          <p className="text-muted-foreground">
            Define your ideal network security posture
          </p>
        </div>
      </div>

      <WizardContent />
    </div>
  );
}

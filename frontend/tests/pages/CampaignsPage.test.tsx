import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { CampaignsPage } from '@/pages/CampaignsPage';
import { useWebSocketStore } from '@/stores/websocketStore';
import api from '@/api/client';
import type { CampaignDetail } from '@/types';

vi.mock('@/api/client', () => ({
  default: {
    get: vi.fn(),
    post: vi.fn(),
    patch: vi.fn(),
  },
}));

const campaignDetail: CampaignDetail = {
  enabled: true,
  openFindingCount: 1,
  definition: {
    id: 'residential-proxy-kimwolf',
    name: 'Residential Proxy / Kimwolf-Style Local Network Exposure',
    shortName: 'Residential Proxy',
    description: 'Find suspicious Android TV, TV box, digital frame, and unknown AOSP-like clients.',
    category: 'Threat Campaign',
    severity: 'HIGH',
    frontendComponent: 'ResidentialProxyCampaign',
    references: [],
    requiredDataSources: ['Active UniFi configuration'],
    defaultOptions: {
      targetNetworkKeywords: ['iot', 'guest'],
      validationPorts: [5555, 1080],
      manualClientMacs: [],
      lookbackHours: 72,
      validationTimeoutMs: 800,
      cleanupCompleted: [],
    },
    options: [],
    steps: [
      { id: 'setup', label: 'Setup', description: 'Check readiness.' },
      { id: 'configure', label: 'Configure', description: 'Set options.' },
      { id: 'collect', label: 'Collect', description: 'Collect evidence.' },
      { id: 'evaluate', label: 'Evaluate', description: 'Score evidence.' },
      { id: 'validate', label: 'Validate', description: 'Run validation.' },
      { id: 'cleanup', label: 'Cleanup', description: 'Track cleanup.' },
    ],
  },
  latestRun: {
    id: 'run-1',
    campaignId: 'residential-proxy-kimwolf',
    status: 'COMPLETED',
    verdict: 'AT_RISK',
    configId: 'config-1',
    startedAt: '2026-05-02T12:00:00.000Z',
    updatedAt: '2026-05-02T12:05:00.000Z',
    stepsJson: [
      { id: 'setup', label: 'Setup', description: 'Check readiness.', status: 'completed' },
      { id: 'configure', label: 'Configure', description: 'Set options.', status: 'completed' },
      { id: 'collect', label: 'Collect', description: 'Collect evidence.', status: 'completed' },
      { id: 'evaluate', label: 'Evaluate', description: 'Score evidence.', status: 'completed' },
      { id: 'validate', label: 'Validate', description: 'Run validation.', status: 'completed' },
      { id: 'cleanup', label: 'Cleanup', description: 'Track cleanup.', status: 'pending' },
    ],
    optionsJson: {
      targetNetworkKeywords: ['iot', 'guest'],
      validationPorts: [5555, 1080],
      manualClientMacs: [],
      lookbackHours: 72,
      validationTimeoutMs: 800,
      cleanupCompleted: [],
    },
    evidenceJson: {
      collectedAt: '2026-05-02T12:00:00.000Z',
      dataSources: {
        activeConfig: true,
        unifiConnection: true,
        eventsChecked: 10,
        alarmsChecked: 2,
        validationRunners: [{ id: 'server', deviceId: 'server-local', name: 'Server', status: 'ONLINE' }],
      },
      candidateDevices: [
        {
          mac: 'aa:bb:cc:dd:ee:ff',
          ip: '192.168.30.50',
          name: 'AOSP TV Box',
          networkName: 'IoT',
          reasonCodes: ['suspicious-device-fingerprint'],
          confidence: 0.8,
        },
      ],
      riskyNetworkPosture: {
        targetNetworks: [{ id: 'iot', name: 'IoT' }],
        weakSegmentation: true,
        indicators: ['IoT does not show network isolation enabled.'],
      },
      dnsPosture: { protectiveDnsLikely: false, indicators: ['IoT inherits default DNS.'] },
      dnsProxyEvidence: {
        configured: true,
        queryLogEnabled: true,
        anonymizedClientIp: false,
        attributionStatus: 'HEALTHY',
        attributionReason: 'AdGuard is seeing multiple client IPs that match UniFi client inventory.',
        deviceLevelQueryCount: 1,
        networkLevelSignalCount: 0,
        matches: [
          {
            source: 'device',
            attribution: 'device',
            queriedAt: '2026-05-02T12:00:00.000Z',
            clientIp: '192.168.30.50',
            domain: 'api.xdresi.to',
            queryType: 'A',
            status: 'NOERROR',
            reason: 'FilteredBlackList',
            blocked: true,
            suspicious: true,
            title: 'Kimwolf xdresi domain',
            severity: 'HIGH',
          },
        ],
        indicators: ['AdGuard sees UniFi client IPs; DNS evidence can be attributed to devices.'],
      },
      idsHoneypotStatus: {
        idsIpsEnabled: true,
        honeypotEnabled: false,
        honeypotCount: 0,
        indicators: [],
      },
      portForwards: [],
      upnpNatPmp: { upnpEnabled: false, natPmpEnabled: false, indicators: [] },
      telemetryMatches: { snippets: [], eventMatchCount: 0, alarmMatchCount: 0 },
    },
    summaryJson: {
      verdict: 'AT_RISK',
      score: 42,
      confidence: 0.72,
      highSignals: [],
      mediumSignals: ['AOSP TV Box matches suspicious device inventory plus posture risk.'],
      lowSignals: ['Target networks have segmentation indicators that need review.'],
      findings: [
        {
          resourceKey: 'aa:bb:cc:dd:ee:ff',
          type: 'campaign_residential_proxy_exposure',
          severity: 'MEDIUM',
          title: 'Residential proxy risk on AOSP TV Box',
          description: 'Risk description',
          impact: 'Impact',
          remediation: 'Remediation',
          affectedResource: 'AOSP TV Box (192.168.30.50)',
          confidence: 0.8,
          evidence: ['suspicious-device-fingerprint'],
        },
      ],
    },
    testRunIdsJson: [],
  },
  runs: [],
};
campaignDetail.runs = [campaignDetail.latestRun!];

function renderWithProviders(path: string) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });

  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path="/campaigns" element={<CampaignsPage />} />
          <Route path="/campaigns/:campaignId" element={<CampaignsPage />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>
  );
}

describe('CampaignsPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useWebSocketStore.setState({ lastMessage: null });
  });

  it('renders campaign overview status cards', async () => {
    vi.mocked(api.get).mockResolvedValue({
      success: true,
      data: { campaigns: [campaignDetail] },
    });

    renderWithProviders('/campaigns');

    expect(await screen.findByText('Residential Proxy')).toBeInTheDocument();
    expect(screen.getByText('At Risk')).toBeInTheDocument();
    expect(screen.getByText('1 open finding(s)')).toBeInTheDocument();
  });

  it('renders residential campaign runbook, evidence, verdict, and cleanup', async () => {
    vi.mocked(api.get).mockResolvedValue({
      success: true,
      data: { campaign: campaignDetail },
    });

    renderWithProviders('/campaigns/residential-proxy-kimwolf');

    expect(await screen.findByText('Residential Proxy / Kimwolf-Style Local Network Exposure')).toBeInTheDocument();
    expect(screen.getAllByText('Validate')[0]).toBeInTheDocument();
    expect(screen.getByText('Detection in One Pass')).toBeInTheDocument();
    expect(screen.getByText('What UniFi Does')).toBeInTheDocument();
    expect(screen.getByText('Verdict Logic')).toBeInTheDocument();
    expect(screen.getByText('DNS Proxy Evidence')).toBeInTheDocument();
    expect(screen.getAllByText('Device-level')[0]).toBeInTheDocument();
    expect(screen.getByText('api.xdresi.to')).toBeInTheDocument();
    expect(screen.getByText('AOSP TV Box')).toBeInTheDocument();
    expect(screen.getByText('At Risk')).toBeInTheDocument();
    expect(screen.getByText('Disable UPnP and NAT-PMP')).toBeInTheDocument();
  });

  it('refreshes the active run after campaign websocket progress', async () => {
    const updated = {
      ...campaignDetail,
      latestRun: { ...campaignDetail.latestRun!, verdict: 'VALIDATED' as const, summaryJson: { ...campaignDetail.latestRun!.summaryJson!, verdict: 'VALIDATED' as const, score: 0 } },
    };
    updated.runs = [updated.latestRun];

    vi.mocked(api.get)
      .mockResolvedValueOnce({ success: true, data: { campaign: campaignDetail } })
      .mockResolvedValueOnce({ success: true, data: { campaign: updated } });

    renderWithProviders('/campaigns/residential-proxy-kimwolf');
    expect(await screen.findByText('At Risk')).toBeInTheDocument();

    act(() => {
      useWebSocketStore.setState({
        lastMessage: {
          type: 'campaign_completed',
          campaignId: 'residential-proxy-kimwolf',
          runId: 'run-1',
          verdict: 'VALIDATED',
        },
      });
    });

    await waitFor(() => expect(screen.getByText('Validated')).toBeInTheDocument());
  });
});

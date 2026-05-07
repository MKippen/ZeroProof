import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { TrafficPage } from '@/pages/TrafficPage';
import api from '@/api/client';

vi.mock('@/api/client', () => ({
  default: { get: vi.fn() },
}));

const populated = {
  configured: true,
  windowHours: 24,
  since: '2026-05-06T00:00:00Z',
  summary: {
    windowHours: 24,
    since: '2026-05-06T00:00:00Z',
    totalBlocked: 5000,
    byRisk: { low: 4900, medium: 50, high: 50, concerning: 0 },
    uniqueSrcMacs: 25,
    threatCount: 50,
  },
  topPolicies: [{ name: 'Block: IOT > Internet', type: null, count: 1500 }],
  topClients: [{ mac: 'aa:bb:cc:dd:ee:01', displayName: 'iPad 0a:05', count: 800 }],
  topRegions: [{ region: 'US', count: 4000 }],
  recentFlows: [
    {
      id: 'f1',
      occurredAt: '2026-05-07T17:00:00Z',
      action: 'blocked',
      protocol: 'TCP',
      service: 'OTHER',
      risk: 'low',
      direction: 'outgoing',
      srcMac: 'aa:bb:cc:dd:ee:01',
      srcClientName: 'iPad 0a:05',
      srcNetworkName: 'IOT',
      dstIp: '203.0.113.10',
      dstRegion: 'US',
      dstClientName: null,
      inNetworkName: 'IOT',
      outNetworkName: 'Default',
      primaryPolicyName: 'Block: IOT > Internet',
    },
  ],
  recentThreats: [
    {
      id: 't1',
      occurredAt: '2026-05-07T17:00:00Z',
      severity: 'LOW',
      message: 'Threat blocked',
      srcIp: '192.168.1.50',
      dstIp: '198.51.100.5',
      deviceMac: '60:22:32:96:06:6d',
    },
  ],
};

function renderPage() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <TrafficPage />
      </MemoryRouter>
    </QueryClientProvider>
  );
}

describe('TrafficPage', () => {
  beforeEach(() => vi.clearAllMocks());

  it('renders the empty state when no UniFi connection is configured', async () => {
    vi.mocked(api.get).mockResolvedValue({
      success: true,
      data: {
        configured: false,
        windowHours: 24,
        since: '2026-05-06T00:00:00Z',
        summary: null,
        topPolicies: [],
        topClients: [],
        topRegions: [],
        recentFlows: [],
        recentThreats: [],
      },
    });

    renderPage();

    expect(await screen.findByRole('heading', { name: /Traffic.*Flow/i })).toBeInTheDocument();
    expect(await screen.findByText(/UniFi not configured/i)).toBeInTheDocument();
  });

  it('renders summary, top lists, threats, and recent flows when populated', async () => {
    vi.mocked(api.get).mockResolvedValue({ success: true, data: populated });
    renderPage();

    await waitFor(() => {
      expect(screen.getByText('Total blocked')).toBeInTheDocument();
    });

    // Summary tiles
    expect(screen.getByText('5,000')).toBeInTheDocument();
    expect(screen.getByText('25')).toBeInTheDocument();
    // Top lists
    expect(screen.getByText('Top triggered policies')).toBeInTheDocument();
    expect(screen.getAllByText('Block: IOT > Internet').length).toBeGreaterThan(0);
    expect(screen.getByText('Top affected clients')).toBeInTheDocument();
    expect(screen.getAllByText('iPad 0a:05').length).toBeGreaterThan(0);
    expect(screen.getByText('Top affected regions')).toBeInTheDocument();
    // Recent threats
    expect(screen.getByText('Recent threats')).toBeInTheDocument();
    expect(screen.getByText('Threat blocked')).toBeInTheDocument();
    // Recent flows row
    expect(screen.getByText('Recent flows')).toBeInTheDocument();
    expect(screen.getAllByText('blocked').length).toBeGreaterThan(0);
  });
});

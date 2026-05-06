import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { DNSProxyPage } from '@/pages/DNSProxyPage';
import api from '@/api/client';

vi.mock('@/api/client', () => ({
  default: {
    get: vi.fn(),
    post: vi.fn(),
    delete: vi.fn(),
  },
}));

const settings = {
  configured: true,
  settings: {
    id: 'conn-1',
    host: '192.168.1.10',
    port: 3000,
    useHttps: false,
    username: 'admin',
    pollingEnabled: true,
    pollingIntervalSec: 60,
    retentionDays: 7,
    lastSyncAt: '2026-05-02T18:00:00.000Z',
    queryLogEnabled: true,
    anonymizeClientIp: false,
    attributionStatus: 'HEALTHY',
    attributionReason: 'AdGuard is seeing multiple client IPs that match UniFi client inventory.',
  },
};

const status = {
  configured: true,
  settings: settings.settings,
  adguard: {
    reachable: true,
    version: 'v0.108.0',
    protectionEnabled: true,
    queryLogConfig: { enabled: true, anonymize_client_ip: false },
  },
  stats: {
    totalQueries: 20,
    recentQueries: 12,
    blockedQueries: 2,
    suspiciousQueries: 1,
    uniqueClients: 4,
    lastQueryAt: '2026-05-02T18:05:00.000Z',
  },
  attribution: {
    status: 'HEALTHY',
    reason: 'AdGuard is seeing multiple client IPs that match UniFi client inventory.',
    uniqueClientCount: 4,
    matchedClientCount: 3,
    sampleClients: ['192.168.30.50'],
  },
};

const queries = {
  queries: [
    {
      id: 'query-1',
      queriedAt: '2026-05-02T18:00:00.000Z',
      clientIp: '192.168.30.50',
      clientName: 'AOSP TV Box',
      domain: 'api.xdresi.to',
      queryType: 'A',
      status: 'NOERROR',
      reason: 'FilteredBlackList',
      rule: '||xdresi.to^',
      upstream: 'tls://1.1.1.1',
      isBlocked: true,
      isSuspicious: true,
    },
  ],
  pagination: { page: 1, limit: 50, total: 1, totalPages: 1 },
};

const analytics = {
  configured: true,
  windowHours: 24,
  since: '2026-05-01T18:00:00.000Z',
  hourlyBuckets: [
    { hour: '2026-05-02T17:00:00.000Z', allowed: 12, blocked: 2 },
  ],
  topBlocked: [{ domain: 'api.xdresi.to', count: 9 }],
  topAllowed: [{ domain: 'apple.com', count: 42 }],
  topClients: [
    {
      mac: 'aa:bb:cc:11:22:33',
      displayName: 'AOSP TV Box',
      queries: 100,
      blocked: 9,
      suspicious: 1,
      lastSeen: '2026-05-02T18:00:00.000Z',
      adguardName: 'AOSP TV Box',
    },
  ],
  coverage: {
    seen: [
      {
        mac: 'aa:bb:cc:11:22:33',
        displayName: 'AOSP TV Box',
        queries: 100,
        blocked: 9,
        suspicious: 1,
        lastSeen: '2026-05-02T18:00:00.000Z',
        adguardName: 'AOSP TV Box',
      },
    ],
    silent: [
      {
        mac: 'aa:bb:cc:99:99:99',
        displayName: 'IoT Camera',
        lastIp: '192.168.30.5',
        adguardName: null,
      },
    ],
    unknownSources: [],
    totals: { unifi: 4, adguard: 3, matched: 3 },
  },
};

function mockApi() {
  vi.mocked(api.get).mockImplementation(async (url: string) => {
    if (url === '/dns-proxy/settings') return { success: true, data: settings };
    if (url === '/dns-proxy/status') return { success: true, data: status };
    if (url.startsWith('/dns-proxy/queries')) return { success: true, data: queries };
    if (url.startsWith('/dns-proxy/analytics')) return { success: true, data: analytics };
    return { success: true, data: {} };
  });
}

function renderPage() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });

  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <DNSProxyPage />
      </MemoryRouter>
    </QueryClientProvider>
  );
}

describe('DNSProxyPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockApi();
  });

  it('renders status tiles, analytics, and coverage panel', async () => {
    renderPage();

    expect(await screen.findByRole('heading', { name: 'DNS Proxy' })).toBeInTheDocument();
    expect(await screen.findByText('Reachable')).toBeInTheDocument();
    expect(screen.getAllByText('Device-level')[0]).toBeInTheDocument();
    expect(await screen.findByText('UniFi ↔ AdGuard coverage')).toBeInTheDocument();
    expect(screen.getByText('Top blocked domains')).toBeInTheDocument();
    expect(screen.getByText('Top allowed domains')).toBeInTheDocument();
    expect(screen.getByText('Top clients by query volume')).toBeInTheDocument();
    // Settings link visible (config moved to Settings page)
    expect(screen.getAllByRole('link', { name: /Settings/i })[0]).toHaveAttribute('href', '/settings#dns-proxy');
  });

  it('sends query log filters to the backend after expanding the log', async () => {
    renderPage();

    await screen.findByText('api.xdresi.to'); // appears in Top Blocked section
    fireEvent.click(screen.getByRole('button', { name: /Show query log/i }));

    fireEvent.change(await screen.findByLabelText('Domain filter'), { target: { value: 'xdresi' } });
    fireEvent.change(screen.getByLabelText('Client filter'), { target: { value: '192.168.30.50' } });
    fireEvent.change(screen.getByLabelText('Status'), { target: { value: 'blocked' } });
    fireEvent.click(screen.getByLabelText('Suspicious only'));

    await waitFor(() => {
      expect(vi.mocked(api.get).mock.calls.some(([url]) =>
        String(url).includes('/dns-proxy/queries?') &&
        String(url).includes('search=xdresi') &&
        String(url).includes('client=192.168.30.50') &&
        String(url).includes('status=blocked') &&
        String(url).includes('suspiciousOnly=true')
      )).toBe(true);
    });
  });
});

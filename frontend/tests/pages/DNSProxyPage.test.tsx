import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
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

function mockApi() {
  vi.mocked(api.get).mockImplementation(async (url: string) => {
    if (url === '/dns-proxy/settings') return { success: true, data: settings };
    if (url === '/dns-proxy/status') return { success: true, data: status };
    if (url.startsWith('/dns-proxy/queries')) return { success: true, data: queries };
    return { success: true, data: {} };
  });
}

function renderPage() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });

  return render(
    <QueryClientProvider client={queryClient}>
      <DNSProxyPage />
    </QueryClientProvider>
  );
}

describe('DNSProxyPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockApi();
  });

  it('renders setup form, attribution status, checklist, and recent query output', async () => {
    renderPage();

    expect(await screen.findByRole('heading', { name: 'DNS Proxy' })).toBeInTheDocument();
    expect(await screen.findByText('api.xdresi.to')).toBeInTheDocument();
    expect(screen.getByText('AdGuard Home connection')).toBeInTheDocument();
    expect(screen.getByText('Home Assistant add-on note')).toBeInTheDocument();
    expect(screen.getByText('UniFi DNS setup checklist')).toBeInTheDocument();
    expect(screen.getByLabelText('Username optional')).toBeInTheDocument();
    expect(screen.getAllByText('Device-level')[0]).toBeInTheDocument();
    expect(screen.getByText('AOSP TV Box (192.168.30.50)')).toBeInTheDocument();
    expect(screen.getAllByText('Blocked')[0]).toBeInTheDocument();
    expect(screen.getByText('Suspicious')).toBeInTheDocument();
  });

  it('sends recent query filters to the backend', async () => {
    renderPage();

    await screen.findByText('api.xdresi.to');
    fireEvent.change(screen.getByLabelText('Domain filter'), { target: { value: 'xdresi' } });
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

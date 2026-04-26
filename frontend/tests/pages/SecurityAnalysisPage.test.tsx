import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { SecurityAnalysisPage } from '@/pages/SecurityAnalysisPage';
import api from '@/api/client';

vi.mock('@/api/client', () => ({
  default: {
    get: vi.fn(),
    post: vi.fn(),
    patch: vi.fn(),
  },
}));

const mockAnalysis = {
  analyzedAt: '2026-03-01T10:00:00Z',
  configSiteName: 'Default',
  summary: {
    totalRules: 15,
    passed: 12,
    failed: 3,
  },
  results: [
    {
      ruleId: 'wifi-open-networks',
      ruleName: 'Open WiFi Detected',
      severity: 'HIGH',
      category: 'wireless',
      passed: false,
      findings: [
        { description: 'SSID "Guest" has no password', affectedResource: 'Guest' },
      ],
    },
    {
      ruleId: 'upnp-enabled',
      ruleName: 'UPnP Enabled',
      severity: 'CRITICAL',
      category: 'general',
      passed: false,
      findings: [
        { description: 'UPnP is enabled on the gateway', affectedResource: 'Gateway' },
      ],
    },
    {
      ruleId: 'pmf-disabled',
      ruleName: 'PMF Not Enabled',
      severity: 'MEDIUM',
      category: 'wireless',
      passed: false,
      findings: [
        { description: 'PMF is not enabled on "Main"', affectedResource: 'Main' },
      ],
    },
  ],
};

function renderWithProviders(ui: React.ReactElement) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>{ui}</MemoryRouter>
    </QueryClientProvider>
  );
}

describe('SecurityAnalysisPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders issue list with severity badges', async () => {
    vi.mocked(api.get).mockImplementation(async (url: string) => {
      if (url === '/security/analysis') return { success: true, data: mockAnalysis };
      if (url === '/security/sources') return { success: true, data: { sources: [] } };
      if (url.startsWith('/vulnerabilities/stats')) return { success: true, data: null };
      if (url.startsWith('/vulnerabilities')) {
        return { success: true, data: { vulnerabilities: [], pagination: { page: 1, limit: 50, total: 0, totalPages: 1 } } };
      }
      return { success: true, data: null };
    });

    renderWithProviders(<SecurityAnalysisPage />);

    await waitFor(() => {
      expect(screen.getByText('Security')).toBeInTheDocument();
    });
    expect(screen.getByText('Open WiFi Detected')).toBeInTheDocument();
    expect(screen.getByText('UPnP Enabled')).toBeInTheDocument();
    expect(screen.getByText('PMF Not Enabled')).toBeInTheDocument();
  });

  it('shows security score', async () => {
    vi.mocked(api.get).mockImplementation(async (url: string) => {
      if (url === '/security/analysis') return { success: true, data: mockAnalysis };
      if (url === '/security/sources') return { success: true, data: { sources: [] } };
      if (url.startsWith('/vulnerabilities/stats')) return { success: true, data: null };
      if (url.startsWith('/vulnerabilities')) {
        return { success: true, data: { vulnerabilities: [], pagination: { page: 1, limit: 50, total: 0, totalPages: 1 } } };
      }
      return { success: true, data: null };
    });

    renderWithProviders(<SecurityAnalysisPage />);

    await waitFor(() => {
      // 12 passed / 15 total = 80%
      expect(screen.getByText('80%')).toBeInTheDocument();
    });
    expect(screen.getByText('Config Score')).toBeInTheDocument();
  });

  it('filter buttons work for severity filtering', async () => {
    vi.mocked(api.get).mockImplementation(async (url: string) => {
      if (url === '/security/analysis') return { success: true, data: mockAnalysis };
      if (url === '/security/sources') return { success: true, data: { sources: [] } };
      if (url.startsWith('/vulnerabilities/stats')) return { success: true, data: null };
      if (url.startsWith('/vulnerabilities')) {
        return { success: true, data: { vulnerabilities: [], pagination: { page: 1, limit: 50, total: 0, totalPages: 1 } } };
      }
      return { success: true, data: null };
    });

    renderWithProviders(<SecurityAnalysisPage />);

    await waitFor(() => {
      expect(screen.getByText('Open WiFi Detected')).toBeInTheDocument();
    });

    // Click the "Critical/High" summary card (it has a "Requires immediate attention" subtitle)
    const criticalHighCard = screen.getByText('Requires immediate attention').closest('[class*="cursor-pointer"]');
    if (criticalHighCard) fireEvent.click(criticalHighCard);

    await waitFor(() => {
      // MEDIUM severity issue should be hidden
      expect(screen.queryByText('PMF Not Enabled')).not.toBeInTheDocument();
    });
    // HIGH and CRITICAL issues should remain
    expect(screen.getByText('Open WiFi Detected')).toBeInTheDocument();
    expect(screen.getByText('UPnP Enabled')).toBeInTheDocument();
  });

  it('handles empty state when no config exists', async () => {
    vi.mocked(api.get).mockImplementation(async (url: string) => {
      if (url === '/security/analysis') {
        return { success: false, error: { code: 'NO_CONFIG', message: 'No configuration found' } };
      }
      if (url === '/security/sources') return { success: true, data: { sources: [] } };
      if (url.startsWith('/vulnerabilities/stats')) return { success: true, data: null };
      if (url.startsWith('/vulnerabilities')) {
        return { success: true, data: { vulnerabilities: [], pagination: { page: 1, limit: 50, total: 0, totalPages: 1 } } };
      }
      return { success: true, data: null };
    });

    renderWithProviders(<SecurityAnalysisPage />);

    await waitFor(() => {
      expect(screen.getByText('No configuration found')).toBeInTheDocument();
    });
  });
});

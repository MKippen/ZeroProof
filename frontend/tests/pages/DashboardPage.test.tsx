import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { DashboardPage } from '@/pages/DashboardPage';
import api from '@/api/client';

vi.mock('@/api/client', () => ({
  default: {
    get: vi.fn(),
    post: vi.fn(),
    patch: vi.fn(),
  },
}));

// Mock the chart component to avoid recharts rendering complexity
vi.mock('@/components/charts/TimelineHistogram', () => ({
  TimelineHistogram: () => <div data-testid="timeline-histogram">Chart</div>,
}));

const mockDashboard = {
  securityScore: 72,
  scoreBreakdown: { analysisPassRate: 80, intentCompliance: 65 },
  securityAnalysis: {
    totalRules: 20,
    passed: 16,
    failed: 4,
    failedBySeverity: { CRITICAL: 1, HIGH: 2, MEDIUM: 1, LOW: 0, INFO: 0 },
    topIssues: [
      { ruleId: 'r1', ruleName: 'Open WiFi Detected', severity: 'HIGH' },
      { ruleId: 'r2', ruleName: 'UPnP Enabled', severity: 'MEDIUM' },
    ],
  },
  vulnerabilities: { fromVulnerabilities: 1 },
  recentVulnerabilities: [],
  intentCompliance: {
    score: 65,
    compliant: false,
    gapCount: 2,
    topGaps: [{ severity: 'HIGH', description: 'VLANs not isolated' }],
  },
  recentTests: [],
  hasConfig: true,
  hasIntentProfile: true,
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

describe('DashboardPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('shows loading spinner initially', () => {
    vi.mocked(api.get).mockReturnValue(new Promise(() => {})); // never resolves
    renderWithProviders(<DashboardPage />);
    expect(document.querySelector('.animate-spin')).toBeInTheDocument();
  });

  it('renders security score from API data', async () => {
    vi.mocked(api.get).mockImplementation(async (url: string) => {
      if (url === '/dashboard') return { success: true, data: mockDashboard };
      return { success: true, data: [] };
    });

    renderWithProviders(<DashboardPage />);

    await waitFor(() => {
      expect(screen.getByText('72')).toBeInTheDocument();
    });
    expect(screen.getByText('Security Score')).toBeInTheDocument();
  });

  it('shows security issues list with top issues', async () => {
    vi.mocked(api.get).mockImplementation(async (url: string) => {
      if (url === '/dashboard') return { success: true, data: mockDashboard };
      return { success: true, data: [] };
    });

    renderWithProviders(<DashboardPage />);

    await waitFor(() => {
      expect(screen.getByText('Security Issues')).toBeInTheDocument();
    });
    expect(screen.getByText('Open WiFi Detected')).toBeInTheDocument();
    expect(screen.getByText('open issues')).toBeInTheDocument();
  });

  it('shows intent compliance section with gaps', async () => {
    vi.mocked(api.get).mockImplementation(async (url: string) => {
      if (url === '/dashboard') return { success: true, data: mockDashboard };
      return { success: true, data: [] };
    });

    renderWithProviders(<DashboardPage />);

    await waitFor(() => {
      expect(screen.getByText('Intent Compliance')).toBeInTheDocument();
    });
    expect(screen.getByText('65%')).toBeInTheDocument();
    expect(screen.getByText('VLANs not isolated')).toBeInTheDocument();
    expect(screen.getByText('2 gaps')).toBeInTheDocument();
  });

  it('handles API error gracefully by showing empty state', async () => {
    vi.mocked(api.get).mockImplementation(async () => {
      throw new Error('Network error');
    });

    renderWithProviders(<DashboardPage />);

    // After error, the loading spinner should disappear (react-query handles the error)
    await waitFor(() => {
      expect(document.querySelector('.animate-spin')).not.toBeInTheDocument();
    });
  });

  it('shows setup prompt when no config imported', async () => {
    vi.mocked(api.get).mockImplementation(async (url: string) => {
      if (url === '/dashboard') {
        return { success: true, data: { ...mockDashboard, hasConfig: false } };
      }
      return { success: true, data: [] };
    });

    renderWithProviders(<DashboardPage />);

    await waitFor(() => {
      expect(screen.getByText('Import UniFi Configuration')).toBeInTheDocument();
    });
  });
});

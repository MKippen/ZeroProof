import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent, act } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { IntentDashboardPage } from '@/pages/IntentDashboardPage';
import api from '@/api/client';

vi.mock('@/api/client', () => ({
  default: {
    get: vi.fn(),
    post: vi.fn(),
    patch: vi.fn(),
  },
}));

const mockIntentProfile = {
  profile: {
    workFromHome: true,
    workDeviceIsolation: true,
    homeServer: false,
    iotDevices: true,
    guestNetwork: true,
    networkMappings: {},
    deviceMappings: {},
  },
  configured: true,
};

const mockAnalysis = {
  score: 73,
  compliant: false,
  gaps: [
    { severity: 'HIGH', description: 'IoT network not isolated' },
    { severity: 'MEDIUM', description: 'Guest firewall rules missing' },
  ],
  summary: {
    configured: 5,
    partial: 2,
    notConfigured: 3,
    notApplicable: 1,
  },
  settings: [
    {
      id: 'work_vlan',
      name: 'Work VLAN',
      description: 'Dedicated network for work devices',
      status: 'configured',
      severity: 'HIGH',
      category: 'work',
      required: true,
      currentValue: 'VLAN 20 (Work)',
      expectedValue: 'Dedicated VLAN',
    },
    {
      id: 'iot_vlan',
      name: 'IoT Network Isolation',
      description: 'Separate network for IoT devices',
      status: 'not_configured',
      severity: 'HIGH',
      category: 'devices',
      required: true,
      currentValue: 'Not set',
      expectedValue: 'Isolated VLAN',
    },
  ],
  configImportedAt: '2026-03-01T10:00:00Z',
  analyzedAt: '2026-03-01T10:01:00Z',
};

const mockNetworks = {
  networks: [
    { _id: 'net1', name: 'Default', vlan_enabled: false },
    { _id: 'net2', name: 'Work', vlan_enabled: true, vlan: 20 },
  ],
  hasConfig: true,
};

const mockDevices = { devices: [], hasConfig: true };

function renderWithProviders(ui: React.ReactElement, queryClient = new QueryClient({
  defaultOptions: { queries: { retry: false } },
})) {
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>{ui}</MemoryRouter>
    </QueryClientProvider>
  );
}

function setupDefaultMocks() {
  vi.mocked(api.get).mockImplementation(async (url: string) => {
    if (url === '/intent') return { success: true, data: mockIntentProfile };
    if (url === '/intent/analysis') return { success: true, data: mockAnalysis };
    if (url === '/intent/networks') return { success: true, data: mockNetworks };
    if (url === '/intent/devices') return { success: true, data: mockDevices };
    return { success: true, data: null };
  });
}

describe('IntentDashboardPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders compliance score and summary', async () => {
    setupDefaultMocks();
    renderWithProviders(<IntentDashboardPage />);

    await waitFor(() => {
      expect(screen.getByText('73%')).toBeInTheDocument();
    });
    expect(screen.getByText('Compliance Overview')).toBeInTheDocument();
    expect(screen.getByText('2 issue(s) to address')).toBeInTheDocument();
  });

  it('shows network mapping section when networks exist', async () => {
    setupDefaultMocks();
    renderWithProviders(<IntentDashboardPage />);

    await waitFor(() => {
      expect(screen.getByText('Network Mappings')).toBeInTheDocument();
    });
  });

  it('shows "Not configured" state when no intent profile', async () => {
    vi.mocked(api.get).mockImplementation(async (url: string) => {
      if (url === '/intent') return { success: true, data: { profile: null, configured: false } };
      if (url === '/intent/analysis') return { success: true, data: null };
      if (url === '/intent/networks') return { success: true, data: { networks: [], hasConfig: false } };
      if (url === '/intent/devices') return { success: true, data: { devices: [], hasConfig: false } };
      return { success: true, data: null };
    });

    renderWithProviders(<IntentDashboardPage />);

    await waitFor(() => {
      expect(screen.getByText('No Intent Profile Configured')).toBeInTheDocument();
    });
    expect(screen.getByText(/Use the Security Wizard/)).toBeInTheDocument();
    expect(screen.getByText('Start Security Wizard')).toBeInTheDocument();
  });

  it('handles loading state', () => {
    vi.mocked(api.get).mockReturnValue(new Promise(() => {})); // never resolves
    renderWithProviders(<IntentDashboardPage />);
    expect(document.querySelector('.animate-spin')).toBeInTheDocument();
  });

  it('shows setting cards with status indicators', async () => {
    setupDefaultMocks();
    renderWithProviders(<IntentDashboardPage />);

    // The "not_configured" setting appears directly as an issue card
    await waitFor(() => {
      expect(screen.getByText('IoT Network Isolation')).toBeInTheDocument();
    });
    // The passed (configured) setting is inside a collapsible "Checks Passed" section
    expect(screen.getByText(/Check.*Passed/)).toBeInTheDocument();
  });

  it('shows a retryable profile error instead of sending an existing installation through setup', async () => {
    vi.mocked(api.get).mockResolvedValue({ success: false, error: { code: 'FETCH_ERROR', message: 'Intent service unavailable' } });
    renderWithProviders(<IntentDashboardPage />);
    expect(await screen.findByRole('alert')).toHaveTextContent('Intent service unavailable');
    expect(screen.queryByText('No Intent Profile Configured')).not.toBeInTheDocument();
    expect(screen.queryByText('Start Security Wizard')).not.toBeInTheDocument();
    setupDefaultMocks();
    fireEvent.click(screen.getByRole('button', { name: 'Retry loading data' }));
    expect(await screen.findByText('Edit Intent')).toBeInTheDocument();
  });

  it('retains the last successful profile and analysis with a warning when refresh fails', async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    setupDefaultMocks();
    renderWithProviders(<IntentDashboardPage />, client);
    expect(await screen.findByText('73%')).toBeInTheDocument();
    vi.mocked(api.get).mockResolvedValue({ success: false, error: { code: 'NETWORK_ERROR', message: 'Refresh failed' } });
    await act(async () => {
      await Promise.all([
        client.invalidateQueries({ queryKey: ['intent-profile'] }),
        client.invalidateQueries({ queryKey: ['intent-analysis'] }),
      ]);
    });
    expect(await screen.findByRole('alert')).toHaveTextContent('Showing the last successful data');
    expect(screen.getByText('73%')).toBeInTheDocument();
    expect(screen.getByText('IoT Network Isolation')).toBeInTheDocument();
    expect(screen.queryByText('No Intent Profile Configured')).not.toBeInTheDocument();
    setupDefaultMocks();
    fireEvent.click(screen.getByRole('button', { name: 'Retry loading data' }));
    await waitFor(() => expect(screen.queryByRole('alert')).not.toBeInTheDocument());
  });

  it.each(['FETCH_ERROR', 'NO_CONFIG'])('distinguishes an analysis %s response from an empty configuration', async (code) => {
    vi.mocked(api.get).mockImplementation(async (url: string) => {
      if (url === '/intent') return { success: true, data: mockIntentProfile };
      if (url === '/intent/analysis') return { success: false, error: { code, message: 'Analysis is unavailable' } };
      if (url === '/intent/networks') return { success: true, data: mockNetworks };
      if (url === '/intent/devices') return { success: true, data: mockDevices };
      return { success: true, data: null };
    });
    renderWithProviders(<IntentDashboardPage />);
    if (code === 'NO_CONFIG') {
      expect(await screen.findByText('Import Your UniFi Configuration')).toBeInTheDocument();
      expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    } else {
      expect(await screen.findByRole('alert')).toHaveTextContent('Analysis is unavailable');
      expect(screen.queryByText('Import Your UniFi Configuration')).not.toBeInTheDocument();
    }
  });
});

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { TimelinePage } from '@/pages/TimelinePage';
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

// Mock the ClientDetailPanel to avoid extra dependencies
vi.mock('@/components/clients/ClientDetailPanel', () => ({
  ClientDetailPanel: () => <div data-testid="client-detail">Client Detail</div>,
}));

const mockTimelineResponse = {
  groups: [
    {
      period: '2026-03-07',
      label: 'March 7, 2026',
      summary: {
        total: 3,
        securityChanges: 1,
        configChanges: 1,
        newClients: 1,
        removedClients: 0,
        deviceChanges: 0,
        firmwareUpdates: 0,
      },
      events: [
        {
          id: 'e1',
          changeType: 'MODIFIED',
          resourceType: 'firewallRule',
          resourceId: 'fw1',
          resourceName: 'Block IoT',
          detectedAt: '2026-03-07T14:00:00Z',
        },
        {
          id: 'e2',
          changeType: 'CREATED',
          resourceType: 'client',
          resourceId: 'aa:bb:cc:dd:ee:ff',
          resourceName: 'iPhone',
          detectedAt: '2026-03-07T12:00:00Z',
        },
        {
          id: 'e3',
          changeType: 'MODIFIED',
          resourceType: 'wlan',
          resourceId: 'wlan1',
          resourceName: 'Home WiFi',
          detectedAt: '2026-03-07T10:00:00Z',
        },
      ],
    },
  ],
  pagination: { totalPages: 1 },
};

const mockStats = {
  totalChanges: 42,
  totalClients: 15,
  firstEventDate: '2026-01-01T00:00:00Z',
};

const mockHistogram = [
  { date: '2026-03-01', total: 5, security: 1, config: 2, clients: 2, devices: 0, firmware: 0 },
  { date: '2026-03-02', total: 3, security: 0, config: 1, clients: 1, devices: 1, firmware: 0 },
];

describe('TimelinePage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders timeline header with stats', async () => {
    vi.mocked(api.get).mockImplementation(async (url: string) => {
      if (url.startsWith('/timeline/stats')) return { success: true, data: mockStats };
      if (url.startsWith('/timeline/histogram')) return { success: true, data: mockHistogram };
      if (url.startsWith('/timeline')) return { success: true, data: mockTimelineResponse };
      return { success: true, data: null };
    });

    render(<MemoryRouter><TimelinePage /></MemoryRouter>);

    await waitFor(() => {
      expect(screen.getByText('Network Timeline')).toBeInTheDocument();
    });
    expect(screen.getByText(/42 changes tracked across 15 clients/)).toBeInTheDocument();
  });

  it('shows range selector buttons', async () => {
    vi.mocked(api.get).mockImplementation(async (url: string) => {
      if (url.startsWith('/timeline/stats')) return { success: true, data: mockStats };
      if (url.startsWith('/timeline/histogram')) return { success: true, data: mockHistogram };
      if (url.startsWith('/timeline')) return { success: true, data: mockTimelineResponse };
      return { success: true, data: null };
    });

    render(<MemoryRouter><TimelinePage /></MemoryRouter>);

    await waitFor(() => {
      expect(screen.getByText('3 months')).toBeInTheDocument();
    });
    expect(screen.getByText('1 year')).toBeInTheDocument();
    expect(screen.getByText('All time')).toBeInTheDocument();
  });

  it('shows event list with group cards', async () => {
    vi.mocked(api.get).mockImplementation(async (url: string) => {
      if (url.startsWith('/timeline/stats')) return { success: true, data: mockStats };
      if (url.startsWith('/timeline/histogram')) return { success: true, data: mockHistogram };
      if (url.startsWith('/timeline')) return { success: true, data: mockTimelineResponse };
      return { success: true, data: null };
    });

    render(<MemoryRouter><TimelinePage /></MemoryRouter>);

    await waitFor(() => {
      expect(screen.getByText('March 7, 2026')).toBeInTheDocument();
    });
    expect(screen.getByText('3 total changes')).toBeInTheDocument();
  });

  it('handles empty state with no changes', async () => {
    vi.mocked(api.get).mockImplementation(async (url: string) => {
      if (url.startsWith('/timeline/stats')) return { success: true, data: { totalChanges: 0, totalClients: 0 } };
      if (url.startsWith('/timeline/histogram')) return { success: true, data: [] };
      if (url.startsWith('/timeline')) {
        return { success: true, data: { groups: [], pagination: { totalPages: 0 } } };
      }
      return { success: true, data: null };
    });

    render(<MemoryRouter><TimelinePage /></MemoryRouter>);

    await waitFor(() => {
      expect(screen.getByText('No changes recorded yet')).toBeInTheDocument();
    });
    expect(screen.getByText('Enable auto-sync to start tracking network changes.')).toBeInTheDocument();
  });

  it('shows filter buttons for event types', async () => {
    vi.mocked(api.get).mockImplementation(async (url: string) => {
      if (url.startsWith('/timeline/stats')) return { success: true, data: mockStats };
      if (url.startsWith('/timeline/histogram')) return { success: true, data: mockHistogram };
      if (url.startsWith('/timeline')) return { success: true, data: mockTimelineResponse };
      return { success: true, data: null };
    });

    render(<MemoryRouter><TimelinePage /></MemoryRouter>);

    await waitFor(() => {
      expect(screen.getByText('All')).toBeInTheDocument();
    });
    expect(screen.getByText('Security')).toBeInTheDocument();
    expect(screen.getByText('Config')).toBeInTheDocument();
    expect(screen.getByText('Devices')).toBeInTheDocument();
    expect(screen.getByText('Clients')).toBeInTheDocument();
    expect(screen.getByText('Firmware')).toBeInTheDocument();
  });
});

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { DetectionsPage } from '@/pages/DetectionsPage';
import api from '@/api/client';

vi.mock('@/api/client', () => ({
  default: { get: vi.fn(), post: vi.fn() },
}));

const summaryPayload = {
  windowHours: 24,
  since: '2026-05-06T00:00:00Z',
  total: 5,
  open: 4,
  resolved: 1,
  dismissed: 0,
  bySeverity: [
    { severity: 'CRITICAL', count: 1 },
    { severity: 'HIGH', count: 2 },
    { severity: 'MEDIUM', count: 2 },
  ],
  byDetector: [
    { detectorId: 'ioc_match', count: 3 },
    { detectorId: 'dns_bypass', count: 2 },
  ],
  topAffected: [
    { resource: 'iot-cam', count: 3, maxSeverity: 'CRITICAL' },
    { resource: 'laptop', count: 2, maxSeverity: 'HIGH' },
  ],
};

const listPayload = [
  {
    id: 'd-1',
    detectorId: 'ioc_match',
    fingerprint: 'fp-1',
    severity: 'CRITICAL',
    status: 'OPEN',
    title: 'iot-cam contacted known-bad 203.0.113.5',
    description: 'Destination matched threat-intel feed(s): urlhaus.',
    affectedResource: 'iot-cam',
    srcMac: 'aa:bb:cc:dd:ee:ff',
    occurrences: 3,
    firstSeen: '2026-05-06T10:00:00Z',
    lastSeen: '2026-05-07T12:00:00Z',
    expiresAt: '2026-06-06T10:00:00Z',
    remediation: 'Isolate device.',
    references: ['https://urlhaus.abuse.ch/'],
    evidence: [{ kind: 'ioc', ioc: '203.0.113.5', feed: 'urlhaus' }],
    metadata: { matchedValue: '203.0.113.5' },
  },
  {
    id: 'd-2',
    detectorId: 'dns_bypass',
    fingerprint: 'fp-2',
    severity: 'MEDIUM',
    status: 'RESOLVED',
    title: 'tv used external DNS server 76.76.2.0',
    description: 'Bypassed monitored proxy.',
    affectedResource: 'tv',
    srcMac: null,
    occurrences: 1,
    firstSeen: '2026-05-07T11:00:00Z',
    lastSeen: '2026-05-07T11:30:00Z',
    expiresAt: '2026-05-21T11:00:00Z',
    remediation: null,
    references: null,
    evidence: [],
    metadata: null,
  },
];

function setupApi() {
  vi.mocked(api.get).mockImplementation(async (url: string) => {
    if (url.startsWith('/detections/analytics')) {
      return { success: true, data: summaryPayload };
    }
    if (url.startsWith('/detections')) {
      return { success: true, data: listPayload };
    }
    return { success: false, error: { code: 'BAD', message: 'unexpected' } };
  });
  vi.mocked(api.post).mockResolvedValue({ success: true, data: {} });
}

function renderPage() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <DetectionsPage />
      </MemoryRouter>
    </QueryClientProvider>
  );
}

describe('DetectionsPage', () => {
  beforeEach(() => vi.clearAllMocks());

  it('renders the empty state when there are no detections', async () => {
    vi.mocked(api.get).mockImplementation(async (url: string) => {
      if (url.startsWith('/detections/analytics')) {
        return {
          success: true,
          data: { ...summaryPayload, total: 0, open: 0, resolved: 0, dismissed: 0 },
        };
      }
      return { success: true, data: [] };
    });

    renderPage();
    expect(
      await screen.findByText(/No detections in this window/i)
    ).toBeInTheDocument();
  });

  it('renders summary tiles, top lists, and the findings table when populated', async () => {
    setupApi();
    renderPage();

    await waitFor(() => {
      expect(screen.getByText('Open detections')).toBeInTheDocument();
    });

    // Summary tile values
    expect(screen.getByText('4')).toBeInTheDocument(); // open count
    // Top detectors
    expect(screen.getAllByText('ioc_match').length).toBeGreaterThan(0);
    // Top affected
    expect(screen.getAllByText('iot-cam').length).toBeGreaterThan(0);
    // Finding row
    expect(
      screen.getByText('iot-cam contacted known-bad 203.0.113.5')
    ).toBeInTheDocument();
    // Severity badge text appears in summary tile + row
    expect(screen.getAllByText('CRITICAL').length).toBeGreaterThan(0);
  });

  it('shows resolve / dismiss for OPEN findings and posts to the right endpoint', async () => {
    setupApi();
    renderPage();

    const resolveBtn = await screen.findByRole('button', { name: /Resolve/i });
    fireEvent.click(resolveBtn);

    await waitFor(() => {
      expect(api.post).toHaveBeenCalledWith(
        '/detections/d-1/resolve',
        expect.anything()
      );
    });
  });

  it('shows reopen for non-OPEN findings', async () => {
    setupApi();
    renderPage();
    expect(
      await screen.findByRole('button', { name: /Reopen/i })
    ).toBeInTheDocument();
  });
});

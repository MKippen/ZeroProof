import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { UniFiPage } from '@/pages/UniFiPage';
import { ConfigContent } from '@/pages/ConfigPage';
import { SecurityAnalysisPage } from '@/pages/SecurityAnalysisPage';
import { IntentDashboardPage } from '@/pages/IntentDashboardPage';
import api from '@/api/client';

const mocks = vi.hoisted(() => ({ toast: vi.fn() }));
vi.mock('@/api/client', () => ({ default: { get: vi.fn(), post: vi.fn(), patch: vi.fn(), delete: vi.fn() } }));
vi.mock('@/hooks/useToast', () => ({ useToast: () => ({ toast: mocks.toast, toasts: [] }) }));
vi.mock('@/components/ControllerConnectionForm', () => ({ ControllerConnectionForm: () => null }));

const securityAnalysis = {
  analyzedAt: '2026-09-07T12:00:00Z', configSiteName: 'Saved site',
  summary: { totalRules: 1, passed: 0, failed: 1 },
  results: [{ ruleId: 'known', ruleName: 'Known security issue', severity: 'HIGH', category: 'wireless', passed: false,
    findings: [{ description: 'Existing finding', affectedResource: 'Saved site' }] }],
};
const intentAnalysis = {
  score: 73, compliant: false, gaps: [], settings: [],
  summary: { configured: 1, partial: 0, notConfigured: 1, notApplicable: 0 },
  analyzedAt: '2026-09-07T12:00:00Z', configImportedAt: '2026-09-07T12:00:00Z',
};
const surfaces = [
  { name: 'named connections', Component: UniFiPage, button: 'Sync Now', saved: 'Lab controller' },
  { name: 'legacy settings', Component: ConfigContent, button: 'Sync Configuration Now', saved: 'unifi.local' },
  { name: 'security analysis', Component: SecurityAnalysisPage, button: 'Sync & Analyze', saved: 'Known security issue' },
  { name: 'intent analysis', Component: IntentDashboardPage, button: 'Refresh', saved: '73%' },
];

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(api.post).mockReset();
  vi.mocked(api.get).mockImplementation(async (url) => {
    if (url === '/unifi/connections') return { success: true, data: { connections: [{
      id: 'lab', name: 'Lab controller', host: 'unifi.local', port: 443, siteId: 'default',
      isActive: true, autoSync: false, lastSyncStatus: 'IN_PROGRESS', lastSyncAt: null, lastSyncError: null,
    }] } };
    if (url === '/unifi/settings') return { success: true, data: { configured: true, settings: {
      host: 'unifi.local', port: 443, selectedSite: 'default', lastSyncStatus: 'success',
    } } };
    if (url === '/config/current') return { success: true, data: { config: null } };
    if (url === '/config/history') return { success: true, data: { configs: [] } };
    if (url === '/security/analysis') return { success: true, data: securityAnalysis };
    if (url === '/security/sources') return { success: true, data: { sources: [] } };
    if (url.startsWith('/vulnerabilities/stats')) return { success: true, data: { bySeverity: {} } };
    if (url.startsWith('/vulnerabilities')) return { success: true, data: { vulnerabilities: [], pagination: { page: 1, limit: 50, total: 0, totalPages: 1 } } };
    if (url === '/intent') return { success: true, data: { configured: true, profile: { networkMappings: {}, deviceMappings: {} } } };
    if (url === '/intent/analysis') return { success: true, data: intentAnalysis };
    if (url === '/intent/networks') return { success: true, data: { networks: [], hasConfig: true } };
    if (url === '/intent/devices') return { success: true, data: { devices: [], hasConfig: true } };
    return { success: true, data: {} };
  });
});

function renderSurface(Component: () => JSX.Element) {
  // Sync operations must override even a globally enabled mutation retry.
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: 3, retryDelay: 1 } } });
  return { ...render(<QueryClientProvider client={client}><MemoryRouter><Component /></MemoryRouter></QueryClientProvider>), client };
}

describe.each(surfaces)('UniFi sync: $name', ({ Component, button, saved }) => {
  it.each(['SYNC_IN_PROGRESS', 'SYNC_LEASE_LOST'])('keeps saved data and offers a manual retry for %s without replaying or analyzing stale data', async (code) => {
    vi.mocked(api.post).mockResolvedValue({ success: false, error: { code, message: 'Retry later' } });
    renderSurface(Component);
    const sync = await screen.findByRole('button', { name: button, exact: true });
    expect(sync).toBeEnabled();
    const analysisReads = vi.mocked(api.get).mock.calls.filter(([url]) => url.endsWith('/analysis')).length;
    await userEvent.click(sync);
    await waitFor(() => expect(mocks.toast).toHaveBeenCalledWith(expect.objectContaining({
      variant: 'default', title: code === 'SYNC_IN_PROGRESS' ? 'Sync already in progress' : 'Sync interrupted',
      description: expect.stringMatching(/try again/),
    })));
    expect(api.post).toHaveBeenCalledTimes(1);
    expect(vi.mocked(api.post).mock.calls[0]![0]).toMatch(/\/unifi\/.*sync$/);
    expect(vi.mocked(api.get).mock.calls.filter(([url]) => url.endsWith('/analysis'))).toHaveLength(analysisReads);
    expect(screen.getByText(saved)).toBeInTheDocument();
    expect(sync).toBeEnabled();

    vi.mocked(api.post).mockImplementation(async (url) => ({ success: true, data: url === '/security/analyze'
      ? securityAnalysis : { synced: false, message: 'Configuration unchanged', stats: { vulnerabilitiesFound: 1 } } }));
    await userEvent.click(sync);
    await waitFor(() => expect(sync).toBeEnabled());
    expect(vi.mocked(api.post).mock.calls.filter(([url]) => url.startsWith('/unifi/'))).toHaveLength(2);
  });
});

describe('analysis with an imported configuration', () => {
  it.each(surfaces.slice(2))('continues $name only when the live controller is confirmed unconfigured', async ({ Component, button }) => {
    vi.mocked(api.post).mockImplementation(async (url) => url === '/unifi/sync'
      ? { success: false, error: { code: 'NOT_CONFIGURED', message: 'No controller configured' } }
      : { success: true, data: securityAnalysis });
    renderSurface(Component);
    const sync = await screen.findByRole('button', { name: button, exact: true });
    const initialReads = vi.mocked(api.get).mock.calls.filter(([url]) => url === '/intent/analysis').length;
    await userEvent.click(sync);
    if (Component === SecurityAnalysisPage) {
      await waitFor(() => expect(api.post).toHaveBeenCalledWith('/security/analyze', { saveFindings: false }));
    } else {
      await waitFor(() => expect(vi.mocked(api.get).mock.calls.filter(([url]) => url === '/intent/analysis').length).toBeGreaterThan(initialReads));
    }
    expect(mocks.toast).not.toHaveBeenCalledWith(expect.objectContaining({ title: 'Sync failed' }));
  });
});

it('keeps the connection visible if its status refresh fails after a busy response', async () => {
  vi.mocked(api.post).mockResolvedValue({ success: false, error: { code: 'SYNC_IN_PROGRESS', message: 'Already running' } });
  renderSurface(UniFiPage);
  const sync = await screen.findByRole('button', { name: 'Sync Now' });
  const healthyReads = vi.mocked(api.get).getMockImplementation()!;
  vi.mocked(api.get).mockResolvedValue({ success: false, error: { code: 'FETCH_ERROR', message: 'Status unavailable' } });
  await userEvent.click(sync);
  expect(await screen.findByRole('alert')).toHaveTextContent('Status unavailable');
  expect(screen.getByRole('alert')).toHaveTextContent('Showing the last successful data');
  expect(screen.getByText('Lab controller')).toBeInTheDocument();
  expect(screen.queryByText('No UniFi Controllers Connected')).not.toBeInTheDocument();
  vi.mocked(api.get).mockImplementation(healthyReads);
  await userEvent.click(screen.getByRole('button', { name: 'Retry loading data' }));
  await waitFor(() => expect(screen.queryByRole('alert')).not.toBeInTheDocument());
  expect(api.post).toHaveBeenCalledTimes(1);
});

describe('configuration data reads', () => {
  it('shows retryable initial read failures without claiming no controller is connected', async () => {
    const healthyReads = vi.mocked(api.get).getMockImplementation()!;
    vi.mocked(api.get).mockImplementation(async (url) => ({
      success: false, error: { code: 'FETCH_ERROR', message: `Unavailable: ${url}` },
    }));
    renderSurface(ConfigContent);
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('Unavailable: /unifi/settings');
    expect(alert).toHaveTextContent('Unavailable: /config/current');
    expect(alert).toHaveTextContent('Unavailable: /config/history');
    expect(screen.queryByText('No UniFi Controller connected')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Sync Configuration Now' })).not.toBeInTheDocument();
    vi.mocked(api.get).mockImplementation(healthyReads);
    await userEvent.click(screen.getByRole('button', { name: 'Retry loading data' }));
    expect(await screen.findByRole('button', { name: 'Sync Configuration Now' })).toBeEnabled();
    await waitFor(() => expect(screen.queryByRole('alert')).not.toBeInTheDocument());
    expect(api.post).not.toHaveBeenCalled();
  });

  it('preserves settings, active configuration and history when post-sync reads fail, and retries only reads', async () => {
    const defaultReads = vi.mocked(api.get).getMockImplementation()!;
    const active = { id: 'active', siteName: 'Saved active site', isActive: true, importedAt: '2026-09-07T12:00:00Z' };
    const historical = { ...active, id: 'old', siteName: 'Saved historical site', isActive: false };
    vi.mocked(api.get).mockImplementation(async (url) => {
      if (url === '/config/current') return { success: true, data: { config: active } };
      if (url === '/config/history') return { success: true, data: { configs: [active, historical] } };
      return defaultReads(url);
    });
    const healthyReads = vi.mocked(api.get).getMockImplementation()!;
    const { client } = renderSurface(ConfigContent);
    const sync = await screen.findByRole('button', { name: 'Sync Configuration Now' });
    expect(screen.getByText('Saved active site')).toBeInTheDocument();
    vi.mocked(api.post).mockResolvedValue({ success: true, data: { synced: true, analysis: { vulnerabilitiesFound: 1 } } });
    vi.mocked(api.get).mockImplementation(async (url) => ({
      success: false, error: { code: 'FETCH_ERROR', message: `Unavailable: ${url}` },
    }));
    await userEvent.click(sync);
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('Unavailable: /unifi/settings');
    expect(alert).toHaveTextContent('Unavailable: /config/current');
    expect(alert).toHaveTextContent('Unavailable: /config/history');
    expect(alert).toHaveTextContent('Showing the last successful data');
    expect(screen.getByText('unifi.local')).toBeInTheDocument();
    expect(screen.getByText('Saved active site')).toBeInTheDocument();
    expect(screen.getByText(/Most recent: Saved historical site/)).toBeInTheDocument();
    expect(client.getQueryData(['config', 'current'])).toEqual(active);
    expect(client.getQueryData(['config', 'history'])).toEqual([active, historical]);
    expect(sync).toBeEnabled();
    vi.mocked(api.get).mockImplementation(healthyReads);
    await userEvent.click(screen.getByRole('button', { name: 'Retry loading data' }));
    await waitFor(() => expect(screen.queryByRole('alert')).not.toBeInTheDocument());
    expect(api.post).toHaveBeenCalledTimes(1);
  });
});

describe('intent refresh result', () => {
  it('displays and caches its fresh analysis without a redundant read', async () => {
    const { client } = renderSurface(IntentDashboardPage);
    expect(await screen.findByText('73%')).toBeInTheDocument();
    const defaultReads = vi.mocked(api.get).getMockImplementation()!;
    const freshAnalysis = { ...intentAnalysis, score: 98 };
    let refreshReads = 0;
    vi.mocked(api.get).mockImplementation(async (url) => {
      if (url === '/intent/analysis') {
        refreshReads += 1;
        return refreshReads === 1 ? { success: true, data: freshAnalysis }
          : { success: false, error: { code: 'FETCH_ERROR', message: 'Redundant read failed' } };
      }
      return defaultReads(url);
    });
    vi.mocked(api.post).mockResolvedValue({ success: true, data: { synced: false } });
    await userEvent.click(screen.getByRole('button', { name: 'Refresh', exact: true }));
    expect(await screen.findByText('98%')).toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole('button', { name: 'Refresh', exact: true })).toBeEnabled());
    expect(refreshReads).toBe(1);
    expect(client.getQueryData(['intent-analysis'])).toEqual(freshAnalysis);
    expect(screen.queryByText('73%')).not.toBeInTheDocument();
    expect(mocks.toast).toHaveBeenCalledWith({ title: 'Analysis refreshed' });
    expect(api.post).toHaveBeenCalledTimes(1);
  });

  it('prevents an older background read from overwriting the refreshed analysis', async () => {
    const { client } = renderSurface(IntentDashboardPage);
    expect(await screen.findByText('73%')).toBeInTheDocument();
    const defaultReads = vi.mocked(api.get).getMockImplementation()!;
    let finishOldRead!: (value: { success: boolean; data: typeof intentAnalysis }) => void;
    const oldRead = new Promise<{ success: boolean; data: typeof intentAnalysis }>((resolve) => { finishOldRead = resolve; });
    const freshAnalysis = { ...intentAnalysis, score: 98 };
    let analysisReads = 0;
    vi.mocked(api.get).mockImplementation(async (url) => {
      if (url === '/intent/analysis') {
        analysisReads += 1;
        return analysisReads === 1 ? oldRead : { success: true, data: freshAnalysis };
      }
      return defaultReads(url);
    });
    void client.invalidateQueries({ queryKey: ['intent-analysis'] });
    await waitFor(() => expect(analysisReads).toBe(1));
    vi.mocked(api.post).mockResolvedValue({ success: true, data: { synced: false } });
    await userEvent.click(screen.getByRole('button', { name: 'Refresh', exact: true }));
    expect(await screen.findByText('98%')).toBeInTheDocument();
    await act(async () => { finishOldRead({ success: true, data: { ...intentAnalysis, score: 12 } }); });
    expect(client.getQueryData(['intent-analysis'])).toEqual(freshAnalysis);
    expect(screen.getByText('98%')).toBeInTheDocument();
    expect(analysisReads).toBe(2);
  });

  it.each([
    { success: false, error: { code: 'FETCH_ERROR', message: 'Analysis unavailable' } },
    { success: true },
  ])('keeps the previous analysis without claiming success if the refreshed read fails: %j', async (response) => {
    const { client } = renderSurface(IntentDashboardPage);
    expect(await screen.findByText('73%')).toBeInTheDocument();
    const defaultReads = vi.mocked(api.get).getMockImplementation()!;
    vi.mocked(api.get).mockImplementation(async (url) => url === '/intent/analysis' ? response : defaultReads(url));
    vi.mocked(api.post).mockResolvedValue({ success: true, data: { synced: false } });
    await userEvent.click(screen.getByRole('button', { name: 'Refresh', exact: true }));
    await waitFor(() => expect(mocks.toast).toHaveBeenCalledWith(expect.objectContaining({ variant: 'destructive', title: 'Refresh failed' })));
    expect(mocks.toast).not.toHaveBeenCalledWith({ title: 'Analysis refreshed' });
    expect(screen.getByText('73%')).toBeInTheDocument();
    expect(client.getQueryData(['intent-analysis'])).toEqual(intentAnalysis);
    expect(screen.getByRole('button', { name: 'Refresh', exact: true })).toBeEnabled();
    expect(api.post).toHaveBeenCalledTimes(1);
  });
});

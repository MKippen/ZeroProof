import { lazy, Suspense, useEffect, useState, type ReactNode } from 'react';
import { BrowserRouter, Routes, Route, Navigate, useLocation } from 'react-router-dom';
import { Toaster } from '@/components/ui/toaster';
import { useAuthStore } from '@/stores/authStore';
import { Layout } from '@/components/layout/Layout';
import api from '@/api/client';

const LoginPage = lazy(() => import('@/pages/LoginPage').then((m) => ({ default: m.LoginPage })));
const SetupPage = lazy(() => import('@/pages/SetupPage').then((m) => ({ default: m.SetupPage })));
const DashboardPage = lazy(() => import('@/pages/DashboardPage').then((m) => ({ default: m.DashboardPage })));
const DevicesPage = lazy(() => import('@/pages/DevicesPage').then((m) => ({ default: m.DevicesPage })));
const ConfigPage = lazy(() => import('@/pages/ConfigPage').then((m) => ({ default: m.ConfigPage })));
const UniFiPage = lazy(() => import('@/pages/UniFiPage').then((m) => ({ default: m.UniFiPage })));
const SettingsPage = lazy(() => import('@/pages/SettingsPage').then((m) => ({ default: m.SettingsPage })));
const ESP32SetupPage = lazy(() => import('@/pages/ESP32SetupPage').then((m) => ({ default: m.ESP32SetupPage })));
const NetworkWizardPage = lazy(() => import('@/pages/NetworkWizardPage').then((m) => ({ default: m.NetworkWizardPage })));
const IntentDashboardPage = lazy(() => import('@/pages/IntentDashboardPage').then((m) => ({ default: m.IntentDashboardPage })));
const SecurityAnalysisPage = lazy(() => import('@/pages/SecurityAnalysisPage').then((m) => ({ default: m.SecurityAnalysisPage })));
const OptimizationPage = lazy(() => import('@/pages/OptimizationPage').then((m) => ({ default: m.OptimizationPage })));
const RulesPage = lazy(() => import('@/pages/RulesPage'));
const TimelinePage = lazy(() => import('@/pages/TimelinePage').then((m) => ({ default: m.TimelinePage })));
const ClientsPage = lazy(() => import('@/pages/ClientsPage').then((m) => ({ default: m.ClientsPage })));
const DNSProxyPage = lazy(() => import('@/pages/DNSProxyPage').then((m) => ({ default: m.DNSProxyPage })));
const TrafficPage = lazy(() => import('@/pages/TrafficPage').then((m) => ({ default: m.TrafficPage })));
const DetectionsPage = lazy(() => import('@/pages/DetectionsPage').then((m) => ({ default: m.DetectionsPage })));

function ProtectedRoute({ children }: { children: ReactNode }) {
  const isAuthenticated = useAuthStore((state) => state.isAuthenticated);

  if (!isAuthenticated) {
    return <Navigate to="/login" replace />;
  }

  return <>{children}</>;
}

// Probe /auth/setup-status on first load; if no admin exists, route the
// user to /setup before any login screen. Avoids the "what is the password?"
// trap on a true fresh install.
function SetupGate({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<'loading' | 'initialized' | 'needs-setup'>('loading');
  const location = useLocation();

  useEffect(() => {
    let cancelled = false;
    api
      .get<{ initialized: boolean }>('/auth/setup-status')
      .then((res) => {
        if (cancelled) return;
        if (res.success && res.data) {
          setStatus(res.data.initialized ? 'initialized' : 'needs-setup');
        } else {
          // If the probe fails we fail open to "initialized" so the existing
          // login flow still works rather than trapping the user on /setup.
          setStatus('initialized');
        }
      })
      .catch(() => {
        if (!cancelled) setStatus('initialized');
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (status === 'loading') {
    return <RouteFallback />;
  }

  if (status === 'needs-setup' && location.pathname !== '/setup') {
    return <Navigate to="/setup" replace />;
  }

  if (status === 'initialized' && location.pathname === '/setup') {
    return <Navigate to="/login" replace />;
  }

  return <>{children}</>;
}

function RouteFallback() {
  return (
    <div className="min-h-screen bg-background flex items-center justify-center text-sm text-muted-foreground">
      Loading...
    </div>
  );
}

function App() {
  return (
    <BrowserRouter>
      <Suspense fallback={<RouteFallback />}>
        <SetupGate>
        <Routes>
          <Route path="/setup" element={<SetupPage />} />
          <Route path="/login" element={<LoginPage />} />
          <Route
            path="/"
            element={
              <ProtectedRoute>
                <Layout />
              </ProtectedRoute>
            }
          >
            <Route index element={<Navigate to="/dashboard" replace />} />
            <Route path="dashboard" element={<DashboardPage />} />
            <Route path="devices" element={<DevicesPage />} />
            <Route path="tests" element={<Navigate to="/devices?tab=tests" replace />} />
            <Route path="vulnerabilities" element={<Navigate to="/security" replace />} />
            <Route path="config" element={<ConfigPage />} />
            <Route path="unifi" element={<UniFiPage />} />
            <Route path="settings" element={<SettingsPage />} />
            <Route path="esp32-setup" element={<ESP32SetupPage />} />
            <Route path="wizard" element={<NetworkWizardPage />} />
            <Route path="intent" element={<IntentDashboardPage />} />
            <Route path="security" element={<SecurityAnalysisPage />} />
            <Route path="optimization" element={<OptimizationPage />} />
            <Route path="rules" element={<RulesPage />} />
            <Route path="timeline" element={<TimelinePage />} />
            <Route path="clients" element={<ClientsPage />} />
            <Route path="dns-proxy" element={<DNSProxyPage />} />
            <Route path="traffic" element={<TrafficPage />} />
            <Route path="detections" element={<DetectionsPage />} />
          </Route>
        </Routes>
        </SetupGate>
      </Suspense>
      <Toaster />
    </BrowserRouter>
  );
}

export default App;

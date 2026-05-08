import { useEffect } from 'react';
import { Outlet, NavLink, useNavigate } from 'react-router-dom';
import {
  LayoutDashboard,
  Cpu,
  ShieldCheck,
  Settings,
  LogOut,
  Menu,
  X,
  Target,
  Zap,
  History,
  Users,
  Network,
  Activity,
  Radar,
} from 'lucide-react';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { useAuthStore } from '@/stores/authStore';
import { useWebSocketStore } from '@/stores/websocketStore';
import api from '@/api/client';
import { cn } from '@/lib/utils';
import { ZeroProofWordmark } from '@/components/brand/ZeroProofLogo';
import { NotificationBell } from '@/components/layout/NotificationBell';

const navItems = [
  { to: '/dashboard', icon: LayoutDashboard, label: 'Dashboard' },
  { to: '/intent', icon: Target, label: 'Intent' },
  { to: '/security', icon: ShieldCheck, label: 'Security' },
  { to: '/dns-proxy', icon: Network, label: 'DNS Proxy' },
  { to: '/traffic', icon: Activity, label: 'Traffic & Flow' },
  { to: '/detections', icon: Radar, label: 'Detections' },
  { to: '/timeline', icon: History, label: 'Timeline' },
  { to: '/optimization', icon: Zap, label: 'Optimization' },
  { to: '/devices', icon: Cpu, label: 'Devices' },
  { to: '/clients', icon: Users, label: 'Clients' },
  { to: '/settings', icon: Settings, label: 'Settings' },
];

export function Layout() {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const navigate = useNavigate();
  const { logout } = useAuthStore();
  const { connect } = useWebSocketStore();

  useEffect(() => {
    connect();
  }, [connect]);

  useEffect(() => {
    if (!sidebarOpen) {
      document.body.style.overflow = '';
      return;
    }
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = '';
    };
  }, [sidebarOpen]);

  const handleLogout = async () => {
    await api.post('/auth/logout');
    logout();
    navigate('/login');
  };

  return (
    <div className="min-h-screen bg-background bg-grid-pattern">
      {/* Mobile sidebar toggle */}
      <div className="lg:hidden fixed top-0 left-0 right-0 z-50 flex items-center justify-between px-4 pb-3 pt-[max(0.75rem,env(safe-area-inset-top))] bg-card/95 backdrop-blur-sm border-b border-border/50">
        <ZeroProofWordmark size="sm" />
        <div className="flex items-center gap-1">
          <NotificationBell />
          <Button variant="ghost" size="icon" onClick={() => setSidebarOpen(!sidebarOpen)}>
            {sidebarOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
          </Button>
        </div>
      </div>

      {/* Sidebar */}
      <aside
        className={cn(
          'fixed inset-y-0 left-0 z-40 w-[min(80vw,20rem)] lg:w-64 bg-card/95 backdrop-blur-sm border-r border-border/50 transform transition-transform duration-200 ease-in-out lg:translate-x-0',
          sidebarOpen ? 'translate-x-0' : '-translate-x-full'
        )}
      >
        <div className="flex flex-col h-full">
          {/* Logo */}
          <div className="hidden lg:flex items-center justify-between p-6 border-b border-border/50">
            <ZeroProofWordmark size="md" />
            <NotificationBell align="left" />
          </div>

          {/* Navigation */}
          <nav className="flex-1 p-4 space-y-1 mt-[4.5rem] lg:mt-0 overflow-y-auto">
            {navItems.map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                onClick={() => setSidebarOpen(false)}
                className={({ isActive }) =>
                  cn(
                    'flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-all duration-200',
                    isActive
                      ? 'bg-orange-500/20 text-orange-400 border border-orange-500/30 shadow-glow-orange'
                      : 'text-muted-foreground hover:bg-muted/50 hover:text-foreground border border-transparent'
                  )
                }
              >
                <item.icon className="h-5 w-5" />
                {item.label}
              </NavLink>
            ))}
          </nav>

          {/* User section */}
          <div className="p-4 border-t border-border/50 pb-[max(1rem,env(safe-area-inset-bottom))]">
            <Button
              variant="outline"
              size="sm"
              className="w-full border-border/50 hover:bg-red-500/10 hover:text-red-400 hover:border-red-500/30 transition-all duration-200"
              onClick={handleLogout}
            >
              <LogOut className="h-4 w-4 mr-2" />
              Logout
            </Button>
          </div>
        </div>
      </aside>

      {/* Mobile overlay */}
      {sidebarOpen && (
        <div
          className="fixed inset-0 z-30 bg-black/60 backdrop-blur-sm lg:hidden"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      {/* Main content */}
      <main className="lg:pl-64 pt-[calc(4.25rem+env(safe-area-inset-top))] lg:pt-0 min-h-screen">
        <div className="px-4 py-4 sm:p-6 pb-[max(1rem,env(safe-area-inset-bottom))]">
          <Outlet />
        </div>
      </main>
    </div>
  );
}

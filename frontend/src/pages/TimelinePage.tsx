import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  History,
  Shield,
  Wifi,
  Server,
  ChevronDown,
  ChevronRight,
  Plus,
  Minus,
  Edit3,
  Cpu,
  Globe,
  Search,
  Laptop,
  Router,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { TimelineHistogram } from '@/components/charts/TimelineHistogram';
import { ClientDetailPanel } from '@/components/clients/ClientDetailPanel';
import api from '@/api/client';
import { POLL_INTERVALS } from '@/config/polling';
import type {
  TimelineGroup,
  TimelineEvent,
  TimelineStats,
  TimelineFilter,
  TimelineGroupBy,
  TimelineHistogramEntry,
} from '@/types';

const FILTER_OPTIONS: { value: TimelineFilter; label: string; icon: typeof Shield }[] = [
  { value: 'all', label: 'All', icon: History },
  { value: 'security', label: 'Security', icon: Shield },
  { value: 'config', label: 'Config', icon: Wifi },
  { value: 'devices', label: 'Devices', icon: Router },
  { value: 'clients', label: 'Clients', icon: Laptop },
  { value: 'firmware', label: 'Firmware', icon: Cpu },
];

const GROUP_OPTIONS: TimelineGroupBy[] = ['day', 'week', 'month'];

function resourceIcon(resourceType: string) {
  switch (resourceType) {
    case 'firewallRule':
    case 'firewallPolicy':
    case 'aclRule':
    case 'trafficRule':
    case 'portForward':
      return <Shield className="h-4 w-4" />;
    case 'wlan':
      return <Wifi className="h-4 w-4" />;
    case 'network':
      return <Globe className="h-4 w-4" />;
    case 'client':
      return <Laptop className="h-4 w-4" />;
    case 'device':
      return <Router className="h-4 w-4" />;
    case 'firmware':
      return <Cpu className="h-4 w-4" />;
    default:
      return <Server className="h-4 w-4" />;
  }
}

function changeIcon(changeType: string) {
  switch (changeType) {
    case 'CREATED': return <Plus className="h-3 w-3" />;
    case 'DELETED': return <Minus className="h-3 w-3" />;
    case 'MODIFIED': return <Edit3 className="h-3 w-3" />;
    default: return null;
  }
}

function changeColor(changeType: string, resourceType: string) {
  const isSecurity = ['firewallRule', 'firewallPolicy', 'aclRule', 'trafficRule', 'portForward', 'securityEvent', 'alarm', 'vpnServer'].includes(resourceType);
  if (isSecurity) return 'border-l-red-500/70';
  if (resourceType === 'firmware') return 'border-l-blue-500/70';
  if (resourceType === 'client') {
    if (changeType === 'CREATED') return 'border-l-green-500/70';
    if (changeType === 'DELETED') return 'border-l-slate-500/70';
    return 'border-l-purple-500/70';
  }
  if (resourceType === 'device') {
    if (changeType === 'CREATED') return 'border-l-cyan-500/70';
    return 'border-l-cyan-500/50';
  }
  return 'border-l-orange-500/70';
}

function changeBadgeColor(changeType: string) {
  switch (changeType) {
    case 'CREATED': return 'bg-green-500/20 text-green-400';
    case 'DELETED': return 'bg-red-500/20 text-red-400';
    case 'MODIFIED': return 'bg-yellow-500/20 text-yellow-400';
    default: return 'bg-muted text-muted-foreground';
  }
}

function eventDescription(event: TimelineEvent): string {
  const action = event.changeType === 'CREATED' ? 'New' : event.changeType === 'DELETED' ? 'Removed' : 'Updated';
  const typeLabel: Record<string, string> = {
    firewallRule: 'firewall rule',
    firewallPolicy: 'firewall policy',
    aclRule: 'ACL rule',
    trafficRule: 'traffic rule',
    portForward: 'port forward',
    network: 'network',
    wlan: 'WiFi network',
    client: 'client',
    device: 'device',
    firmware: 'firmware',
    securityEvent: 'security event',
    alarm: 'alarm',
    adminEvent: 'admin event',
    vpnServer: 'VPN server',
  };
  const type = typeLabel[event.resourceType] || event.resourceType;
  const name = event.resourceName ? `: ${event.resourceName}` : '';
  return `${action} ${type}${name}`;
}

function relativeTime(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(dateStr).toLocaleDateString();
}

function SummaryBadges({ summary }: { summary: TimelineGroup['summary'] }) {
  const badges: { label: string; count: number; color: string }[] = [];
  if (summary.newClients > 0) badges.push({ label: 'new clients', count: summary.newClients, color: 'bg-green-500/20 text-green-400' });
  if (summary.removedClients > 0) badges.push({ label: 'clients removed', count: summary.removedClients, color: 'bg-slate-500/20 text-slate-400' });
  if (summary.deviceChanges > 0) badges.push({ label: 'devices', count: summary.deviceChanges, color: 'bg-cyan-500/20 text-cyan-400' });
  if (summary.securityChanges > 0) badges.push({ label: 'security', count: summary.securityChanges, color: 'bg-red-500/20 text-red-400' });
  if (summary.configChanges > 0) badges.push({ label: 'config', count: summary.configChanges, color: 'bg-orange-500/20 text-orange-400' });
  if (summary.firmwareUpdates > 0) badges.push({ label: 'firmware', count: summary.firmwareUpdates, color: 'bg-blue-500/20 text-blue-400' });

  // If no specific badges, show total
  if (badges.length === 0 && summary.total > 0) {
    badges.push({ label: 'changes', count: summary.total, color: 'bg-muted text-muted-foreground' });
  }

  return (
    <div className="flex flex-wrap gap-1.5">
      {badges.map((b, i) => (
        <span key={i} className={cn('px-2 py-0.5 rounded-full text-xs font-medium', b.color)}>
          {b.count} {b.label}
        </span>
      ))}
    </div>
  );
}

type EventCluster = {
  key: string;
  changeType: string;
  resourceType: string;
  events: TimelineEvent[];
};

function clusterEvents(events: TimelineEvent[]): EventCluster[] {
  const clusters: EventCluster[] = [];
  const clusterMap = new Map<string, EventCluster>();

  for (const event of events) {
    const key = `${event.changeType}:${event.resourceType}`;
    let cluster = clusterMap.get(key);
    if (!cluster) {
      cluster = { key, changeType: event.changeType, resourceType: event.resourceType, events: [] };
      clusterMap.set(key, cluster);
      clusters.push(cluster);
    }
    cluster.events.push(event);
  }

  return clusters;
}

function clusterLabel(cluster: EventCluster): string {
  const action = cluster.changeType === 'CREATED' ? 'New' : cluster.changeType === 'DELETED' ? 'Removed' : 'Updated';
  const typeLabel: Record<string, [string, string]> = {
    firewallRule: ['firewall rule', 'firewall rules'],
    firewallPolicy: ['firewall policy', 'firewall policies'],
    aclRule: ['ACL rule', 'ACL rules'],
    trafficRule: ['traffic rule', 'traffic rules'],
    portForward: ['port forward', 'port forwards'],
    network: ['network', 'networks'],
    wlan: ['WiFi network', 'WiFi networks'],
    client: ['client', 'clients'],
    device: ['device', 'devices'],
    firmware: ['firmware update', 'firmware updates'],
    securityEvent: ['security event', 'security events'],
    alarm: ['alarm', 'alarms'],
    adminEvent: ['admin event', 'admin events'],
    vpnServer: ['VPN server', 'VPN servers'],
  };
  const [singular, plural] = typeLabel[cluster.resourceType] || [cluster.resourceType, cluster.resourceType + 's'];
  const count = cluster.events.length;
  return count === 1
    ? `${action} ${singular}: ${cluster.events[0].resourceName || cluster.events[0].resourceId}`
    : `${count} ${action.toLowerCase()} ${plural}`;
}

function TimelineGroupCard({
  group,
  defaultExpanded = false,
  onClientClick,
}: {
  group: TimelineGroup;
  defaultExpanded?: boolean;
  onClientClick: (mac: string) => void;
}) {
  const [expanded, setExpanded] = useState(defaultExpanded);
  const [expandedClusters, setExpandedClusters] = useState<Set<string>>(new Set());
  const [expandedEvents, setExpandedEvents] = useState<Set<string>>(new Set());

  const clusters = clusterEvents(group.events);

  const toggleCluster = (key: string) => {
    setExpandedClusters((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const toggleEventDetail = (id: string) => {
    setExpandedEvents((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  return (
    <div className="relative">
      {/* Timeline marker */}
      <div className="absolute left-0 top-0 bottom-0 w-px bg-border/50 ml-3 hidden sm:block" />
      <div className="absolute left-1 top-4 w-5 h-5 rounded-full bg-card border-2 border-orange-500/50 z-10 hidden sm:block" />

      <div className="sm:ml-10">
        {/* Group header (collapsed view) */}
        <button
          className="w-full text-left p-4 rounded-lg bg-card/50 border border-border/50 hover:border-border transition-colors"
          onClick={() => setExpanded(!expanded)}
        >
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
            <div className="flex items-center gap-3 min-w-0">
              {expanded ? <ChevronDown className="h-4 w-4 text-muted-foreground" /> : <ChevronRight className="h-4 w-4 text-muted-foreground" />}
              <div>
                <p className="text-sm font-semibold">{group.label}</p>
                <p className="text-xs text-muted-foreground">{group.summary.total} total changes</p>
              </div>
            </div>
            <SummaryBadges summary={group.summary} />
          </div>
        </button>

        {/* Expanded events - grouped by type */}
        {expanded && (
          <div className="mt-2 space-y-1.5 pb-4">
            {clusters.map((cluster) => {
              // Single event in cluster — render inline
              if (cluster.events.length === 1) {
                const event = cluster.events[0];
                return (
                  <div
                    key={event.id}
                    className={cn(
                      'border-l-2 rounded-r-lg bg-card/30 border border-border/30',
                      changeColor(event.changeType, event.resourceType)
                    )}
                  >
                    <div
                      className="flex flex-wrap items-center gap-2 px-3 py-2 cursor-pointer hover:bg-muted/30 transition-colors"
                      onClick={() => {
                        if (event.resourceType === 'client' && event.resourceId) {
                          onClientClick(event.resourceId);
                        } else {
                          toggleEventDetail(event.id);
                        }
                      }}
                    >
                      <div className="text-muted-foreground">{resourceIcon(event.resourceType)}</div>
                      {event.changeType !== 'CREATED' && (
                        <span className={cn('inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium', changeBadgeColor(event.changeType))}>
                          {changeIcon(event.changeType)}
                          {event.changeType}
                        </span>
                      )}
                      <p className="text-sm flex-1 min-w-0 truncate">{eventDescription(event)}</p>
                      <span className="text-xs text-muted-foreground/60 sm:flex-shrink-0 w-full sm:w-auto pl-6 sm:pl-0">{relativeTime(event.detectedAt)}</span>
                    </div>
                    {expandedEvents.has(event.id) && <EventDetail eventId={event.id} />}
                  </div>
                );
              }

              // Multiple events — render as collapsible cluster
              const isClusterExpanded = expandedClusters.has(cluster.key);
              return (
                <div
                  key={cluster.key}
                  className={cn(
                    'border-l-2 rounded-r-lg bg-card/30 border border-border/30',
                    changeColor(cluster.changeType, cluster.resourceType)
                  )}
                >
                  <div
                    className="flex flex-wrap items-center gap-2 px-3 py-2 cursor-pointer hover:bg-muted/30 transition-colors"
                    onClick={() => toggleCluster(cluster.key)}
                  >
                    <div className="text-muted-foreground">{resourceIcon(cluster.resourceType)}</div>
                    {cluster.changeType !== 'CREATED' && (
                      <span className={cn('inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium', changeBadgeColor(cluster.changeType))}>
                        {changeIcon(cluster.changeType)}
                        {cluster.changeType}
                      </span>
                    )}
                    <p className="text-sm flex-1 min-w-0 truncate">{clusterLabel(cluster)}</p>
                    <span className="text-xs text-muted-foreground/60 sm:flex-shrink-0">
                      {isClusterExpanded ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
                    </span>
                  </div>

                  {/* Expanded cluster items */}
                  {isClusterExpanded && (
                    <div className="border-t border-border/20 ml-4">
                      {cluster.events.map((event) => (
                        <div key={event.id}>
                          <div
                            className="flex flex-wrap items-center gap-2 px-3 py-1.5 cursor-pointer hover:bg-muted/30 transition-colors text-sm"
                            onClick={() => {
                              if (event.resourceType === 'client' && event.resourceId) {
                                onClientClick(event.resourceId);
                              } else {
                                toggleEventDetail(event.id);
                              }
                            }}
                          >
                            <span className="text-muted-foreground/50">-</span>
                            <p className="flex-1 min-w-0 truncate">{event.resourceName || event.resourceId}</p>
                            <span className="text-xs text-muted-foreground/60 w-full sm:w-auto pl-4 sm:pl-0">{relativeTime(event.detectedAt)}</span>
                          </div>
                          {expandedEvents.has(event.id) && <EventDetail eventId={event.id} />}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

function EventDetail({ eventId }: { eventId: string }) {
  const [detail, setDetail] = useState<TimelineEvent | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.get<TimelineEvent>(`/timeline/events/${eventId}`).then((res) => {
      if (res.success && res.data) setDetail(res.data);
      setLoading(false);
    });
  }, [eventId]);

  if (loading) return <div className="px-3 py-2 text-xs text-muted-foreground">Loading...</div>;
  if (!detail) return null;

  return (
    <div className="px-3 py-2 border-t border-border/20">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs">
        {detail.previousValue !== undefined && detail.previousValue !== null && (
          <div>
            <p className="text-muted-foreground font-medium mb-1">Previous</p>
            <pre className="bg-red-500/5 border border-red-500/10 rounded p-2 overflow-auto max-h-40 text-[11px]">
              {JSON.stringify(detail.previousValue, null, 2)}
            </pre>
          </div>
        )}
        {detail.newValue !== undefined && detail.newValue !== null && (
          <div>
            <p className="text-muted-foreground font-medium mb-1">New</p>
            <pre className="bg-green-500/5 border border-green-500/10 rounded p-2 overflow-auto max-h-40 text-[11px]">
              {JSON.stringify(detail.newValue, null, 2)}
            </pre>
          </div>
        )}
      </div>
    </div>
  );
}

export function TimelinePage() {
  const [groups, setGroups] = useState<TimelineGroup[]>([]);
  const [stats, setStats] = useState<TimelineStats | null>(null);
  const [histogram, setHistogram] = useState<TimelineHistogramEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [groupBy, setGroupBy] = useState<TimelineGroupBy>('day');
  const [filter, setFilter] = useState<TimelineFilter>('all');
  const [histogramDays, setHistogramDays] = useState(0); // 0 = all time
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [selectedClient, setSelectedClient] = useState<string | null>(null);
  const timeZone = useMemo(() => Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC', []);

  const fetchTimeline = useCallback(async (silent = false) => {
    if (!silent) {
      setLoading(true);
      setError(null);
    }
    try {
      const res = await api.get<{ groups: TimelineGroup[]; pagination: { totalPages: number } }>(
        `/timeline?groupBy=${groupBy}&filter=${filter}&page=${page}&limit=20&tz=${encodeURIComponent(timeZone)}`
      );
      if (res.success && res.data) {
        setGroups(res.data.groups);
        setTotalPages(res.data.pagination.totalPages);
        if (!silent) setError(null);
      } else if (!silent) {
        setError(res.error?.message || 'Failed to load timeline data.');
      }
    } catch (err) {
      if (!silent) {
        setError(err instanceof Error ? err.message : 'Failed to load timeline data.');
      }
    } finally {
      if (!silent) setLoading(false);
    }
  }, [groupBy, filter, page, timeZone]);

  const fetchStats = useCallback(async () => {
    const res = await api.get<TimelineStats>('/timeline/stats');
    if (res.success && res.data) setStats(res.data);
  }, []);

  const fetchHistogram = useCallback(async () => {
    const res = await api.get<TimelineHistogramEntry[]>(`/timeline/histogram?days=${histogramDays}&tz=${encodeURIComponent(timeZone)}`);
    if (res.success && res.data) setHistogram(res.data);
  }, [histogramDays, timeZone]);

  useEffect(() => {
    fetchTimeline();
  }, [fetchTimeline]);

  // Keep timeline current while viewing this page (without spinner flicker).
  useEffect(() => {
    const interval = window.setInterval(() => {
      fetchTimeline(true);
    }, POLL_INTERVALS.timelineRefresh);
    return () => window.clearInterval(interval);
  }, [fetchTimeline]);

  useEffect(() => {
    fetchStats();
    fetchHistogram();
  }, [fetchStats, fetchHistogram]);

  // Reset page when filter/groupBy changes
  useEffect(() => {
    setPage(1);
  }, [groupBy, filter]);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <History className="h-6 w-6 text-orange-400" />
            Network Timeline
          </h1>
          {stats && (
            <p className="text-sm text-muted-foreground mt-1">
              {stats.totalChanges} changes tracked across {stats.totalClients} clients
              {stats.firstEventDate && ` since ${new Date(stats.firstEventDate).toLocaleDateString()}`}
            </p>
          )}
        </div>
      </div>

      {/* Controls */}
      <div className="flex flex-col sm:flex-row gap-3">
        {/* Group by selector */}
        <div className="flex items-center gap-1 bg-card/50 border border-border/50 rounded-lg p-1 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          {GROUP_OPTIONS.map((opt) => (
            <button
              key={opt}
              className={cn(
                'px-3 py-1.5 rounded-md text-xs font-medium transition-colors capitalize',
                groupBy === opt
                  ? 'bg-orange-500/20 text-orange-400 border border-orange-500/30'
                  : 'text-muted-foreground hover:text-foreground hover:bg-muted/50'
              )}
              onClick={() => setGroupBy(opt)}
            >
              {opt}
            </button>
          ))}
        </div>

        {/* Filter selector */}
        <div className="flex items-center gap-1 bg-card/50 border border-border/50 rounded-lg p-1 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          {FILTER_OPTIONS.map((opt) => (
            <button
              key={opt.value}
              className={cn(
                'flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-colors',
                filter === opt.value
                  ? 'bg-orange-500/20 text-orange-400 border border-orange-500/30'
                  : 'text-muted-foreground hover:text-foreground hover:bg-muted/50'
              )}
              onClick={() => setFilter(opt.value)}
            >
              <opt.icon className="h-3 w-3" />
              {opt.label}
            </button>
          ))}
        </div>
      </div>

      {/* Histogram */}
      {histogram.length > 0 && (
        <div className="bg-card/50 border border-border/50 rounded-lg p-4">
          <div className="flex items-center justify-between mb-3">
            <span className="text-sm font-medium text-muted-foreground">Activity</span>
            <div className="flex items-center gap-1 bg-muted/50 rounded-lg p-0.5 text-xs">
              {([
                { label: '3 months', days: 90 },
                { label: '1 year', days: 365 },
                { label: 'All time', days: 0 },
              ] as const).map((opt) => (
                <button
                  key={opt.days}
                  className={`px-2.5 py-1 rounded-md transition-colors ${
                    histogramDays === opt.days
                      ? 'bg-background text-foreground shadow-sm'
                      : 'text-muted-foreground hover:text-foreground'
                  }`}
                  onClick={() => setHistogramDays(opt.days)}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </div>
          <TimelineHistogram data={histogram} height={300} showBrush defaultBrushDays={histogramDays === 0 ? 12 : 90} />
        </div>
      )}

      {/* Timeline view */}
      <div className="relative">
        {loading ? (
          <div className="flex items-center justify-center py-16">
            <div className="animate-spin h-8 w-8 border-2 border-orange-500 border-t-transparent rounded-full" />
          </div>
        ) : error ? (
          <div className="flex flex-col items-center justify-center py-16 text-muted-foreground">
            <Search className="h-12 w-12 mb-4 opacity-30" />
            <p className="text-lg font-medium">Unable to load timeline</p>
            <p className="text-sm mt-1">{error}</p>
            <Button
              variant="outline"
              size="sm"
              className="mt-4"
              onClick={() => fetchTimeline(false)}
            >
              Retry
            </Button>
          </div>
        ) : groups.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 text-muted-foreground">
            <Search className="h-12 w-12 mb-4 opacity-30" />
            <p className="text-lg font-medium">No changes recorded yet</p>
            <p className="text-sm mt-1">Enable auto-sync to start tracking network changes.</p>
          </div>
        ) : (
          <div className="space-y-4">
            {groups.map((group, idx) => (
              <TimelineGroupCard
                key={group.period}
                group={group}
                defaultExpanded={idx === 0}
                onClientClick={(mac) => setSelectedClient(mac)}
              />
            ))}

            {/* Pagination */}
            {totalPages > 1 && (
              <div className="flex flex-wrap items-center justify-center gap-2 pt-4">
                <Button
                  variant="outline"
                  size="sm"
                  disabled={page <= 1}
                  onClick={() => setPage(page - 1)}
                >
                  Previous
                </Button>
                <span className="text-sm text-muted-foreground">
                  Page {page} of {totalPages}
                </span>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={page >= totalPages}
                  onClick={() => setPage(page + 1)}
                >
                  Next
                </Button>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Client detail side panel */}
      {selectedClient && (
        <>
          <div
            className="fixed inset-0 z-40 bg-black/40 backdrop-blur-sm"
            onClick={() => setSelectedClient(null)}
          />
          <ClientDetailPanel
            mac={selectedClient}
            onClose={() => setSelectedClient(null)}
          />
        </>
      )}
    </div>
  );
}

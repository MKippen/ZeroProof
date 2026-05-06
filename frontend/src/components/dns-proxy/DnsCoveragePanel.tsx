import { useMemo, useState } from 'react';
import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from 'recharts';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { cn, formatDate } from '@/lib/utils';
import type {
  DnsCoverageSilent,
  DnsCoverageUnknownSource,
  DnsProxyAnalytics,
  DnsTopClient,
} from '@/types';

type CoverageTab = 'seen' | 'silent' | 'unknown';

interface DnsCoveragePanelProps {
  analytics: DnsProxyAnalytics;
}

interface PiePoint {
  key: CoverageTab;
  label: string;
  value: number;
  color: string;
}

interface TooltipEntry {
  payload?: PiePoint;
  value?: number;
}

function CoverageTooltip({ active, payload }: { active?: boolean; payload?: TooltipEntry[] }) {
  const point = payload?.[0]?.payload;
  if (!active || !point) return null;
  return (
    <div className="rounded-md border border-border bg-popover px-3 py-2 text-xs shadow-md">
      <p className="font-medium">{point.label}</p>
      <p className="text-muted-foreground">{point.value.toLocaleString()} clients</p>
    </div>
  );
}

function SeenTable({ rows }: { rows: DnsTopClient[] }) {
  if (!rows.length) {
    return <EmptyTable message="No UniFi-matched clients have generated DNS traffic in this window." />;
  }
  return (
    <table className="w-full text-sm">
      <thead className="text-left text-xs uppercase text-muted-foreground">
        <tr>
          <th className="px-3 py-2 font-medium">Client</th>
          <th className="px-3 py-2 font-medium">AdGuard name</th>
          <th className="px-3 py-2 text-right font-medium">Queries</th>
          <th className="px-3 py-2 text-right font-medium">Blocked</th>
          <th className="px-3 py-2 font-medium">Last seen</th>
        </tr>
      </thead>
      <tbody className="divide-y divide-border/60">
        {rows.slice(0, 50).map((row) => (
          <tr key={row.mac}>
            <td className="px-3 py-2 font-medium">{row.displayName}</td>
            <td className="px-3 py-2 text-muted-foreground">
              {row.adguardName || <span className="italic">— inherited —</span>}
            </td>
            <td className="px-3 py-2 text-right font-mono">{row.queries.toLocaleString()}</td>
            <td className="px-3 py-2 text-right font-mono">{row.blocked.toLocaleString()}</td>
            <td className="px-3 py-2 text-muted-foreground">{formatDate(row.lastSeen)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function SilentTable({ rows }: { rows: DnsCoverageSilent[] }) {
  if (!rows.length) {
    return <EmptyTable message="Every UniFi client emitted DNS traffic in this window. Solid coverage." />;
  }
  return (
    <table className="w-full text-sm">
      <thead className="text-left text-xs uppercase text-muted-foreground">
        <tr>
          <th className="px-3 py-2 font-medium">Client</th>
          <th className="px-3 py-2 font-medium">MAC</th>
          <th className="px-3 py-2 font-medium">Last IP</th>
          <th className="px-3 py-2 font-medium">In AdGuard?</th>
        </tr>
      </thead>
      <tbody className="divide-y divide-border/60">
        {rows.slice(0, 100).map((row) => (
          <tr key={row.mac}>
            <td className="px-3 py-2 font-medium">{row.displayName}</td>
            <td className="px-3 py-2 font-mono text-xs text-muted-foreground">{row.mac}</td>
            <td className="px-3 py-2 text-muted-foreground">{row.lastIp || '—'}</td>
            <td className="px-3 py-2">
              {row.adguardName ? (
                <Badge variant="success">{row.adguardName}</Badge>
              ) : (
                <Badge variant="medium">Not defined</Badge>
              )}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function UnknownTable({ rows }: { rows: DnsCoverageUnknownSource[] }) {
  if (!rows.length) {
    return <EmptyTable message="Every querying client maps back to UniFi. No unknown sources." />;
  }
  return (
    <table className="w-full text-sm">
      <thead className="text-left text-xs uppercase text-muted-foreground">
        <tr>
          <th className="px-3 py-2 font-medium">Client IP</th>
          <th className="px-3 py-2 font-medium">AdGuard name</th>
          <th className="px-3 py-2 text-right font-medium">Queries</th>
          <th className="px-3 py-2 text-right font-medium">Blocked</th>
          <th className="px-3 py-2 font-medium">Last seen</th>
        </tr>
      </thead>
      <tbody className="divide-y divide-border/60">
        {rows.slice(0, 50).map((row) => (
          <tr key={row.clientIp}>
            <td className="px-3 py-2 font-mono">{row.clientIp}</td>
            <td className="px-3 py-2 text-muted-foreground">{row.clientName || '—'}</td>
            <td className="px-3 py-2 text-right font-mono">{row.queries.toLocaleString()}</td>
            <td className="px-3 py-2 text-right font-mono">{row.blocked.toLocaleString()}</td>
            <td className="px-3 py-2 text-muted-foreground">{formatDate(row.lastSeen)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function EmptyTable({ message }: { message: string }) {
  return (
    <div className="flex min-h-32 items-center justify-center rounded-md border border-dashed border-border/60 px-4 text-center text-sm text-muted-foreground">
      {message}
    </div>
  );
}

export function DnsCoveragePanel({ analytics }: DnsCoveragePanelProps) {
  const { coverage } = analytics;
  const [tab, setTab] = useState<CoverageTab>(() =>
    coverage.silent.length > 0 ? 'silent' : coverage.seen.length > 0 ? 'seen' : 'unknown'
  );

  const pieData = useMemo<PiePoint[]>(
    () => [
      { key: 'seen', label: 'Seen via UniFi', value: coverage.seen.length, color: '#10b981' },
      { key: 'silent', label: 'Silent UniFi clients', value: coverage.silent.length, color: '#f59e0b' },
      { key: 'unknown', label: 'Unknown sources', value: coverage.unknownSources.length, color: '#ef4444' },
    ],
    [coverage]
  );

  const totalCovered = coverage.totals.unifi || 0;
  const matchedPct = totalCovered ? Math.round((coverage.totals.matched / totalCovered) * 100) : 0;

  const tabs: { key: CoverageTab; label: string; count: number }[] = [
    { key: 'seen', label: 'Seen', count: coverage.seen.length },
    { key: 'silent', label: 'Silent', count: coverage.silent.length },
    { key: 'unknown', label: 'Unknown sources', count: coverage.unknownSources.length },
  ];

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-xl">UniFi ↔ AdGuard coverage</CardTitle>
        <CardDescription>
          {coverage.totals.matched} of {coverage.totals.unifi} UniFi clients are defined in AdGuard ({matchedPct}%). Silent
          clients haven&apos;t emitted DNS in this window — they may be bypassing the proxy.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid gap-4 md:grid-cols-[14rem_1fr]">
          <div className="h-48">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Tooltip content={<CoverageTooltip />} />
                <Pie data={pieData} dataKey="value" innerRadius={42} outerRadius={72} paddingAngle={2}>
                  {pieData.map((entry) => (
                    <Cell
                      key={entry.key}
                      fill={entry.color}
                      stroke="transparent"
                      cursor="pointer"
                      onClick={() => setTab(entry.key)}
                    />
                  ))}
                </Pie>
              </PieChart>
            </ResponsiveContainer>
          </div>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
            {pieData.map((slice) => (
              <button
                key={slice.key}
                type="button"
                onClick={() => setTab(slice.key)}
                className={cn(
                  'flex flex-col items-start rounded-md border p-3 text-left transition-colors',
                  tab === slice.key ? 'border-primary/60 bg-primary/5' : 'border-border/60 hover:bg-muted/40'
                )}
              >
                <div className="flex items-center gap-2">
                  <span className="inline-block h-2 w-2 rounded-full" style={{ backgroundColor: slice.color }} />
                  <span className="text-xs uppercase text-muted-foreground">{slice.label}</span>
                </div>
                <span className="mt-2 text-2xl font-semibold">{slice.value}</span>
              </button>
            ))}
          </div>
        </div>

        <div className="flex gap-2 border-b border-border/60">
          {tabs.map((t) => (
            <button
              key={t.key}
              type="button"
              onClick={() => setTab(t.key)}
              className={cn(
                'inline-flex items-center gap-2 border-b-2 px-3 py-2 text-sm font-medium transition-colors',
                tab === t.key
                  ? 'border-primary text-foreground'
                  : 'border-transparent text-muted-foreground hover:text-foreground'
              )}
            >
              {t.label}
              <span className="rounded-full bg-muted px-2 py-0.5 text-xs">{t.count}</span>
            </button>
          ))}
        </div>

        <div className="overflow-x-auto rounded-md border border-border/60">
          {tab === 'seen' && <SeenTable rows={coverage.seen} />}
          {tab === 'silent' && <SilentTable rows={coverage.silent} />}
          {tab === 'unknown' && <UnknownTable rows={coverage.unknownSources} />}
        </div>
      </CardContent>
    </Card>
  );
}

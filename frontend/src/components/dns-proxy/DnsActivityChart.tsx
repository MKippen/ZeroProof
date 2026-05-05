import { useMemo } from 'react';
import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import type { DnsHourlyBucket } from '@/types';

interface DnsActivityChartProps {
  buckets: DnsHourlyBucket[];
  windowHours: number;
}

interface ChartPoint {
  hour: string;
  label: string;
  allowed: number;
  blocked: number;
}

function fillHourlyBuckets(buckets: DnsHourlyBucket[], windowHours: number): ChartPoint[] {
  const byHour = new Map<string, DnsHourlyBucket>();
  for (const b of buckets) {
    const key = new Date(b.hour).toISOString().slice(0, 13);
    byHour.set(key, b);
  }

  const out: ChartPoint[] = [];
  const now = new Date();
  now.setMinutes(0, 0, 0);
  for (let i = windowHours - 1; i >= 0; i--) {
    const dt = new Date(now.getTime() - i * 60 * 60 * 1000);
    const key = dt.toISOString().slice(0, 13);
    const match = byHour.get(key);
    out.push({
      hour: dt.toISOString(),
      label: dt.toLocaleTimeString([], { hour: 'numeric' }),
      allowed: match?.allowed ?? 0,
      blocked: match?.blocked ?? 0,
    });
  }
  return out;
}

interface TooltipPayloadEntry {
  value?: number;
  dataKey?: string;
  color?: string;
  name?: string;
}

function ChartTooltip({
  active,
  payload,
  label,
}: {
  active?: boolean;
  payload?: TooltipPayloadEntry[];
  label?: string;
}) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-md border border-border bg-popover px-3 py-2 text-xs shadow-md">
      <p className="font-medium">{label}</p>
      {payload.map((entry) => (
        <p key={entry.dataKey} className="flex items-center gap-2">
          <span
            className="inline-block h-2 w-2 rounded-full"
            style={{ backgroundColor: entry.color }}
          />
          <span className="capitalize text-muted-foreground">{entry.name}</span>
          <span className="ml-auto font-mono">{entry.value?.toLocaleString()}</span>
        </p>
      ))}
    </div>
  );
}

export function DnsActivityChart({ buckets, windowHours }: DnsActivityChartProps) {
  const data = useMemo(() => fillHourlyBuckets(buckets, windowHours), [buckets, windowHours]);
  const totals = useMemo(
    () =>
      data.reduce(
        (acc, p) => ({ allowed: acc.allowed + p.allowed, blocked: acc.blocked + p.blocked }),
        { allowed: 0, blocked: 0 }
      ),
    [data]
  );

  if (totals.allowed + totals.blocked === 0) {
    return (
      <div className="flex h-56 items-center justify-center rounded-md border border-dashed border-border/60 text-sm text-muted-foreground">
        No DNS activity in the last {windowHours} hours.
      </div>
    );
  }

  return (
    <div className="h-56 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
          <defs>
            <linearGradient id="allowedGrad" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#10b981" stopOpacity={0.5} />
              <stop offset="100%" stopColor="#10b981" stopOpacity={0.05} />
            </linearGradient>
            <linearGradient id="blockedGrad" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#ef4444" stopOpacity={0.5} />
              <stop offset="100%" stopColor="#ef4444" stopOpacity={0.05} />
            </linearGradient>
          </defs>
          <CartesianGrid strokeDasharray="3 3" className="stroke-border/40" />
          <XAxis
            dataKey="label"
            tick={{ fontSize: 11 }}
            tickLine={false}
            axisLine={false}
            interval="preserveStartEnd"
          />
          <YAxis tick={{ fontSize: 11 }} tickLine={false} axisLine={false} width={40} />
          <Tooltip content={<ChartTooltip />} />
          <Area
            type="monotone"
            dataKey="allowed"
            stackId="1"
            name="Allowed"
            stroke="#10b981"
            fill="url(#allowedGrad)"
          />
          <Area
            type="monotone"
            dataKey="blocked"
            stackId="1"
            name="Blocked"
            stroke="#ef4444"
            fill="url(#blockedGrad)"
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}

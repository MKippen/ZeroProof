import { useState, useCallback } from 'react';
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  Legend,
  Brush,
  ResponsiveContainer,
} from 'recharts';
import type { TimelineHistogramEntry } from '@/types';

const CATEGORIES = [
  { key: 'clients', label: 'Clients', color: '#a855f7' },
  { key: 'security', label: 'Security', color: '#ef4444' },
  { key: 'config', label: 'Config', color: '#f97316' },
  { key: 'devices', label: 'Devices', color: '#06b6d4' },
  { key: 'firmware', label: 'Firmware', color: '#3b82f6' },
] as const;

interface TimelineHistogramProps {
  data: TimelineHistogramEntry[];
  height?: number;
  showBrush?: boolean;
  defaultBrushDays?: number;
  title?: string;
}

interface HistogramPayload {
  value?: number;
  dataKey?: string | number;
  color?: string;
  name?: string;
}

interface TooltipContentProps {
  active?: boolean;
  payload?: HistogramPayload[];
  label?: string;
}

interface LegendEntry {
  dataKey?: unknown;
  value?: unknown;
}

function isMonthlyData(data: TimelineHistogramEntry[]): boolean {
  if (data.length < 2) return false;
  // Monthly data always has dates ending in "-01"
  return data.every((d) => d.date.endsWith('-01'));
}

function formatDate(dateStr: string, monthly: boolean): string {
  const d = new Date(dateStr + 'T00:00:00');
  if (monthly) {
    return d.toLocaleDateString('en-US', { month: 'short', year: '2-digit' });
  }
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function CustomTooltip({ active, payload, label }: TooltipContentProps) {
  if (!active || !payload?.length) return null;
  const total = payload.reduce((sum, p) => sum + (p.value || 0), 0);
  if (total === 0) return null;

  return (
    <div className="bg-popover border border-border rounded-lg shadow-lg px-3 py-2 text-xs">
      <p className="font-medium mb-1.5 text-foreground">
        {new Date(`${label || ''}T00:00:00`).toLocaleDateString('en-US', {
          weekday: 'short',
          month: 'short',
          day: 'numeric',
          year: 'numeric',
        })}
      </p>
      <div className="space-y-0.5">
        {payload
          .filter((p) => (p.value || 0) > 0)
          .map((p) => (
            <div key={String(p.dataKey || p.name || '')} className="flex items-center gap-2">
              <div
                className="w-2 h-2 rounded-full flex-shrink-0"
                style={{ backgroundColor: p.color }}
              />
              <span className="text-muted-foreground">{p.name}</span>
              <span className="font-medium ml-auto pl-3 text-foreground">{p.value}</span>
            </div>
          ))}
      </div>
      <div className="border-t border-border/50 mt-1.5 pt-1.5 flex justify-between font-medium text-foreground">
        <span>Total</span>
        <span>{total}</span>
      </div>
    </div>
  );
}

export function TimelineHistogram({
  data,
  height = 300,
  showBrush = false,
  defaultBrushDays,
  title,
}: TimelineHistogramProps) {
  const [hiddenCategories, setHiddenCategories] = useState<Set<string>>(new Set());

  const handleLegendClick = useCallback((entry: LegendEntry) => {
    const key = String(entry.dataKey || entry.value || '');
    if (!key) return;
    setHiddenCategories((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }, []);

  const monthly = isMonthlyData(data);
  const tickFormat = useCallback((dateStr: string) => formatDate(dateStr, monthly), [monthly]);

  if (data.length === 0) return null;

  return (
    <div>
      {title && <h3 className="text-sm font-semibold mb-3">{title}</h3>}
      <ResponsiveContainer width="100%" height={height}>
        <BarChart data={data} margin={{ top: 4, right: 4, left: -20, bottom: 0 }}>
          <XAxis
            dataKey="date"
            tickFormatter={tickFormat}
            tick={{ fontSize: 10, fill: 'hsl(var(--muted-foreground))' }}
            axisLine={{ stroke: 'hsl(var(--border))' }}
            tickLine={false}
            interval="preserveStartEnd"
            minTickGap={40}
          />
          <YAxis
            tick={{ fontSize: 10, fill: 'hsl(var(--muted-foreground))' }}
            axisLine={false}
            tickLine={false}
            allowDecimals={false}
          />
          <Tooltip
            content={<CustomTooltip />}
            cursor={{ fill: 'hsl(var(--muted) / 0.3)' }}
          />
          <Legend
            onClick={handleLegendClick}
            wrapperStyle={{ fontSize: 12, cursor: 'pointer', paddingTop: 8 }}
            formatter={(value: unknown, entry: LegendEntry) => (
              <span
                style={{
                  color: hiddenCategories.has(String(entry.dataKey))
                    ? 'hsl(var(--muted-foreground) / 0.3)'
                    : 'hsl(var(--muted-foreground))',
                  textDecoration: hiddenCategories.has(String(entry.dataKey)) ? 'line-through' : 'none',
                }}
              >
                {String(value)}
              </span>
            )}
          />
          {CATEGORIES.map((cat) => (
            <Bar
              key={cat.key}
              dataKey={cat.key}
              name={cat.label}
              stackId="stack"
              fill={cat.color}
              hide={hiddenCategories.has(cat.key)}
              radius={0}
              maxBarSize={20}
            />
          ))}
          {showBrush && data.length > 30 && (
            <Brush
              dataKey="date"
              height={28}
              stroke="hsl(var(--border))"
              fill="hsl(var(--card))"
              tickFormatter={tickFormat}
              travellerWidth={8}
              startIndex={defaultBrushDays ? Math.max(0, data.length - defaultBrushDays) : undefined}
              endIndex={defaultBrushDays ? data.length - 1 : undefined}
            />
          )}
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

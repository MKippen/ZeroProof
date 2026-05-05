import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import type { DnsTopDomain } from '@/types';

interface DnsTopDomainsProps {
  title: string;
  description: string;
  rows: DnsTopDomain[];
  variant: 'blocked' | 'allowed';
}

export function DnsTopDomains({ title, description, rows, variant }: DnsTopDomainsProps) {
  const max = rows[0]?.count ?? 0;
  const barColor = variant === 'blocked' ? 'bg-red-500/70' : 'bg-emerald-500/70';

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg">{title}</CardTitle>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
      <CardContent>
        {rows.length === 0 ? (
          <div className="flex min-h-32 items-center justify-center rounded-md border border-dashed border-border/60 px-4 text-center text-sm text-muted-foreground">
            No data in this window.
          </div>
        ) : (
          <ol className="space-y-2">
            {rows.map((row, idx) => (
              <li key={row.domain} className="space-y-1">
                <div className="flex items-baseline justify-between gap-3">
                  <span className="truncate text-sm font-medium" title={row.domain}>
                    <span className="mr-2 text-xs text-muted-foreground">{idx + 1}.</span>
                    {row.domain}
                  </span>
                  <span className="font-mono text-xs text-muted-foreground">{row.count.toLocaleString()}</span>
                </div>
                <div className="h-1.5 overflow-hidden rounded-full bg-muted">
                  <div
                    className={`${barColor} h-full rounded-full`}
                    style={{ width: max ? `${Math.max(2, (row.count / max) * 100)}%` : '0%' }}
                  />
                </div>
              </li>
            ))}
          </ol>
        )}
      </CardContent>
    </Card>
  );
}

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { formatDate } from '@/lib/utils';
import type { DnsTopClient } from '@/types';

interface DnsTopClientsProps {
  rows: DnsTopClient[];
}

export function DnsTopClients({ rows }: DnsTopClientsProps) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg">Top clients by query volume</CardTitle>
        <CardDescription>UniFi clients ranked by DNS queries in this window. Suspicious / blocked counts call out outliers.</CardDescription>
      </CardHeader>
      <CardContent>
        {rows.length === 0 ? (
          <div className="flex min-h-32 items-center justify-center rounded-md border border-dashed border-border/60 px-4 text-center text-sm text-muted-foreground">
            No matched UniFi clients have generated DNS traffic in this window.
          </div>
        ) : (
          <div className="overflow-x-auto rounded-md border border-border/60">
            <table className="w-full text-sm">
              <thead className="text-left text-xs uppercase text-muted-foreground">
                <tr>
                  <th className="px-3 py-2 font-medium">Client</th>
                  <th className="px-3 py-2 text-right font-medium">Queries</th>
                  <th className="px-3 py-2 text-right font-medium">Blocked</th>
                  <th className="px-3 py-2 text-right font-medium">Suspicious</th>
                  <th className="px-3 py-2 font-medium">Last seen</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/60">
                {rows.map((row) => {
                  const blockedPct = row.queries ? Math.round((row.blocked / row.queries) * 100) : 0;
                  return (
                    <tr key={row.mac}>
                      <td className="px-3 py-2">
                        <div className="font-medium">{row.displayName}</div>
                        <div className="font-mono text-xs text-muted-foreground">{row.mac}</div>
                      </td>
                      <td className="px-3 py-2 text-right font-mono">{row.queries.toLocaleString()}</td>
                      <td className="px-3 py-2 text-right font-mono">
                        {row.blocked.toLocaleString()}{' '}
                        <span className="text-xs text-muted-foreground">({blockedPct}%)</span>
                      </td>
                      <td className="px-3 py-2 text-right font-mono">
                        {row.suspicious > 0 ? (
                          <span className="text-yellow-400">{row.suspicious.toLocaleString()}</span>
                        ) : (
                          <span className="text-muted-foreground">0</span>
                        )}
                      </td>
                      <td className="px-3 py-2 text-muted-foreground">{formatDate(row.lastSeen)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

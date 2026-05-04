import { AlertTriangle, CheckCircle2, Info, ShieldCheck } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import type { ResidentialProxyEvidence, ResidentialProxySummary } from '@/types';

function EmptyState({ text }: { text: string }) {
  return <div className="rounded-lg border border-dashed border-border/60 p-4 text-sm text-muted-foreground">{text}</div>;
}

function dnsAttributionLabel(status?: string): string {
  if (status === 'HEALTHY') return 'Device-level';
  if (status === 'DEGRADED') return 'Gateway-only';
  return 'Unknown';
}

function dnsAttributionVariant(status?: string): 'success' | 'medium' | 'outline' {
  if (status === 'HEALTHY') return 'success';
  if (status === 'DEGRADED') return 'medium';
  return 'outline';
}

export function EvidencePanel({
  evidence,
  summary,
}: {
  evidence?: ResidentialProxyEvidence;
  summary?: ResidentialProxySummary;
}) {
  if (!evidence) {
    return <EmptyState text="Run Collect to populate campaign evidence." />;
  }

  const signals = [
    ...(summary?.highSignals || []),
    ...(summary?.mediumSignals || []),
    ...(summary?.lowSignals || []),
  ];
  const dnsProxy = evidence.dnsProxyEvidence;
  const dnsMatches = dnsProxy?.matches || [];
  const dnsMatchCount = (dnsProxy?.deviceLevelQueryCount || 0) + (dnsProxy?.networkLevelSignalCount || 0);

  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">Candidates</CardTitle>
          </CardHeader>
          <CardContent className="text-2xl font-semibold">{evidence.candidateDevices.length}</CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">Telemetry Matches</CardTitle>
          </CardHeader>
          <CardContent className="text-2xl font-semibold">
            {evidence.telemetryMatches.eventMatchCount + evidence.telemetryMatches.alarmMatchCount}
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">Open Ports</CardTitle>
          </CardHeader>
          <CardContent className="text-2xl font-semibold">{evidence.validation?.openPorts.length || 0}</CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">DNS Evidence</CardTitle>
          </CardHeader>
          <CardContent className="text-2xl font-semibold">{dnsMatchCount}</CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">Findings</CardTitle>
          </CardHeader>
          <CardContent className="text-2xl font-semibold">{summary?.findings.length || 0}</CardContent>
        </Card>
      </div>

      {signals.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <AlertTriangle className="h-4 w-4 text-amber-400" />
              Campaign Signals
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {signals.map((signal) => (
              <div key={signal} className="rounded-md bg-muted/30 px-3 py-2 text-sm text-foreground/90">
                {signal}
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <div className="flex flex-wrap items-start justify-between gap-3">
            <CardTitle className="flex items-center gap-2 text-base">
              <ShieldCheck className="h-4 w-4 text-emerald-400" />
              DNS Proxy Evidence
            </CardTitle>
            <Badge variant={dnsAttributionVariant(dnsProxy?.attributionStatus)}>
              {dnsProxy?.configured ? dnsAttributionLabel(dnsProxy.attributionStatus) : 'Not configured'}
            </Badge>
          </div>
        </CardHeader>
        <CardContent className="space-y-3 text-sm">
          {!dnsProxy?.configured ? (
            <EmptyState text="Configure DNS Proxy to add AdGuard Home evidence to this campaign." />
          ) : (
            <>
              <div className="grid gap-3 sm:grid-cols-3">
                <div className="rounded-md border border-border/60 p-3">
                  <p className="text-xs text-muted-foreground">Device matches</p>
                  <p className="mt-1 text-lg font-semibold">{dnsProxy.deviceLevelQueryCount}</p>
                </div>
                <div className="rounded-md border border-border/60 p-3">
                  <p className="text-xs text-muted-foreground">Network signals</p>
                  <p className="mt-1 text-lg font-semibold">{dnsProxy.networkLevelSignalCount}</p>
                </div>
                <div className="rounded-md border border-border/60 p-3">
                  <p className="text-xs text-muted-foreground">Client IPs</p>
                  <p className="mt-1 text-lg font-semibold">
                    {dnsProxy.anonymizedClientIp === true ? 'Anonymized' : dnsProxy.anonymizedClientIp === false ? 'Visible' : 'Unknown'}
                  </p>
                </div>
              </div>

              <div className="space-y-2">
                {dnsProxy.indicators.slice(0, 4).map((indicator) => (
                  <div key={indicator} className="rounded-md bg-muted/30 px-3 py-2 text-muted-foreground">
                    {indicator}
                  </div>
                ))}
              </div>

              {dnsMatches.length === 0 ? (
                <EmptyState text="No campaign-grade DNS indicators were found for this run." />
              ) : (
                <div className="space-y-2">
                  {dnsMatches.slice(0, 5).map((match) => (
                    <div key={`${match.attribution}-${match.queriedAt}-${match.domain}`} className="rounded-md border border-border/60 p-3">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div className="min-w-0">
                          <div className="truncate font-medium">{match.domain}</div>
                          <div className="text-xs text-muted-foreground">
                            {match.clientName || match.clientIp || 'Network-level'} | {match.reason || match.title || 'DNS signal'}
                          </div>
                        </div>
                        <div className="flex flex-wrap gap-1.5">
                          <Badge variant={match.attribution === 'device' ? 'success' : 'medium'}>
                            {match.attribution === 'device' ? 'Device' : 'Network'}
                          </Badge>
                          {match.blocked && <Badge variant="destructive">Blocked</Badge>}
                          {match.suspicious && <Badge variant="high">Signal</Badge>}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Candidate Devices</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {evidence.candidateDevices.length === 0 ? (
            <EmptyState text="No candidate devices were found in the current evidence set." />
          ) : (
            evidence.candidateDevices.map((device) => (
              <div key={device.mac} className="rounded-lg border border-border/60 p-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <div className="font-medium">{device.name}</div>
                    <div className="text-xs text-muted-foreground">
                      {device.ip || 'No IP'} | {device.networkName || 'Unknown network'} | {device.mac}
                    </div>
                  </div>
                  <Badge variant="outline">{Math.round(device.confidence * 100)}%</Badge>
                </div>
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {device.reasonCodes.map((reason) => (
                    <Badge key={reason} variant="secondary" className="text-xs">
                      {reason.replace(/-/g, ' ')}
                    </Badge>
                  ))}
                </div>
              </div>
            ))
          )}
        </CardContent>
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Info className="h-4 w-4 text-sky-400" />
              Posture
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            {[...evidence.riskyNetworkPosture.indicators, ...evidence.dnsPosture.indicators, ...evidence.upnpNatPmp.indicators].length === 0 ? (
              <EmptyState text="No posture indicators were retained." />
            ) : (
              [...evidence.riskyNetworkPosture.indicators, ...evidence.dnsPosture.indicators, ...evidence.upnpNatPmp.indicators].map((item) => (
                <div key={item} className="rounded-md bg-muted/30 px-3 py-2">
                  {item}
                </div>
              ))
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <CheckCircle2 className="h-4 w-4 text-emerald-400" />
              Validation
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            {!evidence.validation ? (
              <EmptyState text="Run Validate to check campaign ports from an online runner." />
            ) : evidence.validation.openPorts.length === 0 ? (
              <div className="rounded-md bg-emerald-500/10 px-3 py-2 text-emerald-300">
                No campaign ports were reachable on candidate devices.
              </div>
            ) : (
              evidence.validation.openPorts.map((port) => (
                <div key={`${port.host}-${port.port}`} className="rounded-md bg-red-500/10 px-3 py-2 text-red-300">
                  {port.candidateName || port.host}: TCP {port.port} ({port.service})
                </div>
              ))
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

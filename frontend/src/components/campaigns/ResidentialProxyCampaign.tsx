import { useEffect, useMemo, useState } from 'react';
import {
  Activity,
  BookOpen,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  ClipboardCheck,
  Database,
  ExternalLink,
  Info,
  Network,
  Play,
  RefreshCw,
  Save,
  Search,
  Settings2,
  ShieldCheck,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Progress } from '@/components/ui/progress';
import { Badge } from '@/components/ui/badge';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { RunbookStepper } from './RunbookStepper';
import { EvidencePanel } from './EvidencePanel';
import { VerdictBadge } from './VerdictBadge';
import { formatDate } from '@/lib/utils';
import type {
  CampaignDetail,
  CampaignRun,
  CampaignStepId,
  ResidentialProxyCampaignOptions,
} from '@/types';

const cleanupTasks = [
  { id: 'remove-suspect-devices', label: 'Remove or replace suspect devices' },
  { id: 'disable-adb', label: 'Disable ADB and debug services' },
  { id: 'isolate-network', label: 'Isolate IoT and media networks' },
  { id: 'enable-protective-dns', label: 'Enable DNS filtering or protective DNS' },
  { id: 'disable-upnp', label: 'Disable UPnP and NAT-PMP' },
  { id: 'rerun-validation', label: 'Rerun validation after cleanup' },
];

const technicalSignalRows = [
  {
    signal: 'Find candidates',
    detail: 'Use UniFi client identity and network placement to rank Android TV, TV box, digital frame, AOSP-like, unknown, and manually selected clients.',
  },
  {
    signal: 'Correlate passive signals',
    detail: 'Use bounded UniFi event/alarm matches plus campaign-grade DNS Proxy signals for Kimwolf, ADB, proxy SDKs, SOCKS, risky ports, firewall blocks, IDS hits, and honeypot triggers.',
  },
  {
    signal: 'Attribute DNS evidence',
    detail: 'Use AdGuard Home query logs as short-lived evidence. Device-level DNS is only used when AdGuard sees UniFi client IPs; gateway-forwarded DNS stays network-level.',
  },
  {
    signal: 'Score posture',
    detail: 'Use network isolation, DNS posture, UPnP/NAT-PMP, and port forwards as supporting risk, not proof of compromise.',
  },
  {
    signal: 'Prove exposure',
    detail: 'Use server-local or ESP32 `tcp_connect` validation to confirm whether risky local ports are reachable from inside the LAN.',
  },
];

const verdictRows = [
  {
    level: 'High',
    meaning: 'Open risky port, honeypot/IDS/firewall hit, strong Kimwolf/proxy telemetry, or device-attributed campaign DNS match.',
  },
  {
    level: 'Medium',
    meaning: 'Suspicious device plus weak segmentation, DNS posture, UPnP/NAT-PMP, device DNS security block, or gateway-only campaign DNS.',
  },
  {
    level: 'Low',
    meaning: 'Posture risk only. No suspicious device or active proof.',
  },
];

function parseCsv(value: string): string[] {
  return value
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

function parsePortCsv(value: string): number[] {
  return parseCsv(value)
    .map((item) => Number(item))
    .filter((port) => Number.isInteger(port) && port > 0 && port <= 65535);
}

function optionsFromRun(campaign: CampaignDetail, run: CampaignRun | null): ResidentialProxyCampaignOptions {
  return run?.optionsJson || campaign.definition.defaultOptions;
}

function CampaignBrief({ campaign }: { campaign: CampaignDetail }) {
  const [showTechnicalNotes, setShowTechnicalNotes] = useState(false);

  return (
    <div className="grid gap-4 lg:grid-cols-[1.35fr_0.9fr]">
      <Card className="lg:col-span-full">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <BookOpen className="h-4 w-4 text-orange-400" />
            Detection in One Pass
          </CardTitle>
          <CardDescription>
            The campaign turns public Kimwolf research into a local validation workflow.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3 md:grid-cols-3">
          <div className="rounded-md border border-border/60 p-3 text-sm leading-6">
            <div className="font-medium text-foreground">1. Find likely devices</div>
            <p className="mt-1 text-muted-foreground">
              Android TV boxes, digital frames, AOSP-like clients, unknown media devices, and manual picks.
            </p>
          </div>
          <div className="rounded-md border border-border/60 p-3 text-sm leading-6">
            <div className="font-medium text-foreground">2. Add UniFi context</div>
            <p className="mt-1 text-muted-foreground">
              Network, VLAN, DNS posture, DNS Proxy attribution, UPnP, port forwards, firewall, IDS, honeypot, and bounded log matches.
            </p>
          </div>
          <div className="rounded-md border border-border/60 p-3 text-sm leading-6">
            <div className="font-medium text-foreground">3. Prove reachability</div>
            <p className="mt-1 text-muted-foreground">
              Server-local or ESP32 runners test the risky ports from inside the LAN.
            </p>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Search className="h-4 w-4 text-sky-400" />
            What UniFi Does
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 text-sm leading-6">
          <p>
            UniFi narrows the list and gives attribution: device identity, IP, MAC, network, posture,
            and security events.
          </p>
          <p className="text-muted-foreground">
            It does not prove a TV box is running ADB or proxy software by itself. That proof comes
            from validation.
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Network className="h-4 w-4 text-emerald-400" />
            What ZeroProof Proves
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 text-sm leading-6">
          <p>
            Validation runs small `tcp_connect` batches against ADB and proxy-risk ports. Open ports
            turn suspicion into a high-confidence finding.
          </p>
          <p className="text-muted-foreground">
            Only curated evidence is saved. DNS query rows are short-lived, and campaign DNS signals are retained separately.
          </p>
        </CardContent>
      </Card>

      <Card className="lg:col-span-full">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <ShieldCheck className="h-4 w-4 text-emerald-400" />
            Verdict Logic
          </CardTitle>
          <CardDescription>
            Keep the first read simple: proof beats posture, and missing proof becomes inconclusive.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3 md:grid-cols-3">
          {verdictRows.map((row) => (
            <div key={row.level} className="rounded-md border border-border/60 p-3 text-sm leading-6">
              <div className="font-medium text-foreground">{row.level}</div>
              <p className="mt-1 text-muted-foreground">{row.meaning}</p>
            </div>
          ))}
        </CardContent>
      </Card>

      <Collapsible open={showTechnicalNotes} onOpenChange={setShowTechnicalNotes} className="lg:col-span-full">
        <Card>
          <CollapsibleTrigger asChild>
            <CardHeader className="cursor-pointer py-4 transition-colors hover:bg-muted/40">
              <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-3">
                  {showTechnicalNotes ? (
                    <ChevronDown className="h-4 w-4 text-muted-foreground" />
                  ) : (
                    <ChevronRight className="h-4 w-4 text-muted-foreground" />
                  )}
                  <Info className="h-4 w-4 text-muted-foreground" />
                  <div>
                    <CardTitle className="text-base">Technical Notes and Sources</CardTitle>
                    <CardDescription>
                      Research mapping, UniFi signals, and source links for deeper review.
                    </CardDescription>
                  </div>
                </div>
              </div>
            </CardHeader>
          </CollapsibleTrigger>
          <CollapsibleContent>
            <CardContent className="space-y-4 pt-0">
              <div className="grid gap-3 md:grid-cols-2">
                {technicalSignalRows.map((row) => (
                  <div key={row.signal} className="rounded-md border border-border/60 p-3 text-sm leading-6">
                    <div className="font-medium text-foreground">{row.signal}</div>
                    <p className="mt-1 text-muted-foreground">{row.detail}</p>
                  </div>
                ))}
              </div>
              {campaign.definition.references.length > 0 && (
                <div className="flex flex-wrap gap-2">
                  {campaign.definition.references.map((reference) => (
                    <Button key={reference.url} variant="outline" size="sm" asChild>
                      <a href={reference.url} target="_blank" rel="noreferrer">
                        {reference.label}
                        <ExternalLink className="ml-2 h-3.5 w-3.5" />
                      </a>
                    </Button>
                  ))}
                </div>
              )}
            </CardContent>
          </CollapsibleContent>
        </Card>
      </Collapsible>
    </div>
  );
}

export function ResidentialProxyCampaign({
  campaign,
  activeRun,
  busyStep,
  onStartRun,
  onExecuteStep,
  onToggleEnabled,
}: {
  campaign: CampaignDetail;
  activeRun: CampaignRun | null;
  busyStep: CampaignStepId | 'start' | 'settings' | null;
  onStartRun: (options: ResidentialProxyCampaignOptions) => void;
  onExecuteStep: (stepId: CampaignStepId, body?: Record<string, unknown>) => void;
  onToggleEnabled: (enabled: boolean) => void;
}) {
  const [keywords, setKeywords] = useState('');
  const [ports, setPorts] = useState('');
  const [lookbackHours, setLookbackHours] = useState(72);
  const [validationTimeoutMs, setValidationTimeoutMs] = useState(800);
  const [cleanupCompleted, setCleanupCompleted] = useState<string[]>([]);

  const currentOptions = useMemo(
    () => optionsFromRun(campaign, activeRun),
    [campaign, activeRun]
  );

  useEffect(() => {
    setKeywords(currentOptions.targetNetworkKeywords.join(', '));
    setPorts(currentOptions.validationPorts.join(', '));
    setLookbackHours(currentOptions.lookbackHours);
    setValidationTimeoutMs(currentOptions.validationTimeoutMs);
    setCleanupCompleted(currentOptions.cleanupCompleted || []);
  }, [currentOptions]);

  const editedOptions: ResidentialProxyCampaignOptions = {
    ...currentOptions,
    targetNetworkKeywords: parseCsv(keywords),
    validationPorts: parsePortCsv(ports),
    lookbackHours,
    validationTimeoutMs,
    cleanupCompleted,
  };

  const steps = activeRun?.stepsJson || campaign.definition.steps.map((step) => ({ ...step, status: 'pending' as const }));
  const runningStep = steps.find((step) => step.status === 'running')?.id;
  const verdict = campaign.enabled ? activeRun?.verdict || 'NOT_RUN' : 'DISABLED';
  const evidence = activeRun?.evidenceJson;
  const summary = activeRun?.summaryJson;
  const progress = summary ? Math.min(100, summary.score) : activeRun?.status === 'RUNNING' ? 35 : 0;

  const runStep = (stepId: CampaignStepId) => {
    if (!activeRun) return;
    if (stepId === 'configure' || stepId === 'cleanup') {
      onExecuteStep(stepId, { options: editedOptions });
      return;
    }
    onExecuteStep(stepId);
  };

  const toggleCleanup = (taskId: string) => {
    setCleanupCompleted((current) =>
      current.includes(taskId)
        ? current.filter((item) => item !== taskId)
        : [...current, taskId]
    );
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="outline">{campaign.definition.category}</Badge>
            <Badge variant="outline">{campaign.definition.severity}</Badge>
            <VerdictBadge verdict={verdict} />
          </div>
          <h1 className="text-2xl font-semibold tracking-normal text-foreground md:text-3xl">
            {campaign.definition.name}
          </h1>
          <p className="max-w-3xl text-sm leading-6 text-muted-foreground">
            {campaign.definition.description}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button
            variant={campaign.enabled ? 'outline' : 'default'}
            onClick={() => onToggleEnabled(!campaign.enabled)}
            disabled={busyStep === 'settings'}
          >
            <ShieldCheck className="mr-2 h-4 w-4" />
            {campaign.enabled ? 'Disable' : 'Enable'}
          </Button>
          <Button
            onClick={() => onStartRun(editedOptions)}
            disabled={!campaign.enabled || busyStep === 'start'}
          >
            {busyStep === 'start' ? <RefreshCw className="mr-2 h-4 w-4 animate-spin" /> : <Play className="mr-2 h-4 w-4" />}
            New Run
          </Button>
        </div>
      </div>

      <Card>
        <CardContent className="pt-6">
          <RunbookStepper steps={steps} activeStep={runningStep} />
        </CardContent>
      </Card>

      <CampaignBrief campaign={campaign} />

      <div className="grid gap-4 lg:grid-cols-[minmax(0,0.95fr)_minmax(0,1.35fr)]">
        <div className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <Activity className="h-4 w-4 text-orange-400" />
                Run State
              </CardTitle>
              <CardDescription>
                {activeRun ? `Run ${activeRun.id.slice(0, 8)} started ${formatDate(activeRun.startedAt)}` : 'No run has been started.'}
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <Progress value={progress} />
              {activeRun?.error && (
                <div className="rounded-md border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-300">
                  {activeRun.error}
                </div>
              )}
              <div className="grid grid-cols-2 gap-2">
                {campaign.definition.steps.map((step) => (
                  <Button
                    key={step.id}
                    variant={step.id === 'validate' ? 'default' : 'outline'}
                    className="justify-start"
                    disabled={!campaign.enabled || !activeRun || Boolean(busyStep)}
                    onClick={() => runStep(step.id)}
                  >
                    {step.id === 'setup' && <Settings2 className="mr-2 h-4 w-4" />}
                    {step.id === 'configure' && <Save className="mr-2 h-4 w-4" />}
                    {step.id === 'collect' && <Database className="mr-2 h-4 w-4" />}
                    {step.id === 'evaluate' && <Search className="mr-2 h-4 w-4" />}
                    {step.id === 'validate' && <CheckCircle2 className="mr-2 h-4 w-4" />}
                    {step.id === 'cleanup' && <ClipboardCheck className="mr-2 h-4 w-4" />}
                    {busyStep === step.id ? 'Running' : step.label}
                  </Button>
                ))}
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Configure</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="campaign-keywords">Target networks</Label>
                <Input
                  id="campaign-keywords"
                  value={keywords}
                  onChange={(event) => setKeywords(event.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="campaign-ports">Validation ports</Label>
                <Input
                  id="campaign-ports"
                  value={ports}
                  onChange={(event) => setPorts(event.target.value)}
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-2">
                  <Label htmlFor="campaign-lookback">Lookback hours</Label>
                  <Input
                    id="campaign-lookback"
                    type="number"
                    min={1}
                    value={lookbackHours}
                    onChange={(event) => setLookbackHours(Number(event.target.value))}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="campaign-timeout">TCP timeout ms</Label>
                  <Input
                    id="campaign-timeout"
                    type="number"
                    min={100}
                    value={validationTimeoutMs}
                    onChange={(event) => setValidationTimeoutMs(Number(event.target.value))}
                  />
                </div>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Cleanup</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {cleanupTasks.map((task) => (
                <label key={task.id} className="flex items-start gap-3 rounded-md border border-border/60 p-3 text-sm">
                  <input
                    type="checkbox"
                    className="mt-1 h-4 w-4 accent-orange-500"
                    checked={cleanupCompleted.includes(task.id)}
                    onChange={() => toggleCleanup(task.id)}
                  />
                  <span>{task.label}</span>
                </label>
              ))}
            </CardContent>
          </Card>
        </div>

        <EvidencePanel evidence={evidence} summary={summary} />
      </div>
    </div>
  );
}

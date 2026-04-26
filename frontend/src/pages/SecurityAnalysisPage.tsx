import { useMemo, useState } from 'react';
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Shield,
  ShieldCheck,
  ShieldAlert,
  ShieldX,
  RefreshCw,
  ExternalLink,
  ChevronDown,
  ChevronRight,
  CheckCircle2,
  AlertTriangle,
  Info,
  HelpCircle,
  Settings,
  Scan,
  EyeOff,
  Eye,
  MessageSquare,
  Copy,
  Check,
} from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Textarea } from '@/components/ui/textarea';
import { cn, formatDate } from '@/lib/utils';
import {
  SEVERITY_FILTER_OPTIONS,
  SEVERITY_ORDER,
  VULNERABILITY_STATUS_CLASS,
  type SeverityFilterOption,
} from '@/config/security';
import { useToast } from '@/hooks/useToast';
import api from '@/api/client';
import type {
  SecurityAnalysisResult,
  RuleEvaluationResult,
  RuleSource,
  Severity,
  RuleCategory,
  Vulnerability,
  VulnStatus,
  FindingDismissal,
  RuleFinding,
} from '@/types';

// Unified Security Issue type
type SecurityIssue = {
  id: string;
  type: 'rule' | 'vulnerability';
  severity: Severity;
  title: string;
  description: string;
  category?: string;
  affectedResource?: string;
  impact?: string;
  remediation?: string;
  source: string;
  // Rule-specific
  ruleResult?: RuleEvaluationResult;
  ruleId?: string;
  finding?: RuleFinding;
  // Vulnerability-specific
  vulnerability?: Vulnerability;
  // Dismissal info
  isDismissed?: boolean;
  dismissalId?: string;
  dismissalReason?: string;
};

function buildIssueShareText(issue: SecurityIssue): string {
  const lines: string[] = [
    `Title: ${issue.title}`,
    `Severity: ${issue.severity}`,
    `Type: ${issue.type === 'rule' ? 'Config Rule' : 'Vulnerability'}`,
    `Source: ${issue.source}`,
  ];

  if (issue.category) lines.push(`Category: ${issue.category}`);
  if (issue.affectedResource) lines.push(`Resource: ${issue.affectedResource}`);
  lines.push(`Status: ${issue.isDismissed ? 'DISMISSED' : 'ACTIVE'}`);
  lines.push(`Description: ${issue.description}`);

  if (issue.finding?.impact) lines.push(`Impact: ${issue.finding.impact}`);
  else if (issue.impact) lines.push(`Impact: ${issue.impact}`);

  if (issue.finding?.currentValue) lines.push(`Current Value: ${issue.finding.currentValue}`);
  if (issue.finding?.expectedValue) lines.push(`Expected Value: ${issue.finding.expectedValue}`);

  if (issue.finding?.remediation) lines.push(`Remediation: ${issue.finding.remediation}`);
  else if (issue.remediation) lines.push(`Remediation: ${issue.remediation}`);

  if (issue.vulnerability) {
    lines.push(`Vulnerability Status: ${issue.vulnerability.status}`);
    lines.push(`First Seen: ${formatDate(issue.vulnerability.firstSeen)}`);
    lines.push(`Last Seen: ${formatDate(issue.vulnerability.lastSeen)}`);
    if (issue.vulnerability.cveId) lines.push(`CVE: ${issue.vulnerability.cveId}`);
    if (issue.vulnerability.notes) lines.push(`Notes: ${issue.vulnerability.notes}`);
  }

  if (issue.dismissalReason) lines.push(`Dismissal Reason: ${issue.dismissalReason}`);

  return lines.join('\n');
}

async function fetchSecurityAnalysis(): Promise<SecurityAnalysisResult> {
  const response = await api.get<SecurityAnalysisResult>('/security/analysis');
  if (!response.success || !response.data) {
    const errorMsg = response.error?.message || 'Failed to fetch security analysis';
    console.error('Security analysis error:', response.error);
    throw new Error(errorMsg);
  }
  return response.data;
}

async function fetchRuleSources(): Promise<RuleSource[]> {
  const response = await api.get<{ sources: RuleSource[] }>('/security/sources');
  if (!response.success || !response.data) {
    console.error('Rule sources error:', response.error);
    throw new Error(response.error?.message || 'Failed to fetch rule sources');
  }
  return response.data.sources;
}

async function syncAndAnalyze(): Promise<SecurityAnalysisResult> {
  try {
    const syncResponse = await api.post<{ synced: boolean; message?: string }>('/unifi/sync', {});
    void syncResponse;
  } catch (syncError) {
    console.warn('UniFi sync failed, analyzing existing config:', syncError);
  }

  const response = await api.post<SecurityAnalysisResult>('/security/analyze', {
    saveFindings: false,
  });
  if (!response.success || !response.data) {
    console.error('Run analysis error:', response.error);
    throw new Error(response.error?.message || 'Failed to run security analysis');
  }
  return response.data;
}

const severityConfig: Record<Severity, { color: string; borderColor: string; icon: typeof ShieldAlert; label: string }> = {
  CRITICAL: { color: 'text-red-600 bg-red-600/10', borderColor: 'border-red-600', icon: ShieldX, label: 'Critical' },
  HIGH: { color: 'text-red-500 bg-red-500/10', borderColor: 'border-red-500', icon: ShieldAlert, label: 'High' },
  MEDIUM: { color: 'text-yellow-500 bg-yellow-500/10', borderColor: 'border-yellow-500', icon: AlertTriangle, label: 'Medium' },
  LOW: { color: 'text-blue-500 bg-blue-500/10', borderColor: 'border-blue-500', icon: Info, label: 'Low' },
  INFO: { color: 'text-gray-500 bg-gray-500/10', borderColor: 'border-gray-500', icon: Info, label: 'Info' },
};

const categoryLabels: Record<RuleCategory, string> = {
  firewall: 'Firewall',
  vlan: 'VLAN/Network',
  dns: 'DNS',
  port: 'Port Security',
  upnp: 'UPnP',
  wireless: 'Wireless',
  general: 'General',
  ids_ips: 'IDS/IPS',
  access_control: 'Access Control',
  switch: 'Switch Security',
  optimization: 'Optimization',
};

// How-to guides for common remediations (UniFi Network 8.x / Traffic & Security interface)
interface HowToGuide {
  keywords: string[];
  title: string;
  steps: string[];
  tip?: string;
}

const howToGuides: HowToGuide[] = [
  {
    keywords: ['pmf', 'protected management frames', '802.11w'],
    title: 'Enable PMF (Protected Management Frames)',
    steps: [
      'Go to Settings → WiFi',
      'Click on the WiFi network name',
      'Scroll to "Advanced" section (or click "Manual" configuration)',
      'Find "802.11w/PMF" setting',
      'Select "Optional" for compatibility or "Required" for maximum security',
      'Click "Apply Changes"',
    ],
    tip: 'Use "Optional" if you have older devices (pre-2018). WPA3 requires PMF, so enabling WPA3 automatically enables PMF.',
  },
  {
    keywords: ['dns', 'custom dns', 'dns server', 'cloudflare', 'quad9', 'dns filtering'],
    title: 'Configure Custom DNS Servers',
    steps: [
      'Go to Settings → Internet',
      'Click on your WAN connection',
      'Under "IPv4 Configuration", find DNS settings',
      'Select "Manual" and enter your preferred DNS:',
      '  • Cloudflare: 1.1.1.1, 1.0.0.1',
      '  • Quad9 (malware blocking): 9.9.9.9',
      'Click "Apply Changes"',
    ],
    tip: 'For per-network DNS, edit the network under Settings → Networks and set DHCP Name Server.',
  },
  {
    keywords: ['upnp', 'disable upnp', 'nat-pmp'],
    title: 'Disable UPnP / NAT-PMP',
    steps: [
      'Go to Settings → Internet',
      'Click on your WAN/Gateway connection',
      'Scroll to the "Advanced" section',
      'Toggle OFF "UPnP" and "NAT-PMP" (if present)',
      'Click "Apply Changes"',
    ],
    tip: 'If gaming consoles need open NAT, manually create port forwards instead of relying on UPnP.',
  },
  {
    keywords: ['vlan', 'network isolation', 'isolate', 'inter-vlan', 'iot network', 'camera network'],
    title: 'Isolate a Network (IoT/Camera/Guest)',
    steps: [
      'Go to Settings → Networks',
      'Click on the network to isolate (e.g., IoT)',
      'Enable "Isolate Network" toggle (blocks inter-VLAN routing)',
      'Click "Apply Changes"',
      'For granular control: Go to Settings → Traffic & Security → Firewall Rules',
      'Create Zone-based rules to allow specific traffic between VLANs',
    ],
    tip: 'Isolated networks can still reach the internet. Use Firewall Rules to block internet if needed (e.g., cameras).',
  },
  {
    keywords: ['ssh', 'disable ssh', 'ssh access'],
    title: 'Manage SSH Access',
    steps: [
      'Go to Settings → System → Advanced',
      'Find "Device SSH Authentication" section',
      'Toggle SSH on/off as needed',
      'If enabled, set a strong unique password',
      'Click "Apply Changes"',
    ],
    tip: 'Leave SSH disabled unless actively troubleshooting. Enable temporarily, then disable when done.',
  },
  {
    keywords: ['guest', 'guest network', 'client isolation', 'ap isolation'],
    title: 'Configure Guest Network Security',
    steps: [
      'Go to Settings → WiFi',
      'Select your guest WiFi network',
      'Enable "Guest Hotspot" for portal authentication (optional)',
      'Scroll to "Advanced" and enable "Client Device Isolation"',
      'Under "Network", ensure it uses a dedicated Guest VLAN',
      'Click "Apply Changes"',
    ],
    tip: 'Guest networks should use a separate VLAN with "Isolate Network" enabled for full protection.',
  },
  {
    keywords: ['multicast', 'mdns', 'mcast', 'bonjour', 'airplay', 'chromecast'],
    title: 'Configure mDNS / Multicast',
    steps: [
      'Go to Settings → Networks',
      'Click on a network that needs mDNS',
      'Find "Multicast DNS" or "mDNS" toggle',
      'Enable for networks that need device discovery',
      'For cross-VLAN discovery: Settings → Services → MDNS → Enable reflector',
      'Click "Apply Changes"',
    ],
    tip: 'Only enable mDNS where needed. Cross-VLAN mDNS can leak device info between networks.',
  },
  {
    keywords: ['wpa3', 'wpa2', 'wireless security', 'wifi security', 'encryption'],
    title: 'Upgrade WiFi Security to WPA3',
    steps: [
      'Go to Settings → WiFi',
      'Click on the WiFi network',
      'Find "Security Protocol" dropdown',
      'Select "WPA3" (modern devices only) or "WPA2/WPA3" (transitional)',
      'Click "Apply Changes"',
    ],
    tip: 'WPA2/WPA3 mode lets older devices connect via WPA2 while newer devices use WPA3. PMF is required for WPA3.',
  },
  {
    keywords: ['firewall', 'traffic rules', 'block traffic', 'firewall rule', 'zone', 'rfc1918', 'port forward'],
    title: 'Create Firewall Rules (Zone-Based)',
    steps: [
      'Go to Settings → Traffic & Security',
      'Click "Firewall Rules" tab',
      'Click "Create Rule"',
      'Set Type: Internet In/Out/Local, or Between VLANs',
      'Configure: Action (Allow/Block), Source Zone/Network, Destination Zone/Network',
      'Add Port/Protocol restrictions if needed',
      'Set rule position (rules are processed top to bottom)',
      'Click "Apply"',
    ],
    tip: 'Use Zone-based rules for cleaner config. "Internet In" = traffic entering from WAN. "Between VLANs" = inter-network traffic.',
  },
  {
    keywords: ['ids', 'ips', 'intrusion', 'threat management', 'threat detection'],
    title: 'Enable IDS/IPS (Threat Management)',
    steps: [
      'Go to Settings → Security → Protection',
      'Toggle on "Intrusion Prevention"',
      'Select Active Detections categories to enable',
      'Or: Settings → Firewall & Security → Threat Management (older versions)',
      'Choose "Detect Only" (IDS) or "Detect and Block" (IPS)',
    ],
    tip: 'IDS only detects and logs threats. IPS actively blocks them. Note: Older USG models have reduced throughput (~75mbps) with IDS/IPS enabled.',
  },
  {
    keywords: ['internet access', 'block internet', 'no internet', 'camera internet'],
    title: 'Block Internet Access for a Network',
    steps: [
      'Go to Settings → Networks',
      'Click on the network (e.g., Cameras)',
      'Find "Internet Access" toggle and disable it',
      'Click "Apply Changes"',
      'Or: Create a Firewall Rule blocking that network to "Internet Out" zone',
    ],
    tip: 'Blocking internet prevents cameras/IoT from phoning home. Ensure local NVR/controller access still works.',
  },
  {
    keywords: ['l3 acl', 'acl', 'switch isolation', 'network isolation', 'l3 isolation', 'device isolation'],
    title: 'Configure L3 ACL Network Isolation (Switch-Level)',
    steps: [
      'Go to Settings → Security',
      'Find the "ACL" or "Access Control" section',
      'Enable "L3 Network Isolation" for switch-level blocking',
      'Select the source network (e.g., IoT)',
      'Select destination networks to block (e.g., Default, Work)',
      'Click "Apply" - traffic is blocked at the switch before reaching the gateway',
      'For device isolation: Enable "Device Isolation" to block client-to-client traffic within a VLAN',
    ],
    tip: 'L3 ACL blocking is more efficient than firewall rules because traffic is dropped at the switch before reaching the gateway. Use this for broad VLAN isolation, and firewall rules for granular control.',
  },
];

function findHowToGuide(remediation: string): HowToGuide | null {
  const lower = remediation.toLowerCase();
  for (const guide of howToGuides) {
    if (guide.keywords.some(kw => lower.includes(kw))) {
      return guide;
    }
  }
  return null;
}

function RemediationHowTo({ remediation }: { remediation: string }) {
  const [isExpanded, setIsExpanded] = useState(false);
  const guide = findHowToGuide(remediation);

  // Always show the remediation recommendation
  return (
    <div className="mt-2">
      {/* Recommendation summary */}
      <p className="text-xs text-blue-400 mb-2">
        <span className="font-medium">Recommendation:</span> {remediation}
      </p>

      {/* How-to guide (expandable) */}
      {guide && (
        <>
          <button
            onClick={(e) => {
              e.stopPropagation();
              setIsExpanded(!isExpanded);
            }}
            className="flex items-center gap-1 text-xs text-purple-400 hover:text-purple-300 transition-colors"
          >
            <HelpCircle className="h-3 w-3" />
            {isExpanded ? 'Hide' : 'Show'} how to fix in UniFi
            {isExpanded ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
          </button>
          {isExpanded && (
            <div className="mt-2 p-3 rounded-lg bg-purple-500/10 border border-purple-500/20 space-y-2">
              <p className="text-sm font-medium text-purple-300">{guide.title}</p>
              <ol className="text-xs space-y-1 text-muted-foreground list-decimal list-inside">
                {guide.steps.map((step, idx) => (
                  <li key={idx} className={step.startsWith('  ') ? 'ml-4 list-none' : ''}>
                    {step.startsWith('  ') ? step : step}
                  </li>
                ))}
              </ol>
              {guide.tip && (
                <p className="text-xs text-purple-400 pt-1 border-t border-purple-500/20">
                  <span className="font-medium">Tip:</span> {guide.tip}
                </p>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}

function SeverityBadge({ severity }: { severity: Severity }) {
  const config = severityConfig[severity];
  return (
    <Badge variant="outline" className={cn('font-medium', config.color)}>
      {config.label}
    </Badge>
  );
}

// Unified Issue Card component
function SecurityIssueCard({
  issue,
  isExpanded,
  onToggle,
  onUpdateVulnStatus,
  onDismiss,
  onReopen,
}: {
  issue: SecurityIssue;
  isExpanded: boolean;
  onToggle: () => void;
  onUpdateVulnStatus?: (id: string, status: VulnStatus) => void;
  onDismiss?: (issue: SecurityIssue) => void;
  onReopen?: (dismissalId: string) => void;
}) {
  const config = severityConfig[issue.severity];
  const Icon = config.icon;
  const { toast } = useToast();
  const [copied, setCopied] = useState(false);

  const handleCopy = async (e: React.MouseEvent<HTMLButtonElement>) => {
    e.stopPropagation();
    const payload = buildIssueShareText(issue);

    try {
      await navigator.clipboard.writeText(payload);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
      toast({ title: 'Finding copied' });
    } catch (_error) {
      toast({
        variant: 'destructive',
        title: 'Copy failed',
        description: 'Clipboard permission was denied.',
      });
    }
  };

  return (
    <Card className={cn(
      'border-l-4',
      issue.isDismissed ? 'border-gray-400 opacity-60' : config.borderColor
    )}>
      <div
        className="p-4 cursor-pointer hover:bg-muted/50 transition-colors"
        onClick={onToggle}
      >
        <div className="flex items-start gap-3">
          <Icon className={cn('h-5 w-5 mt-0.5', issue.isDismissed ? 'text-gray-400' : config.color.split(' ')[0])} />
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <h3 className={cn('font-medium', issue.isDismissed && 'text-muted-foreground')}>{issue.title}</h3>
              <Badge
                variant="outline"
                className={cn(
                  'text-xs font-normal',
                  issue.type === 'rule'
                    ? 'bg-blue-500/10 text-blue-400 border-blue-500/30'
                    : 'bg-purple-500/10 text-purple-400 border-purple-500/30'
                )}
              >
                {issue.type === 'rule' ? <Settings className="h-3 w-3 mr-1" /> : <Scan className="h-3 w-3 mr-1" />}
                {issue.source}
              </Badge>
              {issue.isDismissed && (
                <Badge variant="outline" className="text-xs bg-gray-500/10 text-gray-400 border-gray-500/30">
                  <EyeOff className="h-3 w-3 mr-1" />
                  Dismissed
                </Badge>
              )}
            </div>
            <div className="flex flex-wrap items-center gap-2 mt-1 text-sm text-muted-foreground">
              {issue.category && <span>{issue.category}</span>}
              {issue.affectedResource && (
                <>
                  {issue.category && <span>•</span>}
                  <span className="font-mono text-xs">{issue.affectedResource}</span>
                </>
              )}
            </div>
            {issue.isDismissed && issue.dismissalReason && (
              <div className="flex items-center gap-1 mt-1 text-xs text-gray-400">
                <MessageSquare className="h-3 w-3" />
                <span className="truncate max-w-xs">{issue.dismissalReason}</span>
              </div>
            )}
          </div>
          <div className="flex flex-col items-end gap-1.5 sm:flex-row sm:items-center sm:gap-2">
            <Button
              size="sm"
              variant="ghost"
              className="h-7 px-2 text-xs"
              onClick={handleCopy}
            >
              {copied ? <Check className="h-3.5 w-3.5 mr-1" /> : <Copy className="h-3.5 w-3.5 mr-1" />}
              {copied ? 'Copied' : 'Copy'}
            </Button>
            <SeverityBadge severity={issue.severity} />
            {issue.vulnerability && (
              <span className={cn(
                'px-2 py-1 text-xs rounded-full font-medium',
                VULNERABILITY_STATUS_CLASS[issue.vulnerability.status]
              )}>
                {issue.vulnerability.status.replace('_', ' ')}
              </span>
            )}
            {isExpanded ? (
              <ChevronDown className="h-4 w-4 text-muted-foreground" />
            ) : (
              <ChevronRight className="h-4 w-4 text-muted-foreground" />
            )}
          </div>
        </div>
      </div>

      {isExpanded && (
        <div className="px-4 pb-4 pt-0 border-t bg-muted/30">
          <div className="pt-4 space-y-3">
            {/* Description */}
            <p className="text-sm">{issue.description}</p>

            {/* Rule-specific details - show only this card's specific finding */}
            {issue.finding && (
              <div className="p-3 rounded-lg bg-background/50 space-y-2">
                {issue.finding.affectedResource && (
                  <p className="text-xs text-muted-foreground">
                    <span className="font-medium">Affected:</span> {issue.finding.affectedResource}
                  </p>
                )}
                {issue.finding.currentValue && (
                  <p className="text-xs">
                    <span className="text-red-400">Current:</span> {issue.finding.currentValue}
                    {issue.finding.expectedValue && (
                      <>
                        {' | '}
                        <span className="text-green-400">Expected:</span> {issue.finding.expectedValue}
                      </>
                    )}
                  </p>
                )}
                {issue.finding.impact && (
                  <p className="text-xs text-muted-foreground">
                    <span className="font-medium">Impact:</span> {issue.finding.impact}
                  </p>
                )}
                {issue.finding.remediation && (
                  <RemediationHowTo remediation={issue.finding.remediation} />
                )}
              </div>
            )}

            {/* Vulnerability-specific details */}
            {issue.vulnerability && (
              <>
                {issue.impact && (
                  <div>
                    <h4 className="text-sm font-medium mb-1">Impact</h4>
                    <p className="text-sm text-muted-foreground">{issue.impact}</p>
                  </div>
                )}

                {issue.remediation && (
                  <RemediationHowTo remediation={issue.remediation} />
                )}

                <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                  <span>First seen: {formatDate(issue.vulnerability.firstSeen)}</span>
                  <span>•</span>
                  <span>Last seen: {formatDate(issue.vulnerability.lastSeen)}</span>
                  {issue.vulnerability.cveId && (
                    <>
                      <span>•</span>
                      <a
                        href={`https://nvd.nist.gov/vuln/detail/${issue.vulnerability.cveId}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="flex items-center gap-1 text-primary hover:underline"
                        onClick={(e) => e.stopPropagation()}
                      >
                        {issue.vulnerability.cveId}
                        <ExternalLink className="h-3 w-3" />
                      </a>
                    </>
                  )}
                </div>
                {issue.vulnerability.notes && (
                  <div className="flex items-center gap-1 mt-1 text-xs text-gray-400">
                    <MessageSquare className="h-3 w-3" />
                    <span>{issue.vulnerability.notes}</span>
                  </div>
                )}
              </>
            )}

            {/* Unified Dismiss/Reopen buttons for all issues */}
            <div className="flex flex-wrap gap-2 pt-2 border-t">
              {issue.type === 'rule' ? (
                // Rule findings use the dismissal system
                issue.isDismissed ? (
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={(e) => {
                      e.stopPropagation();
                      if (issue.dismissalId && onReopen) {
                        onReopen(issue.dismissalId);
                      }
                    }}
                  >
                    <Eye className="h-4 w-4 mr-1" />
                    Reopen
                  </Button>
                ) : (
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={(e) => {
                      e.stopPropagation();
                      if (onDismiss) {
                        onDismiss(issue);
                      }
                    }}
                  >
                    <EyeOff className="h-4 w-4 mr-1" />
                    Dismiss
                  </Button>
                )
              ) : (
                // Vulnerabilities use status updates
                issue.vulnerability?.status === 'OPEN' ? (
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={(e) => {
                      e.stopPropagation();
                      if (onDismiss) {
                        onDismiss(issue);
                      }
                    }}
                  >
                    <EyeOff className="h-4 w-4 mr-1" />
                    Dismiss
                  </Button>
                ) : (
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={(e) => {
                      e.stopPropagation();
                      if (onUpdateVulnStatus) {
                        onUpdateVulnStatus(issue.vulnerability!.id, 'OPEN');
                      }
                    }}
                  >
                    <Eye className="h-4 w-4 mr-1" />
                    Reopen
                  </Button>
                )
              )}
            </div>
          </div>
        </div>
      )}
    </Card>
  );
}

// Passed rules card (collapsed section)
function PassedRulesSection({ results }: { results: RuleEvaluationResult[] }) {
  const [isOpen, setIsOpen] = useState(false);
  const passedResults = results.filter(r => r.passed);

  if (passedResults.length === 0) return null;

  return (
    <Collapsible open={isOpen} onOpenChange={setIsOpen}>
      <Card className="border-green-500/30 bg-green-500/5">
        <CollapsibleTrigger asChild>
          <CardHeader className="cursor-pointer hover:bg-muted/50 transition-colors py-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                {isOpen ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                <CheckCircle2 className="h-5 w-5 text-green-500" />
                <div>
                  <CardTitle className="text-sm font-medium text-green-500">
                    {passedResults.length} Checks Passed
                  </CardTitle>
                  <CardDescription className="text-xs">
                    Your configuration meets these security requirements
                  </CardDescription>
                </div>
              </div>
            </div>
          </CardHeader>
        </CollapsibleTrigger>
        <CollapsibleContent>
          <CardContent className="pt-0 pb-4">
            <div className="space-y-2">
              {passedResults.map((result) => (
                <div key={result.ruleId} className="flex items-center gap-2 p-2 rounded bg-background/50">
                  <CheckCircle2 className="h-4 w-4 text-green-500 flex-shrink-0" />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium truncate">{result.ruleName}</p>
                    {result.ruleDescription && (
                      <p className="text-xs text-muted-foreground truncate">{result.ruleDescription}</p>
                    )}
                  </div>
                  <SeverityBadge severity={result.severity} />
                </div>
              ))}
            </div>
          </CardContent>
        </CollapsibleContent>
      </Card>
    </Collapsible>
  );
}

export function SecurityAnalysisPage() {
  const VULN_PAGE_SIZE = 50;
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [severityFilter, setSeverityFilter] = useState<SeverityFilterOption>('all');
  const [showDismissed, setShowDismissed] = useState(false);
  const [dismissDialogOpen, setDismissDialogOpen] = useState(false);
  const [dismissingIssue, setDissmissingIssue] = useState<SecurityIssue | null>(null);
  const [dismissReason, setDismissReason] = useState('');

  const { data: analysis, isLoading: analysisLoading, error } = useQuery({
    queryKey: ['security-analysis'],
    queryFn: fetchSecurityAnalysis,
  });

  const { data: sources } = useQuery({
    queryKey: ['rule-sources'],
    queryFn: fetchRuleSources,
  });

  const vulnerabilitiesQuery = useInfiniteQuery({
    queryKey: ['vulnerabilities', 'security-page', 'OPEN'],
    queryFn: async ({ pageParam = 1 }) => {
      const response = await api.get<{
        vulnerabilities: Vulnerability[];
        pagination: { page: number; limit: number; total: number; totalPages: number };
      }>(`/vulnerabilities?limit=${VULN_PAGE_SIZE}&status=OPEN&page=${pageParam}`);
      return response.data || { vulnerabilities: [], pagination: { page: 1, limit: VULN_PAGE_SIZE, total: 0, totalPages: 1 } };
    },
    initialPageParam: 1,
    getNextPageParam: (lastPage) => {
      if (!lastPage?.pagination) return undefined;
      const { page, totalPages } = lastPage.pagination;
      return page < totalPages ? page + 1 : undefined;
    },
  });

  const vulnerabilities = useMemo(
    () => vulnerabilitiesQuery.data?.pages.flatMap((p) => p.vulnerabilities) || [],
    [vulnerabilitiesQuery.data]
  );
  const hasNextVulnPage = vulnerabilitiesQuery.hasNextPage;
  const isFetchingNextVulnPage = vulnerabilitiesQuery.isFetchingNextPage;

  const { data: vulnerabilityStats } = useQuery({
    queryKey: ['vulnerabilities', 'stats', 'OPEN'],
    queryFn: async () => {
      const response = await api.get<{
        bySeverity: Record<Severity, number>;
        byStatus: Record<string, number>;
        byType: Array<{ type: string; _count: { id: number } }>;
        recentTrend: Array<{ firstSeen: string; _count: { id: number } }>;
      }>('/vulnerabilities/stats?status=OPEN');
      return response.data || null;
    },
  });

  const analyzeMutation = useMutation({
    mutationFn: syncAndAnalyze,
    onSuccess: (data) => {
      queryClient.setQueryData(['security-analysis'], data);
      queryClient.invalidateQueries({ queryKey: ['vlan-coverage'] });
      queryClient.invalidateQueries({ queryKey: ['config'] });
      queryClient.invalidateQueries({ queryKey: ['vulnerabilities'] });
    },
  });

  const updateVulnMutation = useMutation({
    mutationFn: async ({ id, status, notes }: { id: string; status: VulnStatus; notes?: string }) => {
      const response = await api.patch(`/vulnerabilities/${id}`, { status, notes });
      if (!response.success) {
        throw new Error(response.error?.message || 'Failed to update');
      }
    },
    onSuccess: () => {
      toast({ title: 'Issue updated' });
      queryClient.invalidateQueries({ queryKey: ['vulnerabilities'] });
      queryClient.invalidateQueries({ queryKey: ['dashboard'] });
    },
    onError: (error: Error) => {
      toast({ variant: 'destructive', title: 'Error', description: error.message });
    },
  });

  // Dismiss mutation
  const dismissMutation = useMutation({
    mutationFn: async ({
      findingType,
      findingId,
      affectedResource,
      reason,
    }: {
      findingType: 'RULE' | 'INTENT_GAP';
      findingId: string;
      affectedResource?: string;
      reason: string;
    }) => {
      const response = await api.post<{ dismissal: FindingDismissal }>('/dismissals', {
        findingType,
        findingId,
        affectedResource,
        reason,
      });
      if (!response.success) {
        throw new Error(response.error?.message || 'Failed to dismiss');
      }
      return response.data;
    },
    onSuccess: () => {
      toast({ title: 'Finding dismissed' });
      queryClient.invalidateQueries({ queryKey: ['security-analysis'] });
      setDismissDialogOpen(false);
      setDissmissingIssue(null);
      setDismissReason('');
    },
    onError: (error: Error) => {
      toast({ variant: 'destructive', title: 'Error', description: error.message });
    },
  });

  // Reopen mutation
  const reopenMutation = useMutation({
    mutationFn: async (dismissalId: string) => {
      const response = await api.post(`/dismissals/${dismissalId}/reopen`);
      if (!response.success) {
        throw new Error(response.error?.message || 'Failed to reopen');
      }
    },
    onSuccess: () => {
      toast({ title: 'Finding reopened' });
      queryClient.invalidateQueries({ queryKey: ['security-analysis'] });
    },
    onError: (error: Error) => {
      toast({ variant: 'destructive', title: 'Error', description: error.message });
    },
  });

  const handleDismiss = (issue: SecurityIssue) => {
    setDissmissingIssue(issue);
    setDismissReason('');
    setDismissDialogOpen(true);
  };

  const handleConfirmDismiss = () => {
    if (!dismissingIssue || dismissReason.trim().length < 10) return;

    if (dismissingIssue.type === 'vulnerability' && dismissingIssue.vulnerability) {
      // For vulnerabilities, update status and save reason in notes
      updateVulnMutation.mutate({
        id: dismissingIssue.vulnerability.id,
        status: 'FALSE_POSITIVE',
        notes: dismissReason.trim(),
      }, {
        onSuccess: () => {
          setDismissDialogOpen(false);
          setDissmissingIssue(null);
          setDismissReason('');
        },
      });
    } else {
      // For rule findings, use the dismissal system
      dismissMutation.mutate({
        findingType: 'RULE',
        findingId: dismissingIssue.ruleId || '',
        affectedResource: dismissingIssue.affectedResource,
        reason: dismissReason.trim(),
      });
    }
  };

  const handleReopen = (dismissalId: string) => {
    reopenMutation.mutate(dismissalId);
  };

  // Convert failed rules and vulnerabilities to unified issues
  const allIssues: SecurityIssue[] = [];

  // Add failed rules as issues (including dismissed ones)
  if (analysis?.results) {
    for (const result of analysis.results) {
      // Include findings from rules that have any findings (passed or not)
      for (const finding of result.findings) {
        // Create an issue for each finding
        allIssues.push({
          id: `rule-${result.ruleId}-${finding.affectedResource || 'all'}`,
          type: 'rule',
          severity: result.severity,
          title: result.ruleName,
          description: finding.description || 'Configuration issue detected',
          category: categoryLabels[result.category],
          affectedResource: finding.affectedResource,
          source: 'Config Analysis',
          ruleResult: result,
          ruleId: result.ruleId,
          finding,
          isDismissed: finding.isDismissed,
          dismissalId: finding.dismissalId,
          dismissalReason: finding.dismissalReason,
        });
      }
    }
  }

  // Add open vulnerabilities as issues
  if (vulnerabilities) {
    for (const vuln of vulnerabilities) {
      allIssues.push({
        id: `vuln-${vuln.id}`,
        type: 'vulnerability',
        severity: vuln.severity,
        title: vuln.title,
        description: vuln.description,
        category: vuln.type,
        affectedResource: vuln.affectedResource,
        impact: vuln.impact,
        remediation: vuln.remediation,
        source: 'Vulnerability Scan',
        vulnerability: vuln,
      });
    }
  }

  // Sort by severity, with dismissed items at the end
  allIssues.sort((a, b) => {
    // Dismissed items go to the end
    if (a.isDismissed && !b.isDismissed) return 1;
    if (!a.isDismissed && b.isDismissed) return -1;
    // Then sort by severity
    return SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity];
  });

  // Filter by severity and dismissed status
  let filteredIssues = allIssues;
  if (!showDismissed) {
    filteredIssues = filteredIssues.filter(i => !i.isDismissed);
  }
  if (severityFilter === 'CRITICAL_HIGH') {
    filteredIssues = filteredIssues.filter(i => i.severity === 'CRITICAL' || i.severity === 'HIGH');
  } else if (severityFilter === 'MEDIUM_LOW') {
    filteredIssues = filteredIssues.filter(i => i.severity === 'MEDIUM' || i.severity === 'LOW');
  } else if (severityFilter !== 'all') {
    filteredIssues = filteredIssues.filter(i => i.severity === severityFilter);
  }

  // Count dismissed issues
  const dismissedCount = allIssues.filter(i => i.isDismissed).length;

  // Failed rules by severity (counts failed rules, not findings)
  const failedBySeverity = {
    CRITICAL: 0,
    HIGH: 0,
    MEDIUM: 0,
    LOW: 0,
    INFO: 0,
  };
  if (analysis?.results) {
    for (const result of analysis.results) {
      if (!result.passed && result.severity in failedBySeverity) {
        failedBySeverity[result.severity as Severity]++;
      }
    }
  }

  const vulnBySeverity = {
    CRITICAL: 0,
    HIGH: 0,
    MEDIUM: 0,
    LOW: 0,
    INFO: 0,
    ...vulnerabilityStats?.bySeverity,
  };

  // Calculate unified metrics (only counting non-dismissed)
  const totalRules = analysis?.summary.totalRules || 0;
  const passedRules = analysis?.summary.passed || 0;
  const failedRules = analysis?.summary.failed || 0;
  const openVulns = Object.values(vulnBySeverity).reduce((sum, val) => sum + val, 0) || vulnerabilities.length || 0;
  const totalIssues = failedRules + openVulns;

  // Security score: passed checks / total checks (rules + vulns count as "failed checks")
  const totalChecks = totalRules + openVulns;
  const securityScore = totalChecks > 0 ? Math.round((passedRules / totalChecks) * 100) : 100;

  // Count critical/high issues (only non-dismissed)
  const criticalHighIssues =
    failedBySeverity.CRITICAL + failedBySeverity.HIGH + vulnBySeverity.CRITICAL + vulnBySeverity.HIGH;

  // Count medium/low issues (only non-dismissed)
  const mediumLowIssues =
    failedBySeverity.MEDIUM + failedBySeverity.LOW + vulnBySeverity.MEDIUM + vulnBySeverity.LOW;

  if (analysisLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <RefreshCw className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (error) {
    return (
      <Card>
        <CardContent className="pt-6">
          <div className="text-center text-red-500">
            <ShieldX className="h-12 w-12 mx-auto mb-2" />
            <p>{(error as Error).message}</p>
            <Button onClick={() => analyzeMutation.mutate()} className="mt-4">
              Run Analysis
            </Button>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Shield className="h-6 w-6" />
            Security
          </h1>
          <p className="text-muted-foreground">
            Unified view of security issues from config analysis and vulnerability scans
          </p>
          {analysis && (
            <p className="text-xs text-muted-foreground mt-1">
              Analyzed {new Date(analysis.analyzedAt).toLocaleString()}
              {analysis.configSiteName && ` \u00b7 ${analysis.configSiteName}`}
              {` \u00b7 ${totalRules} rules checked`}
            </p>
          )}
        </div>
        <Button
          onClick={() => analyzeMutation.mutate()}
          disabled={analyzeMutation.isPending}
        >
          {analyzeMutation.isPending ? (
            <RefreshCw className="h-4 w-4 mr-2 animate-spin" />
          ) : (
            <RefreshCw className="h-4 w-4 mr-2" />
          )}
          Sync & Analyze
        </Button>
      </div>

      {/* Attribution Card */}
      {sources && sources.length > 0 && (
        <Card className="bg-gradient-to-r from-purple-500/5 to-blue-500/5 border-purple-500/20">
          <CardContent className="p-4 sm:p-5">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex items-start sm:items-center gap-3 sm:gap-4">
                <ShieldCheck className="h-5 w-5 text-purple-400" />
                <div className="text-sm">
                  <span className="text-muted-foreground">Powered by </span>
                  {sources.map((source, idx) => (
                    <span key={source.id}>
                      {idx > 0 && ' + '}
                      <span className={source.id === 'industry-standards' ? 'text-purple-400' : 'text-blue-400'}>
                        {source.name}
                      </span>
                    </span>
                  ))}
                </div>
              </div>
              {sources.find((s) => s.url) && (
                <a
                  href={sources.find((s) => s.url)?.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-xs text-muted-foreground hover:text-purple-400 flex items-center gap-1"
                >
                  View Source <ExternalLink className="h-3 w-3" />
                </a>
              )}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Summary Cards */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <Card>
          <CardContent className="p-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-muted-foreground">Config Score</p>
                <p className="text-2xl font-bold">{securityScore}%</p>
              </div>
              <ShieldCheck className={cn('h-10 w-10', securityScore >= 80 ? 'text-green-500' : securityScore >= 50 ? 'text-yellow-500' : 'text-red-500')} />
            </div>
            <Progress value={securityScore} className="mt-3" />
            <p className="text-xs text-muted-foreground mt-2">
              Based on config analysis and open vulnerabilities
            </p>
          </CardContent>
        </Card>

        <Card
          className={cn(
            'cursor-pointer transition-all hover:border-orange-500/50 hover:bg-orange-500/5',
            severityFilter === 'all' && 'ring-2 ring-orange-500/50'
          )}
          onClick={() => setSeverityFilter('all')}
        >
          <CardContent className="p-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-muted-foreground">Open Issues</p>
                <p className="text-2xl font-bold">{totalIssues}</p>
              </div>
              <ShieldAlert className={cn('h-10 w-10', totalIssues === 0 ? 'text-green-500' : 'text-orange-500')} />
            </div>
            <p className="text-xs text-muted-foreground mt-2">
              {failedRules} config • {openVulns} vulnerabilities
            </p>
          </CardContent>
        </Card>

        <Card
          className={cn(
            'cursor-pointer transition-all hover:border-red-500/50 hover:bg-red-500/5',
            severityFilter === 'CRITICAL_HIGH' && 'ring-2 ring-red-500/50'
          )}
          onClick={() => setSeverityFilter('CRITICAL_HIGH')}
        >
          <CardContent className="p-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-muted-foreground">Critical/High</p>
                <p className={cn('text-2xl font-bold', criticalHighIssues > 0 ? 'text-red-500' : 'text-green-500')}>
                  {criticalHighIssues}
                </p>
              </div>
              <ShieldX className={cn('h-10 w-10', criticalHighIssues > 0 ? 'text-red-500' : 'text-green-500')} />
            </div>
            <p className="text-xs text-muted-foreground mt-2">
              Requires immediate attention
            </p>
          </CardContent>
        </Card>

        <Card
          className={cn(
            'cursor-pointer transition-all hover:border-yellow-500/50 hover:bg-yellow-500/5',
            severityFilter === 'MEDIUM_LOW' && 'ring-2 ring-yellow-500/50'
          )}
          onClick={() => setSeverityFilter('MEDIUM_LOW')}
        >
          <CardContent className="p-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-muted-foreground">Medium/Low</p>
                <p className={cn('text-2xl font-bold', mediumLowIssues > 0 ? 'text-yellow-500' : 'text-green-500')}>
                  {mediumLowIssues}
                </p>
              </div>
              <AlertTriangle className={cn('h-10 w-10', mediumLowIssues > 0 ? 'text-yellow-500' : 'text-green-500')} />
            </div>
            <p className="text-xs text-muted-foreground mt-2">
              Review when possible
            </p>
          </CardContent>
        </Card>

      </div>

      {/* Severity Filter */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-2 flex-wrap overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          <span className="text-sm text-muted-foreground">Filter:</span>
          {SEVERITY_FILTER_OPTIONS.map((sev) => (
            <Button
              key={sev}
              variant={severityFilter === sev ? 'default' : 'outline'}
              size="sm"
              onClick={() => setSeverityFilter(sev)}
              className={cn(
                sev === 'CRITICAL_HIGH' && severityFilter === sev && 'bg-red-500/20 text-red-400 border-red-500/50',
                sev === 'MEDIUM_LOW' && severityFilter === sev && 'bg-yellow-500/20 text-yellow-400 border-yellow-500/50',
                sev !== 'all' && sev !== 'CRITICAL_HIGH' && sev !== 'MEDIUM_LOW' && severityFilter === sev && severityConfig[sev].color
              )}
            >
              {sev === 'all' ? 'All Issues' : sev === 'CRITICAL_HIGH' ? 'Critical/High' : sev === 'MEDIUM_LOW' ? 'Medium/Low' : sev}
            </Button>
          ))}
        </div>
        {dismissedCount > 0 && (
          <Button
            variant={showDismissed ? 'default' : 'outline'}
            size="sm"
            onClick={() => setShowDismissed(!showDismissed)}
            className="text-gray-400"
          >
            <EyeOff className="h-4 w-4 mr-1" />
            {showDismissed ? 'Hide' : 'Show'} Dismissed ({dismissedCount})
          </Button>
        )}
      </div>

      {/* Dismiss Dialog */}
      <Dialog open={dismissDialogOpen} onOpenChange={setDismissDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Dismiss Finding</DialogTitle>
            <DialogDescription>
              Dismissing "{dismissingIssue?.title}"
              {dismissingIssue?.affectedResource && (
                <span className="block text-xs mt-1 font-mono">
                  Resource: {dismissingIssue.affectedResource}
                </span>
              )}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <label className="text-sm font-medium">
                Reason for dismissal <span className="text-red-500">*</span>
              </label>
              <Textarea
                placeholder="Explain why this finding is being dismissed (min 10 characters)..."
                value={dismissReason}
                onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) => setDismissReason(e.target.value)}
                className="mt-1"
                rows={3}
              />
              <p className="text-xs text-muted-foreground mt-1">
                {dismissReason.trim().length}/10 characters minimum
              </p>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDismissDialogOpen(false)}>
              Cancel
            </Button>
            <Button
              onClick={handleConfirmDismiss}
              disabled={dismissReason.trim().length < 10 || dismissMutation.isPending}
            >
              {dismissMutation.isPending ? 'Dismissing...' : 'Dismiss Finding'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Security Issues List */}
      {hasNextVulnPage && (
        <Card className="border-yellow-500/30 bg-yellow-500/5">
          <CardContent className="py-3 text-sm text-yellow-600">
            Vulnerabilities are paginated. Load more to see additional items.
          </CardContent>
        </Card>
      )}
      {filteredIssues.length > 0 ? (
        <div className="space-y-3">
          {filteredIssues.map((issue) => (
            <SecurityIssueCard
              key={issue.id}
              issue={issue}
              isExpanded={expandedId === issue.id}
              onToggle={() => setExpandedId(expandedId === issue.id ? null : issue.id)}
              onUpdateVulnStatus={(id, status) => updateVulnMutation.mutate({ id, status })}
              onDismiss={handleDismiss}
              onReopen={handleReopen}
            />
          ))}
        </div>
      ) : (
        <Card className="border-green-500/30 bg-green-500/5">
          <CardContent className="py-8 text-center">
            <CheckCircle2 className="h-12 w-12 mx-auto mb-2 text-green-500" />
            <h3 className="text-lg font-medium text-green-500">No Security Issues Found</h3>
            <p className="text-muted-foreground">
              {hasNextVulnPage
                ? 'More vulnerabilities are available. Load more to continue.'
                : severityFilter === 'all'
                ? 'Your network configuration looks secure!'
                : severityFilter === 'CRITICAL_HIGH'
                ? 'No critical or high severity issues found.'
                : `No ${severityFilter} severity issues found.`}
            </p>
          </CardContent>
        </Card>
      )}

      {hasNextVulnPage && (
        <div className="flex justify-center">
          <Button
            variant="outline"
            onClick={() => vulnerabilitiesQuery.fetchNextPage()}
            disabled={isFetchingNextVulnPage}
          >
            {isFetchingNextVulnPage ? 'Loading...' : 'Load more'}
          </Button>
        </div>
      )}

      {/* Passed Rules Section */}
      {analysis?.results && <PassedRulesSection results={analysis.results} />}
    </div>
  );
}

export default SecurityAnalysisPage;

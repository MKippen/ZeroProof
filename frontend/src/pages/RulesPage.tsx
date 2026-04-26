import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  FileText,
  RefreshCw,
  Github,
  ChevronDown,
  Shield,
  TestTube,
  Target,
  ExternalLink,
  Check,
  X,
  Clock,
  AlertTriangle,
  Info,
  FolderOpen,
} from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { cn, formatDate } from '@/lib/utils';
import { useToast } from '@/hooks/useToast';
import api from '@/api/client';
import { SEVERITY_LEVELS } from '@/config/security';

// Types
interface RuleMetadata {
  author?: string;
  created?: string;
  modified?: string;
  version?: string;
  tags?: string[];
  references?: string[];
}

interface SecurityRule {
  id: string;
  name: string;
  description: string;
  category: string;
  severity: 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW' | 'INFO';
  metadata?: RuleMetadata;
}

interface TestDefinition {
  id: string;
  name: string;
  description: string;
  category: string;
  target: string;
  isDynamic?: boolean;
  isMeshTest?: boolean;
  metadata?: RuleMetadata;
}

interface IntentEvaluation {
  id: string;
  name: string;
  description: string;
  category: string;
  priority: number;
  intentSetting: string;
  metadata?: RuleMetadata;
}

interface RulesStats {
  securityRules: number;
  testDefinitions: number;
  intentEvaluations: number;
  lastLoaded: string;
  byCategory: Record<string, number>;
}

interface OfficialRepoInfo {
  owner: string;
  repo: string;
  branch: string;
  url: string;
}

interface LastSyncInfo {
  success: boolean;
  filesDownloaded: number;
  filesUpdated: number;
  filesSkipped: number;
  errors: string[];
  timestamp: string;
}

interface SyncStatus {
  official: OfficialRepoInfo;
  lastSync: LastSyncInfo | null;
}

interface SyncResult {
  success: boolean;
  filesDownloaded: number;
  filesUpdated: number;
  filesSkipped: number;
  errors: string[];
  message: string;
}

// API functions
async function fetchRulesStats(): Promise<RulesStats> {
  const response = await api.get<RulesStats>('/rules/stats');
  if (!response.success || !response.data) {
    throw new Error(response.error?.message || 'Failed to fetch rules stats');
  }
  return response.data;
}

async function fetchSecurityRules(): Promise<{ total: number; rules: SecurityRule[] }> {
  const response = await api.get<{ total: number; rules: SecurityRule[] }>('/rules');
  if (!response.success || !response.data) {
    throw new Error(response.error?.message || 'Failed to fetch security rules');
  }
  return response.data;
}

async function fetchTests(): Promise<{ total: number; tests: TestDefinition[] }> {
  const response = await api.get<{ total: number; tests: TestDefinition[] }>('/rules/tests');
  if (!response.success || !response.data) {
    throw new Error(response.error?.message || 'Failed to fetch tests');
  }
  return response.data;
}

async function fetchIntents(): Promise<{ total: number; evaluations: IntentEvaluation[] }> {
  const response = await api.get<{ total: number; evaluations: IntentEvaluation[] }>('/rules/intents');
  if (!response.success || !response.data) {
    throw new Error(response.error?.message || 'Failed to fetch intents');
  }
  return response.data;
}

async function fetchSyncStatus(): Promise<SyncStatus> {
  const response = await api.get<SyncStatus>('/rules/sync/status');
  if (!response.success || !response.data) {
    throw new Error(response.error?.message || 'Failed to fetch sync status');
  }
  return response.data;
}

async function syncFromOfficial(): Promise<SyncResult> {
  const response = await api.post<SyncResult>('/rules/sync');
  if (!response.success || !response.data) {
    throw new Error(response.error?.message || 'Failed to sync from official repository');
  }
  return response.data;
}

// Severity colors
const severityColors: Record<string, string> = {
  CRITICAL: 'bg-red-500 text-white',
  HIGH: 'bg-orange-500 text-white',
  MEDIUM: 'bg-yellow-500 text-black',
  LOW: 'bg-blue-500 text-white',
  INFO: 'bg-gray-500 text-white',
};

// Category icons
const categoryIcons: Record<string, React.ReactNode> = {
  firewall: <Shield className="h-4 w-4" />,
  vlan: <FolderOpen className="h-4 w-4" />,
  wireless: <Info className="h-4 w-4" />,
  dns: <Info className="h-4 w-4" />,
  upnp: <AlertTriangle className="h-4 w-4" />,
  port: <AlertTriangle className="h-4 w-4" />,
  general: <Info className="h-4 w-4" />,
  ids_ips: <Shield className="h-4 w-4" />,
  access_control: <Shield className="h-4 w-4" />,
  switch: <Info className="h-4 w-4" />,
};

export function RulesContent() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [activeTab, setActiveTab] = useState('security');

  // Queries
  const { data: stats } = useQuery({
    queryKey: ['rules', 'stats'],
    queryFn: fetchRulesStats,
  });

  const { data: rulesData, isLoading: rulesLoading } = useQuery({
    queryKey: ['rules', 'security'],
    queryFn: fetchSecurityRules,
  });

  const { data: testsData, isLoading: testsLoading } = useQuery({
    queryKey: ['rules', 'tests'],
    queryFn: fetchTests,
  });

  const { data: intentsData, isLoading: intentsLoading } = useQuery({
    queryKey: ['rules', 'intents'],
    queryFn: fetchIntents,
  });

  const { data: syncStatus, isLoading: syncStatusLoading } = useQuery({
    queryKey: ['rules', 'sync', 'status'],
    queryFn: fetchSyncStatus,
  });

  // Mutations
  const syncMutation = useMutation({
    mutationFn: syncFromOfficial,
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: ['rules'] });
      toast({
        title: 'Sync complete',
        description: result.message,
      });
    },
    onError: (error: Error) => {
      toast({ title: 'Sync failed', description: error.message, variant: 'destructive' });
    },
  });

  // Group rules by category
  const rulesByCategory = rulesData?.rules.reduce((acc, rule) => {
    const category = rule.category || 'general';
    if (!acc[category]) acc[category] = [];
    acc[category].push(rule);
    return acc;
  }, {} as Record<string, SecurityRule[]>) || {};

  return (
    <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-4">
        <TabsList className="w-full sm:w-auto">
          <TabsTrigger value="security" className="flex items-center gap-2">
            <Shield className="h-4 w-4" />
            Security Rules {stats ? `(${stats.securityRules})` : ''}
          </TabsTrigger>
          <TabsTrigger value="tests" className="flex items-center gap-2">
            <TestTube className="h-4 w-4" />
            Tests {stats ? `(${stats.testDefinitions})` : ''}
          </TabsTrigger>
          <TabsTrigger value="intents" className="flex items-center gap-2">
            <Target className="h-4 w-4" />
            Intents {stats ? `(${stats.intentEvaluations})` : ''}
          </TabsTrigger>
          <TabsTrigger value="github" className="flex items-center gap-2">
            <Github className="h-4 w-4" />
            GitHub Sync
          </TabsTrigger>
        </TabsList>

        {/* Security Rules Tab */}
        <TabsContent value="security" className="space-y-4">
          {rulesLoading ? (
            <Card>
              <CardContent className="py-8 text-center text-muted-foreground">
                Loading security rules...
              </CardContent>
            </Card>
          ) : (
            <>
              {/* Severity Summary */}
              {rulesData && (
                <div className="flex flex-wrap items-center gap-3 p-3 rounded-lg border bg-card">
                  <span className="text-sm text-muted-foreground">Severity:</span>
                  {SEVERITY_LEVELS.map((severity) => {
                    const count = rulesData.rules.filter(r => r.severity === severity).length;
                    if (count === 0) return null;
                    return (
                      <div key={severity} className="flex items-center gap-1.5">
                        <Badge className={severityColors[severity]}>{severity}</Badge>
                        <span className="text-sm font-medium">{count}</span>
                      </div>
                    );
                  })}
                </div>
              )}
              {Object.entries(rulesByCategory).map(([category, rules]) => (
              <Collapsible key={category} defaultOpen>
                <Card>
                  <CollapsibleTrigger className="w-full">
                    <CardHeader className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                      <div className="flex items-center gap-2">
                        {categoryIcons[category] || <FileText className="h-4 w-4" />}
                        <CardTitle className="text-lg capitalize">{category.replace('_', ' ')}</CardTitle>
                        <Badge variant="secondary">{rules.length} rules</Badge>
                      </div>
                      <ChevronDown className="h-4 w-4" />
                    </CardHeader>
                  </CollapsibleTrigger>
                  <CollapsibleContent>
                    <CardContent className="pt-0">
                      <div className="space-y-2">
                        {rules.map((rule) => (
                          <div
                            key={rule.id}
                            className="flex items-start p-3 rounded-lg border bg-card"
                          >
                            <div className="space-y-1">
                              <div className="flex items-center gap-2">
                                <Badge className={severityColors[rule.severity]}>
                                  {rule.severity}
                                </Badge>
                                <span className="font-medium">{rule.name}</span>
                                <span className="text-xs text-muted-foreground">({rule.id})</span>
                              </div>
                              <p className="text-sm text-muted-foreground line-clamp-2">
                                {rule.description}
                              </p>
                              {rule.metadata?.tags && rule.metadata.tags.length > 0 && (
                                <div className="flex gap-1">
                                  {rule.metadata.tags.slice(0, 5).map((tag) => (
                                    <Badge key={tag} variant="outline" className="text-xs">
                                      {tag}
                                    </Badge>
                                  ))}
                                </div>
                              )}
                            </div>
                          </div>
                        ))}
                      </div>
                    </CardContent>
                  </CollapsibleContent>
                </Card>
              </Collapsible>
            ))}
            </>
          )}
        </TabsContent>

        {/* Tests Tab */}
        <TabsContent value="tests" className="space-y-4">
          {testsLoading ? (
            <Card>
              <CardContent className="py-8 text-center text-muted-foreground">
                Loading test definitions...
              </CardContent>
            </Card>
          ) : (
            <Card>
              <CardHeader>
                <CardTitle>Test Definitions</CardTitle>
                <CardDescription>
                  Tests that can be executed on ESP32 devices or the server
                </CardDescription>
              </CardHeader>
              <CardContent>
                <div className="space-y-2">
                  {testsData?.tests.map((test) => (
                    <div
                      key={test.id}
                      className="flex items-start p-3 rounded-lg border bg-card"
                    >
                      <div className="space-y-1">
                        <div className="flex items-center gap-2">
                          <TestTube className="h-4 w-4" />
                          <span className="font-medium">{test.name}</span>
                          <span className="text-xs text-muted-foreground">({test.id})</span>
                          <Badge variant="outline">{test.target}</Badge>
                          {test.isDynamic && <Badge variant="secondary">Dynamic</Badge>}
                          {test.isMeshTest && <Badge variant="secondary">Mesh</Badge>}
                        </div>
                        <p className="text-sm text-muted-foreground line-clamp-2">
                          {test.description}
                        </p>
                      </div>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}
        </TabsContent>

        {/* Intents Tab */}
        <TabsContent value="intents" className="space-y-4">
          {intentsLoading ? (
            <Card>
              <CardContent className="py-8 text-center text-muted-foreground">
                Loading intent evaluations...
              </CardContent>
            </Card>
          ) : (
            <Card>
              <CardHeader>
                <CardTitle>Intent Evaluations</CardTitle>
                <CardDescription>
                  Evaluations that check if network config matches user intent
                </CardDescription>
              </CardHeader>
              <CardContent>
                <div className="space-y-2">
                  {intentsData?.evaluations.map((intent) => (
                    <div
                      key={intent.id}
                      className="flex items-start p-3 rounded-lg border bg-card"
                    >
                      <div className="space-y-1">
                        <div className="flex items-center gap-2">
                          <Target className="h-4 w-4" />
                          <span className="font-medium">{intent.name}</span>
                          <Badge variant="outline">Priority: {intent.priority}</Badge>
                          <Badge variant="secondary">{intent.intentSetting}</Badge>
                        </div>
                        <p className="text-sm text-muted-foreground line-clamp-2">
                          {intent.description}
                        </p>
                      </div>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}
        </TabsContent>

        {/* GitHub Sync Tab */}
        <TabsContent value="github" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Official Rules Repository</CardTitle>
              <CardDescription>
                Sync rules, tests, and intent definitions from the official ZeroProof repository
              </CardDescription>
            </CardHeader>
            <CardContent>
              {syncStatusLoading ? (
                <div className="py-8 text-center text-muted-foreground">
                  Loading sync status...
                </div>
              ) : (
                <div className="space-y-6">
                  {/* Official repo info */}
                  <div className="p-4 rounded-lg border bg-card space-y-3">
                    <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                      <div className="flex items-center gap-2">
                        <Github className="h-5 w-5" />
                        <span className="font-semibold">ZeroProof Official Rules</span>
                        <Badge variant="outline">Official</Badge>
                      </div>
                      <Button
                        onClick={() => syncMutation.mutate()}
                        disabled={syncMutation.isPending}
                      >
                        <RefreshCw className={cn('h-4 w-4 mr-2', syncMutation.isPending && 'animate-spin')} />
                        {syncMutation.isPending ? 'Syncing...' : 'Sync Now'}
                      </Button>
                    </div>

                    {syncStatus?.official && (
                      <div className="flex flex-wrap items-center gap-2 sm:gap-4 text-sm text-muted-foreground">
                        <a
                          href={syncStatus.official.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="flex items-center gap-1 hover:text-foreground"
                        >
                          <ExternalLink className="h-3 w-3" />
                          {syncStatus.official.owner}/{syncStatus.official.repo}
                        </a>
                        <span>Branch: {syncStatus.official.branch}</span>
                      </div>
                    )}

                    {/* Last sync info */}
                    {syncStatus?.lastSync && (
                      <div className="pt-3 border-t space-y-2">
                        <div className="flex items-center gap-2">
                          {syncStatus.lastSync.success ? (
                            <Badge variant="outline" className="text-green-600">
                              <Check className="h-3 w-3 mr-1" />
                              Last sync successful
                            </Badge>
                          ) : (
                            <Badge variant="destructive">
                              <X className="h-3 w-3 mr-1" />
                              Last sync failed
                            </Badge>
                          )}
                          <span className="text-xs text-muted-foreground flex items-center gap-1">
                            <Clock className="h-3 w-3" />
                            {formatDate(syncStatus.lastSync.timestamp)}
                          </span>
                        </div>
                        <div className="flex items-center gap-4 text-xs text-muted-foreground">
                          <span>{syncStatus.lastSync.filesDownloaded} new</span>
                          <span>{syncStatus.lastSync.filesUpdated} updated</span>
                          <span>{syncStatus.lastSync.filesSkipped} unchanged</span>
                        </div>
                        {syncStatus.lastSync.errors.length > 0 && (
                          <div className="text-sm text-destructive">
                            {syncStatus.lastSync.errors.map((err, i) => (
                              <p key={i}>{err}</p>
                            ))}
                          </div>
                        )}
                      </div>
                    )}

                    {!syncStatus?.lastSync && (
                      <p className="text-sm text-muted-foreground pt-3 border-t">
                        No sync performed yet. Click "Sync Now" to download the latest rules.
                      </p>
                    )}
                  </div>

                  {/* Info about contributing */}
                  <div className="p-4 rounded-lg bg-muted/50 space-y-2">
                    <h4 className="font-medium flex items-center gap-2">
                      <Info className="h-4 w-4" />
                      Contributing Rules
                    </h4>
                    <p className="text-sm text-muted-foreground">
                      Want to contribute security rules, tests, or intent definitions?
                      Submit a pull request to the official ZeroProof repository on GitHub.
                    </p>
                    {syncStatus?.official && (
                      <a
                        href={`${syncStatus.official.url}/tree/${syncStatus.official.branch}/rules`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-sm text-primary hover:underline flex items-center gap-1"
                      >
                        <ExternalLink className="h-3 w-3" />
                        View rules on GitHub
                      </a>
                    )}
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
  );
}

export default function RulesPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl sm:text-3xl font-bold">Rules & Definitions</h1>
        <p className="text-muted-foreground">
          Manage security rules, test definitions, and intent evaluations
        </p>
      </div>
      <RulesContent />
    </div>
  );
}

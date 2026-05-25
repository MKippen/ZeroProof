import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import {
  Shield,
  Activity,
  Clock,
  Wand2,
  CheckCircle2,
  Target,
  ArrowRight,
  ShieldCheck,
  ShieldAlert,
  Settings,
  Scan,
  History,
  AlertTriangle,
  Radar,
} from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import api from '@/api/client';
import { TimelineHistogram } from '@/components/charts/TimelineHistogram';
import { DashboardUpdateBanner } from '@/components/DashboardUpdateBanner';
import { FirstRunChecklist } from '@/components/FirstRunChecklist';
import type {
  ConfigRequirement,
  DashboardData,
  DetectionSummary,
  TimelineHistogramEntry,
} from '@/types';
import { formatDate, getScoreColor, cn } from '@/lib/utils';
import { SEVERITY_BADGE_VARIANT } from '@/config/security';
import { POLL_INTERVALS } from '@/config/polling';

export function DashboardPage() {
  const { data, isLoading } = useQuery({
    queryKey: ['dashboard'],
    queryFn: async () => {
      const response = await api.get<DashboardData>('/dashboard');
      if (response.success && response.data) {
        return response.data;
      }
      throw new Error(response.error?.message || 'Failed to fetch dashboard');
    },
    refetchInterval: POLL_INTERVALS.dashboard,
    staleTime: 0,
    refetchOnMount: 'always',
  });

  const { data: histogramData } = useQuery({
    queryKey: ['timeline-histogram'],
    queryFn: async () => {
      const response = await api.get<TimelineHistogramEntry[]>('/timeline/histogram?days=0');
      if (response.success && response.data) return response.data;
      return [];
    },
    refetchInterval: POLL_INTERVALS.dashboardHistogram,
  });

  // Detection engine summary — the live-feed counterpart to the static
  // security score below. Surfaces only when something is actually firing so
  // the dashboard stays calm when the network is healthy.
  const { data: detectionSummary } = useQuery({
    queryKey: ['dashboard', 'detections-summary'],
    queryFn: async () => {
      const response = await api.get<DetectionSummary>('/detections/analytics?hours=24');
      if (response.success && response.data) return response.data;
      return null;
    },
    refetchInterval: POLL_INTERVALS.dashboard,
  });

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
      </div>
    );
  }

  const dashboard = data;
  const hasConfig = dashboard?.hasConfig;
  const hasIntentProfile = dashboard?.hasIntentProfile;

  // Calculate unified metrics - only count config issues + vulnerabilities (not intent gaps)
  // Intent gaps are shown separately on the Intent page
  // Use securityAnalysis.failed for rule count (not fromSecurityAnalysis which counts findings)
  const configIssues = dashboard?.securityAnalysis?.failed || 0;
  // Use fromVulnerabilities for actual count (recentVulnerabilities is limited to 5)
  const vulnIssues = dashboard?.vulnerabilities.fromVulnerabilities || 0;
  const securityIssues = configIssues + vulnIssues;

  // Count critical/high - prefer failed-by-severity (failed rules)
  const failedBySeverity = dashboard?.securityAnalysis?.failedBySeverity;
  const criticalHighFromAnalysis = failedBySeverity
    ? (failedBySeverity.CRITICAL || 0) + (failedBySeverity.HIGH || 0)
    : (dashboard?.securityAnalysis?.topIssues?.filter(
        i => i.severity === 'CRITICAL' || i.severity === 'HIGH'
      ).length || 0);
  // For vulnerabilities, use the breakdown counts (not recentVulnerabilities which is limited)
  const criticalHighFromVulns = (dashboard?.scoreBreakdown?.vulnerabilities?.CRITICAL || 0) +
                                 (dashboard?.scoreBreakdown?.vulnerabilities?.HIGH || 0);
  const criticalHighIssues = criticalHighFromAnalysis + criticalHighFromVulns;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl sm:text-3xl font-bold">Dashboard</h1>
        <p className="text-muted-foreground">Overview of your network security status</p>
      </div>

      <DashboardUpdateBanner />

      {/* First-run checklist — hides itself once UniFi + Intent are set up */}
      <FirstRunChecklist />

      {/* Live detections — only surfaces when there are open findings */}
      {detectionSummary && detectionSummary.open > 0 && (
        <Card className="border-red-500/30 bg-gradient-to-r from-red-500/5 to-transparent">
          <CardContent className="pt-6">
            <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
              <div className="flex items-start gap-4">
                <div className="rounded-lg bg-red-500/20 p-3">
                  <Radar className="h-6 w-6 text-red-400" />
                </div>
                <div>
                  <h3 className="text-lg font-semibold">
                    {detectionSummary.open} open detection
                    {detectionSummary.open === 1 ? '' : 's'}
                  </h3>
                  <p className="mt-1 text-sm text-muted-foreground">
                    {(detectionSummary.bySeverity.find((s) => s.severity === 'CRITICAL')?.count ?? 0)} critical,{' '}
                    {(detectionSummary.bySeverity.find((s) => s.severity === 'HIGH')?.count ?? 0)} high
                    {detectionSummary.topAffected.length > 0 && (
                      <>
                        {' '}· top affected: <span className="font-medium">{detectionSummary.topAffected[0]?.resource}</span>
                      </>
                    )}
                  </p>
                </div>
              </div>
              <Button asChild>
                <Link to="/detections">
                  Review detections
                  <ArrowRight className="ml-2 h-4 w-4" />
                </Link>
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Setup Prompts */}
      {!hasConfig && (
        <Card className="border-blue-500/30 bg-gradient-to-r from-blue-500/5 to-transparent">
          <CardContent className="pt-6">
            <div className="flex items-start gap-4">
              <div className="p-3 rounded-lg bg-blue-500/20">
                <Shield className="h-6 w-6 text-blue-400" />
              </div>
              <div className="flex-1">
                <h3 className="font-semibold text-lg">Import UniFi Configuration</h3>
                <p className="text-sm text-muted-foreground mt-1">
                  Import or sync your UniFi configuration to enable security analysis.
                </p>
                <Button asChild className="mt-4">
                  <Link to="/config">
                    Go to Configuration
                    <ArrowRight className="ml-2 h-4 w-4" />
                  </Link>
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {hasConfig && !hasIntentProfile && (
        <Card className="border-orange-500/30 bg-gradient-to-r from-orange-500/5 to-transparent">
          <CardContent className="pt-6">
            <div className="flex items-start gap-4">
              <div className="p-3 rounded-lg bg-orange-500/20">
                <Wand2 className="h-6 w-6 text-orange-400" />
              </div>
              <div className="flex-1">
                <h3 className="font-semibold text-lg">Define Your Network Goals</h3>
                <p className="text-sm text-muted-foreground mt-1">
                  Use the Security Wizard to tell us what you want from your network.
                  We&apos;ll compare your goals against your actual configuration.
                </p>
                <Button asChild className="mt-4">
                  <Link to="/wizard">
                    Start Security Wizard
                    <ArrowRight className="ml-2 h-4 w-4" />
                  </Link>
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Configuration Requirements Banner */}
      {dashboard?.intentCompliance?.configRequirements && dashboard.intentCompliance.configRequirements.length > 0 && (
        <Card className="border-amber-500/30 bg-gradient-to-r from-amber-500/5 to-transparent">
          <CardContent className="pt-6">
            <div className="flex items-start gap-4">
              <div className="p-3 rounded-lg bg-amber-500/20">
                <AlertTriangle className="h-6 w-6 text-amber-400" />
              </div>
              <div className="flex-1">
                <h3 className="font-semibold text-lg">Configuration Incomplete</h3>
                <p className="text-sm text-muted-foreground mt-1">
                  {dashboard.intentCompliance.configRequirements.length} network mapping{dashboard.intentCompliance.configRequirements.length !== 1 ? 's' : ''} needed for accurate analysis. Your compliance score may be lower than expected.
                </p>
                <ul className="mt-2 space-y-1">
                  {dashboard.intentCompliance.configRequirements.slice(0, 3).map((req: ConfigRequirement) => (
                    <li key={req.id} className="text-sm text-muted-foreground flex items-center gap-2">
                      <span className="h-1.5 w-1.5 rounded-full bg-amber-400 flex-shrink-0" />
                      {req.message}
                    </li>
                  ))}
                </ul>
                <Button asChild className="mt-4" variant="outline">
                  <Link to="/intent">
                    Map Networks
                    <ArrowRight className="ml-2 h-4 w-4" />
                  </Link>
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Main Security Score */}
      <Card>
        <CardHeader className="pb-2">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <CardTitle className="text-lg flex items-center gap-2">
                <Shield className="h-5 w-5" />
                Security Score
              </CardTitle>
              <CardDescription>Combined score from config analysis, scans, and intent compliance</CardDescription>
            </div>
            <Button variant="outline" size="sm" asChild>
              <Link to="/security">View Details</Link>
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          {dashboard?.securityScore == null ? (
            <div className="flex flex-col items-start gap-3 py-2">
              <div className="text-5xl sm:text-6xl font-bold text-muted-foreground/60">—</div>
              <p className="text-sm text-muted-foreground">
                Not analyzed yet. Connect your UniFi Controller and run a sync to generate a security score.
              </p>
              <Button asChild size="sm" className="bg-orange-600 hover:bg-orange-500">
                <Link to="/config">Get Started</Link>
              </Button>
            </div>
          ) : (
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:gap-6">
            <div className={cn('text-5xl sm:text-6xl font-bold', getScoreColor(dashboard.securityScore))}>
              {dashboard.securityScore}
            </div>
            <div className="flex-1 space-y-3">
              <Progress value={dashboard.securityScore} className="h-3" />
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-sm">
                {dashboard?.scoreBreakdown?.analysisPassRate !== null && (
                  <div className="flex items-center gap-2">
                    <ShieldCheck className="h-4 w-4 text-blue-500" />
                    <span className="text-muted-foreground">Rules:</span>
                    <span className="font-medium">{dashboard?.scoreBreakdown?.analysisPassRate}% pass</span>
                  </div>
                )}
                {dashboard?.scoreBreakdown?.intentCompliance !== null && (
                  <div className="flex items-center gap-2">
                    <Target className="h-4 w-4 text-orange-500" />
                    <span className="text-muted-foreground">Intent:</span>
                    <span className="font-medium">{dashboard?.scoreBreakdown?.intentCompliance}% match</span>
                  </div>
                )}
                <div className="flex items-center gap-2">
                  <ShieldAlert className={cn('h-4 w-4', securityIssues === 0 ? 'text-green-500' : 'text-orange-500')} />
                  <span className="text-muted-foreground">Issues:</span>
                  <span className={cn('font-medium', securityIssues === 0 ? 'text-green-500' : securityIssues > 5 ? 'text-red-500' : '')}>
                    {securityIssues}
                  </span>
                </div>
              </div>
            </div>
          </div>
          )}
        </CardContent>
      </Card>

      {/* Two-column layout for Security Issues and Intent Compliance */}
      <div className="grid gap-4 lg:grid-cols-2">
        {/* Security Issues Card (Unified) */}
        <Card>
          <CardHeader className="pb-2">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex items-center gap-2">
                <ShieldAlert className="h-5 w-5 text-orange-500" />
                <CardTitle className="text-lg">Security Issues</CardTitle>
              </div>
              <Button variant="outline" size="sm" asChild>
                <Link to="/security">View All</Link>
              </Button>
            </div>
            <CardDescription>Config analysis and vulnerability scan findings</CardDescription>
          </CardHeader>
          <CardContent>
            {dashboard?.securityAnalysis || (dashboard?.recentVulnerabilities && dashboard.recentVulnerabilities.length > 0) ? (
              <div className="space-y-4">
                {/* Issue counts */}
                <div className="flex flex-wrap items-center gap-3">
                  <div className={cn('text-2xl font-bold', securityIssues === 0 ? 'text-green-500' : 'text-orange-500')}>
                    {securityIssues}
                  </div>
                  <span className="text-sm text-muted-foreground">open issues</span>
                  {criticalHighIssues > 0 && (
                    <Badge variant="destructive" className="ml-auto">
                      {criticalHighIssues} critical/high
                    </Badge>
                  )}
                </div>

                {/* Source breakdown */}
                <div className="flex flex-wrap gap-4 text-xs">
                  <div className="flex items-center gap-1">
                    <Settings className="h-3 w-3 text-blue-400" />
                    <span className="text-muted-foreground">Config:</span>
                    <span className="font-medium">{configIssues}</span>
                  </div>
                  <div className="flex items-center gap-1">
                    <Scan className="h-3 w-3 text-purple-400" />
                    <span className="text-muted-foreground">Scans:</span>
                    <span className="font-medium">{vulnIssues}</span>
                  </div>
                </div>

                {/* Top Issues - combine config issues and vulnerabilities */}
                {((dashboard?.securityAnalysis?.topIssues?.length ?? 0) > 0 || (dashboard?.recentVulnerabilities?.length ?? 0) > 0) && (
                  <div className="space-y-2">
                    <p className="text-sm font-medium text-muted-foreground">Top Issues:</p>
                    {/* Show config issues */}
                    {dashboard?.securityAnalysis?.topIssues.slice(0, 2).map((issue) => (
                      <div
                        key={issue.ruleId}
                        className="flex items-start gap-2 p-2 rounded-lg bg-muted/50 text-sm"
                      >
                        <Badge
                          variant={SEVERITY_BADGE_VARIANT[issue.severity]}
                          className="mt-0.5"
                        >
                          {issue.severity}
                        </Badge>
                        <span className="text-muted-foreground flex-1">{issue.ruleName}</span>
                        <Badge variant="outline" className="text-xs bg-blue-500/10 text-blue-400 border-blue-500/30">
                          Config
                        </Badge>
                      </div>
                    ))}
                    {/* Show vulnerabilities */}
                    {dashboard?.recentVulnerabilities?.slice(0, 2 - (dashboard?.securityAnalysis?.topIssues?.length || 0)).map((vuln) => (
                      <div
                        key={vuln.id}
                        className="flex items-start gap-2 p-2 rounded-lg bg-muted/50 text-sm"
                      >
                        <Badge
                          variant={SEVERITY_BADGE_VARIANT[vuln.severity]}
                          className="mt-0.5"
                        >
                          {vuln.severity}
                        </Badge>
                        <span className="text-muted-foreground flex-1">{vuln.title}</span>
                        <Badge variant="outline" className="text-xs bg-purple-500/10 text-purple-400 border-purple-500/30">
                          Scan
                        </Badge>
                      </div>
                    ))}
                  </div>
                )}

                {securityIssues === 0 && (
                  <div className="text-center py-4 text-green-500">
                    <CheckCircle2 className="h-8 w-8 mx-auto mb-2" />
                    <p className="text-sm font-medium">No security issues found!</p>
                  </div>
                )}
              </div>
            ) : (
              <div className="text-center py-4 text-muted-foreground">
                <p className="text-sm">Import a UniFi configuration to run analysis</p>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Intent Compliance Card */}
        <Card>
          <CardHeader className="pb-2">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex items-center gap-2">
                <Target className="h-5 w-5 text-orange-400" />
                <CardTitle className="text-lg">Intent Compliance</CardTitle>
              </div>
              <Button variant="outline" size="sm" asChild>
                <Link to="/intent">View Details</Link>
              </Button>
            </div>
            <CardDescription>How well config matches your goals</CardDescription>
          </CardHeader>
          <CardContent>
            {dashboard?.intentCompliance ? (
              <div className="space-y-4">
                <div className="flex flex-wrap items-center gap-3">
                  <div
                    className={cn(
                      'text-2xl font-bold',
                      dashboard.intentCompliance.score >= 80
                        ? 'text-green-500'
                        : dashboard.intentCompliance.score >= 60
                        ? 'text-yellow-500'
                        : dashboard.intentCompliance.score >= 40
                        ? 'text-orange-500'
                        : 'text-red-500'
                    )}
                  >
                    {dashboard.intentCompliance.score}%
                  </div>
                  <Progress value={dashboard.intentCompliance.score} className="flex-1 h-2" />
                  {dashboard.intentCompliance.compliant ? (
                    <div className="flex items-center gap-1 text-green-500">
                      <CheckCircle2 className="h-4 w-4" />
                      <span className="text-sm font-medium">Compliant</span>
                    </div>
                  ) : (
                    <span className="text-sm text-muted-foreground">
                      {dashboard.intentCompliance.gapCount} gap{dashboard.intentCompliance.gapCount !== 1 ? 's' : ''}
                    </span>
                  )}
                </div>

                {dashboard.intentCompliance.topGaps.length > 0 && (
                  <div className="space-y-2">
                    <p className="text-sm font-medium text-muted-foreground">Top Gaps:</p>
                    {dashboard.intentCompliance.topGaps.map((gap, index) => (
                      <div
                        key={index}
                        className="flex items-start gap-2 p-2 rounded-lg bg-muted/50 text-sm"
                      >
                        <Badge
                          variant={SEVERITY_BADGE_VARIANT[gap.severity]}
                          className="mt-0.5"
                        >
                          {gap.severity}
                        </Badge>
                        <span className="text-muted-foreground">{gap.description}</span>
                      </div>
                    ))}
                  </div>
                )}

                {dashboard.intentCompliance.topGaps.length === 0 && dashboard.intentCompliance.compliant && (
                  <div className="text-center py-4 text-green-500">
                    <CheckCircle2 className="h-8 w-8 mx-auto mb-2" />
                    <p className="text-sm font-medium">Config matches your intent!</p>
                  </div>
                )}
              </div>
            ) : hasConfig ? (
              <div className="text-center py-4">
                <Wand2 className="h-8 w-8 mx-auto mb-2 text-orange-400 opacity-50" />
                <p className="text-sm text-muted-foreground mb-3">Define your network goals</p>
                <Button size="sm" variant="outline" asChild>
                  <Link to="/wizard">
                    Start Wizard
                    <ArrowRight className="ml-1 h-3 w-3" />
                  </Link>
                </Button>
              </div>
            ) : (
              <div className="text-center py-4 text-muted-foreground">
                <p className="text-sm">Import a configuration first</p>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Network Activity Histogram */}
      {histogramData && histogramData.length > 0 && histogramData.some(d => d.total > 0) && (
        <Card>
          <CardHeader className="pb-2">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex items-center gap-2">
                <History className="h-5 w-5 text-orange-400" />
                <CardTitle className="text-lg">Network Activity</CardTitle>
              </div>
              <Button variant="outline" size="sm" asChild>
                <Link to="/timeline">View Timeline</Link>
              </Button>
            </div>
            <CardDescription>Recent changes detected across your network</CardDescription>
          </CardHeader>
          <CardContent>
            <TimelineHistogram data={histogramData} height={300} showBrush defaultBrushDays={12} />
          </CardContent>
        </Card>
      )}

      {/* Recent Activity */}
      <div className="grid gap-4 lg:grid-cols-2">
        {/* Recent Tests */}
        <Card>
          <CardHeader>
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <CardTitle className="flex items-center gap-2">
                <Activity className="h-5 w-5" />
                Recent Tests
              </CardTitle>
              <Button variant="outline" size="sm" asChild>
                <Link to="/devices?tab=tests">View All</Link>
              </Button>
            </div>
          </CardHeader>
          <CardContent>
            {dashboard?.recentTests && dashboard.recentTests.length > 0 ? (
              <div className="space-y-3">
                {dashboard.recentTests.map((test) => (
                  <div
                    key={test.id}
                    className="flex items-center gap-3 p-3 rounded-lg bg-muted/50"
                  >
                    <Badge
                      variant={
                        test.status === 'COMPLETED'
                          ? 'success'
                          : test.status === 'FAILED'
                          ? 'destructive'
                          : test.status === 'RUNNING'
                          ? 'default'
                          : 'secondary'
                      }
                    >
                      {test.status}
                    </Badge>
                    <div className="flex-1 min-w-0">
                      <p className="font-medium truncate">{test.testType.replace('_', ' ')}</p>
                      <p className="text-xs text-muted-foreground">
                        {test.device?.name || 'Unknown device'}
                      </p>
                    </div>
                    <div className="text-xs text-muted-foreground">
                      {formatDate(test.startedAt)}
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="text-center py-8 text-muted-foreground">
                <Clock className="h-12 w-12 mx-auto mb-2 opacity-50" />
                <p>No tests run yet</p>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Last Analysis Info */}
      {(dashboard?.lastTestRun || dashboard?.securityAnalysis) && (
        <Card>
          <CardContent className="pt-6">
            <div className="flex flex-wrap items-center gap-3 text-sm text-muted-foreground">
              <Clock className="h-4 w-4" />
              <div className="flex flex-wrap gap-2 sm:gap-4">
                {dashboard?.lastTestRun && (
                  <span>Last security test: {formatDate(dashboard.lastTestRun)}</span>
                )}
                {dashboard?.securityAnalysis && (
                  <span>•</span>
                )}
                {dashboard?.securityAnalysis && (
                  <span>{dashboard.securityAnalysis.totalRules} rules checked</span>
                )}
              </div>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

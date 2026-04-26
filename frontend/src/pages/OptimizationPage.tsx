import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  Zap,
  RefreshCw,
  ChevronDown,
  ChevronRight,
  CheckCircle2,
  Lightbulb,
  Wifi,
  Network,
  Settings2,
} from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { cn } from '@/lib/utils';
import api from '@/api/client';
import type { SecurityAnalysisResult, RuleEvaluationResult } from '@/types';

async function fetchOptimizationAnalysis(): Promise<SecurityAnalysisResult> {
  const response = await api.get<SecurityAnalysisResult>('/security/optimization');
  if (!response.success || !response.data) {
    throw new Error(response.error?.message || 'Failed to fetch optimization analysis');
  }
  return response.data;
}

const categoryConfig: Record<string, { icon: typeof Wifi; label: string; color: string }> = {
  optimization: { icon: Zap, label: 'Optimization', color: 'text-purple-500' },
  wireless: { icon: Wifi, label: 'WiFi', color: 'text-blue-500' },
  vlan: { icon: Network, label: 'Network', color: 'text-green-500' },
  general: { icon: Settings2, label: 'General', color: 'text-gray-500' },
};

function OptimizationCard({
  result,
  isExpanded,
  onToggle,
}: {
  result: RuleEvaluationResult;
  isExpanded: boolean;
  onToggle: () => void;
}) {
  const config = categoryConfig[result.category] || categoryConfig.general;
  const Icon = config.icon;

  return (
    <Card className="border-l-4 border-l-purple-500/50">
      <div
        className="p-4 cursor-pointer hover:bg-muted/50 transition-colors"
        onClick={onToggle}
      >
        <div className="flex items-start gap-3">
          <Lightbulb className="h-5 w-5 mt-0.5 text-purple-400" />
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <h3 className="font-medium">{result.ruleName}</h3>
              <Badge variant="outline" className="text-xs bg-purple-500/10 text-purple-400 border-purple-500/30">
                <Icon className="h-3 w-3 mr-1" />
                {config.label}
              </Badge>
            </div>
            <p className="text-sm text-muted-foreground mt-1">{result.ruleDescription}</p>
            {result.findings.length > 0 && (
              <p className="text-xs text-purple-400 mt-1">
                {result.findings.length} recommendation{result.findings.length > 1 ? 's' : ''}
              </p>
            )}
          </div>
          <div className="flex items-center gap-2">
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
            {result.findings.map((finding, idx) => (
              <div key={idx} className="p-3 rounded-lg bg-background/50 space-y-2">
                {finding.affectedResource && (
                  <p className="text-xs text-muted-foreground">
                    <span className="font-medium">Affected:</span> {finding.affectedResource}
                  </p>
                )}
                {finding.currentValue && (
                  <p className="text-xs">
                    <span className="text-yellow-400">Current:</span> {finding.currentValue}
                    {finding.expectedValue && (
                      <>
                        {' | '}
                        <span className="text-green-400">Recommended:</span> {finding.expectedValue}
                      </>
                    )}
                  </p>
                )}
                {finding.impact && (
                  <p className="text-xs text-muted-foreground">
                    <span className="font-medium">Why:</span> {finding.impact}
                  </p>
                )}
                {finding.remediation && (
                  <p className="text-xs text-purple-400">
                    <span className="font-medium">How to fix:</span> {finding.remediation}
                  </p>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </Card>
  );
}

function PassedChecksSection({ results }: { results: RuleEvaluationResult[] }) {
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
                    {passedResults.length} Best Practices Already Configured
                  </CardTitle>
                  <CardDescription className="text-xs">
                    Your configuration follows these recommendations
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
                    <p className="text-xs text-muted-foreground truncate">{result.ruleDescription}</p>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </CollapsibleContent>
      </Card>
    </Collapsible>
  );
}

export function OptimizationPage() {
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const { data: analysis, isLoading, error, refetch } = useQuery({
    queryKey: ['optimization-analysis'],
    queryFn: fetchOptimizationAnalysis,
  });

  if (isLoading) {
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
            <Zap className="h-12 w-12 mx-auto mb-2" />
            <p>{(error as Error).message}</p>
            <Button onClick={() => refetch()} className="mt-4">
              Retry
            </Button>
          </div>
        </CardContent>
      </Card>
    );
  }

  const failedResults = analysis?.results.filter(r => !r.passed) || [];
  const totalRecommendations = failedResults.reduce((sum, r) => sum + r.findings.length, 0);
  const passRate = analysis ? (analysis.summary.passed / analysis.summary.totalRules) * 100 : 100;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Zap className="h-6 w-6 text-purple-500" />
            Optimization
          </h1>
          <p className="text-muted-foreground">
            Best practice recommendations to improve your network performance
          </p>
        </div>
        <Button variant="outline" onClick={() => refetch()}>
          <RefreshCw className="h-4 w-4 mr-2" />
          Refresh
        </Button>
      </div>

      {/* Info Banner */}
      <Card className="bg-gradient-to-r from-purple-500/5 to-blue-500/5 border-purple-500/20">
        <CardContent className="py-3">
          <div className="flex items-center gap-3">
            <Lightbulb className="h-5 w-5 text-purple-400" />
            <p className="text-sm text-muted-foreground">
              These are optional recommendations to optimize your network. They don't affect your security score.
            </p>
          </div>
        </CardContent>
      </Card>

      {/* Summary Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-muted-foreground">Configuration Score</p>
                <p className="text-2xl font-bold">{passRate.toFixed(0)}%</p>
              </div>
              <Zap className={cn('h-10 w-10', passRate >= 80 ? 'text-green-500' : passRate >= 50 ? 'text-yellow-500' : 'text-purple-500')} />
            </div>
            <Progress value={passRate} className="mt-3" />
          </CardContent>
        </Card>

        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-muted-foreground">Recommendations</p>
                <p className="text-2xl font-bold">{totalRecommendations}</p>
              </div>
              <Lightbulb className={cn('h-10 w-10', totalRecommendations === 0 ? 'text-green-500' : 'text-purple-500')} />
            </div>
            <p className="text-xs text-muted-foreground mt-2">
              {failedResults.length} checks with suggestions
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-muted-foreground">Checks Passed</p>
                <p className="text-2xl font-bold text-green-500">{analysis?.summary.passed || 0}</p>
              </div>
              <CheckCircle2 className="h-10 w-10 text-green-500" />
            </div>
            <p className="text-xs text-muted-foreground mt-2">
              of {analysis?.summary.totalRules || 0} total checks
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Recommendations List */}
      {failedResults.length > 0 ? (
        <div className="space-y-3">
          <h2 className="text-lg font-semibold flex items-center gap-2">
            <Lightbulb className="h-5 w-5 text-purple-400" />
            Recommendations
          </h2>
          {failedResults.map((result) => (
            <OptimizationCard
              key={result.ruleId}
              result={result}
              isExpanded={expandedId === result.ruleId}
              onToggle={() => setExpandedId(expandedId === result.ruleId ? null : result.ruleId)}
            />
          ))}
        </div>
      ) : (
        <Card className="border-green-500/30 bg-green-500/5">
          <CardContent className="py-8 text-center">
            <CheckCircle2 className="h-12 w-12 mx-auto mb-2 text-green-500" />
            <h3 className="text-lg font-medium text-green-500">All Optimizations Applied</h3>
            <p className="text-muted-foreground">
              Your network configuration follows all recommended best practices!
            </p>
          </CardContent>
        </Card>
      )}

      {/* Passed Checks Section */}
      {analysis?.results && <PassedChecksSection results={analysis.results} />}
    </div>
  );
}

export default OptimizationPage;

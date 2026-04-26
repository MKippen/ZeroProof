import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Shield, Filter, ChevronDown, ChevronUp, ExternalLink, EyeOff, Eye, MessageSquare } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Textarea } from '@/components/ui/textarea';
import api from '@/api/client';
import type { Vulnerability, Severity, VulnStatus } from '@/types';
import { formatDate, cn } from '@/lib/utils';
import { useToast } from '@/hooks/useToast';
import {
  SEVERITY_BADGE_VARIANT,
  SEVERITY_LEVELS,
  VULNERABILITY_STATUS_CLASS,
  VULNERABILITY_STATUS_OPTIONS,
} from '@/config/security';

export function VulnerabilitiesPage() {
  const [severityFilter, setSeverityFilter] = useState<Severity | ''>('');
  const [statusFilter, setStatusFilter] = useState<VulnStatus | ''>('');
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [dismissDialogOpen, setDismissDialogOpen] = useState(false);
  const [dismissingVuln, setDismissingVuln] = useState<Vulnerability | null>(null);
  const [dismissReason, setDismissReason] = useState('');
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const { data, isLoading } = useQuery({
    queryKey: ['vulnerabilities', severityFilter, statusFilter],
    queryFn: async () => {
      let url = '/vulnerabilities?limit=50';
      if (severityFilter) url += `&severity=${severityFilter}`;
      if (statusFilter) url += `&status=${statusFilter}`;
      const response = await api.get<{ vulnerabilities: Vulnerability[] }>(url);
      return response.data?.vulnerabilities || [];
    },
  });

  const updateMutation = useMutation({
    mutationFn: async ({ id, status, notes }: { id: string; status: VulnStatus; notes?: string }) => {
      const response = await api.patch(`/vulnerabilities/${id}`, { status, notes });
      if (!response.success) {
        throw new Error(response.error?.message || 'Failed to update');
      }
    },
    onSuccess: () => {
      toast({ title: 'Vulnerability updated' });
      queryClient.invalidateQueries({ queryKey: ['vulnerabilities'] });
      queryClient.invalidateQueries({ queryKey: ['dashboard'] });
    },
    onError: (error: Error) => {
      toast({ variant: 'destructive', title: 'Error', description: error.message });
    },
  });

  const handleDismiss = (vuln: Vulnerability) => {
    setDismissingVuln(vuln);
    setDismissReason('');
    setDismissDialogOpen(true);
  };

  const handleConfirmDismiss = () => {
    if (!dismissingVuln || dismissReason.trim().length < 10) return;

    updateMutation.mutate({
      id: dismissingVuln.id,
      status: 'FALSE_POSITIVE',
      notes: dismissReason.trim(),
    }, {
      onSuccess: () => {
        setDismissDialogOpen(false);
        setDismissingVuln(null);
        setDismissReason('');
      },
    });
  };

  const getSeverityBadge = (severity: Severity) => {
    return <Badge variant={SEVERITY_BADGE_VARIANT[severity]}>{severity}</Badge>;
  };

  const getStatusBadge = (status: VulnStatus) => {
    return (
      <span className={cn('px-2 py-1 text-xs rounded-full font-medium', VULNERABILITY_STATUS_CLASS[status])}>
        {status.replace('_', ' ')}
      </span>
    );
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl sm:text-3xl font-bold">Vulnerabilities</h1>
          <p className="text-muted-foreground">Review and manage security findings</p>
        </div>
      </div>

      {/* Filters */}
      <Card>
        <CardContent className="pt-6">
          <div className="flex flex-col sm:flex-row sm:flex-wrap gap-3 sm:gap-4 sm:items-center">
            <Filter className="h-4 w-4 text-muted-foreground" />
            <div className="w-full sm:w-auto">
              <select
                className="h-9 w-full sm:w-auto px-3 rounded-md border border-input bg-background text-sm"
                value={severityFilter}
                onChange={(e) => setSeverityFilter(e.target.value as Severity | '')}
              >
                <option value="">All Severities</option>
                {SEVERITY_LEVELS.map((severity) => (
                  <option key={severity} value={severity}>
                    {severity.charAt(0) + severity.slice(1).toLowerCase()}
                  </option>
                ))}
              </select>
            </div>
            <div className="w-full sm:w-auto">
              <select
                className="h-9 w-full sm:w-auto px-3 rounded-md border border-input bg-background text-sm"
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value as VulnStatus | '')}
              >
                <option value="">All Statuses</option>
                {VULNERABILITY_STATUS_OPTIONS.map((status) => (
                  <option key={status.value} value={status.value}>
                    {status.label}
                  </option>
                ))}
              </select>
            </div>
            {(severityFilter || statusFilter) && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  setSeverityFilter('');
                  setStatusFilter('');
                }}
              >
                Clear filters
              </Button>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Vulnerability List */}
      {isLoading ? (
        <div className="flex items-center justify-center h-64">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
        </div>
      ) : data && data.length > 0 ? (
        <div className="space-y-3">
          {data.map((vuln) => (
            <Card key={vuln.id} className="overflow-hidden">
              <div
                className="p-4 cursor-pointer hover:bg-muted/50 transition-colors"
                onClick={() => setExpandedId(expandedId === vuln.id ? null : vuln.id)}
              >
                <div className="flex items-start gap-3">
                  {getSeverityBadge(vuln.severity)}
                  <div className="flex-1 min-w-0">
                    <h3 className="font-medium">{vuln.title}</h3>
                    <div className="flex flex-wrap items-center gap-2 mt-1 text-sm text-muted-foreground">
                      <span>{vuln.type}</span>
                      {vuln.affectedResource && (
                        <>
                          <span>•</span>
                          <span className="font-mono text-xs">{vuln.affectedResource}</span>
                        </>
                      )}
                    </div>
                  </div>
                  <div className="flex flex-wrap items-center justify-end gap-2">
                    {getStatusBadge(vuln.status)}
                    {expandedId === vuln.id ? (
                      <ChevronUp className="h-4 w-4 text-muted-foreground" />
                    ) : (
                      <ChevronDown className="h-4 w-4 text-muted-foreground" />
                    )}
                  </div>
                </div>
              </div>

              {expandedId === vuln.id && (
                <div className="px-4 pb-4 pt-0 border-t bg-muted/30">
                  <div className="pt-4 space-y-4">
                    <div>
                      <h4 className="text-sm font-medium mb-1">Description</h4>
                      <p className="text-sm text-muted-foreground whitespace-pre-wrap">
                        {vuln.description}
                      </p>
                    </div>

                    {vuln.impact && (
                      <div>
                        <h4 className="text-sm font-medium mb-1">Impact</h4>
                        <p className="text-sm text-muted-foreground">{vuln.impact}</p>
                      </div>
                    )}

                    {vuln.remediation && (
                      <div>
                        <h4 className="text-sm font-medium mb-1">Remediation</h4>
                        <p className="text-sm text-muted-foreground whitespace-pre-wrap">
                          {vuln.remediation}
                        </p>
                      </div>
                    )}

                    <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                      <span>First seen: {formatDate(vuln.firstSeen)}</span>
                      <span>•</span>
                      <span>Last seen: {formatDate(vuln.lastSeen)}</span>
                      {vuln.cveId && (
                        <>
                          <span>•</span>
                          <a
                            href={`https://nvd.nist.gov/vuln/detail/${vuln.cveId}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="flex items-center gap-1 text-primary hover:underline"
                          >
                            {vuln.cveId}
                            <ExternalLink className="h-3 w-3" />
                          </a>
                        </>
                      )}
                    </div>

                    {vuln.notes && (
                      <div className="flex items-center gap-1 text-xs text-muted-foreground">
                        <MessageSquare className="h-3 w-3" />
                        <span>{vuln.notes}</span>
                      </div>
                    )}

                    <div className="flex flex-wrap gap-2 pt-2">
                      {vuln.status === 'OPEN' ? (
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={(e) => {
                            e.stopPropagation();
                            handleDismiss(vuln);
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
                            updateMutation.mutate({ id: vuln.id, status: 'OPEN' });
                          }}
                        >
                          <Eye className="h-4 w-4 mr-1" />
                          Reopen
                        </Button>
                      )}
                    </div>
                  </div>
                </div>
              )}
            </Card>
          ))}
        </div>
      ) : (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-12">
            <Shield className="h-16 w-16 text-muted-foreground mb-4" />
            <h3 className="text-lg font-medium mb-2">No Vulnerabilities Found</h3>
            <p className="text-muted-foreground text-center max-w-md">
              {severityFilter || statusFilter
                ? 'No vulnerabilities match your filters.'
                : 'Import a configuration or run a security test to find vulnerabilities.'}
            </p>
          </CardContent>
        </Card>
      )}

      {/* Dismiss Dialog */}
      <Dialog open={dismissDialogOpen} onOpenChange={setDismissDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Dismiss Vulnerability</DialogTitle>
            <DialogDescription>
              Dismissing "{dismissingVuln?.title}"
              {dismissingVuln?.affectedResource && (
                <span className="block text-xs mt-1 font-mono">
                  Resource: {dismissingVuln.affectedResource}
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
              disabled={dismissReason.trim().length < 10 || updateMutation.isPending}
            >
              {updateMutation.isPending ? 'Dismissing...' : 'Dismiss'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

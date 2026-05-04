import { Link } from 'react-router-dom';
import { ArrowRight, ShieldAlert } from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { formatDate } from '@/lib/utils';
import { VerdictBadge } from './VerdictBadge';
import type { CampaignListItem, CampaignVerdict } from '@/types';

export function CampaignCard({ campaign }: { campaign: CampaignListItem }) {
  const verdict: CampaignVerdict = campaign.enabled
    ? campaign.latestRun?.verdict || 'NOT_RUN'
    : 'DISABLED';

  return (
    <Card className="h-full border-border/60 bg-card/80">
      <CardHeader className="space-y-3">
        <div className="flex items-start justify-between gap-3">
          <div className="flex min-w-0 items-start gap-3">
            <div className="rounded-lg border border-orange-500/30 bg-orange-500/10 p-2 text-orange-400">
              <ShieldAlert className="h-5 w-5" />
            </div>
            <div className="min-w-0">
              <CardTitle className="text-lg leading-6">{campaign.definition.shortName}</CardTitle>
              <CardDescription className="mt-1">{campaign.definition.category}</CardDescription>
            </div>
          </div>
          <VerdictBadge verdict={verdict} />
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="text-sm leading-6 text-muted-foreground">{campaign.definition.description}</p>
        <div className="flex flex-wrap gap-2">
          <Badge variant="outline">{campaign.definition.severity}</Badge>
          <Badge variant="outline">{campaign.openFindingCount} open finding(s)</Badge>
          {campaign.latestRun?.startedAt && (
            <Badge variant="secondary">Last run {formatDate(campaign.latestRun.startedAt)}</Badge>
          )}
        </div>
        <Button asChild className="w-full">
          <Link to={`/campaigns/${campaign.definition.id}`}>
            Open Campaign
            <ArrowRight className="ml-2 h-4 w-4" />
          </Link>
        </Button>
      </CardContent>
    </Card>
  );
}

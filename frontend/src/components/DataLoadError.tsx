import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';

interface DataLoadErrorProps {
  title: string;
  message: string;
  onRetry: () => void;
  isRetrying: boolean;
  hasPreviousData?: boolean;
}

export function DataLoadError({ title, message, onRetry, isRetrying, hasPreviousData }: DataLoadErrorProps) {
  return (
    <Card className="border-red-500/30">
      <CardContent className="pt-6" role="alert">
        <p className="font-medium text-red-400">{title}</p>
        <p className="mt-2 text-sm text-muted-foreground">{message}</p>
        {hasPreviousData && (
          <p className="mt-2 text-sm text-muted-foreground">
            Showing the last successful data. It may be out of date.
          </p>
        )}
        <Button variant="outline" className="mt-3" onClick={onRetry} disabled={isRetrying}>
          {isRetrying ? 'Retrying...' : 'Retry loading data'}
        </Button>
      </CardContent>
    </Card>
  );
}

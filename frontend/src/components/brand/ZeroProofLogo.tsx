import { cn } from '@/lib/utils';

// Text-only wordmark
export function ZeroProofWordmark({ className, size = 'md' }: { className?: string; size?: 'sm' | 'md' | 'lg' }) {
  const sizes = {
    sm: 'text-lg',
    md: 'text-2xl',
    lg: 'text-4xl',
  };

  return (
    <span className={cn('font-bold tracking-tight', sizes[size], className)}>
      <span className="text-foreground">Zero</span>
      <span className="text-orange-400">Proof</span>
    </span>
  );
}

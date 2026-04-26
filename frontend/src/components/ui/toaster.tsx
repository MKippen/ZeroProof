import { useState } from 'react';
import { Copy, Check } from 'lucide-react';
import {
  Toast,
  ToastClose,
  ToastDescription,
  ToastProvider,
  ToastTitle,
  ToastViewport,
} from '@/components/ui/toast';
import { useToast } from '@/hooks/useToast';
import { cn } from '@/lib/utils';

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async (e: React.MouseEvent) => {
    e.stopPropagation();
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.error('Failed to copy:', err);
    }
  };

  return (
    <button
      onClick={handleCopy}
      className={cn(
        'absolute right-8 top-2 rounded-md p-1 opacity-0 transition-opacity',
        'hover:bg-white/10 focus:opacity-100 focus:outline-none group-hover:opacity-100',
        'text-foreground/50 hover:text-foreground',
        'group-[.destructive]:text-red-300 group-[.destructive]:hover:text-red-50'
      )}
      title="Copy error message"
    >
      {copied ? (
        <Check className="h-4 w-4" />
      ) : (
        <Copy className="h-4 w-4" />
      )}
    </button>
  );
}

export function Toaster() {
  const { toasts } = useToast();

  return (
    <ToastProvider>
      {toasts.map(function ({ id, title, description, action, ...props }) {
        // Build copyable text from title and description
        const copyText = [
          typeof title === 'string' ? title : '',
          typeof description === 'string' ? description : '',
        ].filter(Boolean).join(': ');

        return (
          <Toast key={id} {...props}>
            <div className="grid gap-1">
              {title && <ToastTitle>{title}</ToastTitle>}
              {description && <ToastDescription>{description}</ToastDescription>}
            </div>
            {action}
            {/* Show copy button for error toasts with description */}
            {props.variant === 'destructive' && copyText && (
              <CopyButton text={copyText} />
            )}
            <ToastClose />
          </Toast>
        );
      })}
      <ToastViewport />
    </ToastProvider>
  );
}

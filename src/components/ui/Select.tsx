import { forwardRef, type SelectHTMLAttributes } from 'react';
import { ChevronDown } from 'lucide-react';
import { cn } from '@/lib/utils/cn';

export interface SelectProps extends Omit<SelectHTMLAttributes<HTMLSelectElement>, 'size'> {
  size?: 'sm' | 'md';
  wrapperClassName?: string;
}

export const Select = forwardRef<HTMLSelectElement, SelectProps>(function Select(
  { className, wrapperClassName, size = 'sm', children, ...props },
  ref,
) {
  return (
    <div className={cn('relative inline-flex', wrapperClassName)}>
      <select
        ref={ref}
        className={cn(
          'border-line bg-surface-2 text-fg hover:border-line-strong focus-visible:outline-accent w-full appearance-none rounded-lg border pr-7 pl-2.5 font-medium transition-colors focus-visible:outline-2',
          size === 'sm' ? 'h-8 text-xs' : 'h-9 text-sm',
          className,
        )}
        {...props}
      >
        {children}
      </select>
      <ChevronDown
        aria-hidden
        className="text-fg-subtle pointer-events-none absolute top-1/2 right-2 size-3.5 -translate-y-1/2"
      />
    </div>
  );
});

'use client';

import { useId, type ReactNode } from 'react';
import { cn } from '@/lib/utils/cn';

export interface SegmentedOption<T extends string> {
  value: T;
  label: ReactNode;
  title?: string;
}

export interface SegmentedProps<T extends string> {
  value: T;
  options: SegmentedOption<T>[];
  onChange: (value: T) => void;
  label: string;
  size?: 'xs' | 'sm';
  className?: string;
  'data-tour'?: string;
}

export function Segmented<T extends string>({
  value,
  options,
  onChange,
  label,
  size = 'sm',
  className,
  'data-tour': tour,
}: SegmentedProps<T>) {
  const name = useId();
  return (
    <div
      role="radiogroup"
      aria-label={label}
      data-tour={tour}
      className={cn('bg-surface-3/70 inline-flex rounded-lg p-0.5', className)}
    >
      {options.map((opt) => {
        const selected = opt.value === value;
        return (
          <button
            key={opt.value}
            type="button"
            role="radio"
            aria-checked={selected}
            name={name}
            title={opt.title}
            onClick={() => onChange(opt.value)}
            className={cn(
              'rounded-md font-medium transition-colors [&_svg]:size-3.5',
              size === 'xs' ? 'h-6 px-2 text-[11px]' : 'h-7 px-2.5 text-xs',
              selected ? 'bg-surface text-fg shadow-sm' : 'text-fg-muted hover:text-fg',
            )}
          >
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}

'use client';

import { memo, type CSSProperties } from 'react';
import { cn } from '@/lib/utils/cn';

export interface FaderProps {
  value: number;
  min?: number;
  max?: number;
  step?: number;
  label: string;
  onChange: (value: number) => void;
  format?: (value: number) => string;
  className?: string;
  defaultValue?: number;
}

export const Fader = memo(function Fader({
  value,
  min = 0,
  max = 1,
  step = 0.01,
  label,
  onChange,
  format,
  className,
  defaultValue,
}: FaderProps) {
  const fill = ((value - min) / (max - min)) * 100;
  return (
    <input
      type="range"
      className={cn('fader', className)}
      min={min}
      max={max}
      step={step}
      value={value}
      aria-label={label}
      aria-valuetext={format?.(value)}
      title={`${label}: ${format ? format(value) : value}`}
      onChange={(e) => onChange(Number(e.target.value))}
      onDoubleClick={() => defaultValue !== undefined && onChange(defaultValue)}
      onKeyDown={(e) => e.stopPropagation()}
      style={{ '--fill': `${fill}%` } as CSSProperties}
    />
  );
});

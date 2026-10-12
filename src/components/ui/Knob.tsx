'use client';

import {
  memo,
  useCallback,
  useEffect,
  useEffectEvent,
  useRef,
  useState,
  type KeyboardEvent,
  type PointerEvent,
} from 'react';
import { clamp, snap } from '@/lib/utils/math';
import { cn } from '@/lib/utils/cn';

export interface KnobProps {
  value: number;
  min: number;
  max: number;
  step?: number;
  defaultValue?: number;
  label: string;
  onChange: (value: number) => void;
  format?: (value: number) => string;
  /** Logarithmic travel for frequencies and times (min must be > 0). */
  log?: boolean;
  /** Draw the arc from the centre, e.g. for pan. */
  bipolar?: boolean;
  size?: number;
  color?: string;
  disabled?: boolean;
  className?: string;
}

const START = -135;
const SWEEP = 270;
const DRAG_PIXELS = 180;

function polar(cx: number, cy: number, r: number, angle: number) {
  const rad = ((angle - 90) * Math.PI) / 180;
  return { x: cx + r * Math.cos(rad), y: cy + r * Math.sin(rad) };
}

function arc(cx: number, cy: number, r: number, from: number, to: number) {
  if (Math.abs(to - from) < 0.01) return '';
  const a = polar(cx, cy, r, Math.min(from, to));
  const b = polar(cx, cy, r, Math.max(from, to));
  const large = Math.abs(to - from) > 180 ? 1 : 0;
  return `M ${a.x} ${a.y} A ${r} ${r} 0 ${large} 1 ${b.x} ${b.y}`;
}

export const Knob = memo(function Knob({
  value,
  min,
  max,
  step = 0.01,
  defaultValue,
  label,
  onChange,
  format,
  log = false,
  bipolar = false,
  size = 44,
  color = 'var(--accent)',
  disabled,
  className,
}: KnobProps) {
  const ref = useRef<HTMLDivElement>(null);
  const drag = useRef<{ y: number; norm: number } | null>(null);
  const [active, setActive] = useState(false);

  const useLog = log && min > 0;
  const toNorm = useCallback(
    (v: number) => (useLog ? Math.log(v / min) / Math.log(max / min) : (v - min) / (max - min)),
    [useLog, min, max],
  );
  const fromNorm = useCallback(
    (n: number) => {
      const t = clamp(n, 0, 1);
      const raw = useLog ? min * Math.pow(max / min, t) : min + t * (max - min);
      return clamp(snap(raw, step), min, max);
    },
    [useLog, min, max, step],
  );

  const norm = clamp(toNorm(value), 0, 1);
  const emit = useCallback(
    (next: number) => {
      if (next !== value) onChange(next);
    },
    [onChange, value],
  );

  const onWheel = useEffectEvent((e: WheelEvent) => {
    if (disabled) return;
    e.preventDefault();
    const delta = (-e.deltaY / (e.shiftKey ? 4000 : 800)) * (e.deltaMode === 1 ? 30 : 1);
    emit(fromNorm(norm + delta));
  });
  // Wheel needs a non-passive listener to prevent page scroll.
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const listener = (e: WheelEvent) => onWheel(e);
    el.addEventListener('wheel', listener, { passive: false });
    return () => el.removeEventListener('wheel', listener);
  }, []);

  const onPointerDown = (e: PointerEvent<HTMLDivElement>) => {
    if (disabled || e.button !== 0) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    drag.current = { y: e.clientY, norm };
    setActive(true);
  };

  const onPointerMove = (e: PointerEvent<HTMLDivElement>) => {
    if (!drag.current) return;
    const delta = (drag.current.y - e.clientY) / (DRAG_PIXELS * (e.shiftKey ? 5 : 1));
    emit(fromNorm(drag.current.norm + delta));
  };

  const endDrag = () => {
    drag.current = null;
    setActive(false);
  };

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (disabled) return;
    const fine = e.shiftKey ? 0.002 : 0.01;
    const moves: Record<string, number> = {
      ArrowUp: fine,
      ArrowRight: fine,
      ArrowDown: -fine,
      ArrowLeft: -fine,
      PageUp: 0.1,
      PageDown: -0.1,
    };
    if (e.key in moves) {
      e.preventDefault();
      e.stopPropagation();
      const next = fromNorm(norm + moves[e.key]);
      // Guarantee movement even when the step is coarser than 1%.
      if (next === value) emit(clamp(value + Math.sign(moves[e.key]) * step, min, max));
      else emit(next);
    } else if (e.key === 'Home') {
      e.preventDefault();
      emit(min);
    } else if (e.key === 'End') {
      e.preventDefault();
      emit(max);
    }
  };

  const reset = () => {
    if (!disabled && defaultValue !== undefined) emit(defaultValue);
  };

  const r = size / 2 - 4;
  const c = size / 2;
  const angle = START + norm * SWEEP;
  const from = bipolar ? 0 : START;
  const dot = polar(c, c, r - 6, angle);
  const text = format ? format(value) : String(value);

  return (
    <div className={cn('flex flex-col items-center gap-1 select-none', disabled && 'opacity-40', className)}>
      <div
        ref={ref}
        role="slider"
        tabIndex={disabled ? -1 : 0}
        aria-label={label}
        aria-valuemin={min}
        aria-valuemax={max}
        aria-valuenow={value}
        aria-valuetext={text}
        aria-disabled={disabled}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        onLostPointerCapture={endDrag}
        onDoubleClick={reset}
        onKeyDown={onKeyDown}
        className={cn(
          'relative touch-none rounded-full outline-none',
          disabled ? 'cursor-not-allowed' : 'cursor-ns-resize',
          'focus-visible:ring-accent focus-visible:ring-offset-surface focus-visible:ring-2 focus-visible:ring-offset-2',
        )}
        style={{ width: size, height: size }}
        title={`${label}: ${text}${defaultValue !== undefined ? ' (double-click to reset)' : ''}`}
      >
        <svg width={size} height={size} aria-hidden className="overflow-visible">
          <circle cx={c} cy={c} r={r - 3} className="fill-surface-3" />
          <circle cx={c} cy={c} r={r - 3} fill="none" className="stroke-line-strong" strokeWidth={1} />
          <path
            d={arc(c, c, r + 1, START, START + SWEEP)}
            fill="none"
            className="stroke-surface-3"
            strokeWidth={3}
            strokeLinecap="round"
          />
          <path d={arc(c, c, r + 1, from, angle)} fill="none" stroke={color} strokeWidth={3} strokeLinecap="round" />
          <circle cx={dot.x} cy={dot.y} r={2.2} className="fill-fg" />
        </svg>
      </div>
      <div className="flex flex-col items-center leading-tight">
        <span className="text-fg-muted text-[10px] font-medium tracking-wide uppercase">{label}</span>
        <span className={cn('font-mono text-[10px] tabular-nums', active ? 'text-accent' : 'text-fg-subtle')}>
          {text}
        </span>
      </div>
    </div>
  );
});

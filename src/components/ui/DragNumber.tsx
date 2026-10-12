'use client';

import { useEffect, useEffectEvent, useRef, type PointerEvent } from 'react';
import { clamp, snap } from '@/lib/utils/math';

export interface DragNumberProps {
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  /** Pixels of vertical drag per step */
  sensitivity?: number;
  format?: (value: number) => string;
  onChange: (value: number) => void;
  defaultValue?: number;
}

/** Compact numeric readout adjusted by dragging, scrolling or the arrow keys. */
export function DragNumber({
  label,
  value,
  min,
  max,
  step = 1,
  sensitivity = 4,
  format = String,
  onChange,
  defaultValue,
}: DragNumberProps) {
  const ref = useRef<HTMLButtonElement>(null);
  const drag = useRef<{ y: number; value: number } | null>(null);
  const set = (next: number) => onChange(clamp(snap(next, step), min, max));

  const onWheel = useEffectEvent((e: WheelEvent) => {
    e.preventDefault();
    set(value + (e.deltaY < 0 ? step : -step));
  });
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const listener = (e: WheelEvent) => onWheel(e);
    el.addEventListener('wheel', listener, { passive: false });
    return () => el.removeEventListener('wheel', listener);
  }, []);

  const onPointerDown = (e: PointerEvent<HTMLButtonElement>) => {
    if (e.button !== 0) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    drag.current = { y: e.clientY, value };
  };
  const onPointerMove = (e: PointerEvent<HTMLButtonElement>) => {
    if (!drag.current) return;
    const steps = Math.round((drag.current.y - e.clientY) / (sensitivity * (e.shiftKey ? 4 : 1)));
    set(drag.current.value + steps * step);
  };
  const end = () => {
    drag.current = null;
  };

  return (
    <button
      ref={ref}
      type="button"
      role="slider"
      aria-label={label}
      aria-valuemin={min}
      aria-valuemax={max}
      aria-valuenow={value}
      aria-valuetext={format(value)}
      title={`${label}: drag, scroll or use arrow keys${defaultValue !== undefined ? '. Double-click to reset' : ''}`}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={end}
      onPointerCancel={end}
      onDoubleClick={() => defaultValue !== undefined && onChange(defaultValue)}
      onKeyDown={(e) => {
        if (['ArrowUp', 'ArrowRight', 'ArrowDown', 'ArrowLeft'].includes(e.key)) {
          e.preventDefault();
          e.stopPropagation();
          const dir = e.key === 'ArrowUp' || e.key === 'ArrowRight' ? 1 : -1;
          set(value + dir * step * (e.shiftKey ? 5 : 1));
        }
      }}
      className="bg-surface-2 hover:bg-surface-3 flex h-9 cursor-ns-resize touch-none flex-col items-start justify-center rounded-lg px-2.5"
    >
      <span className="text-fg-subtle text-[9px] leading-none font-semibold tracking-widest uppercase">{label}</span>
      <span className="font-mono text-sm leading-tight font-semibold tabular-nums">{format(value)}</span>
    </button>
  );
}

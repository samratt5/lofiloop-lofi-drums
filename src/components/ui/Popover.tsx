'use client';

import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { cn } from '@/lib/utils/cn';

export interface PopoverProps {
  /** Viewport coordinates to anchor to (e.g. the bottom-centre of a trigger). */
  anchor: { x: number; y: number };
  onClose: () => void;
  children: ReactNode;
  className?: string;
  label: string;
}

/** Floating panel positioned inside the viewport; closes on outside click, scroll or Esc. */
export function Popover({ anchor, onClose, children, className, label }: PopoverProps) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const { width, height } = el.getBoundingClientRect();
    const margin = 8;
    let left = anchor.x - width / 2;
    let top = anchor.y + 6;
    if (top + height > window.innerHeight - margin) top = Math.max(margin, anchor.y - height - 46);
    left = Math.min(Math.max(margin, left), window.innerWidth - width - margin);
    setPos({ left, top });
  }, [anchor.x, anchor.y]);

  useEffect(() => {
    const onPointer = (e: PointerEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
      }
    };
    const onResize = () => onClose();
    document.addEventListener('pointerdown', onPointer, true);
    document.addEventListener('keydown', onKey, true);
    window.addEventListener('resize', onResize);
    return () => {
      document.removeEventListener('pointerdown', onPointer, true);
      document.removeEventListener('keydown', onKey, true);
      window.removeEventListener('resize', onResize);
    };
  }, [onClose]);

  useEffect(() => {
    const first = ref.current?.querySelector<HTMLElement>('button, [tabindex="0"], input, select');
    first?.focus({ preventScroll: true });
  }, []);

  return createPortal(
    <div
      ref={ref}
      role="dialog"
      aria-label={label}
      className={cn(
        'border-line-strong bg-surface-2 animate-pop-in fixed z-50 rounded-xl border p-3 shadow-2xl shadow-black/40',
        !pos && 'invisible',
        className,
      )}
      style={pos ?? { left: 0, top: 0 }}
    >
      {children}
    </div>,
    document.body,
  );
}

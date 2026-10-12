'use client';

import { useEffect, useRef, useState, type PointerEvent } from 'react';
import { BPM_MAX, BPM_MIN } from '@/lib/project/types';
import { actions, useStudio } from '@/lib/store/studio';
import { tapTempo } from '@/lib/utils/tapTempo';
import { clamp } from '@/lib/utils/math';
import { cn } from '@/lib/utils/cn';

/** BPM display you can drag, scroll, type into or tap. */
export function TempoControl({ compact = false }: { compact?: boolean }) {
  const bpm = useStudio((s) => s.project.bpm);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(String(bpm));
  const drag = useRef<{ y: number; bpm: number; moved: boolean } | null>(null);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const current = useStudio.getState().project.bpm;
      actions.setBpm(current + (e.deltaY < 0 ? 1 : -1) * (e.shiftKey ? 5 : 1));
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, []);

  const onPointerDown = (e: PointerEvent<HTMLButtonElement>) => {
    if (e.button !== 0) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    drag.current = { y: e.clientY, bpm, moved: false };
  };
  const onPointerMove = (e: PointerEvent<HTMLButtonElement>) => {
    if (!drag.current) return;
    const dy = drag.current.y - e.clientY;
    if (Math.abs(dy) > 3) drag.current.moved = true;
    if (drag.current.moved) actions.setBpm(drag.current.bpm + Math.round(dy / (e.shiftKey ? 8 : 2.5)));
  };
  const onPointerUp = () => {
    const moved = drag.current?.moved;
    drag.current = null;
    if (!moved) {
      setDraft(String(bpm));
      setEditing(true);
    }
  };

  const commit = () => {
    const value = Number(draft);
    if (Number.isFinite(value) && value > 0) actions.setBpm(clamp(value, BPM_MIN, BPM_MAX));
    setEditing(false);
  };

  return (
    <div ref={ref} className="bg-surface-2 flex items-center gap-1 rounded-lg p-0.5 pl-2.5">
      <div className="flex flex-col">
        {!compact && <span className="text-fg-subtle text-[9px] leading-none font-semibold tracking-widest">BPM</span>}
        {editing ? (
          <input
            autoFocus
            inputMode="numeric"
            aria-label="Tempo in BPM"
            value={draft}
            onChange={(e) => setDraft(e.target.value.replace(/[^\d.]/g, ''))}
            onBlur={commit}
            onKeyDown={(e) => {
              if (e.key === 'Enter') commit();
              if (e.key === 'Escape') setEditing(false);
            }}
            className="h-6 w-11 bg-transparent font-mono text-base font-semibold tabular-nums outline-none"
          />
        ) : (
          <button
            type="button"
            aria-label={`Tempo ${bpm} BPM. Drag, scroll or click to edit`}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onKeyDown={(e) => {
              if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
                e.preventDefault();
                e.stopPropagation();
                actions.setBpm(bpm + (e.key === 'ArrowUp' ? 1 : -1) * (e.shiftKey ? 10 : 1));
              }
            }}
            className="h-6 w-11 cursor-ns-resize touch-none text-left font-mono text-base font-semibold tabular-nums"
          >
            {bpm}
          </button>
        )}
      </div>
      <button
        type="button"
        onClick={() => {
          const next = tapTempo();
          if (next) actions.setBpm(next);
        }}
        className={cn(
          'text-fg-muted hover:bg-surface-3 hover:text-fg active:bg-accent-soft active:text-accent h-8 rounded-md px-2 text-[10px] font-bold tracking-widest transition-colors',
        )}
        title="Tap tempo (T)"
      >
        TAP
      </button>
    </div>
  );
}

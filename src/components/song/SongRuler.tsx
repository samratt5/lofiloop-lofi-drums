'use client';

import { useRef, type PointerEvent } from 'react';
import { actions, useStudio } from '@/lib/store/studio';
import { useUi } from '@/lib/store/ui';
import { seekSong } from '@/lib/transport';

interface SongRulerProps {
  bars: number;
  zoom: number;
}

/** Bar numbers; click to move the song position, drag to set a loop region. */
export function SongRuler({ bars, zoom }: SongRulerProps) {
  const loop = useStudio((s) => s.project.loop);
  const cursor = useUi((s) => s.songCursor);
  const drag = useRef<{ start: number; moved: boolean } | null>(null);

  const barAt = (e: PointerEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    return Math.max(0, Math.min(bars, (e.clientX - rect.left) / zoom));
  };

  const every = zoom < 16 ? 8 : zoom < 28 ? 4 : zoom < 48 ? 2 : 1;
  const labels = [];
  for (let b = 0; b < bars; b += every) {
    labels.push(
      <span
        key={b}
        className="text-fg-subtle border-line-strong absolute top-0 flex h-full items-center border-l pl-1 font-mono text-[10px] tabular-nums"
        style={{ left: b * zoom }}
      >
        {b + 1}
      </span>,
    );
  }

  return (
    <div
      role="slider"
      aria-label="Song position"
      aria-valuemin={0}
      aria-valuemax={bars}
      aria-valuenow={cursor}
      tabIndex={0}
      className="bg-surface/95 border-line relative h-7 cursor-text border-b select-none"
      style={{ width: Math.max(1, bars) * zoom }}
      onKeyDown={(e) => {
        if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
          e.preventDefault();
          e.stopPropagation();
          seekSong(Math.max(0, Math.min(bars - 1, Math.round(cursor) + (e.key === 'ArrowRight' ? 1 : -1))));
        }
      }}
      onPointerDown={(e) => {
        if (e.button !== 0) return;
        e.currentTarget.setPointerCapture(e.pointerId);
        drag.current = { start: Math.floor(barAt(e)), moved: false };
      }}
      onPointerMove={(e) => {
        const d = drag.current;
        if (!d) return;
        const bar = Math.round(barAt(e));
        if (Math.abs(bar - d.start) >= 1) d.moved = true;
        if (d.moved) {
          const start = Math.min(d.start, bar);
          const end = Math.max(d.start + 1, bar);
          actions.setLoop({ start, end: Math.max(start + 1, end) });
        }
      }}
      onPointerUp={(e) => {
        const d = drag.current;
        drag.current = null;
        if (d && !d.moved) seekSong(Math.floor(barAt(e)));
      }}
      title="Click to move the song position, drag to loop a range"
    >
      {loop && (
        <div
          aria-hidden
          className="bg-accent/25 border-accent absolute inset-y-0 border-x-2"
          style={{ left: loop.start * zoom, width: (loop.end - loop.start) * zoom }}
        />
      )}
      {labels}
      <div
        aria-hidden
        className="border-t-accent absolute top-0 size-0 -translate-x-1/2 border-x-[6px] border-t-[8px] border-x-transparent"
        style={{ left: cursor * zoom }}
      />
    </div>
  );
}

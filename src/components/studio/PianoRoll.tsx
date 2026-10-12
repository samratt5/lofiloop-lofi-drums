'use client';

import { useEffect, useLayoutEffect, useMemo, useRef, useState, type PointerEvent } from 'react';
import { engine } from '@/lib/audio/engine';
import { isInScale, noteName, pitchClass } from '@/lib/music/theory';
import { INSTRUMENTS } from '@/lib/project/instruments';
import type { Pattern, Track } from '@/lib/project/types';
import { actions, getProject, useStudio } from '@/lib/store/studio';
import { useUi } from '@/lib/store/ui';
import { usePlayhead } from '@/hooks/usePlayhead';
import { Segmented } from '@/components/ui/Segmented';
import { cn } from '@/lib/utils/cn';

const ROW = 16;
const LABEL = 44;
const MIN_COL = 22;

function Playline({ patternId, col }: { patternId: string; col: number }) {
  const playhead = usePlayhead();
  if (!playhead.playing || playhead.patternId !== patternId || playhead.step < 0) return null;
  return (
    <div
      aria-hidden
      className="bg-accent pointer-events-none absolute inset-y-0 z-10 w-px"
      style={{ left: LABEL + playhead.step * col }}
    />
  );
}

export function PianoRoll({ track, pattern }: { track: Track; pattern: Pattern }) {
  const root = useStudio((s) => s.project.root);
  const scale = useStudio((s) => s.project.scale);
  const [scaleOnly, setScaleOnly] = useState<'scale' | 'all'>('scale');
  const scrollRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(800);
  const drag = useRef<{ note: number; visited: Set<number>; erase: boolean } | null>(null);

  const def = INSTRUMENTS[track.instrument];
  const steps = pattern.steps[track.id];
  const len = pattern.length;

  const rows = useMemo(() => {
    const list: number[] = [];
    for (let n = def.noteRange[1]; n >= def.noteRange[0]; n--) {
      if (scaleOnly === 'all' || isInScale(n, root, scale)) list.push(n);
    }
    return list;
  }, [def.noteRange, scaleOnly, root, scale]);

  const col = Math.max(MIN_COL, (width - LABEL - 8) / len);

  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => setWidth(entry.contentRect.width));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Scroll to the notes in use (or the instrument's home note) when the track changes.
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const used = steps
      .slice(0, len)
      .filter((s) => s.on)
      .map((s) => s.note);
    const target = used.length ? used.reduce((a, b) => a + b, 0) / used.length : def.defaultNote + root;
    const index = rows.findIndex((n) => n <= target);
    el.scrollTop = Math.max(0, index * ROW - el.clientHeight / 2);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only on track / view change
  }, [track.id, scaleOnly]);

  const locate = (e: PointerEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const x = e.clientX - rect.left - LABEL;
    const y = e.clientY - rect.top;
    const c = Math.floor(x / col);
    const r = Math.floor(y / ROW);
    if (c < 0 || c >= len || r < 0 || r >= rows.length) return null;
    return { col: c, note: rows[r] };
  };

  const apply = (c: number, note: number, erase: boolean) => {
    const current = getProject().patterns.find((p) => p.id === pattern.id)?.steps[track.id]?.[c];
    if (!current) return;
    if (erase) {
      if (current.on && current.note === note) actions.setStep(track.id, c, { on: false }, `roll:${track.id}`);
    } else if (!current.on || current.note !== note) {
      actions.setStep(track.id, c, { on: true, note }, `roll:${track.id}`);
    }
  };

  const onPointerDown = (e: PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    const hit = locate(e);
    if (!hit) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    const step = steps[hit.col];
    const erase = step.on && step.note === hit.note;
    drag.current = { note: hit.note, visited: new Set([hit.col]), erase };
    apply(hit.col, hit.note, erase);
    if (!erase && useUi.getState().audition && !engine.isPlaying) void engine.preview(track, hit.note, step.vel);
  };

  const onPointerMove = (e: PointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    if (!d) return;
    const hit = locate(e);
    if (!hit || d.visited.has(hit.col)) return;
    d.visited.add(hit.col);
    apply(hit.col, d.erase ? d.note : hit.note, d.erase);
  };

  const height = rows.length * ROW;

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-3 px-4 pt-3 pb-2">
        <Segmented
          label="Rows"
          size="xs"
          value={scaleOnly}
          onChange={setScaleOnly}
          options={[
            { value: 'scale', label: 'In key', title: 'Only show notes in the project key' },
            { value: 'all', label: 'Chromatic', title: 'Show all 12 notes' },
          ]}
        />
        <p className="text-fg-subtle hidden text-xs sm:block">
          Click to add or remove notes, drag to draw a line. Right-click a pad in the grid to set its length.
        </p>
      </div>
      <div ref={scrollRef} className="border-line relative min-h-0 flex-1 overflow-auto border-t">
        <div
          role="grid"
          aria-label={`${track.name} piano roll`}
          className="relative touch-none select-none"
          style={{ width: LABEL + col * len, height }}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={() => (drag.current = null)}
          onPointerCancel={() => (drag.current = null)}
        >
          {rows.map((note, i) => {
            const isRoot = pitchClass(note - root) === 0;
            const inKey = isInScale(note, root, scale);
            return (
              <div
                key={note}
                className={cn(
                  'border-line/60 absolute right-0 left-0 border-b',
                  isRoot ? 'bg-accent-soft' : inKey ? 'bg-surface-2/60' : 'bg-bg-deep/50',
                )}
                style={{ top: i * ROW, height: ROW }}
              >
                <span
                  className={cn(
                    'border-line bg-surface sticky left-0 flex h-full items-center border-r pl-1.5 font-mono text-[9px]',
                    isRoot ? 'text-accent font-bold' : 'text-fg-subtle',
                  )}
                  style={{ width: LABEL }}
                >
                  {noteName(note)}
                </span>
              </div>
            );
          })}
          <div
            aria-hidden
            className="pointer-events-none absolute inset-y-0"
            style={{
              left: LABEL,
              right: 0,
              backgroundImage: `repeating-linear-gradient(to right, var(--line-strong) 0 1px, transparent 1px ${col * 4}px), repeating-linear-gradient(to right, var(--line) 0 1px, transparent 1px ${col}px)`,
            }}
          />
          {steps.slice(0, len).map((step, i) => {
            if (!step.on) return null;
            const r = rows.indexOf(step.note);
            if (r < 0) return null;
            return (
              <div
                key={i}
                className="pointer-events-none absolute rounded-[4px] border border-black/20 shadow-sm"
                style={{
                  top: r * ROW + 1,
                  height: ROW - 2,
                  left: LABEL + i * col + 1,
                  width: Math.min(step.len, len - i) * col - 2,
                  background: def.color,
                  opacity: 0.45 + step.vel * 0.55,
                }}
              />
            );
          })}
          <Playline patternId={pattern.id} col={col} />
        </div>
      </div>
    </div>
  );
}

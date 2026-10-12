'use client';

import { useRef, useState, type PointerEvent } from 'react';
import type { Pattern, Track } from '@/lib/project/types';
import { INSTRUMENTS } from '@/lib/project/instruments';
import { actions } from '@/lib/store/studio';
import { Segmented } from '@/components/ui/Segmented';
import { clamp } from '@/lib/utils/math';
import { cn } from '@/lib/utils/cn';

type Lane = 'vel' | 'prob';

/** Draw velocity or chance across the active steps of a track. */
export function Lanes({ track, pattern }: { track: Track; pattern: Pattern }) {
  const [lane, setLane] = useState<Lane>('vel');
  const drawing = useRef(false);
  const steps = pattern.steps[track.id];
  const len = pattern.length;
  const color = INSTRUMENTS[track.instrument].color;

  const drawAt = (e: PointerEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const c = Math.floor(((e.clientX - rect.left) / rect.width) * len);
    if (c < 0 || c >= len || !steps[c]?.on) return;
    const value = clamp(1 - (e.clientY - rect.top) / rect.height, lane === 'vel' ? 0.05 : 0, 1);
    actions.setStep(track.id, c, { [lane]: Math.round(value * 100) / 100 }, `lane:${track.id}:${lane}`);
  };

  return (
    <div className="flex h-full flex-col px-4 pt-3 pb-3">
      <div className="mb-2 flex items-center gap-3">
        <Segmented
          label="Lane"
          size="xs"
          value={lane}
          onChange={setLane}
          options={[
            { value: 'vel', label: 'Velocity' },
            { value: 'prob', label: 'Chance' },
          ]}
        />
        <p className="text-fg-subtle text-xs">
          Drag across the bars to draw {lane === 'vel' ? 'dynamics' : 'how often each step plays'}.
        </p>
      </div>
      <div
        role="group"
        aria-label={`${track.name} ${lane === 'vel' ? 'velocity' : 'chance'} lane`}
        className="bg-surface-2/60 relative grid min-h-0 flex-1 touch-none gap-[3px] rounded-lg p-1 select-none"
        style={{ gridTemplateColumns: `repeat(${len}, minmax(0, 1fr))` }}
        onPointerDown={(e) => {
          e.currentTarget.setPointerCapture(e.pointerId);
          drawing.current = true;
          drawAt(e);
        }}
        onPointerMove={(e) => drawing.current && drawAt(e)}
        onPointerUp={() => (drawing.current = false)}
        onPointerCancel={() => (drawing.current = false)}
      >
        {steps.slice(0, len).map((step, i) => {
          const value = lane === 'vel' ? step.vel : step.prob;
          return (
            <div
              key={i}
              className={cn('relative flex items-end rounded-sm', Math.floor(i / 4) % 2 ? 'bg-step-alt' : 'bg-step')}
            >
              {step.on && (
                <div
                  className="w-full rounded-sm"
                  style={{ height: `${value * 100}%`, background: color, opacity: 0.5 + value * 0.5 }}
                  title={`Step ${i + 1}: ${Math.round(value * 100)}%`}
                />
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

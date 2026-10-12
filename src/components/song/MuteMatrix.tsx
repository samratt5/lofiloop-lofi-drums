'use client';

import { memo } from 'react';
import type { sectionSpans } from '@/lib/audio/sequence';
import { INSTRUMENTS } from '@/lib/project/instruments';
import type { Pattern, Track } from '@/lib/project/types';
import { actions } from '@/lib/store/studio';
import { ui } from '@/lib/store/ui';
import { InstrumentBadge } from '@/components/studio/InstrumentPicker';
import { cn } from '@/lib/utils/cn';
import { TRACK_HEADER_WIDTH } from './sectionStyle';

type Span = ReturnType<typeof sectionSpans>[number];

function density(pattern: Pattern | undefined, trackId: string): number {
  if (!pattern) return 0;
  const steps = pattern.steps[trackId];
  if (!steps) return 0;
  let on = 0;
  for (let i = 0; i < pattern.length; i++) if (steps[i].on) on += 1;
  return on / pattern.length;
}

interface MuteMatrixProps {
  tracks: Track[];
  spans: Span[];
  patterns: Pattern[];
  zoom: number;
  totalBars: number;
}

/** Which tracks play in which section. Click a cell to mute or unmute a track for that section. */
export const MuteMatrix = memo(function MuteMatrix({ tracks, spans, patterns, zoom, totalBars }: MuteMatrixProps) {
  const byId = new Map(patterns.map((p) => [p.id, p]));
  return (
    <div role="group" aria-label="Tracks per section" className="pb-2">
      {tracks.map((track) => {
        const color = INSTRUMENTS[track.instrument].color;
        return (
          <div key={track.id} className="flex h-8 items-stretch">
            <div
              className="bg-surface border-line sticky left-0 z-10 flex shrink-0 items-center gap-2 border-r px-2"
              style={{ width: TRACK_HEADER_WIDTH }}
            >
              <InstrumentBadge id={track.instrument} className="h-5 min-w-8 text-[9px]" />
              <button
                type="button"
                onClick={() => ui.selectTrack(track.id)}
                className={cn(
                  'truncate text-left text-xs',
                  track.mute ? 'text-fg-subtle line-through' : 'text-fg-muted',
                )}
              >
                {track.name}
              </button>
            </div>
            <div className="relative" style={{ width: (totalBars + 6) * zoom }}>
              {spans.map((span) => {
                const muted = span.section.muted.includes(track.id);
                const pattern = byId.get(span.section.patternId);
                const fill = span.section.fillPatternId ? byId.get(span.section.fillPatternId) : undefined;
                const d = Math.max(density(pattern, track.id), density(fill, track.id));
                return (
                  <button
                    key={span.section.id}
                    type="button"
                    aria-pressed={!muted}
                    aria-label={`${track.name} in ${span.section.name}: ${muted ? 'muted' : d > 0 ? 'playing' : 'no notes'}`}
                    onClick={() => actions.toggleSectionMute(span.section.id, track.id)}
                    className="group absolute inset-y-1 px-px"
                    style={{ left: span.startBar * zoom, width: Math.max(6, span.bars * zoom) }}
                  >
                    <span
                      className={cn(
                        'block h-full rounded-[5px] border transition-colors',
                        muted
                          ? 'border-line bg-[repeating-linear-gradient(135deg,var(--line)_0_4px,transparent_4px_8px)]'
                          : 'border-transparent',
                      )}
                      style={
                        muted
                          ? undefined
                          : {
                              background:
                                d > 0
                                  ? `color-mix(in oklab, ${color} ${25 + d * 60}%, var(--surface-2))`
                                  : 'var(--surface-2)',
                            }
                      }
                    />
                  </button>
                );
              })}
            </div>
          </div>
        );
      })}
    </div>
  );
});

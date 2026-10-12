'use client';

import { Plus, X } from 'lucide-react';
import { MAX_SECTIONS } from '@/lib/project/types';
import { actions, useStudio } from '@/lib/store/studio';
import { usePlayhead } from '@/hooks/usePlayhead';
import { Menu } from '@/components/ui/Menu';
import { buildSongTimeline } from '@/lib/audio/sequence';
import { formatDuration } from '@/lib/utils/format';
import { cn } from '@/lib/utils/cn';

/** Compact strip of song sections shown in pattern view. */
export function SongChain() {
  const project = useStudio((s) => s.project);
  const playhead = usePlayhead();
  const { arrangement, patterns, activePatternId } = project;
  const byId = new Map(patterns.map((p) => [p.id, p]));
  const total = buildSongTimeline(project).totalSeconds;

  return (
    <div className="border-line flex h-11 items-center gap-2 border-t px-2 sm:px-3">
      <span className="text-fg-subtle shrink-0 text-[10px] font-semibold tracking-widest uppercase">Song</span>
      <ol
        className="scrollbar-none flex min-w-0 flex-1 items-center gap-1 overflow-x-auto py-1"
        aria-label="Song sections"
      >
        {arrangement.map((section, i) => {
          const pattern = byId.get(section.patternId);
          if (!pattern) return null;
          const playing = playhead.playing && playhead.mode === 'song' && playhead.sectionIndex === i;
          return (
            <li key={section.id} className="group relative shrink-0">
              <button
                type="button"
                onClick={() => actions.selectPattern(section.patternId)}
                title={`${section.name}: pattern ${pattern.name} × ${section.repeats}`}
                className={cn(
                  'flex h-7 items-center gap-1 rounded-md border px-2.5 text-xs font-semibold transition-colors',
                  playing
                    ? 'border-accent bg-accent text-accent-fg'
                    : section.patternId === activePatternId
                      ? 'border-accent/60 bg-accent-soft text-accent'
                      : 'border-line bg-surface-2 text-fg-muted hover:text-fg',
                )}
              >
                {section.name}
                {section.repeats > 1 && <span className="font-mono text-[10px] opacity-70">×{section.repeats}</span>}
              </button>
              {arrangement.length > 1 && (
                <button
                  type="button"
                  aria-label={`Remove ${section.name}`}
                  onClick={() => actions.removeSection(section.id)}
                  className="bg-surface-3 text-fg-muted hover:bg-danger absolute -top-1.5 -right-1.5 hidden size-4 items-center justify-center rounded-full shadow group-hover:flex hover:text-white focus-visible:flex"
                >
                  <X className="size-2.5" />
                </button>
              )}
            </li>
          );
        })}
        {arrangement.length < MAX_SECTIONS && (
          <li className="shrink-0">
            <Menu
              label="Add section"
              align="start"
              trigger={(props) => (
                <button
                  type="button"
                  {...props}
                  aria-label="Add section"
                  className="border-line-strong text-fg-muted hover:border-accent hover:text-accent flex h-7 items-center gap-1 rounded-md border border-dashed px-2 text-xs"
                >
                  <Plus className="size-3.5" /> Add
                </button>
              )}
              items={patterns.map((p) => ({
                label: `Pattern ${p.name}`,
                onSelect: () => actions.addSection({ patternId: p.id }),
              }))}
            />
          </li>
        )}
      </ol>
      <span className="text-fg-subtle shrink-0 font-mono text-[11px] tabular-nums" title="Song length">
        {formatDuration(total)}
      </span>
    </div>
  );
}

'use client';

import { memo, useState } from 'react';
import { ArrowDown, ArrowUp, Copy, Eraser, MoreVertical, SlidersHorizontal, Trash2 } from 'lucide-react';
import { engine } from '@/lib/audio/engine';
import { INSTRUMENTS } from '@/lib/project/instruments';
import type { Track } from '@/lib/project/types';
import { actions } from '@/lib/store/studio';
import { ui } from '@/lib/store/ui';
import { Menu } from '@/components/ui/Menu';
import { cn } from '@/lib/utils/cn';
import { InstrumentBadge } from './InstrumentPicker';

interface TrackHeaderProps {
  track: Track;
  index: number;
  count: number;
  selected: boolean;
}

export const TrackHeader = memo(function TrackHeader({ track, index, count, selected }: TrackHeaderProps) {
  const [renaming, setRenaming] = useState(false);
  const def = INSTRUMENTS[track.instrument];

  return (
    <div
      className={cn(
        'border-line sticky left-0 z-10 flex h-full items-center gap-1.5 border-r pr-1.5 pl-2 transition-colors',
        selected ? 'bg-surface-2' : 'bg-surface',
      )}
      onClick={() => ui.selectTrack(track.id)}
    >
      <span
        aria-hidden
        className={cn(
          'absolute inset-y-1 left-0 w-[3px] rounded-r-full transition-opacity',
          selected ? 'opacity-100' : 'opacity-0',
        )}
        style={{ background: def.color }}
      />
      <InstrumentBadge
        id={track.instrument}
        onClick={() => {
          ui.selectTrack(track.id);
          void engine.preview(track);
        }}
      />
      <div className="hidden min-w-0 flex-1 sm:block">
        {renaming ? (
          <input
            autoFocus
            defaultValue={track.name}
            aria-label="Track name"
            maxLength={80}
            onBlur={(e) => {
              const name = e.target.value.trim();
              if (name && name !== track.name) actions.updateTrack(track.id, { name });
              setRenaming(false);
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') e.currentTarget.blur();
              if (e.key === 'Escape') setRenaming(false);
              e.stopPropagation();
            }}
            className="bg-surface-3 h-6 w-full rounded px-1 text-[13px] font-medium outline-none"
          />
        ) : (
          <button
            type="button"
            onClick={() => ui.selectTrack(track.id)}
            onDoubleClick={() => setRenaming(true)}
            title={`${track.name} (double-click to rename)`}
            aria-current={selected}
            className={cn(
              'block w-full truncate text-left text-[13px] font-medium',
              track.mute ? 'text-fg-subtle line-through' : 'text-fg',
            )}
          >
            {track.name}
          </button>
        )}
      </div>
      <button
        type="button"
        aria-pressed={track.mute}
        aria-label={`Mute ${track.name}`}
        title="Mute (M)"
        onClick={(e) => {
          e.stopPropagation();
          actions.toggleMute(track.id);
        }}
        className={cn(
          'size-6 shrink-0 rounded-md text-[11px] font-bold transition-colors',
          track.mute ? 'bg-danger text-white' : 'bg-surface-3 text-fg-subtle hover:text-fg',
        )}
      >
        M
      </button>
      <button
        type="button"
        aria-pressed={track.solo}
        aria-label={`Solo ${track.name}`}
        title="Solo (S). Alt-click to solo exclusively"
        onClick={(e) => {
          e.stopPropagation();
          actions.toggleSolo(track.id, e.altKey);
        }}
        className={cn(
          'size-6 shrink-0 rounded-md text-[11px] font-bold transition-colors',
          track.solo ? 'bg-warn text-black' : 'bg-surface-3 text-fg-subtle hover:text-fg',
        )}
      >
        S
      </button>
      <Menu
        label={`${track.name} actions`}
        align="start"
        trigger={(props) => (
          <button
            type="button"
            {...props}
            aria-label={`${track.name} actions`}
            className="text-fg-subtle hover:bg-surface-3 hover:text-fg hidden size-6 shrink-0 items-center justify-center rounded-md sm:flex"
          >
            <MoreVertical className="size-3.5" />
          </button>
        )}
        items={[
          {
            label: 'Edit sound',
            icon: <SlidersHorizontal />,
            onSelect: () => {
              ui.selectTrack(track.id);
              ui.set({ inspectorOpen: true, inspectorTab: 'sound' });
            },
          },
          {
            label: 'Duplicate',
            icon: <Copy />,
            hint: '⌘D',
            disabled: count >= 16,
            onSelect: () => {
              const id = actions.duplicateTrack(track.id);
              if (id) ui.selectTrack(id);
            },
          },
          { label: 'Clear steps', icon: <Eraser />, hint: 'Del', onSelect: () => actions.clearTrack(track.id) },
          'separator',
          {
            label: 'Move up',
            icon: <ArrowUp />,
            disabled: index === 0,
            onSelect: () => actions.moveTrack(index, index - 1),
          },
          {
            label: 'Move down',
            icon: <ArrowDown />,
            disabled: index === count - 1,
            onSelect: () => actions.moveTrack(index, index + 1),
          },
          'separator',
          {
            label: 'Delete track',
            icon: <Trash2 />,
            danger: true,
            onSelect: () => {
              actions.removeTrack(track.id);
              ui.toast(`Deleted ${track.name}`, 'info', { label: 'Undo', run: actions.undo });
            },
          },
        ]}
      />
      <span
        data-meter={track.id}
        aria-hidden
        className="bg-surface-3 relative ml-auto h-7 w-1 shrink-0 overflow-hidden rounded-full [--level:0] sm:ml-0"
      >
        <span
          className="bg-success [[data-clip=true]>&]:bg-danger absolute inset-x-0 bottom-0 h-full origin-bottom rounded-full transition-none"
          style={{ transform: 'scaleY(var(--level))' }}
        />
      </span>
    </div>
  );
});

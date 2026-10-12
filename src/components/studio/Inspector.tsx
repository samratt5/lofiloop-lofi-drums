'use client';

import { ChevronDown, ChevronUp } from 'lucide-react';
import { INSTRUMENTS } from '@/lib/project/instruments';
import { selectActivePattern, useStudio } from '@/lib/store/studio';
import { ui, useUi, type InspectorTab } from '@/lib/store/ui';
import { IconButton } from '@/components/ui/Button';
import { cn } from '@/lib/utils/cn';
import { InstrumentBadge } from './InstrumentPicker';
import { Lanes } from './Lanes';
import { PianoRoll } from './PianoRoll';
import { SoundPanel } from './SoundPanel';

export function Inspector() {
  const selectedId = useUi((s) => s.selectedTrackId);
  const open = useUi((s) => s.inspectorOpen);
  const tab = useUi((s) => s.inspectorTab);
  const track = useStudio((s) => s.project.tracks.find((t) => t.id === selectedId) ?? s.project.tracks[0]);
  const pattern = useStudio(selectActivePattern);

  if (!track) return null;
  const def = INSTRUMENTS[track.instrument];
  const tabs: { id: InspectorTab; label: string; hidden?: boolean }[] = [
    { id: 'sound', label: 'Sound' },
    { id: 'notes', label: 'Notes', hidden: !def.melodic },
    { id: 'lanes', label: 'Velocity' },
  ];
  const current = tab === 'notes' && !def.melodic ? 'sound' : tab;

  return (
    <section
      data-tour="inspector"
      aria-label={`${track.name} inspector`}
      className={cn(
        'border-line bg-surface flex shrink-0 flex-col border-t transition-[height] duration-200',
        open ? 'h-[248px] sm:h-[272px]' : 'h-10',
      )}
    >
      <div className="border-line flex h-10 shrink-0 items-center gap-2 border-b px-2 sm:px-3">
        <InstrumentBadge id={track.instrument} />
        <span className="max-w-40 truncate text-sm font-semibold">{track.name}</span>
        <div role="tablist" aria-label="Inspector" className="ml-2 flex items-center gap-0.5">
          {tabs
            .filter((t) => !t.hidden)
            .map((t) => (
              <button
                key={t.id}
                type="button"
                role="tab"
                aria-selected={current === t.id}
                onClick={() => ui.set({ inspectorTab: t.id, inspectorOpen: true })}
                className={cn(
                  'h-7 rounded-md px-2.5 text-xs font-medium transition-colors',
                  current === t.id && open ? 'bg-surface-3 text-fg' : 'text-fg-muted hover:text-fg',
                )}
              >
                {t.label}
              </button>
            ))}
        </div>
        <IconButton
          label={open ? 'Collapse inspector' : 'Expand inspector'}
          tip="top"
          className="ml-auto"
          onClick={() => ui.set({ inspectorOpen: !open })}
        >
          {open ? <ChevronDown /> : <ChevronUp />}
        </IconButton>
      </div>
      {open && (
        <div role="tabpanel" className="min-h-0 flex-1 overflow-auto">
          {current === 'sound' && <SoundPanel track={track} />}
          {current === 'notes' && <PianoRoll track={track} pattern={pattern} />}
          {current === 'lanes' && <Lanes track={track} pattern={pattern} />}
        </div>
      )}
    </section>
  );
}

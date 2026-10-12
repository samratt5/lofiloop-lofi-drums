'use client';

import { INSTRUMENTS } from '@/lib/project/instruments';
import { actions, useStudio } from '@/lib/store/studio';
import { ui, useUi } from '@/lib/store/ui';
import { Fader } from '@/components/ui/Fader';
import { Knob } from '@/components/ui/Knob';
import { formatPan } from '@/lib/utils/params';
import { formatPercent } from '@/lib/utils/format';
import { cn } from '@/lib/utils/cn';
import { InstrumentBadge } from './InstrumentPicker';

export function MixerPanel() {
  const tracks = useStudio((s) => s.project.tracks);
  const selected = useUi((s) => s.selectedTrackId);
  const anySolo = tracks.some((t) => t.solo);

  return (
    <ul className="flex flex-col gap-1.5 p-3" aria-label="Mixer">
      {tracks.map((t) => {
        const audible = !t.mute && (!anySolo || t.solo);
        return (
          <li
            key={t.id}
            className={cn(
              'rounded-xl border p-2.5 transition-colors',
              t.id === selected ? 'border-line-strong bg-surface-2' : 'border-line bg-surface-2/40',
              !audible && 'opacity-60',
            )}
            onClick={() => ui.selectTrack(t.id)}
          >
            <div className="mb-1.5 flex items-center gap-2">
              <InstrumentBadge id={t.instrument} />
              <span className="min-w-0 flex-1 truncate text-[13px] font-medium">{t.name}</span>
              <button
                type="button"
                aria-pressed={t.mute}
                aria-label={`Mute ${t.name}`}
                onClick={() => actions.toggleMute(t.id)}
                className={cn(
                  'size-6 rounded-md text-[11px] font-bold',
                  t.mute ? 'bg-danger text-white' : 'bg-surface-3 text-fg-subtle hover:text-fg',
                )}
              >
                M
              </button>
              <button
                type="button"
                aria-pressed={t.solo}
                aria-label={`Solo ${t.name}`}
                onClick={(e) => actions.toggleSolo(t.id, e.altKey)}
                className={cn(
                  'size-6 rounded-md text-[11px] font-bold',
                  t.solo ? 'bg-warn text-black' : 'bg-surface-3 text-fg-subtle hover:text-fg',
                )}
              >
                S
              </button>
            </div>
            <div className="flex items-center gap-3">
              <div className="flex flex-1 flex-col gap-0.5">
                <div className="text-fg-subtle flex justify-between text-[10px]">
                  <span>Volume</span>
                  <span className="font-mono">{formatPercent(t.volume)}</span>
                </div>
                <Fader
                  label={`${t.name} volume`}
                  value={t.volume}
                  defaultValue={0.8}
                  onChange={(v) => actions.updateTrack(t.id, { volume: v })}
                  format={formatPercent}
                />
                <span
                  data-meter={t.id}
                  aria-hidden
                  className="bg-surface-3 relative mt-0.5 h-1 overflow-hidden rounded-full [--level:0]"
                >
                  <span
                    className="absolute inset-y-0 left-0 w-full origin-left rounded-full"
                    style={{ transform: 'scaleX(var(--level))', background: INSTRUMENTS[t.instrument].color }}
                  />
                </span>
              </div>
              <Knob
                label="Pan"
                size={32}
                value={t.pan}
                min={-1}
                max={1}
                defaultValue={0}
                bipolar
                format={formatPan}
                onChange={(v) => actions.updateTrack(t.id, { pan: v })}
              />
              <Knob
                label="Verb"
                size={32}
                value={t.reverb}
                min={0}
                max={1}
                defaultValue={0}
                format={formatPercent}
                onChange={(v) => actions.updateTrack(t.id, { reverb: v })}
              />
              <Knob
                label="Echo"
                size={32}
                value={t.delay}
                min={0}
                max={1}
                defaultValue={0}
                format={formatPercent}
                onChange={(v) => actions.updateTrack(t.id, { delay: v })}
              />
            </div>
          </li>
        );
      })}
    </ul>
  );
}

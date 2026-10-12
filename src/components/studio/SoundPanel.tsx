'use client';

import { useCallback, useState } from 'react';
import { ChevronDown, Play, RotateCcw } from 'lucide-react';
import { engine } from '@/lib/audio/engine';
import type { ChordType } from '@/lib/music/theory';
import { INSTRUMENTS } from '@/lib/project/instruments';
import type { Track } from '@/lib/project/types';
import { actions } from '@/lib/store/studio';
import { Button } from '@/components/ui/Button';
import { Knob } from '@/components/ui/Knob';
import { Popover } from '@/components/ui/Popover';
import { Segmented } from '@/components/ui/Segmented';
import { formatPan, formatParam } from '@/lib/utils/params';
import { formatPercent } from '@/lib/utils/format';
import { expMap } from '@/lib/utils/math';
import { InstrumentBadge, InstrumentPicker } from './InstrumentPicker';
import { SamplePanel } from './SamplePanel';

const CHORDS: { value: ChordType; label: string; title: string }[] = [
  { value: 'off', label: 'Single', title: 'Play single notes' },
  { value: 'triad', label: 'Triad', title: 'Diatonic 3-note chords' },
  { value: 'seventh', label: '7th', title: 'Diatonic 7th chords' },
  { value: 'ninth', label: '9th', title: 'Diatonic 9th chords' },
];

function Section({ title, children, className }: { title: string; children: React.ReactNode; className?: string }) {
  return (
    <section className={className}>
      <h3 className="text-fg-subtle mb-2 text-[10px] font-semibold tracking-widest uppercase">{title}</h3>
      {children}
    </section>
  );
}

export function SoundPanel({ track }: { track: Track }) {
  const def = INSTRUMENTS[track.instrument];
  const [anchor, setAnchor] = useState<{ x: number; y: number } | null>(null);
  const close = useCallback(() => setAnchor(null), []);

  return (
    <div className="flex flex-wrap items-start gap-x-8 gap-y-4 p-4">
      {def.sampler && <SamplePanel track={track} />}
      <Section title="Instrument" className="w-full sm:w-52">
        <button
          type="button"
          onClick={(e) => {
            const r = e.currentTarget.getBoundingClientRect();
            setAnchor(anchor ? null : { x: r.left + 170, y: r.bottom });
          }}
          className="border-line bg-surface-2 hover:border-line-strong flex h-10 w-full items-center gap-2 rounded-lg border px-2 text-left text-sm font-medium"
        >
          <InstrumentBadge id={track.instrument} />
          <span className="flex-1 truncate">{def.name}</span>
          <ChevronDown className="text-fg-subtle size-4" />
        </button>
        <div className="mt-2 flex gap-1.5">
          <Button size="sm" icon={<Play />} onClick={() => void engine.preview(track)} className="flex-1">
            Preview
          </Button>
          <Button
            size="sm"
            variant="ghost"
            icon={<RotateCcw />}
            onClick={() => actions.resetParams(track.id)}
            title="Reset sound to default"
          >
            Reset
          </Button>
        </div>
        {anchor && (
          <Popover anchor={anchor} onClose={close} label="Change instrument" className="w-[340px]">
            <InstrumentPicker
              value={track.instrument}
              onSelect={(id) => {
                actions.changeInstrument(track.id, id);
                close();
              }}
            />
          </Popover>
        )}
      </Section>

      <Section title="Sound">
        <div className="flex flex-wrap gap-3">
          {def.params.map((p) => (
            <Knob
              key={p.id}
              label={p.label}
              value={track.params[p.id] ?? p.default}
              min={p.min}
              max={p.max}
              step={p.step}
              defaultValue={p.default}
              log={p.unit === 'hz' || (p.unit === 's' && p.min > 0)}
              color={def.color}
              format={(v) => formatParam(p, v)}
              onChange={(v) => actions.setParam(track.id, p.id, v)}
            />
          ))}
        </div>
      </Section>

      <Section title="Mix">
        <div className="flex flex-wrap gap-3">
          <Knob
            label="Volume"
            value={track.volume}
            min={0}
            max={1}
            defaultValue={0.8}
            format={formatPercent}
            onChange={(v) => actions.updateTrack(track.id, { volume: v })}
          />
          <Knob
            label="Pan"
            value={track.pan}
            min={-1}
            max={1}
            defaultValue={0}
            bipolar
            format={formatPan}
            onChange={(v) => actions.updateTrack(track.id, { pan: v })}
          />
          <Knob
            label="Reverb"
            value={track.reverb}
            min={0}
            max={1}
            defaultValue={0}
            format={formatPercent}
            onChange={(v) => actions.updateTrack(track.id, { reverb: v })}
          />
          <Knob
            label="Delay"
            value={track.delay}
            min={0}
            max={1}
            defaultValue={0}
            format={formatPercent}
            onChange={(v) => actions.updateTrack(track.id, { delay: v })}
          />
          <Knob
            label="Duck"
            value={track.duck}
            min={0}
            max={1}
            defaultValue={0}
            format={formatPercent}
            onChange={(v) => actions.updateTrack(track.id, { duck: v })}
          />
        </div>
      </Section>

      <Section title="Effects">
        <div className="flex flex-wrap gap-3">
          <Knob
            label="Filter"
            value={track.fx.cutoff}
            min={0}
            max={1}
            defaultValue={1}
            format={(v) => (v >= 0.999 ? 'Open' : `${Math.round(expMap(v, 120, 20000))} Hz`)}
            onChange={(v) => actions.setTrackFx(track.id, { cutoff: v })}
          />
          <Knob
            label="Reso"
            value={track.fx.resonance}
            min={0}
            max={1}
            defaultValue={0.1}
            format={formatPercent}
            onChange={(v) => actions.setTrackFx(track.id, { resonance: v })}
          />
          <Knob
            label="Low cut"
            value={track.fx.highpass}
            min={0}
            max={1}
            defaultValue={0}
            format={(v) => (v <= 0.001 ? 'Off' : `${Math.round(20 * Math.pow(2, v * 9))} Hz`)}
            onChange={(v) => actions.setTrackFx(track.id, { highpass: v })}
          />
          <Knob
            label="Drive"
            value={track.fx.drive}
            min={0}
            max={1}
            defaultValue={0}
            format={formatPercent}
            onChange={(v) => actions.setTrackFx(track.id, { drive: v })}
          />
          <Knob
            label="Crush"
            value={track.fx.crush}
            min={0}
            max={1}
            defaultValue={0}
            format={(v) => (v < 0.01 ? 'Off' : `${Math.round(12 - v * 9)} bit`)}
            onChange={(v) => actions.setTrackFx(track.id, { crush: v })}
          />
          <Knob
            label="Chorus"
            value={track.fx.chorus}
            min={0}
            max={1}
            defaultValue={0}
            format={formatPercent}
            onChange={(v) => actions.setTrackFx(track.id, { chorus: v })}
          />
        </div>
      </Section>

      <Section title="Feel">
        <div className="flex flex-wrap gap-3">
          <Knob
            label="Timing"
            value={track.feel}
            min={-1}
            max={1}
            defaultValue={0}
            bipolar
            format={(v) =>
              Math.abs(v) < 0.02 ? 'On grid' : `${v > 0 ? 'Late' : 'Early'} ${Math.round(Math.abs(v) * 30)} ms`
            }
            onChange={(v) => actions.updateTrack(track.id, { feel: v })}
          />
          <Knob
            label="Humanize"
            value={track.humanize}
            min={0}
            max={1}
            defaultValue={0}
            format={formatPercent}
            onChange={(v) => actions.updateTrack(track.id, { humanize: v })}
          />
        </div>
      </Section>

      {def.polyphonic && (
        <Section title="Chords">
          <Segmented
            label="Chord mode"
            value={track.chord}
            options={CHORDS}
            onChange={(v) => actions.setChord(track.id, v)}
          />
          <p className="text-fg-subtle mt-2 max-w-52 text-xs">Each note plays a chord built from the project key.</p>
        </Section>
      )}
    </div>
  );
}

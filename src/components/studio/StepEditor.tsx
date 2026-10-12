'use client';

import { useCallback } from 'react';
import { Minus, Play, Plus } from 'lucide-react';
import { engine } from '@/lib/audio/engine';
import { buildChord, noteName } from '@/lib/music/theory';
import { INSTRUMENTS } from '@/lib/project/instruments';
import type { Track } from '@/lib/project/types';
import { actions, selectActivePattern, useStudio } from '@/lib/store/studio';
import { useUi, type StepEditorTarget } from '@/lib/store/ui';
import { Button, IconButton } from '@/components/ui/Button';
import { Fader } from '@/components/ui/Fader';
import { Popover } from '@/components/ui/Popover';
import { Segmented } from '@/components/ui/Segmented';
import { formatPercent } from '@/lib/utils/format';

function Row({ label, value, children }: { label: string; value?: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-baseline justify-between">
        <span className="text-fg-subtle text-[10px] font-semibold tracking-widest uppercase">{label}</span>
        {value && <span className="text-fg-muted font-mono text-[11px] tabular-nums">{value}</span>}
      </div>
      {children}
    </div>
  );
}

export function StepEditor({ target, track }: { target: StepEditorTarget; track: Track }) {
  const step = useStudio((s) => selectActivePattern(s).steps[track.id]?.[target.index]);
  const root = useStudio((s) => s.project.root);
  const scale = useStudio((s) => s.project.scale);
  const close = useCallback(() => useUi.setState({ stepEditor: null }), []);
  if (!step) return null;

  const def = INSTRUMENTS[track.instrument];
  const set = (patch: Parameters<typeof actions.setStep>[2], key?: string) =>
    actions.setStep(track.id, target.index, { on: true, ...patch }, key && `step:${track.id}:${target.index}:${key}`);
  const [lo, hi] = def.noteRange;
  const chordNotes = def.polyphonic && track.chord !== 'off' ? buildChord(step.note, track.chord, root, scale) : null;

  return (
    <Popover anchor={target.anchor} onClose={close} label={`${track.name} step ${target.index + 1}`} className="w-64">
      <div className="mb-3 flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold">{track.name}</p>
          <p className="text-fg-muted text-xs">
            Step {target.index + 1} · {step.on ? 'on' : 'off'}
          </p>
        </div>
        <div className="flex shrink-0 gap-1">
          <IconButton label="Preview" tip="none" onClick={() => void engine.preview(track, step.note, step.vel)}>
            <Play />
          </IconButton>
          <Button
            size="xs"
            variant={step.on ? 'secondary' : 'primary'}
            onClick={() => actions.toggleStep(track.id, target.index)}
          >
            {step.on ? 'Turn off' : 'Turn on'}
          </Button>
        </div>
      </div>

      <div className="flex flex-col gap-3">
        {def.melodic && (
          <Row label="Note" value={chordNotes ? chordNotes.map((n) => noteName(n, false)).join(' ') : undefined}>
            <div className="flex items-center gap-1">
              <IconButton
                label="Octave down"
                tip="none"
                size="xs"
                variant="secondary"
                disabled={step.note - 12 < lo}
                onClick={() => set({ note: step.note - 12 })}
              >
                <span className="font-mono text-[9px] font-bold">−12</span>
              </IconButton>
              <IconButton
                label="Semitone down"
                tip="none"
                size="xs"
                variant="secondary"
                disabled={step.note - 1 < lo}
                onClick={() => set({ note: step.note - 1 })}
              >
                <Minus />
              </IconButton>
              <span className="flex-1 text-center font-mono text-sm font-semibold">{noteName(step.note)}</span>
              <IconButton
                label="Semitone up"
                tip="none"
                size="xs"
                variant="secondary"
                disabled={step.note + 1 > hi}
                onClick={() => set({ note: step.note + 1 })}
              >
                <Plus />
              </IconButton>
              <IconButton
                label="Octave up"
                tip="none"
                size="xs"
                variant="secondary"
                disabled={step.note + 12 > hi}
                onClick={() => set({ note: step.note + 12 })}
              >
                <span className="font-mono text-[9px] font-bold">+12</span>
              </IconButton>
            </div>
          </Row>
        )}
        <Row label="Velocity" value={formatPercent(step.vel)}>
          <Fader
            label="Velocity"
            value={step.vel}
            min={0.05}
            max={1}
            defaultValue={0.8}
            onChange={(v) => set({ vel: v }, 'vel')}
            format={formatPercent}
          />
        </Row>
        <Row label="Chance" value={formatPercent(step.prob)}>
          <Fader
            label="Chance"
            value={step.prob}
            min={0}
            max={1}
            defaultValue={1}
            onChange={(v) => set({ prob: v }, 'prob')}
            format={formatPercent}
          />
        </Row>
        <Row
          label="Timing"
          value={
            Math.abs(step.offset) < 0.01
              ? 'On grid'
              : `${step.offset > 0 ? 'Late' : 'Early'} ${Math.round(Math.abs(step.offset) * 100)}%`
          }
        >
          <Fader
            label="Timing"
            value={step.offset}
            min={-0.5}
            max={0.5}
            step={0.01}
            defaultValue={0}
            onChange={(v) => set({ offset: v }, 'offset')}
          />
        </Row>
        <Row label="Repeat">
          <Segmented
            label="Ratchet"
            size="xs"
            value={String(step.ratchet)}
            onChange={(v) => set({ ratchet: Number(v) })}
            options={['1', '2', '3', '4'].map((v) => ({ value: v, label: `${v}×` }))}
            className="w-full [&>button]:flex-1"
          />
        </Row>
        {def.melodic && (
          <Row label="Length" value={`${step.len} step${step.len > 1 ? 's' : ''}`}>
            <Fader
              label="Length"
              value={step.len}
              min={1}
              max={16}
              step={1}
              defaultValue={1}
              onChange={(v) => set({ len: v }, 'len')}
            />
          </Row>
        )}
      </div>
    </Popover>
  );
}

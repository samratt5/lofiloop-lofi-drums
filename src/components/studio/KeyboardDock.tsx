'use client';

import { useEffect, useState, useSyncExternalStore } from 'react';
import { Cable, Circle, Minus, OctagonX, Plus, Square, X } from 'lucide-react';
import { liveInput } from '@/lib/input/live';
import { MAX_OCTAVE, MIN_OCTAVE, PIANO_KEYS, PIANO_SPAN } from '@/lib/input/keymap';
import { INSTRUMENTS } from '@/lib/project/instruments';
import { useStudio } from '@/lib/store/studio';
import { ui, useUi } from '@/lib/store/ui';
import { Button, IconButton } from '@/components/ui/Button';
import { Fader } from '@/components/ui/Fader';
import { Segmented } from '@/components/ui/Segmented';
import { Select } from '@/components/ui/Select';
import { cn } from '@/lib/utils/cn';
import { formatPercent } from '@/lib/utils/format';

const WHITE = new Set([0, 2, 4, 5, 7, 9, 11]);

export function useLiveInput() {
  return useSyncExternalStore(liveInput.subscribe, liveInput.getState, liveInput.getState);
}

/** Legend for each semitone: the upper row wins where the two rows overlap. */
const LABELS = new Map<number, string>();
for (const k of PIANO_KEYS) if (!LABELS.has(k.semitone) || k.row === 'upper') LABELS.set(k.semitone, k.label);
const SEMITONES = Array.from({ length: PIANO_SPAN + 1 }, (_, i) => i);
const WHITES = SEMITONES.filter((s) => WHITE.has(s % 12));

/** Semitone (above the base C) of each computer key. */
const SEMITONE_OF = new Map(PIANO_KEYS.map((k) => [k.code, k.semitone]));

function Keys({ base, heldKeys }: { base: number; heldKeys: string[] }) {
  // Pointer presses are tracked here: the engine reports the note it played,
  // which can differ from the key (drums, notes folded into an instrument's range).
  const [pointers, setPointers] = useState<Record<number, number>>({});
  const lit = new Set([...heldKeys.map((c) => SEMITONE_OF.get(c) ?? -1), ...Object.values(pointers)]);

  const down = (semitone: number, pointerId: number) => {
    if (!liveInput.pointerDown(base + semitone, pointerId)) {
      ui.toast('Select a track to play it', 'info');
      return;
    }
    setPointers((p) => ({ ...p, [pointerId]: semitone }));
  };
  const up = (pointerId: number) => {
    liveInput.pointerUp(pointerId);
    setPointers((p) => {
      if (!(pointerId in p)) return p;
      const next = { ...p };
      delete next[pointerId];
      return next;
    });
  };

  const keyProps = (semitone: number) => ({
    'aria-label': `Note ${base + semitone}`,
    'data-held': lit.has(semitone) || undefined,
    onPointerDown: (e: React.PointerEvent) => {
      e.preventDefault();
      (e.currentTarget as HTMLElement).releasePointerCapture?.(e.pointerId);
      down(semitone, e.pointerId);
    },
    onPointerEnter: (e: React.PointerEvent) => {
      // Glide across keys while the button is held.
      if (e.buttons !== 1) return;
      up(e.pointerId);
      down(semitone, e.pointerId);
    },
    onPointerLeave: (e: React.PointerEvent) => up(e.pointerId),
    onPointerUp: (e: React.PointerEvent) => up(e.pointerId),
    onPointerCancel: (e: React.PointerEvent) => up(e.pointerId),
  });
  const whiteWidth = 100 / WHITES.length;
  return (
    <div className="relative h-24 touch-none select-none sm:h-28" role="group" aria-label="On-screen keyboard">
      <div className="flex h-full gap-px">
        {WHITES.map((s) => (
          <button
            key={s}
            type="button"
            tabIndex={-1}
            {...keyProps(s)}
            className="flex flex-1 items-end justify-center rounded-b-md bg-[#f4efe6] pb-1.5 text-[10px] font-semibold text-black/45 shadow-[inset_0_-3px_0_rgb(0_0_0/0.12)] data-[held]:bg-[var(--accent)] data-[held]:text-[var(--accent-fg)]"
          >
            <span className="flex flex-col items-center leading-tight">
              {s % 12 === 0 && <span className="text-black/30">C{Math.floor((base + s) / 12) - 1}</span>}
              {LABELS.get(s)}
            </span>
          </button>
        ))}
      </div>
      {SEMITONES.filter((s) => !WHITE.has(s % 12)).map((s) => {
        const whitesBefore = WHITES.filter((w) => w < s).length;
        return (
          <button
            key={s}
            type="button"
            tabIndex={-1}
            {...keyProps(s)}
            className="absolute top-0 flex h-[60%] items-end justify-center rounded-b-md bg-[#1c1a1f] pb-1 text-[9px] font-semibold text-white/50 shadow-[inset_0_-3px_0_rgb(255_255_255/0.08)] data-[held]:bg-[var(--accent)] data-[held]:text-[var(--accent-fg)]"
            style={{
              left: `calc(${whitesBefore * whiteWidth}% - ${whiteWidth * 0.32}%)`,
              width: `${whiteWidth * 0.64}%`,
            }}
          >
            {LABELS.get(s)}
          </button>
        );
      })}
    </div>
  );
}

function MidiControls() {
  const state = useLiveInput();
  if (!state.midiSupported) return null;
  if (!state.midiEnabled) {
    return (
      <div className="flex items-center gap-2">
        <Button
          size="xs"
          variant="outline"
          icon={<Cable />}
          disabled={state.midiStatus === 'connecting'}
          onClick={() => void liveInput.enableMidi()}
        >
          {state.midiStatus === 'connecting' ? 'Connecting…' : 'Use MIDI keyboard'}
        </Button>
        {state.midiError && <span className="text-danger text-xs">{state.midiError}</span>}
      </div>
    );
  }
  return (
    <div className="flex items-center gap-1.5">
      <Cable className="text-success size-4" aria-label="MIDI connected" />
      <Select
        aria-label="MIDI input"
        size="sm"
        value={state.midiInput}
        onChange={(e) => liveInput.setMidiInput(e.target.value)}
      >
        <option value="all">All MIDI inputs ({state.midiDevices.length})</option>
        {state.midiDevices.map((d) => (
          <option key={d.id} value={d.id}>
            {d.name}
          </option>
        ))}
      </Select>
      <Select
        aria-label="MIDI channel"
        size="sm"
        value={state.midiChannel ?? 0}
        onChange={(e) => liveInput.setMidiChannel(Number(e.target.value) || null)}
      >
        <option value={0}>Any channel</option>
        {Array.from({ length: 16 }, (_, i) => (
          <option key={i} value={i + 1}>
            Channel {i + 1}
          </option>
        ))}
      </Select>
      <IconButton label="Disconnect MIDI" size="xs" onClick={() => liveInput.disableMidi()}>
        <X />
      </IconButton>
    </div>
  );
}

export function RecordButton({ size = 'md' }: { size?: 'sm' | 'md' }) {
  const { recording } = useLiveInput();
  const view = useUi((s) => s.mainView);
  const cursor = useUi((s) => s.songCursor);
  const active = recording.status === 'countIn' || recording.status === 'recording';
  return (
    <IconButton
      label={
        active ? 'Stop recording' : 'Record (plays a count-in, then records what you play into the selected track)'
      }
      size={size}
      active={active}
      className={cn(active && 'text-danger', recording.status === 'countIn' && 'animate-pulse')}
      onClick={() => {
        if (active) {
          liveInput.recorder.stop();
          return;
        }
        if (!useUi.getState().selectedTrackId) {
          ui.toast('Select a track to record into', 'info');
          return;
        }
        if (!liveInput.getState().pianoOn) liveInput.enablePiano(true);
        void liveInput.recorder.start({ fromBar: view === 'song' ? Math.floor(cursor) : undefined });
      }}
    >
      {active ? <Square className="fill-current" /> : <Circle className="text-danger fill-current" />}
    </IconButton>
  );
}

/** Play the selected track from the computer keyboard, the screen or a MIDI keyboard, and record takes. */
export function KeyboardDock() {
  const state = useLiveInput();
  const trackId = useUi((s) => s.selectedTrackId);
  const track = useStudio((s) => s.project.tracks.find((t) => t.id === trackId) ?? null);

  // Leave nothing held or listening when the studio goes away.
  useEffect(() => () => liveInput.enablePiano(false), []);

  if (!state.pianoOn && !state.midiEnabled) return null;
  const base = (state.octave + 1) * 12;
  const { recording } = state;
  const def = track ? INSTRUMENTS[track.instrument] : null;

  return (
    <section
      aria-label="Keyboard"
      className="border-line bg-surface shrink-0 border-t px-2 pt-2 pb-2 sm:px-3"
      data-tour="keyboard"
    >
      <div className="mb-2 flex flex-wrap items-center gap-x-3 gap-y-1.5">
        <div className="flex min-w-0 items-center gap-2">
          <span className="size-2.5 shrink-0 rounded-full" style={{ background: def?.color ?? 'var(--fg-subtle)' }} />
          <span className="truncate text-sm font-semibold">{track ? track.name : 'No track selected'}</span>
        </div>
        <div className="flex items-center gap-0.5" role="group" aria-label="Octave">
          <IconButton
            label="Octave down (←)"
            size="xs"
            disabled={state.octave <= MIN_OCTAVE}
            onClick={() => liveInput.shiftOctave(-1)}
          >
            <Minus />
          </IconButton>
          <span className="w-8 text-center font-mono text-xs font-semibold">C{state.octave}</span>
          <IconButton
            label="Octave up (→)"
            size="xs"
            disabled={state.octave >= MAX_OCTAVE}
            onClick={() => liveInput.shiftOctave(1)}
          >
            <Plus />
          </IconButton>
        </div>
        <div className="w-28">
          <Fader
            label="Velocity"
            value={state.velocity}
            min={0.1}
            max={1}
            defaultValue={0.8}
            format={formatPercent}
            onChange={(v) => liveInput.setVelocity(v)}
          />
        </div>
        <span className="bg-line hidden h-5 w-px sm:block" />
        <div className="flex flex-wrap items-center gap-1.5">
          <RecordButton size="sm" />
          <span className="text-fg-muted w-28 text-xs whitespace-nowrap" aria-live="polite">
            {recording.status === 'countIn'
              ? `Count-in ${Math.ceil(recording.countIn / 4)}…`
              : recording.status === 'recording'
                ? `Recording · ${recording.notes} note${recording.notes === 1 ? '' : 's'}`
                : 'Ready to record'}
          </span>
          <Select
            aria-label="Count-in"
            wrapperClassName="shrink-0"
            size="sm"
            value={recording.options.countInBars}
            onChange={(e) => liveInput.recorder.arm({ countInBars: Number(e.target.value) })}
          >
            <option value={0}>No count-in</option>
            <option value={1}>1 bar count-in</option>
            <option value={2}>2 bars count-in</option>
          </Select>
          <Select
            aria-label="Quantize"
            wrapperClassName="shrink-0"
            size="sm"
            value={recording.options.quantize}
            onChange={(e) => liveInput.recorder.arm({ quantize: Number(e.target.value) })}
          >
            <option value={0}>No quantize</option>
            <option value={0.5}>Quantize 50%</option>
            <option value={0.75}>Quantize 75%</option>
            <option value={1}>Quantize 100%</option>
          </Select>
          <Segmented
            label="Record mode"
            size="xs"
            value={recording.options.mode}
            onChange={(mode) => liveInput.recorder.arm({ mode })}
            options={[
              { value: 'overdub', label: 'Overdub', title: 'Add notes to what is there' },
              { value: 'replace', label: 'Replace', title: 'Clear the track as the take passes' },
            ]}
          />
        </div>
        <div className="ml-auto flex items-center gap-1">
          <MidiControls />
          <IconButton label="Stop all notes" size="xs" onClick={() => liveInput.panic()}>
            <OctagonX />
          </IconButton>
          <IconButton
            label="Close keyboard (Esc)"
            size="xs"
            onClick={() => {
              liveInput.enablePiano(false);
              if (state.midiEnabled) liveInput.disableMidi();
            }}
          >
            <X />
          </IconButton>
        </div>
      </div>
      <Keys base={base} heldKeys={state.heldKeys} />
    </section>
  );
}

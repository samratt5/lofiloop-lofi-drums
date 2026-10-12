/**
 * Live playing: routes the computer keyboard, an on-screen keyboard and MIDI
 * inputs to the selected track, keeps held-note bookkeeping (no stuck notes)
 * and feeds the recorder. Framework-agnostic; the UI reads `getState()` via
 * `subscribe` (useSyncExternalStore-friendly).
 */
import { engine, type LiveNote } from '@/lib/audio/engine';
import { INSTRUMENTS } from '@/lib/project/instruments';
import type { Track } from '@/lib/project/types';
import { getProject, useStudio } from '@/lib/store/studio';
import { useUi } from '@/lib/store/ui';
import {
  ACCENT_VELOCITY,
  clampOctave,
  DEFAULT_OCTAVE,
  DEFAULT_VELOCITY,
  isEditableTarget,
  isPianoReserved,
  keyToNote,
  octaveShift,
  ownsArrowKeys,
} from './keymap';
import {
  midiSupported,
  MidiAccessError,
  requestMidi,
  type MidiAccessHandle,
  type MidiDevice,
  type MidiInputSelection,
  type MidiNoteEvent,
} from './midi';
import { Recorder, type RecorderState } from './recorder';

export type NoteSource = 'keyboard' | 'pointer' | 'midi';

export type MidiStatus = 'off' | 'connecting' | 'on' | 'error';

export interface LiveInputState {
  pianoOn: boolean;
  /** Base octave of the computer keyboard (lower row starts at C of this octave) */
  octave: number;
  /** Velocity for unaccented keyboard/pointer notes, 0..1 */
  velocity: number;
  /** MIDI notes currently held, ascending */
  heldNotes: number[];
  /** `KeyboardEvent.code`s currently held, for lighting up a key legend */
  heldKeys: string[];
  midiSupported: boolean;
  midiEnabled: boolean;
  midiStatus: MidiStatus;
  midiError: string | null;
  midiDevices: MidiDevice[];
  midiInput: MidiInputSelection;
  /** 1..16, or null for all channels */
  midiChannel: number | null;
  recording: RecorderState;
}

export interface LiveNoteEvent {
  type: 'noteon' | 'noteoff';
  /** Pairs a note-on with its note-off, e.g. `key:KeyZ`, `pointer:1`, `midi:<input>:<ch>:<note>` */
  id: string;
  source: NoteSource;
  trackId: string;
  note: number;
  velocity: number;
  time: number;
}

interface Held {
  id: string;
  source: NoteSource;
  code: string | null;
  trackId: string;
  note: number;
  velocity: number;
  melodic: boolean;
  live: LiveNote | null;
  /** Released (or retriggered by a mono track) before `engine.noteOn` resolved */
  ended: boolean;
  /** Choked by a newer note on a mono track; still physically held */
  silenced: boolean;
  /** Stop even a one-shot (panic) */
  forced: boolean;
}

/** Fold a note by octaves into an instrument's playable range. */
export function foldIntoRange(note: number, [lo, hi]: [number, number]): number {
  if (hi - lo < 11) return Math.min(hi, Math.max(lo, note));
  let n = note;
  while (n < lo) n += 12;
  while (n > hi) n -= 12;
  return n;
}

/** Capture phase: runs before the app's own (bubble-phase) hotkeys, which skip prevented events. */
const CAPTURE = { capture: true } as const;

function modalOpen(): boolean {
  return typeof document !== 'undefined' && Boolean(document.querySelector?.('dialog[open]'));
}

export class LiveInput {
  readonly recorder: Recorder;
  private state: LiveInputState;
  private readonly listeners = new Set<() => void>();
  private readonly noteListeners = new Set<(event: LiveNoteEvent) => void>();
  private readonly held = new Map<string, Held>();
  private midi: MidiAccessHandle | null = null;
  private midiUnsubs: (() => void)[] = [];
  private midiRequest = 0;
  private globalCleanup: (() => void) | null = null;

  constructor(recorder = new Recorder()) {
    this.recorder = recorder;
    this.state = {
      pianoOn: false,
      octave: DEFAULT_OCTAVE,
      velocity: DEFAULT_VELOCITY,
      heldNotes: [],
      heldKeys: [],
      midiSupported: midiSupported(),
      midiEnabled: false,
      midiStatus: 'off',
      midiError: null,
      midiDevices: [],
      midiInput: 'all',
      midiChannel: null,
      recording: recorder.getState(),
    };
    recorder.subscribe(() => this.set({ recording: recorder.getState() }));
  }

  // --- store ------------------------------------------------------------------

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  getState = (): LiveInputState => this.state;

  /** Every note played (after track routing), e.g. for visualizers. */
  onNote(listener: (event: LiveNoteEvent) => void): () => void {
    this.noteListeners.add(listener);
    return () => this.noteListeners.delete(listener);
  }

  private set(patch: Partial<LiveInputState>) {
    this.state = { ...this.state, ...patch };
    for (const l of this.listeners) l();
  }

  // --- settings ---------------------------------------------------------------

  /** Computer-keyboard piano: while on, note keys win over single-key shortcuts. */
  enablePiano(on: boolean): void {
    if (on === this.state.pianoOn) return;
    if (typeof window === 'undefined') return;
    if (on) {
      window.addEventListener('keydown', this.onKeyDown, CAPTURE);
      window.addEventListener('keyup', this.onKeyUp, CAPTURE);
      this.installGlobal();
    } else {
      window.removeEventListener('keydown', this.onKeyDown, CAPTURE);
      window.removeEventListener('keyup', this.onKeyUp, CAPTURE);
      this.releaseWhere((h) => h.source === 'keyboard');
    }
    this.set({ pianoOn: on });
  }

  togglePiano(): void {
    this.enablePiano(!this.state.pianoOn);
  }

  setOctave(octave: number): void {
    const next = clampOctave(octave);
    if (next !== this.state.octave) this.set({ octave: next });
  }

  shiftOctave(delta: number): void {
    this.setOctave(this.state.octave + delta);
  }

  setVelocity(velocity: number): void {
    this.set({ velocity: Math.min(1, Math.max(0.05, velocity)) });
  }

  // --- MIDI -----------------------------------------------------------------

  /** Ask for MIDI access and listen. Resolves false (with `midiError` set) when unavailable. */
  async enableMidi(): Promise<boolean> {
    if (this.midi) return true;
    const request = ++this.midiRequest;
    this.set({ midiStatus: 'connecting', midiError: null });
    try {
      const handle = await requestMidi();
      if (request !== this.midiRequest) {
        handle.dispose();
        return false;
      }
      this.midi = handle;
      handle.select(this.state.midiInput);
      handle.setChannel(this.state.midiChannel);
      this.midiUnsubs = [
        handle.onNote(this.onMidiNote),
        handle.onDevicesChange((devices) => {
          const input = this.state.midiInput;
          // Selected device unplugged: fall back to all inputs.
          if (input !== 'all' && !devices.some((d) => d.id === input)) {
            handle.select('all');
            this.set({ midiDevices: devices, midiInput: 'all' });
          } else {
            this.set({ midiDevices: devices });
          }
        }),
      ];
      this.installGlobal();
      this.set({ midiEnabled: true, midiStatus: 'on', midiDevices: handle.devices });
      return true;
    } catch (error) {
      if (request !== this.midiRequest) return false;
      const message = error instanceof MidiAccessError ? error.message : 'Could not connect to MIDI devices.';
      this.set({ midiEnabled: false, midiStatus: 'error', midiError: message });
      return false;
    }
  }

  disableMidi(): void {
    this.midiRequest += 1;
    for (const off of this.midiUnsubs) off();
    this.midiUnsubs = [];
    this.midi?.dispose();
    this.midi = null;
    this.releaseWhere((h) => h.source === 'midi');
    this.set({ midiEnabled: false, midiStatus: 'off', midiError: null, midiDevices: [] });
  }

  setMidiInput(input: MidiInputSelection): void {
    this.midi?.select(input);
    this.set({ midiInput: input });
  }

  setMidiChannel(channel: number | null): void {
    this.midi?.setChannel(channel);
    this.set({ midiChannel: this.midi?.channel ?? channel });
  }

  private readonly onMidiNote = (e: MidiNoteEvent) => {
    const id = `midi:${e.input}:${e.channel}:${e.note}`;
    if (e.type === 'noteon') this.press(id, e.note, Math.max(0.05, e.velocity), 'midi');
    else this.release(id);
  };

  // --- playing ----------------------------------------------------------------

  /**
   * Start a note on the selected track. `id` pairs it with `release(id)`;
   * pressing an id that is already held retriggers it. Returns false when no
   * track is selected.
   */
  press(id: string, note: number, velocity = this.state.velocity, source: NoteSource = 'pointer'): boolean {
    if (this.held.has(id)) this.release(id);
    const track = this.selectedTrack();
    if (!track) return false;
    const def = INSTRUMENTS[track.instrument];
    const pitch = def.melodic ? foldIntoRange(note, def.noteRange) : def.defaultNote;
    const time = performance.now();

    if (def.melodic && def.mono) {
      for (const other of this.held.values()) {
        if (other.trackId === track.id && !other.silenced) this.silence(other, time);
      }
    }

    const entry: Held = {
      id,
      source,
      code: source === 'keyboard' ? id.slice(4) : null,
      trackId: track.id,
      note: pitch,
      velocity,
      melodic: def.melodic,
      live: null,
      ended: false,
      silenced: false,
      forced: false,
    };
    this.held.set(id, entry);
    engine.noteOn(track, pitch, velocity).then(
      (live) => {
        if (entry.ended) {
          if (entry.melodic || entry.forced) engine.noteOff(live);
        } else {
          entry.live = live;
        }
      },
      () => undefined,
    );
    this.recorder.noteOn({ key: id, trackId: track.id, note: pitch, velocity, time });
    this.emitNote({ type: 'noteon', id, source, trackId: track.id, note: pitch, velocity, time });
    this.syncHeld();
    return true;
  }

  /** End a held note. Drum one-shots ring out; melodic notes fade with the track's release. */
  release(id: string): void {
    const entry = this.held.get(id);
    if (!entry) return;
    this.held.delete(id);
    if (!entry.silenced) this.end(entry, performance.now(), false);
    this.syncHeld();
  }

  /** On-screen keyboard: press with a pointer; lifting it anywhere releases the note. */
  pointerDown(note: number, pointerId = 0, velocity = this.state.velocity): boolean {
    this.installGlobal();
    return this.press(`pointer:${pointerId}`, note, velocity, 'pointer');
  }

  /** Call on pointerup / pointerleave / pointercancel of the on-screen key. */
  pointerUp(pointerId = 0): void {
    this.release(`pointer:${pointerId}`);
  }

  /** Silence everything that is held, from every source. */
  panic(): void {
    this.midi?.releaseAll();
    const time = performance.now();
    for (const entry of this.held.values()) {
      if (!entry.silenced) this.end(entry, time, true);
    }
    this.held.clear();
    this.syncHeld();
  }

  /** Detach all listeners and MIDI; stops a running recording. */
  dispose(): void {
    this.enablePiano(false);
    this.disableMidi();
    this.panic();
    this.recorder.stop();
    this.globalCleanup?.();
    this.globalCleanup = null;
  }

  private selectedTrack(): Track | null {
    const id = useUi.getState().selectedTrackId;
    if (!id) return null;
    return getProject().tracks.find((t) => t.id === id) ?? null;
  }

  /** Mono retrigger: the older note stops sounding but stays held. */
  private silence(entry: Held, time: number) {
    entry.silenced = true;
    this.end(entry, time, false);
  }

  private end(entry: Held, time: number, force: boolean) {
    entry.ended = true;
    entry.forced = force;
    if (entry.live && (entry.melodic || force)) engine.noteOff(entry.live);
    this.recorder.noteOff(entry.id, time);
    this.emitNote({
      type: 'noteoff',
      id: entry.id,
      source: entry.source,
      trackId: entry.trackId,
      note: entry.note,
      velocity: 0,
      time,
    });
  }

  private releaseWhere(match: (h: Held) => boolean) {
    for (const entry of [...this.held.values()]) if (match(entry)) this.release(entry.id);
  }

  private emitNote(event: LiveNoteEvent) {
    for (const l of this.noteListeners) l(event);
  }

  private syncHeld() {
    const entries = [...this.held.values()];
    const heldNotes = [...new Set(entries.map((h) => h.note))].sort((a, b) => a - b);
    const heldKeys = entries.flatMap((h) => (h.code ? [h.code] : []));
    const same = (a: readonly unknown[], b: readonly unknown[]) =>
      a.length === b.length && a.every((v, i) => v === b[i]);
    if (same(heldNotes, this.state.heldNotes) && same(heldKeys, this.state.heldKeys)) return;
    this.set({ heldNotes, heldKeys });
  }

  // --- DOM listeners ----------------------------------------------------------

  private readonly onKeyDown = (e: KeyboardEvent) => {
    if (e.defaultPrevented || e.isComposing) return;
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    if (isEditableTarget(e.target) || modalOpen()) return;

    const shift = octaveShift(e.code);
    if (shift) {
      if (ownsArrowKeys(e.target)) return;
      e.preventDefault();
      if (!e.repeat) this.shiftOctave(shift);
      return;
    }
    if (!isPianoReserved(e.code)) return;
    e.preventDefault();
    const id = `key:${e.code}`;
    if (e.repeat || this.held.has(id)) return;
    const note = keyToNote(e.code, this.state.octave);
    if (note === null) return;
    this.press(id, note, e.shiftKey ? ACCENT_VELOCITY : this.state.velocity, 'keyboard');
  };

  private readonly onKeyUp = (e: KeyboardEvent) => {
    // macOS drops key-ups of other keys while ⌘ is held: release everything with it.
    if (e.code === 'MetaLeft' || e.code === 'MetaRight') {
      this.releaseWhere((h) => h.source === 'keyboard');
      return;
    }
    const id = `key:${e.code}`;
    if (!this.held.has(id)) return;
    e.preventDefault();
    this.release(id);
  };

  private readonly onBlur = () => this.releaseWhere((h) => h.source !== 'midi');

  private readonly onVisibility = () => {
    if (document.visibilityState === 'hidden') this.panic();
  };

  private readonly onPointerUp = (e: PointerEvent) => this.release(`pointer:${e.pointerId}`);

  /** Blur/visibility/pointer-up safety nets and track-deletion cleanup, installed once. */
  private installGlobal() {
    if (this.globalCleanup || typeof window === 'undefined') return;
    window.addEventListener('blur', this.onBlur);
    window.addEventListener('pointerup', this.onPointerUp);
    window.addEventListener('pointercancel', this.onPointerUp);
    if (typeof document !== 'undefined') document.addEventListener('visibilitychange', this.onVisibility);
    const unsubStudio = useStudio.subscribe((s, prev) => {
      if (s.project.tracks === prev.project.tracks) return;
      const ids = new Set(s.project.tracks.map((t) => t.id));
      this.releaseWhere((h) => !ids.has(h.trackId));
    });
    this.globalCleanup = () => {
      window.removeEventListener('blur', this.onBlur);
      window.removeEventListener('pointerup', this.onPointerUp);
      window.removeEventListener('pointercancel', this.onPointerUp);
      if (typeof document !== 'undefined') document.removeEventListener('visibilitychange', this.onVisibility);
      unsubStudio();
    };
  }
}

/** App-wide instance (keyboard, MIDI and recorder share held-note state). */
export const liveInput = new LiveInput();

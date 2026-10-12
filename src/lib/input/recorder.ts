/**
 * Live recording into patterns. Notes are placed with `engine.locate()` (what
 * the player heard), optionally quantized, and written with
 * `actions.recordNote`; a whole take is one undo step.
 */
import { engine, type Playhead } from '@/lib/audio/engine';
import { INSTRUMENTS } from '@/lib/project/instruments';
import type { Project } from '@/lib/project/types';
import { actions, getProject, useStudio } from '@/lib/store/studio';
import { useUi } from '@/lib/store/ui';
import { createId } from '@/lib/utils/id';

export type RecordMode = 'overdub' | 'replace';

export interface RecordOptions {
  /** Bars (of 16 steps) played before recording starts when the transport is stopped */
  countInBars: number;
  /** 0 keeps the played timing, 1 snaps fully to the grid */
  quantize: number;
  /** overdub adds notes; replace also clears the track's steps the first time the take passes them */
  mode: RecordMode;
}

export interface StartOptions {
  /** Song mode: bar to start recording at (playback pre-rolls the count-in before it when possible) */
  fromBar?: number;
}

export type RecorderStatus = 'idle' | 'armed' | 'countIn' | 'recording';

export interface RecorderState {
  status: RecorderStatus;
  options: RecordOptions;
  /** Steps left before recording starts (count-in) */
  countIn: number;
  /** Undo/coalesce id of the current take */
  take: string | null;
  /** Notes written in the current take */
  notes: number;
}

/** A note from a live source; `key` pairs the note-on with its note-off. */
export interface RecordNoteInput {
  key: string;
  trackId: string;
  /** MIDI note as heard (section transpose is removed when writing) */
  note: number;
  velocity: number;
  /** performance.now() */
  time: number;
}

export const DEFAULT_RECORD_OPTIONS: RecordOptions = { countInBars: 1, quantize: 0.5, mode: 'overdub' };

const STEPS_PER_BAR = 16;
/**
 * The playhead normally moves 1–2 steps per frame; a bigger move is a jump
 * (seek, stutter, stalled tab) and only counts the landing step.
 */
const MAX_STEP_JUMP = 16;

interface ActiveNote {
  patternId: string;
  trackId: string;
  step: number;
  note: number;
  melodic: boolean;
  usesLength: boolean;
  time: number;
  bpm: number;
}

interface Position {
  patternId: string;
  step: number;
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/** Duration of a 16th step in seconds. */
export function stepSeconds(bpm: number): number {
  return 60 / bpm / 4;
}

/** Gate length in steps (1..16) for a note held `ms` milliseconds at `bpm`. */
export function lengthInSteps(ms: number, bpm: number): number {
  return clamp(Math.round(ms / 1000 / stepSeconds(bpm)), 1, 16);
}

/** Micro-timing kept after quantizing: 0 → as played, 1 → on the grid. */
export function quantizeOffset(offset: number, quantize: number): number {
  const kept = clamp(offset, -0.5, 0.5) * (1 - clamp(quantize, 0, 1));
  return Math.round(kept * 1000) / 1000 || 0;
}

export class Recorder {
  private state: RecorderState = {
    status: 'idle',
    options: { ...DEFAULT_RECORD_OPTIONS },
    countIn: 0,
    take: null,
    notes: 0,
  };
  private readonly listeners = new Set<() => void>();
  private unsubscribe: (() => void) | null = null;
  /** Bumped on every start/stop so a slow `engine.play()` can't revive a stopped take */
  private session = 0;
  private lastHead: Playhead | null = null;
  private elapsed = 0;
  private beginAt = 0;
  private forcedMetronome = false;
  private readonly active = new Map<string, ActiveNote>();
  /** pattern:track:step already cleared (replace) or written in this take */
  private readonly touched = new Set<string>();

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  getState = (): RecorderState => this.state;

  get recording(): boolean {
    return this.state.status === 'recording';
  }

  /** Prepare a take (or change options of the running one). */
  arm(options: Partial<RecordOptions> = {}): void {
    const merged = this.merge(options);
    this.set({ options: merged, status: this.state.status === 'idle' ? 'armed' : this.state.status });
  }

  disarm(): void {
    if (this.state.status === 'armed') this.set({ status: 'idle' });
  }

  /**
   * Stopped transport: start playback with the metronome on and record after the
   * count-in. Playing: record from the next step.
   */
  async start(options: Partial<RecordOptions> & StartOptions = {}): Promise<void> {
    if (this.state.status === 'countIn' || this.state.status === 'recording') return;
    const merged = this.merge(options);
    const session = ++this.session;
    this.active.clear();
    this.touched.clear();
    this.elapsed = 0;
    this.unsubscribe?.();
    this.unsubscribe = engine.subscribe(() => this.onPlayhead(engine.getPlayhead()));

    if (engine.isPlaying) {
      const head = engine.getPlayhead();
      this.lastHead = head.patternId ? head : null;
      this.beginAt = 1;
      this.set({ status: 'countIn', options: merged, countIn: 1, take: createId('take'), notes: 0 });
      return;
    }

    this.lastHead = null;
    this.beginAt = Math.max(0, Math.round(merged.countInBars)) * STEPS_PER_BAR;
    const counting = this.beginAt > 0;
    this.set({
      status: counting ? 'countIn' : 'recording',
      options: merged,
      countIn: this.beginAt,
      take: createId('take'),
      notes: 0,
    });
    if (counting) {
      this.forcedMetronome = true;
      engine.setMetronome(true);
    }
    // Song mode: pre-roll the count-in from the bars before `fromBar` (at bar 0 the first bars count in).
    const song = getProject().playMode === 'song';
    const fromBar =
      options.fromBar !== undefined && song ? Math.max(0, options.fromBar - merged.countInBars) : undefined;
    try {
      await engine.play(fromBar !== undefined ? { fromBar } : {});
    } finally {
      if (session === this.session && !engine.isPlaying) this.stop();
    }
  }

  /** End the take; held notes get their length up to now. */
  stop({ stopTransport = false }: { stopTransport?: boolean } = {}): void {
    this.session += 1;
    this.unsubscribe?.();
    this.unsubscribe = null;
    const now = performance.now();
    if (this.state.status === 'recording') {
      for (const key of [...this.active.keys()]) this.noteOff(key, now);
    }
    this.active.clear();
    this.restoreMetronome();
    this.lastHead = null;
    if (stopTransport) engine.stop();
    if (this.state.status !== 'idle') this.set({ status: 'idle', countIn: 0, take: null });
  }

  /** A live note started (from `LiveInput`). */
  noteOn(input: RecordNoteInput): void {
    const { status } = this.state;
    if (status !== 'countIn' && status !== 'recording') return;
    const loc = engine.locate();
    if (!loc) return;
    if (status === 'countIn') {
      // A note just before the first recorded step (played early) belongs to it.
      const head = this.lastHead;
      const nextStep =
        head && this.elapsed + 1 >= this.beginAt && (loc.patternId !== head.patternId || loc.step !== head.step);
      if (!nextStep) return;
      this.begin();
    }

    const project = getProject();
    const pattern = project.patterns.find((p) => p.id === loc.patternId);
    const track = project.tracks.find((t) => t.id === input.trackId);
    if (!pattern || !track || loc.step < 0 || loc.step >= pattern.length) return;
    const steps = pattern.steps[track.id];
    if (!steps?.[loc.step]) return;

    const def = INSTRUMENTS[track.instrument];
    const note = def.melodic ? clamp(Math.round(input.note - this.sectionValue(project, 'transpose')), 0, 127) : 0;
    const usesLength = def.melodic || Boolean(def.usesLength);
    const take = this.state.take!;
    this.keepTakeOpen();
    actions.recordNote(
      pattern.id,
      track.id,
      loc.step,
      {
        vel: input.velocity,
        offset: quantizeOffset(loc.offset, this.state.options.quantize),
        prob: 1,
        ratchet: 1,
        ...(def.melodic ? { note } : {}),
        ...(usesLength ? { len: 1 } : {}),
      },
      take,
    );
    this.touched.add(`${pattern.id}:${track.id}:${loc.step}`);
    this.active.set(input.key, {
      patternId: pattern.id,
      trackId: track.id,
      step: loc.step,
      note,
      melodic: def.melodic,
      usesLength,
      time: input.time,
      bpm: this.sectionValue(project, 'bpm'),
    });
    this.set({ notes: this.state.notes + 1 });
  }

  /** A live note ended: set the recorded step's length from how long it was held. */
  noteOff(key: string, time: number): void {
    const entry = this.active.get(key);
    if (!entry) return;
    this.active.delete(key);
    if (!entry.usesLength || !this.state.take) return;
    const step = getProject().patterns.find((p) => p.id === entry.patternId)?.steps[entry.trackId]?.[entry.step];
    // Another note may have replaced this one in the same step since.
    if (!step?.on || (entry.melodic && step.note !== entry.note)) return;
    const len = lengthInSteps(time - entry.time, entry.bpm);
    if (step.len === len) return;
    this.keepTakeOpen();
    actions.recordNote(entry.patternId, entry.trackId, entry.step, { len }, this.state.take);
  }

  // --- internals -------------------------------------------------------------

  private merge(options: Partial<RecordOptions>): RecordOptions {
    const next = { ...this.state.options };
    if (options.countInBars !== undefined) next.countInBars = clamp(Math.round(options.countInBars), 0, 4);
    if (options.quantize !== undefined) next.quantize = clamp(options.quantize, 0, 1);
    if (options.mode !== undefined) next.mode = options.mode;
    return next;
  }

  private set(patch: Partial<RecorderState>) {
    this.state = { ...this.state, ...patch };
    for (const l of this.listeners) l();
  }

  private begin() {
    this.restoreMetronome();
    this.set({ status: 'recording', countIn: 0 });
  }

  private restoreMetronome() {
    if (!this.forcedMetronome) return;
    this.forcedMetronome = false;
    engine.setMetronome(useUi.getState().metronome);
  }

  private onPlayhead(head: Playhead) {
    const { status } = this.state;
    if (status !== 'countIn' && status !== 'recording') return;
    if (!head.playing) {
      this.stop();
      return;
    }
    if (!head.patternId) return;
    const prev = this.lastHead;
    this.lastHead = head;
    if (!prev) {
      if (status === 'countIn' && this.beginAt <= 0) this.begin();
      if (this.state.status === 'recording') this.clearPassed([{ patternId: head.patternId, step: head.step }]);
      return;
    }
    if (prev.patternId === head.patternId && prev.step === head.step && prev.songStep === head.songStep) return;
    const passed = this.between(prev, head);
    if (status === 'countIn') {
      this.elapsed += passed.length;
      if (this.elapsed < this.beginAt) {
        this.set({ countIn: this.beginAt - this.elapsed });
        return;
      }
      this.begin();
      // Only the steps from the start of recording count as passed.
      this.clearPassed(passed.slice(passed.length - (this.elapsed - this.beginAt) - 1));
      return;
    }
    this.clearPassed(passed);
  }

  /** Steps played after `prev` up to and including `head` (the playhead can skip frames). */
  private between(prev: Playhead, head: Playhead): Position[] {
    const project = getProject();
    const length = (id: string) => project.patterns.find((p) => p.id === id)?.length ?? 0;
    const out: Position[] = [];
    if (prev.patternId === head.patternId && head.step > prev.step) {
      for (let s = prev.step + 1; s <= head.step; s++) out.push({ patternId: head.patternId!, step: s });
    } else {
      for (let s = prev.step + 1; s < length(prev.patternId!); s++) out.push({ patternId: prev.patternId!, step: s });
      for (let s = 0; s <= head.step; s++) out.push({ patternId: head.patternId!, step: s });
    }
    return out.length > MAX_STEP_JUMP ? [{ patternId: head.patternId!, step: head.step }] : out;
  }

  /** Replace mode: clear the selected track at steps this take passes for the first time. */
  private clearPassed(positions: Position[]) {
    if (this.state.options.mode !== 'replace' || !this.state.take || !positions.length) return;
    const trackId = useUi.getState().selectedTrackId;
    if (!trackId) return;
    const fresh = positions.filter((p) => !this.touched.has(`${p.patternId}:${trackId}:${p.step}`));
    if (!fresh.length) return;
    for (const p of fresh) this.touched.add(`${p.patternId}:${trackId}:${p.step}`);
    this.keepTakeOpen();
    useStudio.getState().update(
      (draft) => {
        for (const p of fresh) {
          const step = draft.patterns.find((x) => x.id === p.patternId)?.steps[trackId]?.[p.step];
          if (step) step.on = false;
        }
      },
      { coalesce: this.coalesceKey(), label: 'Record' },
    );
  }

  /** Must match the key `actions.recordNote` coalesces on. */
  private coalesceKey(): string {
    return `record:${this.state.take}`;
  }

  /**
   * The store only merges same-key edits within a short window; a take with long
   * pauses would split into several undo steps. Refresh the window while nothing
   * else has been edited since the take's last write.
   */
  private keepTakeOpen() {
    const store = useStudio.getState();
    if (store.coalesceKey === this.coalesceKey()) useStudio.setState({ coalesceAt: Date.now() });
  }

  /** Tempo or transpose of the playing song section (project tempo / 0 in pattern mode). */
  private sectionValue(project: Project, key: 'bpm' | 'transpose'): number {
    const head = engine.getPlayhead();
    const section = head.mode === 'song' && head.sectionIndex >= 0 ? project.arrangement[head.sectionIndex] : undefined;
    if (key === 'bpm') return section?.bpm ?? project.bpm;
    return section?.transpose ?? 0;
  }
}

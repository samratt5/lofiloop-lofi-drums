/**
 * Realtime playback engine. A worker-driven lookahead scheduler reads the
 * latest project on every tick, so edits (steps, tempo, mutes, arrangement)
 * are heard immediately without restarting playback.
 */
import { INSTRUMENTS } from '@/lib/project/instruments';
import type { Project, Track } from '@/lib/project/types';
import type { Voice } from './instruments';
import { Mixer } from './mixer';
import { Performer } from './performer';
import { VoicePlayer } from './player';
import { buildSongTimeline, getPattern, slotAtStep, stepDuration, type SongTimeline } from './sequence';

const TICK_MS = 25;
const LOOKAHEAD = 0.12;
/** Steps can be nudged up to half a step early plus a track's feel. */
const EARLY_MARGIN = 0.05;
const START_DELAY = 0.06;

export interface Playhead {
  playing: boolean;
  mode: 'pattern' | 'song';
  patternId: string | null;
  /** Step within the playing pattern */
  step: number;
  /** Song position in 16ths (song mode), -1 otherwise */
  songStep: number;
  /** Index into the arrangement (song mode), -1 otherwise */
  sectionIndex: number;
}

const IDLE: Playhead = { playing: false, mode: 'pattern', patternId: null, step: -1, songStep: -1, sectionIndex: -1 };

interface QueuedStep {
  time: number;
  head: Playhead;
}

export interface RecordPosition {
  patternId: string;
  step: number;
  /** Fraction of a step early (<0) or late (>0) */
  offset: number;
}

export interface PlayOptions {
  /** Start the song from this bar (song mode) */
  fromBar?: number;
  /** Stop at the end of the song instead of looping (radio, playlists) */
  stopAtEnd?: boolean;
  /** Called once the song has finished and its tail has rung out */
  onEnd?: () => void;
}

type Listener = () => void;

class Ticker {
  private worker: Worker | null = null;
  private interval: ReturnType<typeof setInterval> | null = null;

  constructor(private readonly onTick: () => void) {}

  start() {
    this.stop();
    try {
      if (!this.worker) {
        const source = `let id=null;onmessage=(e)=>{clearInterval(id);id=null;if(e.data==='start'){id=setInterval(()=>postMessage(0),${TICK_MS});}};`;
        const url = URL.createObjectURL(new Blob([source], { type: 'text/javascript' }));
        this.worker = new Worker(url);
        URL.revokeObjectURL(url);
        this.worker.onmessage = () => this.onTick();
      }
      this.worker.postMessage('start');
    } catch {
      // Workers can be blocked (CSP, old browsers); fall back to a main-thread timer.
      this.worker = null;
      this.interval = setInterval(this.onTick, TICK_MS);
    }
  }

  stop() {
    this.worker?.postMessage('stop');
    if (this.interval) clearInterval(this.interval);
    this.interval = null;
  }
}

export interface LiveNote {
  id: number;
  voices: Voice[];
  release: number;
}

export class AudioEngine {
  private ctx: AudioContext | null = null;
  private mixer: Mixer | null = null;
  private player: VoicePlayer | null = null;
  private performer: Performer | null = null;
  private readonly ticker = new Ticker(() => this.schedule());
  private getProject: (() => Project) | null = null;
  private projectOverride: (() => Project | null) | null = null;

  private playing = false;
  /** Incremented on every play/stop so a slow context resume can't start a stale session. */
  private session = 0;
  private mode: 'pattern' | 'song' = 'pattern';
  private nextStepTime = 0;
  /** Pattern mode position */
  private stepIndex = 0;
  private patternId = '';
  /** Song mode position in 16ths */
  private songStep = 0;
  private timeline: SongTimeline | null = null;
  private timelineFor: Project | null = null;
  private stopAtEnd = false;
  private onEnd: (() => void) | null = null;
  private endTimer: ReturnType<typeof setTimeout> | null = null;
  private metronome = false;
  /** Performance mode: jump here at the next bar line. */
  private queuedBar: number | null = null;
  /** Performance mode: repeat a short loop from this position while held. */
  private stutterState: { songStep: number; stepIndex: number; length: number; count: number } | null = null;
  private queue: QueuedStep[] = [];
  private raf = 0;
  private liveId = 0;

  private playhead: Playhead = IDLE;
  private readonly listeners = new Set<Listener>();

  /** Connect the engine to the app state. Safe to call more than once. */
  attach(getProject: () => Project): void {
    this.getProject = getProject;
  }

  /** Temporarily play another project (A/B compare) without touching the editor state. */
  setOverride(source: (() => Project | null) | null): void {
    this.projectOverride = source;
    if (this.mixer) this.mixer.sync(this.current());
  }

  get context(): AudioContext | null {
    return this.ctx;
  }

  get analyser(): AnalyserNode | null {
    return this.mixer?.analyser ?? null;
  }

  get loudnessAnalyser(): AnalyserNode | null {
    return this.mixer?.loudnessAnalyser ?? null;
  }

  get isPlaying(): boolean {
    return this.playing;
  }

  trackAnalyser(trackId: string): AnalyserNode | undefined {
    return this.mixer?.trackAnalyser(trackId);
  }

  private current(): Project {
    return this.projectOverride?.() ?? this.getProject!();
  }

  // --- playhead store (useSyncExternalStore) ---

  subscribe = (listener: Listener): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  getPlayhead = (): Playhead => this.playhead;

  getServerPlayhead = (): Playhead => IDLE;

  private setPlayhead(next: Playhead) {
    const prev = this.playhead;
    if (
      prev.playing === next.playing &&
      prev.mode === next.mode &&
      prev.patternId === next.patternId &&
      prev.step === next.step &&
      prev.songStep === next.songStep &&
      prev.sectionIndex === next.sectionIndex
    ) {
      return;
    }
    this.playhead = next;
    for (const l of this.listeners) l();
  }

  // --- lifecycle ---

  /** Must be called from a user gesture the first time (autoplay policy). */
  async ensureStarted(): Promise<AudioContext> {
    if (!this.ctx) {
      const Ctor =
        window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      this.ctx = new Ctor({ latencyHint: 'interactive' });
      this.mixer = new Mixer(this.ctx, this.ctx.destination, { realtime: true });
      this.player = new VoicePlayer(this.ctx, this.mixer);
      this.performer = new Performer(this.mixer, this.player, { rng: Math.random });
      if (this.getProject) this.mixer.sync(this.current());
    }
    if (this.ctx.state !== 'running') {
      try {
        await this.ctx.resume();
      } catch {
        // Resume can reject when not triggered by a gesture; the next interaction retries.
      }
    }
    return this.ctx;
  }

  /** Push project changes (volumes, FX, new tracks) into the audio graph. */
  sync(project: Project): void {
    if (this.projectOverride?.()) return;
    this.mixer?.sync(project);
  }

  setMetronome(on: boolean): void {
    this.metronome = on;
  }

  async play(options: PlayOptions = {}): Promise<void> {
    if (this.playing || !this.getProject) return;
    const session = ++this.session;
    const ctx = await this.ensureStarted();
    if (session !== this.session || this.playing) return;
    const project = this.current();
    this.mixer!.sync(project);

    this.playing = true;
    this.mode = project.playMode;
    this.stopAtEnd = options.stopAtEnd ?? false;
    this.onEnd = options.onEnd ?? null;
    this.stepIndex = 0;
    this.patternId = project.activePatternId;
    this.songStep = Math.max(0, Math.round((options.fromBar ?? project.loop?.start ?? 0) * 16));
    this.timeline = null;
    this.nextStepTime = ctx.currentTime + START_DELAY;
    this.queue = [];
    this.recent.length = 0;
    this.mixer!.resetTransitions(ctx.currentTime);
    this.mixer!.setTransportActive(true, this.nextStepTime);
    this.schedule(true);
    this.ticker.start();
    this.raf = requestAnimationFrame(this.frame);
  }

  stop(): void {
    this.session += 1;
    this.queuedBar = null;
    this.stutterState = null;
    if (this.endTimer) clearTimeout(this.endTimer);
    this.endTimer = null;
    if (!this.playing) return;
    this.playing = false;
    this.ticker.stop();
    cancelAnimationFrame(this.raf);
    this.queue = [];
    if (this.ctx && this.mixer && this.getProject) {
      this.player?.stopAll(this.ctx.currentTime);
      this.mixer.setTransportActive(false);
      this.mixer.resetTransitions();
      this.mixer.releaseAutomation(this.current());
    }
    this.setPlayhead(IDLE);
  }

  async toggle(): Promise<void> {
    if (this.playing) this.stop();
    else await this.play();
  }

  /** Restart from the top (e.g. after switching between pattern and song mode). */
  async restart(options?: PlayOptions): Promise<void> {
    this.stop();
    await this.play(options);
  }

  /** Jump to a bar while playing (song mode). */
  seek(bar: number): void {
    if (!this.playing || !this.ctx || this.mode !== 'song') return;
    this.player?.stopAll(this.ctx.currentTime);
    this.mixer?.resetTransitions();
    this.songStep = Math.max(0, Math.round(bar * 16));
    this.nextStepTime = this.ctx.currentTime + START_DELAY;
    this.queue = [];
    this.schedule(true);
  }

  /** Audition a track's sound immediately. */
  async preview(track: Track, note?: number, velocity = 0.8): Promise<void> {
    const ctx = await this.ensureStarted();
    if (!this.getProject || !this.player) return;
    const project = this.current();
    this.mixer!.sync(project);
    const def = INSTRUMENTS[track.instrument];
    this.player.preview(track, {
      trackId: track.id,
      instrument: track.instrument,
      time: ctx.currentTime + 0.01,
      position: 0,
      notes: [note ?? def.defaultNote],
      velocity,
      duration: stepDuration(project.bpm) * (def.usesLength ? 16 : 2),
      step: 0,
    });
  }

  /** Start a held note (computer keyboard, MIDI). Release it with `noteOff`. */
  async noteOn(track: Track, note: number, velocity = 0.8): Promise<LiveNote | null> {
    const ctx = await this.ensureStarted();
    if (!this.player) return null;
    this.mixer!.sync(this.current());
    const def = INSTRUMENTS[track.instrument];
    const voices = this.player.preview(track, {
      trackId: track.id,
      instrument: track.instrument,
      time: ctx.currentTime + 0.005,
      position: 0,
      notes: [def.melodic ? note : def.defaultNote],
      velocity,
      duration: def.melodic ? 12 : 0.5,
      step: 0,
    });
    const release = Math.max(0.03, track.params.release ?? 0.12);
    return { id: ++this.liveId, voices, release };
  }

  noteOff(note: LiveNote | null): void {
    if (!note || !this.ctx) return;
    for (const voice of note.voices) voice.stop(this.ctx.currentTime, note.release);
  }

  /** Jump to a bar on the next bar line, keeping the groove (performance mode). */
  queueSeek(bar: number): void {
    if (!this.playing) {
      this.play({ fromBar: bar }).catch(() => undefined);
      return;
    }
    this.queuedBar = Math.max(0, Math.round(bar));
  }

  get queuedSeek(): number | null {
    return this.queuedBar;
  }

  /** Hold to repeat the last `length` steps (a beat-repeat effect); release to carry on. */
  stutter(length: number | null): void {
    if (length === null) {
      if (this.stutterState && this.getProject) {
        // Resume where the groove would be if the stutter had never happened.
        const { songStep, stepIndex, count } = this.stutterState;
        const length = getPattern(this.current(), this.patternId)?.length ?? 16;
        this.songStep = songStep + count;
        this.stepIndex = (stepIndex + count) % length;
      }
      this.stutterState = null;
      return;
    }
    this.stutterState = { songStep: this.songStep, stepIndex: this.stepIndex, length, count: 0 };
  }

  /** Momentary performance effects that don't change the project. */
  liveEffect(kind: 'filter' | 'wash' | 'tapeStop', active: boolean): void {
    if (!this.mixer || !this.ctx) return;
    this.mixer.liveEffect(kind, active, this.ctx.currentTime, this.current().bpm);
  }

  /**
   * Where a note played right now lands in the sequence, compensating for
   * output latency (players react to what they hear). Used by recording.
   */
  locate(): RecordPosition | null {
    if (!this.playing || !this.ctx || !this.recent.length) return null;
    const latency = this.ctx.outputLatency || this.ctx.baseLatency || 0;
    const heard = this.ctx.currentTime - latency;
    let index = -1;
    for (let i = this.recent.length - 1; i >= 0; i--) {
      if (this.recent[i].time <= heard) {
        index = i;
        break;
      }
    }
    if (index < 0) index = 0;
    let entry = this.recent[index];
    let offset = (heard - entry.time) / entry.dur;
    // Closer to the next step: snap forward and record a small negative offset.
    if (offset > 0.5 && this.recent[index + 1]) {
      entry = this.recent[index + 1];
      offset = (heard - entry.time) / entry.dur;
    }
    return { patternId: entry.patternId, step: entry.step, offset: Math.max(-0.5, Math.min(0.5, offset)) };
  }

  private readonly recent: { time: number; dur: number; patternId: string; step: number }[] = [];

  // --- scheduling ---

  private songTimeline(project: Project): SongTimeline {
    if (this.timeline && this.timelineFor === project) return this.timeline;
    this.timeline = buildSongTimeline(project);
    this.timelineFor = project;
    return this.timeline;
  }

  private schedule = (initial = false) => {
    if (!this.playing || !this.ctx || !this.getProject || !this.performer) return;
    const ctx = this.ctx;
    let project = this.current();

    if (project.playMode !== this.mode) {
      // Mode switched while playing: start the new mode from the top.
      this.mode = project.playMode;
      this.stepIndex = 0;
      this.songStep = project.loop ? Math.round(project.loop.start * 16) : 0;
      this.patternId = project.activePatternId;
      initial = true;
    }

    // After a long stall (sleeping laptop, frozen tab) jump forward instead of flooding notes.
    if (this.nextStepTime < ctx.currentTime - 0.25) {
      this.nextStepTime = ctx.currentTime + START_DELAY;
    }

    while (this.nextStepTime - EARLY_MARGIN < ctx.currentTime + LOOKAHEAD) {
      project = this.current();
      if (this.mode === 'song') {
        if (!this.scheduleSongStep(project, initial)) return;
      } else {
        this.schedulePatternStep(project);
      }
      initial = false;
    }
  };

  private schedulePatternStep(project: Project) {
    let pattern = getPattern(project, this.patternId);
    if (!pattern || this.stepIndex >= pattern.length) {
      this.stepIndex = 0;
      this.patternId = project.activePatternId;
      pattern = getPattern(project, this.patternId) ?? project.patterns[0];
      this.patternId = pattern.id;
    }
    const time = this.nextStepTime;
    this.performer!.playStep(project, { pattern, step: this.stepIndex, time, bpm: project.bpm, songStep: null });
    if (this.metronome && this.stepIndex % 4 === 0) this.click(time, this.stepIndex % 16 === 0);
    this.enqueue(
      time,
      {
        playing: true,
        mode: 'pattern',
        patternId: pattern.id,
        step: this.stepIndex,
        songStep: -1,
        sectionIndex: -1,
      },
      project.bpm,
    );
    this.nextStepTime += stepDuration(project.bpm);
    this.advance();
  }

  /** Move to the next step, looping back while a stutter is held. */
  private advance() {
    const st = this.stutterState;
    if (st) {
      st.count += 1;
      if (st.count % st.length === 0) {
        this.songStep = st.songStep;
        this.stepIndex = st.stepIndex;
        return;
      }
    }
    this.songStep += 1;
    this.stepIndex += 1;
  }

  /** Returns false when playback ended. */
  private scheduleSongStep(project: Project, initial: boolean): boolean {
    const timeline = this.songTimeline(project);
    if (!timeline.slots.length) {
      this.stop();
      return false;
    }
    const loop = project.loop;
    const loopEnd = loop ? Math.min(timeline.totalSteps, Math.round(loop.end * 16)) : timeline.totalSteps;
    const loopStart = loop ? Math.min(Math.round(loop.start * 16), Math.max(0, loopEnd - 1)) : 0;

    if (this.songStep >= loopEnd || this.songStep >= timeline.totalSteps) {
      if (this.stopAtEnd && !loop) {
        this.finish(this.nextStepTime);
        return false;
      }
      this.songStep = loopStart;
      initial = true;
    }

    if (this.queuedBar !== null && this.songStep % 16 === 0) {
      this.songStep = Math.min(this.queuedBar * 16, Math.max(0, timeline.totalSteps - 1));
      this.queuedBar = null;
      this.mixer!.resetTransitions(this.nextStepTime);
      initial = true;
    }

    const slotIndex = slotAtStep(timeline, this.songStep);
    const slot = timeline.slots[slotIndex];
    const step = this.songStep - slot.startStep;
    const time = this.nextStepTime;
    if (step === 0 || initial) {
      if (initial) this.mixer!.resetTransitions(time);
      if (step === 0) this.performer!.enterSlot(slot, time);
    }
    this.performer!.playStep(project, {
      pattern: slot.pattern,
      step,
      time,
      bpm: slot.bpm,
      transpose: slot.transpose,
      muted: slot.muted,
      songStep: this.songStep,
    });
    if (this.metronome && step % 4 === 0) this.click(time, this.songStep % 16 === 0);
    this.enqueue(
      time,
      {
        playing: true,
        mode: 'song',
        patternId: slot.pattern.id,
        step,
        songStep: this.songStep,
        sectionIndex: slot.sectionIndex,
      },
      slot.bpm,
    );
    this.nextStepTime += stepDuration(slot.bpm);
    this.advance();
    return true;
  }

  /** Let tails ring out, then stop and notify. */
  private finish(time: number) {
    this.ticker.stop();
    const ctx = this.ctx!;
    const wait = Math.max(0, time - ctx.currentTime) + 2.5;
    const session = this.session;
    const onEnd = this.onEnd;
    this.endTimer = setTimeout(() => {
      if (session !== this.session) return;
      this.stop();
      onEnd?.();
    }, wait * 1000);
  }

  private enqueue(time: number, head: Playhead, bpm: number) {
    this.queue.push({ time, head });
    if (head.patternId) {
      this.recent.push({ time, dur: stepDuration(bpm), patternId: head.patternId, step: head.step });
      if (this.recent.length > 64) this.recent.shift();
    }
  }

  private frame = () => {
    if (!this.playing || !this.ctx) return;
    const latency = this.ctx.outputLatency || this.ctx.baseLatency || 0;
    const heard = this.ctx.currentTime - latency;
    let current: QueuedStep | undefined;
    while (this.queue.length && this.queue[0].time <= heard) current = this.queue.shift();
    if (current) {
      this.setPlayhead(current.head);
    } else if (!this.playhead.playing) {
      this.setPlayhead({ ...IDLE, playing: true, mode: this.mode });
    }
    this.raf = requestAnimationFrame(this.frame);
  };

  private click(time: number, accent: boolean) {
    const ctx = this.ctx!;
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.frequency.value = accent ? 1760 : 1320;
    g.gain.setValueAtTime(0, time);
    g.gain.linearRampToValueAtTime(accent ? 0.25 : 0.15, time + 0.001);
    g.gain.exponentialRampToValueAtTime(0.0001, time + 0.05);
    o.connect(g).connect(ctx.destination);
    o.start(time);
    o.stop(time + 0.06);
    o.onended = () => g.disconnect();
  }
}

export const engine = new AudioEngine();

/**
 * Pure timing and event logic shared by the realtime engine, the offline
 * renderer and the MIDI exporter so all three always agree.
 */
import { buildChord } from '@/lib/music/theory';
import type { Rng } from '@/lib/music/rng';
import { INSTRUMENTS, type InstrumentId } from '@/lib/project/instruments';
import type { AutomationLane, Pattern, Project, Section, Track } from '@/lib/project/types';

export interface NoteEvent {
  trackId: string;
  instrument: InstrumentId;
  /** Absolute start time in seconds */
  time: number;
  /** Position in 16th steps from the start of the render/song (for MIDI) */
  position: number;
  /** MIDI notes; a chord when the track has chord mode on */
  notes: number[];
  /** Step velocity 0..1 (track volume is applied by the mixer) */
  velocity: number;
  /** Gate length in seconds */
  duration: number;
  step: number;
}

/** Largest timing push/pull from a track's feel, in seconds. */
export const FEEL_SECONDS = 0.03;
/** Largest random timing drift from humanize, in seconds. */
export const HUMANIZE_SECONDS = 0.012;

export function stepDuration(bpm: number): number {
  return 60 / bpm / 4;
}

/** Delay applied to off-beat 16ths. 50% swing is straight, 66.7% is a triplet shuffle. */
export function swingOffset(stepIndex: number, bpm: number, swing: number): number {
  if (stepIndex % 2 === 0) return 0;
  return Math.max(0, (swing / 100) * 2 - 1) * stepDuration(bpm);
}

export function hasSolo(tracks: Track[]): boolean {
  return tracks.some((t) => t.solo);
}

export function isAudible(track: Track, anySolo: boolean): boolean {
  return !track.mute && (!anySolo || track.solo);
}

export function getPattern(project: Project, id: string): Pattern | undefined {
  return project.patterns.find((p) => p.id === id);
}

/** The track whose hits trigger sidechain ducking. */
export function sidechainSource(project: Project): string | null {
  if (project.sidechain && project.tracks.some((t) => t.id === project.sidechain)) return project.sidechain;
  return (
    project.tracks.find((t) => t.instrument === 'kick')?.id ??
    project.tracks.find((t) => t.instrument === '808')?.id ??
    null
  );
}

export interface StepContext {
  rng: Rng;
  /** Tempo for this step (sections can override the project tempo). */
  bpm?: number;
  /** Semitones added to melodic notes. */
  transpose?: number;
  /** Tracks silenced for this step (section mutes). */
  muted?: ReadonlySet<string>;
  /** Ignore mute/solo, e.g. when rendering stems. */
  includeMuted?: boolean;
  /** Only produce events for these track ids. */
  onlyTracks?: ReadonlySet<string>;
  /** Song position of this step in 16ths, for MIDI export. */
  position?: number;
}

/** All note events that start on `stepIndex` of `pattern`, scheduled at `stepTime` (pre-swing). */
export function eventsForStep(
  project: Project,
  pattern: Pattern,
  stepIndex: number,
  stepTime: number,
  { rng, bpm = project.bpm, transpose = 0, muted, includeMuted = false, onlyTracks, position = stepIndex }: StepContext,
): NoteEvent[] {
  const events: NoteEvent[] = [];
  const dur = stepDuration(bpm);
  const swung = stepTime + swingOffset(stepIndex, bpm, project.swing);
  const anySolo = hasSolo(project.tracks);

  for (const track of project.tracks) {
    if (onlyTracks && !onlyTracks.has(track.id)) continue;
    if (!includeMuted && !isAudible(track, anySolo)) continue;
    if (muted?.has(track.id)) continue;
    const step = pattern.steps[track.id]?.[stepIndex];
    if (!step?.on) continue;
    if (step.prob < 1 && rng() >= step.prob) continue;

    const def = INSTRUMENTS[track.instrument];
    const note = def.melodic ? Math.max(0, Math.min(127, step.note + transpose)) : def.defaultNote;
    const notes =
      def.melodic && def.polyphonic && track.chord !== 'off'
        ? buildChord(step.note, track.chord, project.root, project.scale).map((n) => n + transpose)
        : [note];

    // Micro-timing: the step's own nudge, the track's feel, and a little random drift.
    let jitter = 0;
    let velocity = step.vel;
    if (track.humanize > 0) {
      jitter = (rng() * 2 - 1) * track.humanize * HUMANIZE_SECONDS;
      velocity = Math.max(0.05, Math.min(1, velocity * (1 + (rng() * 2 - 1) * track.humanize * 0.15)));
    }
    const nudge = step.offset * dur + track.feel * FEEL_SECONDS + jitter;
    const time = Math.max(0, swung + nudge);
    const pos = position + (time - stepTime) / dur;
    const ratchet = Math.max(1, Math.min(4, Math.round(step.ratchet)));
    const long = def.melodic || def.usesLength;

    if (ratchet === 1) {
      events.push({
        trackId: track.id,
        instrument: track.instrument,
        time,
        position: pos,
        notes,
        velocity,
        duration: long ? Math.max(1, step.len) * dur * 0.95 : dur,
        step: stepIndex,
      });
      continue;
    }

    const sub = dur / ratchet;
    for (let r = 0; r < ratchet; r++) {
      events.push({
        trackId: track.id,
        instrument: track.instrument,
        time: time + r * sub,
        position: pos + r / ratchet,
        notes,
        velocity: Math.max(0.05, velocity * (1 - r * 0.1)),
        duration: sub * 0.9,
        step: stepIndex,
      });
    }
  }
  return events;
}

// ---------------------------------------------------------------------------
// Song timeline

/** One pass of a pattern inside the song. */
export interface TimelineSlot {
  /** Index into project.arrangement, or -1 for pattern-loop renders */
  sectionIndex: number;
  section: Section | null;
  pattern: Pattern;
  /** 0-based repeat of the section this slot plays */
  repeat: number;
  /** Last repeat of its section */
  last: boolean;
  /** Song position of the slot's first step, in 16ths */
  startStep: number;
  /** Seconds from the start of the song */
  startTime: number;
  bpm: number;
  transpose: number;
  muted: ReadonlySet<string>;
}

export interface SongTimeline {
  slots: TimelineSlot[];
  totalSteps: number;
  totalSeconds: number;
}

const EMPTY: ReadonlySet<string> = new Set();

/** Expand the arrangement into consecutive pattern passes. */
export function buildSongTimeline(project: Project): SongTimeline {
  const slots: TimelineSlot[] = [];
  let step = 0;
  let time = 0;
  project.arrangement.forEach((section, sectionIndex) => {
    const main = getPattern(project, section.patternId);
    if (!main) return;
    const fill = section.fillPatternId ? getPattern(project, section.fillPatternId) : undefined;
    const bpm = section.bpm ?? project.bpm;
    const muted = section.muted.length ? new Set(section.muted) : EMPTY;
    for (let repeat = 0; repeat < section.repeats; repeat++) {
      const last = repeat === section.repeats - 1;
      const pattern = last && fill ? fill : main;
      slots.push({
        sectionIndex,
        section,
        pattern,
        repeat,
        last,
        startStep: step,
        startTime: time,
        bpm,
        transpose: section.transpose,
        muted,
      });
      step += pattern.length;
      time += pattern.length * stepDuration(bpm);
    }
  });
  return { slots, totalSteps: step, totalSeconds: time };
}

/** Timeline that loops the active pattern (pattern mode). */
export function buildPatternTimeline(project: Project, repeats = 1): SongTimeline {
  const pattern = getPattern(project, project.activePatternId) ?? project.patterns[0];
  const slots: TimelineSlot[] = [];
  const dur = stepDuration(project.bpm);
  for (let r = 0; r < Math.max(1, repeats); r++) {
    slots.push({
      sectionIndex: -1,
      section: null,
      pattern,
      repeat: r,
      last: r === repeats - 1,
      startStep: r * pattern.length,
      startTime: r * pattern.length * dur,
      bpm: project.bpm,
      transpose: 0,
      muted: EMPTY,
    });
  }
  return { slots, totalSteps: pattern.length * repeats, totalSeconds: pattern.length * repeats * dur };
}

/** Repeat a whole timeline end to end. */
export function repeatTimeline(timeline: SongTimeline, times: number): SongTimeline {
  if (times <= 1) return timeline;
  const slots: TimelineSlot[] = [];
  for (let r = 0; r < times; r++) {
    for (const slot of timeline.slots) {
      slots.push({
        ...slot,
        startStep: slot.startStep + r * timeline.totalSteps,
        startTime: slot.startTime + r * timeline.totalSeconds,
      });
    }
  }
  return { slots, totalSteps: timeline.totalSteps * times, totalSeconds: timeline.totalSeconds * times };
}

/** Timeline for a render or export: the looped pattern or the whole song. */
export function renderTimeline(project: Project, mode: 'pattern' | 'song', repeats: number): SongTimeline {
  return mode === 'song'
    ? repeatTimeline(buildSongTimeline(project), Math.max(1, repeats))
    : buildPatternTimeline(project, repeats);
}

/** Slot containing song step `step` (clamped to the song). */
export function slotAtStep(timeline: SongTimeline, step: number): number {
  const { slots } = timeline;
  if (!slots.length) return -1;
  let lo = 0;
  let hi = slots.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (slots[mid].startStep <= step) lo = mid;
    else hi = mid - 1;
  }
  return lo;
}

export function stepToSeconds(timeline: SongTimeline, step: number): number {
  const index = slotAtStep(timeline, step);
  if (index < 0) return 0;
  const slot = timeline.slots[index];
  return slot.startTime + (step - slot.startStep) * stepDuration(slot.bpm);
}

export function secondsToStep(timeline: SongTimeline, seconds: number): number {
  const { slots } = timeline;
  for (let i = slots.length - 1; i >= 0; i--) {
    if (slots[i].startTime <= seconds)
      return slots[i].startStep + (seconds - slots[i].startTime) / stepDuration(slots[i].bpm);
  }
  return 0;
}

/** Start position of each section in bars, for the arrangement view. */
export function sectionSpans(
  project: Project,
): { section: Section; startBar: number; bars: number; seconds: number }[] {
  const timeline = buildSongTimeline(project);
  const spans: { section: Section; startBar: number; bars: number; seconds: number }[] = [];
  for (const slot of timeline.slots) {
    const dur = slot.pattern.length * stepDuration(slot.bpm);
    const bars = slot.pattern.length / 16;
    const last = spans[spans.length - 1];
    if (last && last.section === slot.section) {
      last.bars += bars;
      last.seconds += dur;
    } else if (slot.section) {
      spans.push({ section: slot.section, startBar: slot.startStep / 16, bars, seconds: dur });
    }
  }
  return spans;
}

/** Piecewise-linear automation value at a song position in bars. */
export function automationValue(lane: AutomationLane, bar: number): number | null {
  const { points } = lane;
  if (!points.length) return null;
  if (bar <= points[0].t) return points[0].v;
  const last = points[points.length - 1];
  if (bar >= last.t) return last.v;
  for (let i = 1; i < points.length; i++) {
    const b = points[i];
    if (bar <= b.t) {
      const a = points[i - 1];
      const span = b.t - a.t;
      return span <= 0 ? b.v : a.v + ((bar - a.t) / span) * (b.v - a.v);
    }
  }
  return last.v;
}

export interface CollectOptions {
  rng: Rng;
  includeMuted?: boolean;
  onlyTracks?: ReadonlySet<string>;
}

/** Every note event of a timeline, offset by `offset` seconds. */
export function collectEvents(
  project: Project,
  timeline: SongTimeline,
  options: CollectOptions,
  offset = 0,
): NoteEvent[] {
  const events: NoteEvent[] = [];
  for (const slot of timeline.slots) {
    const dur = stepDuration(slot.bpm);
    for (let i = 0; i < slot.pattern.length; i++) {
      events.push(
        ...eventsForStep(project, slot.pattern, i, offset + slot.startTime + i * dur, {
          ...options,
          bpm: slot.bpm,
          transpose: slot.transpose,
          muted: slot.muted,
          position: slot.startStep + i,
        }),
      );
    }
  }
  return events;
}

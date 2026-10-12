import type { ChordType, ScaleId } from '@/lib/music/theory';
import type { InstrumentId } from './instruments';

export const PROJECT_VERSION = 3;
/** Steps are always stored at full capacity; `Pattern.length` decides how many play. */
export const MAX_STEPS = 128;
export const PATTERN_LENGTHS = [8, 12, 16, 24, 32, 48, 64, 96, 128] as const;
export const MAX_TRACKS = 24;
export const MAX_PATTERNS = 32;
export const MAX_SECTIONS = 128;
export const MAX_SECTION_REPEATS = 16;
export const MAX_AUTOMATION_POINTS = 256;
export const BPM_MIN = 40;
export const BPM_MAX = 220;
export const SWING_MIN = 50;
export const SWING_MAX = 75;
/** Largest micro-timing nudge, as a fraction of a 16th step. */
export const MAX_STEP_OFFSET = 0.5;

export interface Step {
  on: boolean;
  /** Velocity 0..1 */
  vel: number;
  /** MIDI note; ignored by drum instruments. */
  note: number;
  /** Chance the step plays, 0..1 */
  prob: number;
  /** Number of evenly spaced retriggers within the step, 1..4 */
  ratchet: number;
  /** Gate length in steps for melodic instruments, 1..16 */
  len: number;
  /** Micro-timing: fraction of a step to play early (<0) or late (>0), -0.5..0.5 */
  offset: number;
}

/** Insert effects on a track, applied before the fader. */
export interface TrackFx {
  /** Low-pass cutoff, 1 = fully open */
  cutoff: number;
  /** Filter resonance 0..1 */
  resonance: number;
  /** High-pass amount, 0 = off */
  highpass: number;
  drive: number;
  crush: number;
  chorus: number;
}

export type SampleMode = 'pitched' | 'chop';

/** Reference to an audio file stored in the browser, played by the sampler instrument. */
export interface SampleRef {
  id: string;
  name: string;
  /** MIDI note the sample sounds at its original pitch (pitched mode) */
  root: number;
  mode: SampleMode;
  /** Slice start points 0..1 for chop mode (first is always 0) */
  slices: number[];
  /** Trim region 0..1 */
  start: number;
  end: number;
}

export interface Track {
  id: string;
  name: string;
  instrument: InstrumentId;
  volume: number;
  pan: number;
  mute: boolean;
  solo: boolean;
  /** Send levels 0..1 */
  reverb: number;
  delay: number;
  chord: ChordType;
  params: Record<string, number>;
  fx: TrackFx;
  /** How much the sidechain source ducks this track, 0..1 */
  duck: number;
  /** Laid-back (+) or pushed (-) timing for the whole track, -1..1 (about ±30 ms) */
  feel: number;
  /** Random timing and velocity variation, 0..1 */
  humanize: number;
  sample: SampleRef | null;
}

export interface Pattern {
  id: string;
  name: string;
  length: number;
  /** Keyed by track id, each array is MAX_STEPS long. */
  steps: Record<string, Step[]>;
}

export const SECTION_KINDS = [
  'intro',
  'verse',
  'prechorus',
  'hook',
  'break',
  'bridge',
  'drop',
  'outro',
  'custom',
] as const;
export type SectionKind = (typeof SECTION_KINDS)[number];

export const ENTER_TRANSITIONS = ['none', 'filter', 'fade'] as const;
export type EnterTransition = (typeof ENTER_TRANSITIONS)[number];

export const EXIT_TRANSITIONS = ['none', 'filter', 'fade', 'drop', 'tapeStop'] as const;
export type ExitTransition = (typeof EXIT_TRANSITIONS)[number];

/** One block of the song arrangement: a pattern played `repeats` times with its own mix. */
export interface Section {
  id: string;
  name: string;
  kind: SectionKind;
  patternId: string;
  repeats: number;
  /** Played instead of the pattern on the last repeat (e.g. a drum fill). */
  fillPatternId: string | null;
  /** Track ids silenced in this section */
  muted: string[];
  /** Semitones added to melodic notes, e.g. a key lift for the last hook */
  transpose: number;
  /** Tempo override; null follows the project tempo */
  bpm: number | null;
  enter: EnterTransition;
  exit: ExitTransition;
  /** Locked sections are left alone when regenerating */
  locked: boolean;
}

export const MASTER_AUTOMATION_PARAMS = ['volume', 'tone', 'filter', 'reverbMix', 'delayMix', 'wow'] as const;
export type MasterAutomationParam = (typeof MASTER_AUTOMATION_PARAMS)[number];

export const TRACK_AUTOMATION_PARAMS = ['volume', 'pan', 'cutoff', 'reverb', 'delay'] as const;
export type TrackAutomationParam = (typeof TRACK_AUTOMATION_PARAMS)[number];

/** `master.<param>` or `track.<trackId>.<param>` */
export type AutomationTarget = `master.${MasterAutomationParam}` | `track.${string}.${TrackAutomationParam}`;

export interface AutomationPoint {
  /** Song position in bars (fractional) */
  t: number;
  /** Normalised value 0..1 */
  v: number;
}

export interface AutomationLane {
  id: string;
  target: AutomationTarget;
  points: AutomationPoint[];
}

export const AMBIENCE_TYPES = ['none', 'rain', 'cafe', 'city', 'night', 'room', 'vinyl'] as const;
export type AmbienceType = (typeof AMBIENCE_TYPES)[number];

export interface Ambience {
  type: AmbienceType;
  level: number;
}

export const DELAY_DIVISIONS = ['1/4', '1/8d', '1/8', '1/8t', '1/16'] as const;
export type DelayDivision = (typeof DELAY_DIVISIONS)[number];

export interface MasterFx {
  /** Low-pass "tape" tone, 0 = dark, 1 = open */
  tone: number;
  crackle: number;
  wow: number;
  /** Bit crushing, 0 = off */
  crush: number;
  drive: number;
  reverbSize: number;
  reverbMix: number;
  delayDivision: DelayDivision;
  delayFeedback: number;
  delayMix: number;
  /** Bus compression amount */
  glue: number;
}

export type PlayMode = 'pattern' | 'song';

/** Loop region in bars, used while editing in song mode. */
export interface LoopRegion {
  start: number;
  end: number;
}

export interface ProjectMeta {
  artist: string;
  /** Seed for the generated cover art */
  coverSeed: number;
  /** Styles the song was generated from, for display and regenerating */
  styles: string[];
}

export interface Project {
  version: typeof PROJECT_VERSION;
  id: string;
  name: string;
  bpm: number;
  /** MPC-style swing percentage, 50 = straight, ~66 = triplet feel */
  swing: number;
  /** Root pitch class 0..11 */
  root: number;
  scale: ScaleId;
  volume: number;
  tracks: Track[];
  patterns: Pattern[];
  activePatternId: string;
  playMode: PlayMode;
  arrangement: Section[];
  automation: AutomationLane[];
  loop: LoopRegion | null;
  ambience: Ambience;
  /** Track whose hits trigger sidechain ducking; null picks the first kick automatically */
  sidechain: string | null;
  fx: MasterFx;
  meta: ProjectMeta;
  createdAt: number;
  updatedAt: number;
}

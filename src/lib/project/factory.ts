import { createId } from '@/lib/utils/id';
import type { ChordType, ScaleId } from '@/lib/music/theory';
import { defaultParams, getInstrument, type InstrumentId } from './instruments';
import {
  MAX_STEPS,
  PROJECT_VERSION,
  type Ambience,
  type MasterFx,
  type Pattern,
  type Project,
  type ProjectMeta,
  type Section,
  type SectionKind,
  type Step,
  type Track,
  type TrackFx,
} from './types';

const LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('');

/** A–Z, then A2–Z2 and so on. */
export const PATTERN_NAMES = [...LETTERS, ...LETTERS.map((l) => `${l}2`)];

export function createStep(note = 60, overrides: Partial<Step> = {}): Step {
  return { on: false, vel: 0.8, note, prob: 1, ratchet: 1, len: 1, offset: 0, ...overrides };
}

export function createSteps(note = 60): Step[] {
  return Array.from({ length: MAX_STEPS }, () => createStep(note));
}

/** Default note for an instrument, transposed to the project's key. */
export function rootNoteFor(instrument: InstrumentId, root: number): number {
  const def = getInstrument(instrument);
  if (!def.melodic) return def.defaultNote;
  const base = def.defaultNote - (def.defaultNote % 12);
  const note = base + root;
  return note > def.noteRange[1] ? note - 12 : note;
}

export function defaultTrackFx(): TrackFx {
  return { cutoff: 1, resonance: 0.1, highpass: 0, drive: 0, crush: 0, chorus: 0 };
}

export interface TrackOptions {
  name?: string;
  volume?: number;
  pan?: number;
  reverb?: number;
  delay?: number;
  chord?: ChordType;
  params?: Record<string, number>;
  fx?: Partial<TrackFx>;
  duck?: number;
  feel?: number;
  humanize?: number;
}

export function createTrack(instrument: InstrumentId, options: TrackOptions = {}): Track {
  const def = getInstrument(instrument);
  return {
    id: createId('t'),
    name: options.name ?? def.name,
    instrument,
    volume: options.volume ?? 0.8,
    pan: options.pan ?? 0,
    mute: false,
    solo: false,
    reverb: options.reverb ?? (def.category === 'drums' ? 0.08 : 0.25),
    delay: options.delay ?? 0,
    chord: options.chord ?? 'off',
    params: { ...defaultParams(instrument), ...options.params },
    fx: { ...defaultTrackFx(), ...options.fx },
    duck: options.duck ?? 0,
    feel: options.feel ?? 0,
    humanize: options.humanize ?? 0,
    sample: null,
  };
}

export function createPattern(name: string, tracks: Track[], root: number, length = 16): Pattern {
  const steps: Record<string, Step[]> = {};
  for (const track of tracks) steps[track.id] = createSteps(rootNoteFor(track.instrument, root));
  return { id: createId('p'), name, length, steps };
}

export function nextPatternName(patterns: Pattern[]): string {
  const used = new Set(patterns.map((p) => p.name));
  return PATTERN_NAMES.find((n) => !used.has(n)) ?? `P${patterns.length + 1}`;
}

export const SECTION_LABELS: Record<SectionKind, string> = {
  intro: 'Intro',
  verse: 'Verse',
  prechorus: 'Pre-hook',
  hook: 'Hook',
  break: 'Break',
  bridge: 'Bridge',
  drop: 'Drop',
  outro: 'Outro',
  custom: 'Section',
};

export function createSection(patternId: string, options: Partial<Omit<Section, 'id'>> = {}): Section {
  const kind = options.kind ?? 'custom';
  return {
    id: createId('s'),
    name: options.name ?? SECTION_LABELS[kind],
    kind,
    patternId,
    repeats: options.repeats ?? 1,
    fillPatternId: options.fillPatternId ?? null,
    muted: options.muted ?? [],
    transpose: options.transpose ?? 0,
    bpm: options.bpm ?? null,
    enter: options.enter ?? 'none',
    exit: options.exit ?? 'none',
    locked: options.locked ?? false,
  };
}

export function defaultFx(): MasterFx {
  return {
    tone: 0.7,
    crackle: 0.25,
    wow: 0.2,
    crush: 0,
    drive: 0.2,
    reverbSize: 0.5,
    reverbMix: 0.35,
    delayDivision: '1/8d',
    delayFeedback: 0.35,
    delayMix: 0.25,
    glue: 0.4,
  };
}

export function defaultAmbience(): Ambience {
  return { type: 'none', level: 0.4 };
}

export function defaultMeta(seed = Math.floor(Math.random() * 2 ** 31)): ProjectMeta {
  return { artist: '', coverSeed: seed, styles: [] };
}

export interface ProjectOptions {
  name?: string;
  bpm?: number;
  swing?: number;
  root?: number;
  scale?: ScaleId;
  tracks?: Track[];
  fx?: Partial<MasterFx>;
  ambience?: Partial<Ambience>;
  meta?: Partial<ProjectMeta>;
}

export function createProject(options: ProjectOptions = {}): Project {
  const root = options.root ?? 0;
  const tracks =
    options.tracks ?? (['kick', 'snare', 'hat', 'keys', 'bass'] as InstrumentId[]).map((id) => createTrack(id));
  const pattern = createPattern('A', tracks, root);
  const now = Date.now();
  return {
    version: PROJECT_VERSION,
    id: createId('prj'),
    name: options.name ?? 'Untitled beat',
    bpm: options.bpm ?? 84,
    swing: options.swing ?? 58,
    root,
    scale: options.scale ?? 'minor',
    volume: 0.8,
    tracks,
    patterns: [pattern],
    activePatternId: pattern.id,
    playMode: 'pattern',
    arrangement: [createSection(pattern.id, { name: 'A' })],
    automation: [],
    loop: null,
    ambience: { ...defaultAmbience(), ...options.ambience },
    sidechain: null,
    fx: { ...defaultFx(), ...options.fx },
    meta: { ...defaultMeta(), ...options.meta },
    createdAt: now,
    updatedAt: now,
  };
}

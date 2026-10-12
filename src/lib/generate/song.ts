/**
 * Whole-song generator: a structured 0.5–6 minute arrangement (intro, verses,
 * hooks, breaks, outro...) with an energy curve, fills, transitions, harmony
 * per section, a developed hook motif, human feel, mix and automation. Styles
 * can be blended and steered by mood. Deterministic for the same options.
 */
import { SCALES, snapToScale, transposeInScale, type ChordType, type ScaleId } from '@/lib/music/theory';
import { chance, pick, randInt, randRange, weightedPick, type Rng } from '@/lib/music/rng';
import {
  SECTION_LABELS,
  createProject,
  createSection,
  createStep,
  createTrack,
  defaultFx,
  nextPatternName,
  rootNoteFor,
} from '@/lib/project/factory';
import { INSTRUMENTS, isInstrumentId, type InstrumentId } from '@/lib/project/instruments';
import {
  BPM_MAX,
  BPM_MIN,
  MAX_PATTERNS,
  MAX_SECTION_REPEATS,
  MAX_STEP_OFFSET,
  MAX_TRACKS,
  SWING_MAX,
  SWING_MIN,
  type AmbienceType,
  type AutomationLane,
  type MasterFx,
  type Pattern,
  type Project,
  type Section,
  type SectionKind,
  type Step,
  type Track,
  type TrackFx,
} from '@/lib/project/types';
import { createId } from '@/lib/utils/id';
import { clamp } from '@/lib/utils/math';
import {
  GENRES,
  isGenreId,
  type BassStyle,
  type ChordRhythm,
  type DrumGroove,
  type GenreId,
  type MelodyStyle,
  type Progression,
} from './genres';
import {
  BUILD_FILLS,
  HAT_ROLLS,
  MIX,
  SNARE_FILLS,
  TOM_FILLS,
  applyFigure,
  bassSteps,
  beatName,
  blankSteps,
  chordSpan,
  chordStepsWithRhythm,
  coverSeed,
  drumStepsFromGroove,
  fitOctave,
  harmonyScale,
  human,
  isProgressionUsable,
  melodyWindow,
  progressionFromSteps,
  resolveChokes,
  round2,
  scaleFamily,
  seededRng,
  setHit,
  vel,
  type GenerateContext,
} from './generators';
import {
  anchorFor,
  answerMotif,
  createMotif,
  renderMotif,
  trimOverlaps,
  varyMotif,
  type Harmony,
  type Motif,
  type Voice,
} from './motif';
import { KIND_ENERGY, SONG_STYLES, fitStructure, fitTempo, targetBars, type FeelSettings } from './structure';

export interface StyleWeight {
  genre: GenreId;
  weight: number;
}

/** Each 0..1: sad → happy, chill → hype, warm/dusty → bright/clean. */
export interface Mood {
  valence: number;
  energy: number;
  brightness: number;
}

export interface SongOptions {
  seed: number;
  /** One or more styles to blend; weights are normalised */
  styles: StyleWeight[];
  /** Target length in minutes, default 2.5, clamped to 0.5–6 */
  minutes?: number;
  mood?: Partial<Mood>;
  root?: number;
  scale?: ScaleId;
  bpm?: number;
  /** Extra instruments that must play a part */
  instruments?: InstrumentId[];
  exclude?: InstrumentId[];
  ambience?: AmbienceType;
  name?: string;
}

export const DEFAULT_MOOD: Mood = { valence: 0.5, energy: 0.5, brightness: 0.5 };
export const SONG_MINUTES = { min: 0.5, max: 6, default: 2.5 } as const;
/**
 * Songs keep this many tracks unless more instruments are requested; then the
 * budget grows to fit them all plus the core drums and bass, up to MAX_TRACKS.
 */
export const SONG_MAX_TRACKS = 10;
/** Kick, snare, hat and bass stay even when many instruments are requested. */
const CORE_TRACKS = 4;

export type TrackRole =
  | 'kick'
  | 'snare'
  | 'hat'
  | 'openhat'
  | 'perc'
  | 'tom'
  | 'crash'
  | 'riser'
  | 'bass'
  | 'chords'
  | 'pad'
  | 'lead'
  | 'answer';

type RoleKey = SectionKind | 'verse2';
type HarmonyKey = 'verse' | 'hook' | 'bridge' | 'build';
type FillType = 'build' | 'fill' | 'stop';

const HARMONY_OF: Record<RoleKey, HarmonyKey> = {
  intro: 'hook',
  verse: 'verse',
  verse2: 'verse',
  prechorus: 'build',
  hook: 'hook',
  break: 'verse',
  bridge: 'bridge',
  drop: 'hook',
  outro: 'hook',
  custom: 'verse',
};

const DRUM_ROLES: Partial<Record<InstrumentId, TrackRole>> = {
  kick: 'kick',
  kick2: 'kick',
  kick3: 'kick',
  snare: 'snare',
  snare2: 'snare',
  clap: 'snare',
  hat: 'hat',
  hat2: 'hat',
  openhat: 'openhat',
  openhat2: 'openhat',
  rim: 'perc',
  shaker: 'perc',
  shaker2: 'perc',
  tom: 'tom',
  crash: 'crash',
  riser: 'riser',
};

/** Instruments that sustain chords under the main comping part. */
const PAD_TYPES = new Set<InstrumentId>(['pad', 'strings', 'vox']);

/** Display order within each group (drums → bass → harmony → melody → fx). */
const ORDER: InstrumentId[] = [
  'kick',
  'snare',
  'clap',
  'rim',
  'hat',
  'openhat',
  'shaker',
  'tom',
  'crash',
  '808',
  'bass',
  'upright',
  'keys',
  'wurli',
  'guitar',
  'pad',
  'strings',
  'vox',
  'pluck',
  'bell',
  'lead',
  'flute',
  'riser',
];

const ROLE_PREFS: Partial<Record<InstrumentId, TrackRole[]>> = {
  keys: ['chords', 'lead'],
  wurli: ['chords', 'lead'],
  guitar: ['chords', 'lead', 'answer'],
  pluck: ['lead', 'answer', 'chords'],
  pad: ['pad', 'chords'],
  strings: ['pad', 'answer', 'lead'],
  vox: ['pad', 'answer'],
  bell: ['lead', 'answer'],
  lead: ['lead', 'answer'],
  flute: ['lead', 'answer'],
};

const HAPPY_SCALES: ScaleId[] = ['major', 'lydian', 'mixolydian'];
const SAD_SCALES: ScaleId[] = ['minor', 'phrygian', 'harmonicMinor'];

const major = (...degrees: number[]): Progression => ({ degrees, family: 'major' });
const minor = (...degrees: number[]): Progression => ({ degrees, family: 'minor' });

/** Fallback progressions when a style has none that suit the chosen scale. */
const GENERIC_PROGRESSIONS: Progression[] = [
  major(1, 5, 6, 4),
  major(1, 4),
  major(1, 6, 4, 5),
  major(4, 5, 3, 6),
  major(2, 5, 1, 1),
  minor(1, 6, 3, 7),
  minor(1, 4),
  minor(1, 7, 6, 7),
  minor(6, 7, 1, 1),
  minor(1, 2),
];

/** Pre-hook progressions that pull towards the tonic. */
const BUILD_PROGRESSIONS: Progression[] = [major(4, 5), major(2, 5), minor(6, 7), minor(4, 5), minor(4, 7)];

// ---------------------------------------------------------------------------
// Styles and mood

interface Blend {
  styles: StyleWeight[];
  primary: GenreId;
  /** Grooves are in half time (trap) at about double tempo */
  halfTime: boolean;
}

/** Merge duplicates, drop unknown/non-positive entries, strongest first, weights normalised. Any number blend. */
export function normalizeStyles(styles: StyleWeight[] | undefined): StyleWeight[] {
  const merged = new Map<GenreId, number>();
  for (const s of styles ?? []) {
    if (!isGenreId(s?.genre) || !Number.isFinite(s.weight) || s.weight <= 0) continue;
    merged.set(s.genre, (merged.get(s.genre) ?? 0) + s.weight);
  }
  const list = [...merged].map(([genre, weight]) => ({ genre, weight })).sort((a, b) => b.weight - a.weight);
  if (!list.length) return [{ genre: 'lofi', weight: 1 }];
  const total = list.reduce((n, s) => n + s.weight, 0);
  return list.map((s) => ({ genre: s.genre, weight: Math.round((s.weight / total) * 1000) / 1000 }));
}

function blendOf(styles: StyleWeight[]): Blend {
  const half = styles.reduce((n, s) => n + (SONG_STYLES[s.genre].halfTime ? s.weight : 0), 0);
  return { styles, primary: styles[0].genre, halfTime: half >= 0.5 };
}

function avg(blend: Blend, f: (genre: GenreId) => number): number {
  return blend.styles.reduce((n, s) => n + s.weight * f(s.genre), 0);
}

function pickGenre(blend: Blend, rng: Rng): GenreId {
  return weightedPick(
    rng,
    blend.styles.map((s) => [s.genre, s.weight] as const),
  );
}

export function normalizeMood(mood: Partial<Mood> | undefined): Mood {
  const unit = (v: number | undefined, d: number) => (typeof v === 'number' && Number.isFinite(v) ? clamp(v, 0, 1) : d);
  return {
    valence: unit(mood?.valence, DEFAULT_MOOD.valence),
    energy: unit(mood?.energy, DEFAULT_MOOD.energy),
    brightness: unit(mood?.brightness, DEFAULT_MOOD.brightness),
  };
}

/** A genre's tempo range expressed in the song's frame (half-time styles run at double tempo). */
function tempoRange(genre: GenreId, halfTime: boolean): [number, number] {
  const [lo, hi] = GENRES[genre].bpm;
  const factor = SONG_STYLES[genre].halfTime === halfTime ? 1 : halfTime ? 2 : 0.5;
  return [lo * factor, hi * factor];
}

/** Blended tempo range of the styles, in the song's frame. */
export function blendedTempoRange(styles: StyleWeight[]): [number, number] {
  const blend = blendOf(normalizeStyles(styles));
  return [
    Math.round(avg(blend, (g) => tempoRange(g, blend.halfTime)[0])),
    Math.round(avg(blend, (g) => tempoRange(g, blend.halfTime)[1])),
  ];
}

function chooseScale(blend: Blend, mood: Mood, rng: Rng): ScaleId {
  const v = mood.valence;
  const allowed: ScaleId[] | null =
    v >= 0.72
      ? HAPPY_SCALES
      : v >= 0.58
        ? [...HAPPY_SCALES, 'dorian']
        : v <= 0.28
          ? SAD_SCALES
          : v <= 0.42
            ? [...SAD_SCALES, 'dorian']
            : null;
  const first = pickGenre(blend, rng);
  const order = [first, ...blend.styles.map((s) => s.genre).filter((g) => g !== first)];
  for (const genre of order) {
    const candidates = GENRES[genre].scales.filter((s) => !allowed || allowed.includes(s));
    if (candidates.length) return pick(rng, candidates);
  }
  // No style scale fits the mood: the brightest dark style keeps dorian, otherwise plain major/minor.
  if (!allowed) return 'minor';
  return allowed.includes('dorian') && GENRES[first].scales.includes('minor') ? 'dorian' : allowed[0];
}

// ---------------------------------------------------------------------------
// Harmony

function progressionPool(genre: GenreId, scale: ScaleId): Progression[] {
  const family = scaleFamily(scale);
  const usable = GENRES[genre].progressions.filter((p) => isProgressionUsable(p, scale));
  const matching = usable.filter((p) => p.family === family);
  if (matching.length) return matching;
  const generic = GENERIC_PROGRESSIONS.filter((p) => p.family === family && isProgressionUsable(p, scale));
  if (generic.length) return generic;
  return usable.length ? usable : [{ degrees: [1], family }];
}

/** Degrees for a section: a weighted style's progression, different from `avoid` when possible. */
function chooseProgression(blend: Blend, scale: ScaleId, rng: Rng, avoid: number[][], bridge = false): number[] {
  const pool = progressionPool(pickGenre(blend, rng), scale).map((p) => p.degrees);
  const key = (d: number[]) => d.join();
  const avoided = new Set(avoid.map(key));
  let options = pool.filter((d) => !avoided.has(key(d)));
  if (bridge) {
    const away = options.filter((d) => d[0] !== 1);
    if (away.length) options = away;
  }
  if (!options.length) {
    // Everything was used: rotate a progression so the section starts somewhere new.
    const base = pick(rng, pool);
    return base.length > 1 ? [...base.slice(2), ...base.slice(0, 2)] : base;
  }
  return pick(rng, options);
}

function chooseBuild(scale: ScaleId, rng: Rng): number[] | null {
  const family = scaleFamily(scale);
  const options = BUILD_PROGRESSIONS.filter((p) => p.family === family && isProgressionUsable(p, scale));
  return options.length ? pick(rng, options).degrees : null;
}

/** Scale degrees (1-based) of chord roots, with a repeated cycle folded (1,4,1,4 → 1,4). */
function degreesOf(roots: number[], root: number, scale: ScaleId): number[] {
  const intervals = SCALES[harmonyScale(scale)].intervals as readonly number[];
  let degrees = roots.map((r) => intervals.indexOf((((r - root) % 12) + 12) % 12) + 1);
  while (degrees.length % 2 === 0 && degrees.length > 1) {
    const half = degrees.length / 2;
    if (degrees.slice(0, half).join() !== degrees.slice(half).join()) break;
    degrees = degrees.slice(0, half);
  }
  return degrees;
}

/** Steps per chord for a progression: whole bars when the style prefers them and the pattern stays ≤ 4 bars. */
function spanFor(degrees: number[], preferBar: boolean): 8 | 16 {
  if (degrees.length <= 2) return 16;
  return preferBar && degrees.length <= 4 ? 16 : 8;
}

/** Pattern length for a progression: 2 bars, or 4 when it has four one-bar chords (or the style is slow-moving). */
function lengthFor(degrees: number[], span: number, long: boolean): number {
  return long ? 64 : clamp(degrees.length * span, 32, 64);
}

/**
 * Chord roots (MIDI 48..64, the same format as generateProgression) for the
 * degrees over `length` steps, voice-led by nearest octave.
 */
export function progressionRoots(degrees: number[], length: number, root: number, scale: ScaleId): number[] {
  const span = degrees.length * 16 <= length ? 16 : 8;
  const count = Math.max(1, Math.ceil(length / span));
  const intervals = SCALES[harmonyScale(scale)].intervals;
  const roots: number[] = [];
  for (let i = 0; i < count; i++) {
    const degree = degrees[i % degrees.length];
    const interval = intervals[(((degree - 1) % 7) + 7) % 7];
    const raw = snapToScale(48 + ((root + interval) % 12), root, scale);
    if (i === 0) {
      roots.push(fitOctave(raw, 50, 61));
      continue;
    }
    const prev = roots[i - 1];
    const octaves = [raw - 12, raw, raw + 12].filter((n) => n >= 48 && n <= 64);
    roots.push(octaves.reduce((best, n) => (Math.abs(n - prev) < Math.abs(best - prev) ? n : best)));
  }
  return roots;
}

// ---------------------------------------------------------------------------
// Grooves

interface GrooveRef {
  genre: GenreId;
  groove: DrumGroove;
}

const HIT_STRENGTH: Record<string, number> = { X: 9, x: 7, '4': 6, '3': 6, '2': 6, '*': 5, o: 4, g: 2, '?': 1 };

/** Re-time a groove: ×2 stretches a straight groove into half time, ×0.5 folds a half-time groove. */
export function retimeGroove(groove: DrumGroove, factor: 0.5 | 2): DrumGroove {
  const parts: DrumGroove['parts'] = {};
  for (const [instrument, part] of Object.entries(groove.parts) as [InstrumentId, string][]) {
    const chars = part.replace(/[ |]/g, '').split('');
    if (factor === 2) {
      parts[instrument] = chars.map((c) => `${c}.`).join('');
      continue;
    }
    const out = new Array<string>(Math.ceil(chars.length / 2)).fill('.');
    chars.forEach((c, i) => {
      const j = Math.floor(i / 2);
      if ((HIT_STRENGTH[c] ?? 0) > (HIT_STRENGTH[out[j]] ?? 0)) out[j] = c;
    });
    parts[instrument] = out.join('');
  }
  return { name: groove.name, parts };
}

function grooveRef(genre: GenreId, index: number, halfTime: boolean): GrooveRef {
  const list = GENRES[genre].grooves;
  const groove = list[((index % list.length) + list.length) % list.length];
  const native = SONG_STYLES[genre].halfTime;
  if (native === halfTime) return { genre, groove };
  return { genre, groove: retimeGroove(groove, halfTime ? 2 : 0.5) };
}

// ---------------------------------------------------------------------------
// Context shared by song generation and section regeneration

interface SongContext {
  seed: number;
  blend: Blend;
  mood: Mood;
  root: number;
  scale: ScaleId;
  tracks: Track[];
  roles: Map<string, TrackRole>;
  call: Motif;
  response: Motif;
  melody: MelodyStyle;
  grooves: { main: GrooveRef; alt: GrooveRef };
  bassStyle: BassStyle;
  /** 0..1 how much the styles like risers, drops and rolls */
  energetic: number;
  /** 0..1 how jazzy the harmony is (passing chords) */
  jazzy: number;
  /** 0..1 how far ghost notes drift off the grid */
  ghost: number;
  /** Style likes to open with the melody (trap, ambient) */
  introMelody: boolean;
}

const JAZZY: Record<GenreId, number> = {
  lofi: 0.6,
  jazzhop: 1,
  boombap: 0.25,
  chillhop: 0.5,
  trap: 0,
  rnb: 0.8,
  house: 0.1,
  ambient: 0,
};

function blendMelody(blend: Blend, mood: Mood, rng: Rng): MelodyStyle {
  const m = (g: GenreId) => GENRES[g].melody;
  return {
    density: clamp(avg(blend, (g) => m(g).density) * (0.85 + 0.3 * mood.energy), 0.2, 0.85),
    grid: m(pickGenre(blend, rng)).grid,
    maxLen: Math.round(avg(blend, (g) => m(g).maxLen)),
    syncopation: avg(blend, (g) => m(g).syncopation),
    register: Math.round(avg(blend, (g) => m(g).register)),
  };
}

function createContext(
  seed: number,
  blend: Blend,
  mood: Mood,
  root: number,
  scale: ScaleId,
  tracks: Track[],
  roles: Map<string, TrackRole>,
): SongContext {
  const rng = seededRng(seed, 'context');
  const melody = blendMelody(blend, mood, rng);
  const motifRng = seededRng(seed, 'motif');
  const call = createMotif(motifRng, melody, 16);
  const response = answerMotif(call, motifRng, melody);
  const mainGenre = pickGenre(blend, rng);
  const mainIndex = randInt(rng, 0, GENRES[mainGenre].grooves.length - 1);
  const altGenre = pickGenre(blend, rng);
  let altIndex = randInt(rng, 0, GENRES[altGenre].grooves.length - 1);
  if (altGenre === mainGenre && altIndex === mainIndex) altIndex += 1;
  return {
    seed,
    blend,
    mood,
    root,
    scale,
    tracks,
    roles,
    call,
    response,
    melody,
    grooves: {
      main: grooveRef(mainGenre, mainIndex, blend.halfTime),
      alt: grooveRef(altGenre, altIndex, blend.halfTime),
    },
    bassStyle: GENRES[pickGenre(blend, rng)].bass,
    energetic: clamp(avg(blend, (g) => SONG_STYLES[g].energy) + (mood.energy - 0.5) * 0.6, 0, 1),
    jazzy: avg(blend, (g) => JAZZY[g]),
    ghost: avg(blend, (g) => SONG_STYLES[g].feel.ghostOffset),
    introMelody: avg(blend, (g) => (g === 'trap' || g === 'ambient' ? 1 : 0)) >= 0.5,
  };
}

/** Roles of existing tracks (used when regenerating a section of any project). */
export function inferRoles(tracks: Track[]): Map<string, TrackRole> {
  const roles = new Map<string, TrackRole>();
  const chordTracks: Track[] = [];
  const melodic: Track[] = [];
  for (const track of tracks) {
    const def = INSTRUMENTS[track.instrument];
    const drum = DRUM_ROLES[track.instrument];
    if (drum) roles.set(track.id, drum);
    else if (def.sampler) continue;
    else if (def.category === 'bass') roles.set(track.id, 'bass');
    else if (def.polyphonic && track.chord !== 'off') chordTracks.push(track);
    else if (def.melodic) melodic.push(track);
  }
  const main = chordTracks.find((t) => !PAD_TYPES.has(t.instrument)) ?? chordTracks[0];
  for (const t of chordTracks) roles.set(t.id, t === main ? 'chords' : 'pad');
  melodic.forEach((t, i) => roles.set(t.id, i === 0 ? 'lead' : 'answer'));
  return roles;
}

// ---------------------------------------------------------------------------
// Pattern building

interface PatternSpec {
  role: RoleKey;
  kind: SectionKind;
  energy: number;
  roots: number[];
  length: number;
  salt: string;
}

function clearStep(steps: Step[], i: number, blank: Step): void {
  steps[i] = { ...blank };
}

function isFourOnFloor(steps: Step[], length: number): boolean {
  for (let i = 0; i < Math.min(length, 16); i += 4) if (!steps[i].on) return false;
  return true;
}

/** Density and dynamics of a drum part for the section energy. */
function shapeDrums(
  steps: Step[],
  role: TrackRole,
  instrument: InstrumentId,
  spec: PatternSpec,
  ctx: SongContext,
  rng: Rng,
  rolls: number,
): void {
  const { length, energy } = spec;
  const blank = createStep(rootNoteFor(instrument, ctx.root));
  const level = 0.8 + 0.22 * energy;
  for (let i = 0; i < length; i++) if (steps[i].on) steps[i] = { ...steps[i], vel: vel(steps[i].vel * level) };

  if (role === 'hat' && instrument === 'hat') {
    if (energy < 0.45) {
      // Sparse sections: 8ths only (quarters when very quiet), no rolls.
      const keep = energy < 0.3 ? 4 : 2;
      for (let i = 0; i < length; i++) {
        if (!steps[i].on) continue;
        if (i % keep !== 0) clearStep(steps, i, blank);
        else if (steps[i].ratchet > 1) steps[i] = { ...steps[i], ratchet: 1 };
      }
    } else if (energy < 0.7) {
      // Verses leave out most of the ghosted 16ths the hooks keep.
      for (let i = 1; i < length; i += 2)
        if (steps[i].on && steps[i].vel < 0.4 && chance(rng, 0.6)) clearStep(steps, i, blank);
    } else if (energy >= 0.78) {
      for (let bar = 0; bar * 16 < length; bar++) {
        const start = bar * 16;
        const rolled = steps.slice(start, start + 16).some((s) => s.on && s.ratchet > 1);
        if (rolls > 0 && !rolled && chance(rng, rolls * 0.7)) {
          const at = start + pick(rng, [6, 10, 13, 14]);
          if (at < length) setHit(steps, at, { note: blank.note, vel: human(0.6, rng), ratchet: randInt(rng, 2, 3) });
        } else if (rolls === 0) {
          // Lift: a couple of ghosted 16ths.
          for (const r of [3, 11, 15]) {
            const at = start + r;
            if (at < length && !steps[at].on && chance(rng, 0.3))
              setHit(steps, at, { note: blank.note, vel: human(0.26, rng, 0.15) });
          }
        }
      }
    }
  }
  if (role === 'snare' && energy < 0.4) {
    for (let i = 0; i < length; i++) if (steps[i].on && steps[i].vel < 0.4) clearStep(steps, i, blank);
  }
  if (role === 'kick' && energy >= 0.85 && !isFourOnFloor(steps, length) && chance(rng, 0.6)) {
    // A pickup kick pushing into the next bar.
    const at = length - pick(rng, [2, 3]);
    if (!steps[at].on && !steps[at - 1]?.on && !steps[at + 1]?.on) setHit(steps, at, { note: blank.note, vel: 0.7 });
  }
}

/** Nudge soft (ghost) hits a little off the grid for a played feel. */
function nudgeGhosts(steps: Step[], length: number, amount: number, rng: Rng): void {
  if (amount <= 0) return;
  for (let i = 0; i < length; i++) {
    const s = steps[i];
    if (!s.on || s.vel >= 0.45) continue;
    const offset = round2(clamp(randRange(rng, -0.08, 0.22) * amount, -MAX_STEP_OFFSET, MAX_STEP_OFFSET));
    steps[i] = { ...s, offset };
  }
}

function chordRhythmFor(
  ctx: SongContext,
  spec: PatternSpec,
  span: number,
  rng: Rng,
  instrument: InstrumentId,
): Omit<ChordRhythm, 'span'> {
  const sustained = { hits: [0], push: 0 };
  const quiet = spec.energy < 0.4 || spec.kind === 'intro' || spec.kind === 'outro' || spec.kind === 'break';
  // Pads, strings and choirs hold their chords (a push is fine).
  if (PAD_TYPES.has(instrument)) return quiet ? sustained : { hits: [0], push: pick(rng, [0, 0, 1, 2]) };
  if (quiet) return sustained;
  let options = GENRES[pickGenre(ctx.blend, rng)].chordRhythms.filter((r) => r.span === span);
  if (!options.length) {
    options = ctx.blend.styles.flatMap((s) => GENRES[s.genre].chordRhythms).filter((r) => r.span === span);
  }
  if (!options.length) return sustained;
  const a = pick(rng, options);
  if (spec.kind !== 'hook' && spec.kind !== 'drop') return a;
  const b = pick(rng, options);
  return b.hits.length > a.hits.length ? b : a;
}

/** Diatonic passing chords a beat before some changes (jazzy styles). */
function addPassingChords(steps: Step[], track: Track, ctx: SongContext, length: number, rng: Rng, amount: number) {
  if (amount <= 0) return;
  const [lo, hi] = INSTRUMENTS[track.instrument].noteRange;
  const onsets: number[] = [];
  for (let i = 0; i < length; i++) if (steps[i].on) onsets.push(i);
  for (let k = 1; k < onsets.length; k++) {
    const a = onsets[k - 1];
    const b = onsets[k];
    if (steps[a].note === steps[b].note || b - a < 6 || !chance(rng, amount)) continue;
    const at = b - 2;
    const moved = transposeInScale(steps[b].note, chance(rng, 0.6) ? 1 : -1, ctx.root, harmonyScale(ctx.scale));
    const note = snapToScale(moved, ctx.root, ctx.scale);
    if (note < lo || note > hi) continue;
    steps[a] = { ...steps[a], len: Math.max(1, Math.min(steps[a].len, at - a)) };
    setHit(steps, at, { note, vel: human(steps[a].vel * 0.85, rng), len: 2 });
  }
}

function scaleVelocity(steps: Step[], length: number, factor: number): void {
  for (let i = 0; i < length; i++) if (steps[i].on) steps[i] = { ...steps[i], vel: vel(steps[i].vel * factor) };
}

function voiceFor(instrument: InstrumentId, register: number, harmony: Harmony): Voice {
  const [lo, hi] = melodyWindow(instrument, register);
  const pool: number[] = [];
  for (let n = lo; n <= hi; n++) if (snapToScale(n, harmony.root, harmony.scale) === n) pool.push(n);
  return { pool, anchor: anchorFor(pool, harmony) };
}

/** Lead and answer parts for a section: the hook motif, its response and variations. */
function writeMelodies(ctx: SongContext, spec: PatternSpec, harmony: Harmony, out: Record<string, Step[]>): void {
  const melodic = ctx.tracks.filter((t) => ctx.roles.get(t.id) === 'lead' || ctx.roles.get(t.id) === 'answer');
  if (!melodic.length) return;
  const lead = melodic.find((t) => ctx.roles.get(t.id) === 'lead') ?? melodic[0];
  const answers = melodic.filter((t) => t !== lead);
  const { length, energy, kind } = spec;
  const phrase = Math.min(32, length);
  const half = phrase / 2;
  const rng = seededRng(ctx.seed, `${spec.salt}:melody`);
  const variant = seededRng(ctx.seed, `variation:${spec.role}`);
  const { call, response, melody } = ctx;
  const leadVoice = voiceFor(lead.instrument, melody.register, harmony);
  const render = (track: Track, motif: Motif, start: number, opts: { resolve?: boolean; level?: number } = {}) => {
    const voice = track === lead ? leadVoice : voiceFor(track.instrument, melody.register + 3, harmony);
    renderMotif(out[track.id], motif, start, voice, harmony, rng, { energy, limit: length, ...opts });
  };
  const phrases = Math.max(1, Math.floor(length / phrase));
  const lastPhrase = (p: number) => p === phrases - 1;

  for (let p = 0; p < phrases; p++) {
    const start = p * phrase;
    const resolve = lastPhrase(p);
    if (kind === 'hook' || kind === 'drop' || kind === 'custom') {
      render(lead, call, start);
      if (answers.length) for (const a of answers) render(a, response, start + half, { resolve });
      else render(lead, response, start + half, { resolve });
    } else if (kind === 'verse') {
      // Verses restate the hook idea sparser, displaced and moved within the scale.
      const shift = pick(variant, [0, 2, -2, 4]);
      const transpose = pick(variant, [-2, -1, 1, 2]);
      render(lead, varyMotif(call, rng, { sparsity: 0.35, shift, transpose }), start, { level: 0.92 });
      render(lead, varyMotif(response, rng, { sparsity: 0.45, transpose, fragment: 0.75 }), start + half, {
        resolve,
        level: 0.9,
      });
      for (const a of answers) {
        // A short echo in the gap at the end of the phrase.
        const echo = varyMotif(call, rng, { fragment: 0.5, shift: half / 2, transpose: transpose + 2, sparsity: 0.3 });
        render(a, echo, start + half, { level: 0.85 });
      }
    } else if (kind === 'prechorus') {
      const frag = varyMotif(call, rng, { fragment: 0.5 });
      render(lead, frag, start);
      render(lead, varyMotif(frag, rng, { transpose: 2 }), start + half);
    } else if (kind === 'bridge') {
      render(lead, varyMotif(call, rng, { invert: true, transpose: 1, sparsity: 0.2 }), start);
      const reply = varyMotif(response, rng, { invert: true, sparsity: 0.25 });
      if (answers.length) for (const a of answers) render(a, reply, start + half, { resolve });
      else render(lead, reply, start + half, { resolve });
    } else if (kind === 'break') {
      const sparse = varyMotif(call, rng, { sparsity: 0.5, invert: chance(variant, 0.5), maxLen: 4 });
      for (const t of answers.length ? answers : [lead]) render(t, sparse, start, { level: 0.8 });
      if (answers.length) render(lead, varyMotif(call, rng, { fragment: 0.4 }), start + half, { level: 0.75 });
    } else if (kind === 'intro') {
      render(lead, varyMotif(call, rng, { fragment: 0.6, sparsity: 0.2 }), start, { level: 0.85 });
    } else if (kind === 'outro') {
      if (p === 0) {
        render(lead, call, start, { level: 0.85 });
        render(lead, varyMotif(response, rng, { sparsity: 0.3 }), start + half, { resolve: true, level: 0.8 });
      } else {
        render(lead, varyMotif(call, rng, { fragment: 0.4 }), start, { level: 0.75, resolve: true });
      }
    }
  }
  for (const t of melodic) trimOverlaps(out[t.id], length);
}

function drumGrooveFor(ctx: SongContext, kind: SectionKind): GrooveRef {
  return kind === 'bridge' ? ctx.grooves.alt : ctx.grooves.main;
}

/** Main pattern steps for a section role. */
function buildMain(ctx: SongContext, spec: PatternSpec): Record<string, Step[]> {
  const { length, kind, energy, roots } = spec;
  const out: Record<string, Step[]> = {};
  const span = chordSpan(length, roots.length);
  const harmony: Harmony = { root: ctx.root, scale: ctx.scale, roots, span };
  const groove = drumGrooveFor(ctx, kind);
  const drumGenre = GENRES[groove.genre];
  const base = (index: number, track: Track): GenerateContext => ({
    root: ctx.root,
    scale: ctx.scale,
    length,
    rng: seededRng(ctx.seed, `${spec.salt}:${index}:${track.instrument}`),
  });
  const rolls = avg(ctx.blend, (g) => GENRES[g].drums.rolls);
  const hook = kind === 'hook' || kind === 'drop';

  // Drums first so the bass can lock to the kick.
  ctx.tracks.forEach((track, index) => {
    const role = ctx.roles.get(track.id);
    let steps = blankSteps(track.instrument, ctx.root);
    if (role === 'kick' || role === 'snare' || role === 'hat' || role === 'openhat' || role === 'perc') {
      const gctx = base(index, track);
      steps = drumStepsFromGroove(groove.groove, drumGenre, track.instrument, gctx, { fill: false });
      shapeDrums(steps, role, track.instrument, spec, ctx, gctx.rng, rolls);
      if (role !== 'kick') nudgeGhosts(steps, length, ctx.ghost, gctx.rng);
    } else if (role === 'tom' && (hook || kind === 'bridge') && energy >= 0.6) {
      steps = drumStepsFromGroove(groove.groove, drumGenre, 'tom', base(index, track), { fill: false });
    } else if (role === 'crash' && hook) {
      setHit(steps, 0, { note: steps[0].note, vel: 0.72 });
    }
    out[track.id] = steps;
  });
  const kickTrack = ctx.tracks.find((t) => ctx.roles.get(t.id) === 'kick');
  const kick = kickTrack ? out[kickTrack.id] : undefined;

  ctx.tracks.forEach((track, index) => {
    const role = ctx.roles.get(track.id);
    const gctx = base(index, track);
    if (role === 'bass') {
      const quiet = energy < 0.4 || kind === 'intro' || kind === 'outro' || kind === 'break';
      let style: BassStyle = quiet ? 'sustain' : ctx.bassStyle;
      if (track.instrument === '808' && (style === 'walking' || style === 'offbeat' || style === 'syncopated')) {
        style = ctx.blend.halfTime ? '808' : 'syncopated';
      } else if (track.instrument !== '808' && style === '808') style = 'syncopated';
      out[track.id] = bassSteps(style, drumGenre, track, { ...gctx, kick }, roots);
    } else if (role === 'chords') {
      const steps = chordStepsWithRhythm(
        track,
        gctx,
        roots,
        chordRhythmFor(ctx, spec, span, gctx.rng, track.instrument),
      );
      if (energy >= 0.45) addPassingChords(steps, track, ctx, length, gctx.rng, ctx.jazzy * 0.35);
      scaleVelocity(steps, length, 0.85 + 0.2 * energy);
      out[track.id] = steps;
    } else if (role === 'pad') {
      const steps = chordStepsWithRhythm(track, gctx, roots, { hits: [0], push: 0 });
      scaleVelocity(steps, length, 0.7 + 0.15 * energy);
      out[track.id] = steps;
    } else if (role === 'lead' || role === 'answer') {
      out[track.id] = blankSteps(track.instrument, ctx.root);
    }
  });
  writeMelodies(ctx, spec, harmony, out);
  resolveChokes(ctx.tracks, out, length, ctx.root, new Set(ctx.tracks.map((t) => t.id)));
  return out;
}

/** Snare roll over [from, to): 8ths, then 16ths, getting louder. */
function snareRoll(steps: Step[], from: number, to: number, note: number, rng: Rng, ratchetEnd: boolean): void {
  const mid = from + Math.floor((to - from) / 2);
  for (let i = from; i < to; i++) {
    if (i < mid && (i - from) % 2 === 1) continue;
    const t = (i - from) / Math.max(1, to - from - 1);
    const ratchet = ratchetEnd && i >= to - 2 ? 2 : 1;
    setHit(steps, i, { note, vel: human(0.42 + 0.48 * t, rng, 0.04), ratchet });
  }
}

/**
 * A copy of the main pattern with a drum fill in the last bar: a snare/tom fill,
 * a snare roll and riser before hooks/drops ('build'), or a stop before breaks
 * and the outro ('stop').
 */
function buildFill(
  ctx: SongContext,
  spec: PatternSpec,
  main: Record<string, Step[]>,
  type: FillType,
): Record<string, Step[]> {
  const out: Record<string, Step[]> = {};
  for (const [id, steps] of Object.entries(main)) out[id] = steps.map((s) => ({ ...s }));
  const { length } = spec;
  const lastBar = Math.max(0, length - 16);
  const rng = seededRng(ctx.seed, `${spec.salt}:fill:${type}`);
  const genre = GENRES[drumGrooveFor(ctx, spec.kind).genre];
  const style = genre.drums.fill;
  const rolling = style === 'roll' || ctx.energetic >= 0.6;
  const hasSnare = ctx.tracks.some((t) => t.instrument === 'snare');
  const tail = Math.max(0, length - 4);

  ctx.tracks.forEach((track) => {
    const role = ctx.roles.get(track.id);
    const steps = out[track.id];
    const note = rootNoteFor(track.instrument, ctx.root);
    const blank = createStep(note);
    const clearTail = (from: number) => {
      for (let i = from; i < length; i++) if (steps[i].on) clearStep(steps, i, blank);
    };
    switch (role) {
      case 'kick':
        if (type === 'stop') {
          clearTail(tail);
          setHit(steps, tail, { note, vel: 0.9 });
        } else if (type === 'build' && rolling) {
          clearTail(tail);
        } else if (chance(rng, 0.4)) {
          for (let i = length - 3; i < length; i++) if (i % 16 !== 0 && steps[i].on) clearStep(steps, i, blank);
        }
        break;
      case 'snare':
        if (track.instrument === 'clap' && hasSnare) {
          if (type === 'stop') clearTail(tail);
          break;
        }
        if (type === 'stop') {
          clearTail(tail);
          setHit(steps, tail, { note, vel: 0.92 });
        } else if (type === 'build' && rolling) {
          clearTail(length - 8);
          snareRoll(steps, length - 8, length, note, rng, style === 'roll');
        } else if (style !== 'none') {
          applyFigure(
            steps,
            tail,
            pick(rng, style === 'roll' ? BUILD_FILLS : SNARE_FILLS),
            note,
            rng,
            style === 'roll',
          );
        }
        break;
      case 'hat':
        if (type === 'stop') clearTail(tail);
        else if (track.instrument === 'hat' && (style === 'roll' || (type === 'build' && rolling))) {
          applyFigure(steps, tail, pick(rng, HAT_ROLLS), note, rng, true);
        }
        break;
      case 'openhat':
        if (type === 'fill' && style !== 'roll' && chance(rng, 0.6)) setHit(steps, length - 2, { note, vel: 0.55 });
        if (type === 'stop') clearTail(tail);
        break;
      case 'perc':
        if (style === 'none' && type !== 'stop')
          applyFigure(steps, tail, pick(rng, ['.g.o', 'g.go', '..go']), note, rng, true);
        if (type === 'stop') clearTail(tail);
        break;
      case 'tom':
        if (type !== 'stop') applyFigure(steps, tail, pick(rng, TOM_FILLS), note, rng, false);
        break;
      case 'riser':
        if (type === 'build') setHit(steps, lastBar, { note, vel: 0.72, len: Math.min(16, length - lastBar) });
        break;
      default:
        break;
    }
  });
  resolveChokes(ctx.tracks, out, length, ctx.root, new Set(ctx.tracks.map((t) => t.id)));
  return out;
}

function fillTypeFor(next: SectionKind | undefined): FillType | null {
  if (!next) return null;
  if (next === 'hook' || next === 'drop') return 'build';
  if (next === 'break' || next === 'outro') return 'stop';
  return 'fill';
}

function sameSteps(a: Record<string, Step[]>, b: Record<string, Step[]>, length: number): boolean {
  for (const id of Object.keys(a)) {
    for (let i = 0; i < length; i++) {
      const x = a[id][i];
      const y = b[id]?.[i];
      if (!y || x.on !== y.on || (x.on && (x.vel !== y.vel || x.note !== y.note || x.len !== y.len))) return false;
    }
  }
  return true;
}

// ---------------------------------------------------------------------------
// Kit and tracks

interface KitEntry {
  instrument: InstrumentId;
  role: TrackRole;
  requested: boolean;
  /** Higher survives trimming */
  priority: number;
}

function assignKit(blend: Blend, mood: Mood, options: SongOptions): KitEntry[] {
  const excluded = new Set((options.exclude ?? []).filter(isInstrumentId));
  const requested = [...new Set((options.instruments ?? []).filter(isInstrumentId))].filter(
    (id) => !excluded.has(id) && !INSTRUMENTS[id].sampler,
  );
  const wanted = new Set(requested);
  const energetic = avg(blend, (g) => SONG_STYLES[g].energy) + (mood.energy - 0.5);

  // Candidates from every style, strongest first.
  const candidates: { instrument: InstrumentId; weight: number }[] = [];
  const seen = new Set<InstrumentId>();
  for (const style of blend.styles) {
    const extras = SONG_STYLES[style.genre].extras.filter(() => energetic >= 0.35);
    for (const instrument of [...GENRES[style.genre].kit, ...extras]) {
      if (seen.has(instrument) || excluded.has(instrument)) continue;
      seen.add(instrument);
      candidates.push({ instrument, weight: style.weight });
    }
  }
  if (energetic >= 0.6 && !seen.has('riser') && !excluded.has('riser'))
    candidates.push({ instrument: 'riser', weight: 0.3 });

  const entries: KitEntry[] = [];
  const add = (instrument: InstrumentId, role: TrackRole, priority: number) => {
    if (entries.some((e) => e.instrument === instrument)) return;
    entries.push({
      instrument,
      role,
      requested: wanted.has(instrument),
      priority: wanted.has(instrument) ? 100 : priority,
    });
  };

  // Drums and fx.
  for (const id of requested) if (DRUM_ROLES[id]) add(id, DRUM_ROLES[id]!, 100);
  for (const c of candidates) {
    const role = DRUM_ROLES[c.instrument];
    if (!role) continue;
    const core = role === 'kick' || role === 'snare' || role === 'hat';
    add(c.instrument, role, (core ? 80 : 40) + c.weight * 10 - (c.instrument === 'clap' ? 5 : 0));
  }

  // Bass: requested ones, else the strongest style's.
  const basses = requested.filter((id) => INSTRUMENTS[id].category === 'bass');
  if (basses.length) for (const id of basses) add(id, 'bass', 100);
  else {
    const bass = candidates.find((c) => INSTRUMENTS[c.instrument].category === 'bass');
    if (bass) add(bass.instrument, 'bass', 90);
  }

  // Melodic roles: requested instruments choose first.
  const taken = new Set<TrackRole>();
  const melodic = [
    ...requested.map((instrument) => ({ instrument, weight: 2 })),
    ...candidates.filter((c) => !wanted.has(c.instrument)),
  ].filter((c) => ROLE_PREFS[c.instrument]);
  for (const c of melodic) {
    const prefs = ROLE_PREFS[c.instrument]!;
    let role = prefs.find((r) => !taken.has(r));
    if (!role && wanted.has(c.instrument)) role = prefs.includes('answer') ? 'answer' : prefs[prefs.length - 1];
    if (!role) continue;
    taken.add(role);
    const priority = { chords: 85, lead: 75, pad: 55, answer: 45 }[role as 'chords' | 'lead' | 'pad' | 'answer'] ?? 40;
    add(c.instrument, role, priority + c.weight * 5);
  }
  // Harmony needs a comping part: promote the pad if nothing else plays chords.
  if (!entries.some((e) => e.role === 'chords')) {
    const pad = entries.find((e) => e.role === 'pad');
    if (pad) pad.role = 'chords';
  }

  const budget = Math.min(MAX_TRACKS, Math.max(SONG_MAX_TRACKS, requested.length + CORE_TRACKS));
  while (entries.length > budget) {
    // Unrequested parts go first; past the hard track limit, the least important requested ones too.
    const pool = entries.filter((e) => !e.requested);
    const victim = (pool.length ? pool : entries).sort((a, b) => a.priority - b.priority)[0];
    entries.splice(entries.indexOf(victim), 1);
  }
  return entries;
}

const GROUP: Record<TrackRole, number> = {
  kick: 0,
  snare: 0,
  hat: 0,
  openhat: 0,
  perc: 0,
  tom: 0,
  crash: 0,
  bass: 1,
  chords: 2,
  pad: 2,
  lead: 3,
  answer: 4,
  riser: 5,
};

function sortKit(entries: KitEntry[]): KitEntry[] {
  return [...entries].sort(
    (a, b) => GROUP[a.role] - GROUP[b.role] || ORDER.indexOf(a.instrument) - ORDER.indexOf(b.instrument),
  );
}

function blendFeel(blend: Blend): FeelSettings {
  const keys = Object.keys(SONG_STYLES.lofi.feel) as (keyof FeelSettings)[];
  const out = {} as FeelSettings;
  for (const key of keys) out[key] = avg(blend, (g) => SONG_STYLES[g].feel[key]);
  return out;
}

function feelFor(role: TrackRole, feel: FeelSettings): number {
  switch (role) {
    case 'kick':
      return feel.kick;
    case 'snare':
      return feel.snare;
    case 'hat':
    case 'openhat':
      return feel.hat;
    case 'perc':
    case 'tom':
      return feel.perc;
    case 'bass':
      return feel.bass;
    case 'chords':
    case 'pad':
      return feel.chords;
    case 'lead':
    case 'answer':
      return feel.melody;
    default:
      return 0;
  }
}

const DUCK_SHARE: Partial<Record<TrackRole, number>> = { bass: 1, pad: 0.9, chords: 0.7, lead: 0.3, answer: 0.3 };

function chordTypeFor(role: TrackRole, instrument: InstrumentId, blend: Blend, rng: Rng): ChordType {
  if (role !== 'chords' && role !== 'pad') return 'off';
  const type = GENRES[pickGenre(blend, rng)].chordType;
  if (role === 'pad') return instrument === 'vox' || type === 'triad' ? 'triad' : 'seventh';
  if (instrument === 'guitar' && type === 'ninth') return 'seventh';
  return type === 'off' ? 'seventh' : type;
}

function trackFx(role: TrackRole, instrument: InstrumentId, tone: number, brightness: number): Partial<TrackFx> {
  const fx: Partial<TrackFx> = {};
  if (role === 'chords' && (instrument === 'keys' || instrument === 'wurli')) {
    fx.cutoff = round2(clamp(tone + 0.1 + (brightness - 0.5) * 0.3, 0.45, 1));
  }
  if (instrument === 'guitar') fx.chorus = 0.2;
  if (instrument === 'vox') fx.chorus = 0.15;
  if (role === 'pad') fx.highpass = 0.12;
  if (instrument === 'strings' && role !== 'pad') fx.highpass = 0.08;
  return fx;
}

function createTracks(
  kit: KitEntry[],
  blend: Blend,
  mood: Mood,
  fx: MasterFx,
  rng: Rng,
): { tracks: Track[]; roles: Map<string, TrackRole> } {
  const feel = blendFeel(blend);
  const duck = avg(blend, (g) => SONG_STYLES[g].duck);
  const wet = 1 + 0.4 * avg(blend, (g) => (g === 'ambient' ? 1 : 0));
  const roles = new Map<string, TrackRole>();
  let leadPan = 0;
  const tracks = sortKit(kit).map((entry) => {
    const { instrument, role } = entry;
    const mix = MIX[instrument];
    const def = INSTRUMENTS[instrument];
    const params: Record<string, number> = {};
    for (const s of [...blend.styles].reverse()) Object.assign(params, GENRES[s.genre].params[instrument]);
    let pan = mix.pan;
    if (role === 'lead') leadPan = pan = pan || 0.15;
    if (role === 'answer') pan = -(Math.abs(leadPan) || 0.15) * Math.sign(leadPan || 1) - 0.05;
    const humanize = def.category === 'drums' ? feel.humanizeDrums : def.melodic ? feel.humanizeMelodic : 0;
    const track = createTrack(instrument, {
      volume: mix.volume,
      pan: round2(clamp(pan, -1, 1)),
      reverb: round2(Math.min(0.8, mix.reverb * (def.melodic ? wet : 1))),
      delay: mix.delay,
      chord: chordTypeFor(role, instrument, blend, rng),
      params,
      fx: trackFx(role, instrument, fx.tone, mood.brightness),
      duck: round2(clamp(duck * (DUCK_SHARE[role] ?? 0), 0, 1)),
      feel: round2(clamp(feelFor(role, feel), -1, 1)),
      humanize: round2(clamp(humanize, 0, 1)),
    });
    roles.set(track.id, role);
    return track;
  });
  return { tracks, roles };
}

function masterFx(blend: Blend, mood: Mood): MasterFx {
  const d = defaultFx();
  const num = (key: Exclude<keyof MasterFx, 'delayDivision'>) =>
    avg(blend, (g) => (GENRES[g].fx[key] as number | undefined) ?? d[key]);
  const b = mood.brightness;
  const unit = (v: number) => round2(clamp(v, 0, 1));
  return {
    tone: unit(num('tone') + (b - 0.5) * 0.3),
    crackle: unit(num('crackle') * (1.6 - 1.2 * b)),
    wow: unit(num('wow') * (1.5 - b)),
    crush: unit(num('crush') + (b < 0.25 ? 0.06 : 0)),
    drive: unit(num('drive')),
    reverbSize: unit(num('reverbSize')),
    reverbMix: unit(num('reverbMix') + (0.5 - mood.energy) * 0.08),
    delayDivision: GENRES[blend.primary].fx.delayDivision ?? d.delayDivision,
    delayFeedback: round2(clamp(num('delayFeedback'), 0, 0.9)),
    delayMix: unit(num('delayMix')),
    glue: unit(num('glue')),
  };
}

// ---------------------------------------------------------------------------
// Arrangement

interface PlannedSection {
  kind: SectionKind;
  name: string;
  bars: number;
  role: RoleKey;
  energy: number;
}

function planSections(blend: Blend, mood: Mood, minutes: number, bpm: number, rng: Rng): PlannedSection[] {
  const template = pick(rng, SONG_STYLES[blend.primary].structures);
  const fitted = fitStructure(template, targetBars(minutes, bpm), {
    long: blend.primary === 'ambient',
    wide: blend.halfTime,
  });
  const totals = new Map<SectionKind, number>();
  for (const f of fitted) totals.set(f.kind, (totals.get(f.kind) ?? 0) + 1);
  const seen = new Map<SectionKind, number>();
  const lastHook = fitted.map((f) => f.kind === 'hook' || f.kind === 'drop').lastIndexOf(true);
  const moodShift = (mood.energy - 0.5) * 0.3;
  return fitted.map((f, i) => {
    const n = (seen.get(f.kind) ?? 0) + 1;
    seen.set(f.kind, n);
    const label = f.name ?? SECTION_LABELS[f.kind];
    const numbered = (totals.get(f.kind) ?? 0) > 1 && f.kind !== 'intro' && f.kind !== 'outro';
    let energy = KIND_ENERGY[f.kind] + moodShift;
    if (f.kind === 'verse' && n > 1) energy += 0.05;
    if (i === lastHook) energy += 0.08;
    return {
      kind: f.kind,
      name: numbered ? `${label} ${n}` : label,
      bars: f.bars,
      role: f.kind === 'verse' && n > 1 ? 'verse2' : f.kind,
      energy: round2(clamp(energy, 0.05, 1)),
    };
  });
}

/** Tracks silenced in a section, from its energy and kind. */
function mutedFor(ctx: SongContext, plan: PlannedSection): string[] {
  const { kind, energy, role: roleKey } = plan;
  const hasChords = [...ctx.roles.values()].includes('chords');
  const hasAnswer = [...ctx.roles.values()].includes('answer');
  const ambient = ctx.blend.primary === 'ambient';
  const muted: string[] = [];
  for (const track of ctx.tracks) {
    const role = ctx.roles.get(track.id);
    const drum = INSTRUMENTS[track.instrument].category === 'drums';
    let mute = false;
    if (kind === 'break' && drum) mute = true;
    else if (role === 'kick' || role === 'snare') mute = energy < 0.45 || kind === 'intro' || kind === 'outro';
    else if (role === 'hat') mute = energy < 0.3;
    else if (role === 'openhat') mute = energy < 0.6;
    else if (role === 'perc') mute = energy < (ambient ? 0.3 : 0.5);
    else if (role === 'bass') mute = energy < 0.4;
    else if (role === 'pad') mute = kind === 'verse' && hasChords && energy < 0.7 && !ambient;
    else if (role === 'lead') {
      mute = (kind === 'intro' && !ctx.introMelody) || (kind === 'break' && hasAnswer) || kind === 'prechorus';
    } else if (role === 'answer') {
      mute = kind === 'intro' || kind === 'outro' || kind === 'prechorus' || (kind === 'verse' && roleKey !== 'verse2');
    }
    if (mute) muted.push(track.id);
  }
  return muted;
}

interface ArrangedSection {
  plan: PlannedSection;
  section: Section;
  startBar: number;
}

function automationFor(ctx: SongContext, arranged: ArrangedSection[], fx: MasterFx, rng: Rng): AutomationLane[] {
  const lanes: AutomationLane[] = [];
  const endOf = (a: ArrangedSection) => a.startBar + a.plan.bars;
  // Keys open up through the first verse.
  const chords = ctx.tracks.find((t) => ctx.roles.get(t.id) === 'chords');
  // Only straight after the intro: the lane holds its first value from the start of the song.
  const verse = arranged[1]?.plan.kind === 'verse' && arranged[0].plan.kind === 'intro' ? arranged[1] : undefined;
  if (chords && verse && ctx.energetic < 0.6 && chance(rng, 0.65)) {
    const open = chords.fx.cutoff;
    lanes.push({
      id: createId('a'),
      target: `track.${chords.id}.cutoff`,
      points: [
        { t: verse.startBar, v: round2(open * 0.55) },
        { t: endOf(verse), v: open },
      ],
    });
  }
  // Reverb swells through the first break.
  const brk = arranged.find((a) => a.plan.kind === 'break');
  if (brk && chance(rng, 0.75)) {
    const base = fx.reverbMix;
    lanes.push({
      id: createId('a'),
      target: 'master.reverbMix',
      points: [
        { t: brk.startBar, v: base },
        { t: brk.startBar + brk.plan.bars * 0.75, v: round2(Math.min(1, base + 0.25)) },
        { t: endOf(brk), v: base },
      ],
    });
  }
  // The master filter closes over each build and snaps open on the drop.
  const builds = arranged.filter(
    (a, i) => a.plan.kind === 'prechorus' && ['drop', 'hook'].includes(arranged[i + 1]?.plan.kind ?? ''),
  );
  if (builds.length && ctx.energetic >= 0.5) {
    const points = builds.flatMap((a) => [
      { t: a.startBar, v: 1 },
      { t: endOf(a) - 0.0625, v: 0.3 },
      { t: endOf(a), v: 1 },
    ]);
    lanes.push({ id: createId('a'), target: 'master.filter', points });
  }
  return lanes;
}

/** Enter/exit effects and the final-hook key lift. */
function applyTransitions(ctx: SongContext, arranged: ArrangedSection[], filterLane: boolean, rng: Rng): void {
  const dusty = avg(ctx.blend, (g) => (SONG_STYLES[g].tapeStop ? 1 : 0));
  const lift = ctx.blend.styles.some((s) => SONG_STYLES[s.genre].halfTime)
    ? 0
    : avg(ctx.blend, (g) => (SONG_STYLES[g].keyLift ? 1 : 0));
  const filterIntro = avg(ctx.blend, (g) =>
    g === 'lofi' || g === 'jazzhop' || g === 'boombap' || g === 'rnb' ? 1 : 0.4,
  );
  arranged.forEach((a, i) => {
    const { section } = a;
    const next = arranged[i + 1]?.plan.kind;
    if (a.plan.kind === 'intro') section.enter = !filterLane && chance(rng, filterIntro) ? 'filter' : 'fade';
    if (a.plan.kind === 'break' && !filterLane) section.enter = 'filter';
    if ((next === 'hook' || next === 'drop') && a.plan.kind !== 'intro' && chance(rng, ctx.energetic * 0.5)) {
      section.exit = 'drop';
    }
    if (a.plan.kind === 'outro') section.exit = chance(rng, dusty * 0.55) ? 'tapeStop' : 'fade';
  });
  if (lift > 0 && chance(rng, lift * 0.6)) {
    const last = arranged.map((a) => a.plan.kind === 'hook').lastIndexOf(true);
    const first = arranged.findIndex((a) => a.plan.kind === 'hook');
    if (last > first && first >= 0) {
      const amount = pick(rng, [1, 2]);
      for (let i = last; i < arranged.length; i++) arranged[i].section.transpose = amount;
    }
  }
}

function chooseAmbience(blend: Blend, rng: Rng): AmbienceType {
  const weights = new Map<AmbienceType, number>();
  for (const s of blend.styles) {
    const list = SONG_STYLES[s.genre].ambience;
    const total = list.reduce((n, [, w]) => n + w, 0);
    for (const [type, w] of list) weights.set(type, (weights.get(type) ?? 0) + (s.weight * w) / total);
  }
  return weightedPick(rng, [...weights]);
}

/**
 * A complete song: kit and mix from the blended styles, arrangement fitted to
 * the target length, one pattern (plus fill variants) per section role.
 */
export function generateSong(options: SongOptions): Project {
  const seed = Number.isFinite(options.seed) ? Math.floor(options.seed) : 0;
  const styles = normalizeStyles(options.styles);
  const blend = blendOf(styles);
  const mood = normalizeMood(options.mood);
  const minutes = clamp(options.minutes ?? SONG_MINUTES.default, SONG_MINUTES.min, SONG_MINUTES.max);
  const rng = seededRng(seed, 'song');

  // Every random choice is drawn up front so explicit options don't shift the others.
  const randomRoot = randInt(rng, 0, 11);
  const tempoT = clamp(0.2 + 0.6 * mood.energy + (rng() - 0.5) * 0.2, 0, 1);
  const swingT = rng();
  const randomScale = chooseScale(blend, mood, seededRng(seed, 'scale'));

  const root = options.root === undefined ? randomRoot : ((Math.round(options.root) % 12) + 12) % 12;
  const scale = options.scale && SCALES[options.scale] ? options.scale : randomScale;
  const [lo, hi] = [
    avg(blend, (g) => tempoRange(g, blend.halfTime)[0]),
    avg(blend, (g) => tempoRange(g, blend.halfTime)[1]),
  ];
  const bpm =
    options.bpm === undefined
      ? clamp(fitTempo(Math.round(lo + (hi - lo) * tempoT), minutes, Math.floor(lo), Math.ceil(hi)), BPM_MIN, BPM_MAX)
      : clamp(Math.round(options.bpm), BPM_MIN, BPM_MAX);
  const swingLo = avg(blend, (g) => GENRES[g].swing[0]);
  const swingHi = avg(blend, (g) => GENRES[g].swing[1]);
  const swing = clamp(Math.round(swingLo + (swingHi - swingLo) * swingT), SWING_MIN, SWING_MAX);
  const name = (options.name?.trim() || beatName(seed, blend.primary)).slice(0, 120);

  const fx = masterFx(blend, mood);
  const kit = assignKit(blend, mood, options);
  const { tracks, roles } = createTracks(kit, blend, mood, fx, seededRng(seed, 'tracks'));
  const ctx = createContext(seed, blend, mood, root, scale, tracks, roles);

  // Harmony: different progressions for verse, hook, bridge and the pre-hook build.
  const hrng = seededRng(seed, 'harmony');
  const verse = chooseProgression(blend, scale, hrng, []);
  const hook = chooseProgression(blend, scale, hrng, [verse]);
  const bridge = chooseProgression(blend, scale, hrng, [verse, hook], true);
  const build = chooseBuild(scale, hrng) ?? verse.slice(-2);
  const barChords = avg(blend, (g) => {
    const spans = GENRES[g].chordRhythms.map((r) => r.span);
    return spans.filter((s) => s === 16).length / spans.length;
  });
  const degrees: Record<HarmonyKey, number[]> = { verse, hook, bridge, build };
  const preferBar = chance(hrng, barChords);
  const harmonyFor = (key: HarmonyKey) => {
    const span = spanFor(degrees[key], preferBar);
    const length = lengthFor(degrees[key], span, blend.primary === 'ambient');
    return { length, roots: progressionRoots(degrees[key], length, root, scale) };
  };

  const plans = planSections(blend, mood, minutes, bpm, seededRng(seed, 'structure'));
  const patterns: Pattern[] = [];
  const mains = new Map<RoleKey, { pattern: Pattern; spec: PatternSpec; steps: Record<string, Step[]> }>();
  const fills = new Map<string, Pattern | null>();
  const addPattern = (length: number, steps: Record<string, Step[]>): Pattern => {
    const pattern: Pattern = { id: createId('p'), name: nextPatternName(patterns), length, steps };
    patterns.push(pattern);
    return pattern;
  };

  const arranged: ArrangedSection[] = [];
  let bar = 0;
  plans.forEach((plan, i) => {
    let main = mains.get(plan.role);
    if (!main) {
      const { length, roots } = harmonyFor(HARMONY_OF[plan.role]);
      const spec: PatternSpec = {
        role: plan.role,
        kind: plan.kind,
        energy: plan.energy,
        roots,
        length,
        salt: plan.role,
      };
      const steps = buildMain(ctx, spec);
      main = { pattern: addPattern(length, steps), spec, steps };
      mains.set(plan.role, main);
    }
    const length = main.pattern.length;
    const repeats = clamp(Math.round((plan.bars * 16) / length), 1, MAX_SECTION_REPEATS);
    const type = fillTypeFor(plans[i + 1]?.kind);
    let fillId: string | null = null;
    if (type && (repeats >= 2 || type === 'build') && patterns.length < MAX_PATTERNS) {
      const key = `${plan.role}:${type}`;
      if (!fills.has(key)) {
        const steps = buildFill(ctx, main.spec, main.steps, type);
        fills.set(key, sameSteps(steps, main.steps, length) ? null : addPattern(length, steps));
      }
      fillId = fills.get(key)?.id ?? null;
    }
    const section = createSection(main.pattern.id, {
      name: plan.name,
      kind: plan.kind,
      repeats,
      fillPatternId: fillId,
      muted: mutedFor(ctx, plan),
    });
    arranged.push({ plan, section, startBar: bar });
    bar += (repeats * length) / 16;
  });

  const lanes = automationFor(ctx, arranged, fx, seededRng(seed, 'automation'));
  applyTransitions(
    ctx,
    arranged,
    lanes.some((l) => l.target === 'master.filter'),
    seededRng(seed, 'transitions'),
  );

  const ambienceRng = seededRng(seed, 'ambience');
  const ambience = options.ambience ?? chooseAmbience(blend, ambienceRng);
  const project = createProject({
    name,
    bpm,
    swing,
    root,
    scale,
    tracks,
    fx,
    ambience: { type: ambience, level: round2(0.3 + 0.15 * (1 - mood.energy)) },
    meta: { artist: '', coverSeed: coverSeed(seed), styles: styles.map((s) => s.genre) },
  });
  const first = mains.get('verse') ?? mains.get('hook') ?? mains.get('drop') ?? [...mains.values()][0];
  project.patterns = patterns;
  project.activePatternId = first.pattern.id;
  project.arrangement = arranged.map((a) => a.section);
  project.automation = lanes;
  project.playMode = 'song';
  return project;
}

// ---------------------------------------------------------------------------
// Regenerating one section

export type SectionParts = 'all' | 'drums' | 'harmony' | 'melody';

export interface RegenerateSectionOptions {
  seed: number;
  parts?: SectionParts;
  /** Styles to regenerate with; defaults to the song's own (meta.styles) */
  styles?: StyleWeight[];
}

function partTracks(parts: SectionParts, roles: Map<string, TrackRole>, tracks: Track[]): Track[] {
  return tracks.filter((t) => {
    const role = roles.get(t.id);
    if (!role) return false;
    if (parts === 'all') return true;
    if (parts === 'drums') return GROUP[role] === 0 || role === 'riser';
    if (parts === 'harmony') return role === 'chords' || role === 'pad' || role === 'bass';
    return role === 'lead' || role === 'answer';
  });
}

/**
 * New patterns for one section (main and fill), keeping the song's key and
 * tracks; `parts` limits which tracks change. Shared patterns are cloned first
 * so other sections stay as they are. Locked sections (or no room for a clone)
 * return the project unchanged. The input project is never mutated.
 */
export function regenerateSection(project: Project, sectionId: string, options: RegenerateSectionOptions): Project {
  const index = project.arrangement.findIndex((s) => s.id === sectionId);
  const section = project.arrangement[index];
  if (!section || section.locked) return project;
  const main = project.patterns.find((p) => p.id === section.patternId);
  if (!main) return project;
  const fill = section.fillPatternId ? project.patterns.find((p) => p.id === section.fillPatternId) : undefined;
  const parts = options.parts ?? 'all';
  const seed = Number.isFinite(options.seed) ? Math.floor(options.seed) : 0;

  const fromMeta = project.meta.styles.filter(isGenreId).map((genre, i) => ({ genre, weight: 1 / (i + 1) }));
  const blend = blendOf(normalizeStyles(options.styles ?? fromMeta));
  const roles = inferRoles(project.tracks);
  const ctx = createContext(seed, blend, DEFAULT_MOOD, project.root, project.scale, project.tracks, roles);
  const targets = partTracks(parts, roles, project.tracks);
  if (!targets.length) return project;

  const kind: SectionKind = section.kind === 'custom' ? 'verse' : section.kind;
  const earlier = project.arrangement.slice(0, index).filter((s) => s.kind === 'verse').length;
  const role: RoleKey = kind === 'verse' && earlier > 0 ? 'verse2' : kind;
  const length = main.length;

  // Harmony: keep the section's chords unless they are being regenerated.
  const chordTrack = project.tracks.find((t) => roles.get(t.id) === 'chords');
  let roots =
    chordTrack && main.steps[chordTrack.id]
      ? progressionFromSteps(main.steps[chordTrack.id], length, project.root, project.scale)
      : null;
  if (!roots || parts === 'harmony' || parts === 'all') {
    const hrng = seededRng(seed, 'regen:harmony');
    const current = roots ? [degreesOf(roots, project.root, project.scale)] : [];
    const degrees =
      HARMONY_OF[role] === 'build'
        ? (chooseBuild(project.scale, hrng) ?? chooseProgression(blend, project.scale, hrng, current))
        : chooseProgression(blend, project.scale, hrng, current, HARMONY_OF[role] === 'bridge');
    roots = progressionRoots(degrees, length, project.root, project.scale);
  }
  const spec: PatternSpec = { role, kind, energy: KIND_ENERGY[kind], roots, length, salt: `regen:${role}` };
  const fresh = buildMain(ctx, spec);
  const editable = new Set(targets.map((t) => t.id));
  const merge = (base: Pattern, generated: Record<string, Step[]>): Record<string, Step[]> => {
    const steps: Record<string, Step[]> = { ...base.steps };
    for (const t of targets) steps[t.id] = generated[t.id];
    resolveChokes(project.tracks, steps, base.length, project.root, editable);
    return steps;
  };
  const mainSteps = merge(main, fresh);
  let fillSteps: Record<string, Step[]> | null = null;
  if (fill) {
    const next = project.arrangement[index + 1]?.kind;
    const type = fillTypeFor(next === 'custom' ? 'verse' : next) ?? 'fill';
    const generated = buildFill(ctx, spec, mainSteps, type);
    // A fill of another length is rebuilt entirely from the new main pattern.
    fillSteps = fill.length === length ? merge(fill, generated) : generated;
  }

  // Write back, cloning patterns that other sections also use.
  const patterns = [...project.patterns];
  const usedElsewhere = (id: string) =>
    project.arrangement.some((s, i) => i !== index && (s.patternId === id || s.fillPatternId === id)) ||
    (section.patternId === id && section.fillPatternId === id);
  const place = (original: Pattern, steps: Record<string, Step[]>, lengthOf: number): string | null => {
    if (usedElsewhere(original.id)) {
      if (patterns.length >= MAX_PATTERNS) return null;
      const clone: Pattern = { id: createId('p'), name: nextPatternName(patterns), length: lengthOf, steps };
      patterns.push(clone);
      return clone.id;
    }
    patterns[patterns.indexOf(original)] = { ...original, length: lengthOf, steps };
    return original.id;
  };
  const needed = (usedElsewhere(main.id) ? 1 : 0) + (fill && usedElsewhere(fill.id) ? 1 : 0);
  if (patterns.length + needed > MAX_PATTERNS) return project;
  const mainId = place(main, mainSteps, length)!;
  const fillId = fill && fillSteps ? place(fill, fillSteps, length) : section.fillPatternId;
  const arrangement = project.arrangement.map((s, i) =>
    i === index ? { ...s, muted: [...s.muted], patternId: mainId, fillPatternId: fillId } : s,
  );
  return { ...project, patterns, arrangement };
}

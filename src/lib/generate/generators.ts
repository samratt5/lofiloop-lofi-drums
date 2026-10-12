/**
 * Algorithmic idea generator: chord progressions, drum grooves, bass lines,
 * chord parts and motif-based melodies, plus whole-beat generation.
 * Everything is deterministic for a given seed/rng.
 */
import {
  SCALES,
  buildChord,
  isInScale,
  pitchClass,
  scaleNotes,
  snapToScale,
  transposeInScale,
  type ScaleId,
} from '@/lib/music/theory';
import { chance, createRng, pick, randInt, weightedPick, type Rng } from '@/lib/music/rng';
import {
  createPattern,
  createProject,
  createSection,
  createStep,
  createSteps,
  createTrack,
  rootNoteFor,
} from '@/lib/project/factory';
import { INSTRUMENTS, type InstrumentId } from '@/lib/project/instruments';
import {
  BPM_MAX,
  BPM_MIN,
  MAX_STEPS,
  MAX_TRACKS,
  type Pattern,
  type Project,
  type Step,
  type Track,
} from '@/lib/project/types';
import { clamp } from '@/lib/utils/math';
import {
  GENRES,
  parseGroovePart,
  type BassStyle,
  type ChordRhythm,
  type DrumGroove,
  type Genre,
  type GenreId,
  type Progression,
  type ScaleFamily,
} from './genres';

export interface GenerateContext {
  /** Key root pitch class 0..11 */
  root: number;
  scale: ScaleId;
  /** Steps in the pattern, 1..64 */
  length: number;
  rng: Rng;
  /** Index into the genre's grooves so every drum track shares one groove; drawn from `rng` if omitted. */
  groove?: number;
  /** Kick steps the bass locks to; the groove's kick part is used if omitted. */
  kick?: Step[];
}

const BAR = 16;

// ---------------------------------------------------------------------------
// Small helpers

function patternLength(length: number): number {
  return clamp(Math.round(length), 1, MAX_STEPS);
}

/** Velocities are kept at 1/100 precision so they survive the project file format. */
export function vel(value: number): number {
  return Math.round(clamp(value, 0.05, 1) * 100) / 100;
}

/** Velocity with a little relative random variation. */
export function human(value: number, rng: Rng, spread = 0.07): number {
  return vel(value * (1 + (rng() - 0.5) * 2 * spread));
}

/** Round to 1/100 (never -0, which the project file format can't tell from 0). */
export function round2(value: number): number {
  return Math.round(value * 100) / 100 || 0;
}

export function blankSteps(instrument: InstrumentId, root: number): Step[] {
  return createSteps(rootNoteFor(instrument, root));
}

export function setHit(steps: Step[], index: number, fields: Partial<Step>): void {
  steps[index] = { ...steps[index], on: true, prob: 1, ratchet: 1, len: 1, ...fields };
}

/** Move a note by octaves into [lo, hi] (the window should span at least 12 semitones). */
export function fitOctave(note: number, lo: number, hi: number): number {
  let n = note;
  while (n < lo) n += 12;
  while (n > hi) n -= 12;
  return n;
}

/** Mix a seed with a label into an independent 32-bit seed (FNV-1a + avalanche). */
export function mixSeed(seed: number, salt: string): number {
  let h = (Math.floor(Number.isFinite(seed) ? seed : 0) ^ 0x811c9dc5) >>> 0;
  for (let i = 0; i < salt.length; i++) {
    h ^= salt.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  h ^= h >>> 16;
  h = Math.imul(h, 0x85ebca6b) >>> 0;
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35) >>> 0;
  h ^= h >>> 16;
  return h >>> 0;
}

export function seededRng(seed: number, salt: string): Rng {
  return createRng(mixSeed(seed, salt));
}

export function scaleFamily(scale: ScaleId): ScaleFamily {
  return (SCALES[scale].intervals as readonly number[]).includes(4) ? 'major' : 'minor';
}

/** Pentatonic/blues scales borrow their parent heptatonic scale for harmony (like buildChord). */
export function harmonyScale(scale: ScaleId): ScaleId {
  if (SCALES[scale].intervals.length === 7) return scale;
  return scale === 'pentatonicMajor' ? 'major' : 'minor';
}

/**
 * Steps per chord for a progression of `count` chords covering `length` steps:
 * 16 (one per bar) or 8 (half bar), matching what generateProgression produces.
 */
export function chordSpan(length: number, count: number): number {
  const n = patternLength(length);
  if (count <= 0) return BAR;
  if (Math.ceil(n / BAR) === count) return BAR;
  if (Math.ceil(n / 8) === count) return 8;
  return Math.max(1, Math.ceil(n / count));
}

export function chordAt(progression: number[], span: number, step: number): number {
  return progression[Math.floor(step / span) % progression.length];
}

/** Pitch classes of the diatonic seventh chord on `chordRoot` that are in the key. */
function chordPitchClasses(chordRoot: number, ctx: GenerateContext): Set<number> {
  const pcs = new Set<number>([pitchClass(chordRoot)]);
  for (const n of buildChord(chordRoot, 'seventh', ctx.root, ctx.scale)) {
    if (isInScale(n, ctx.root, ctx.scale)) pcs.add(pitchClass(n));
  }
  return pcs;
}

// ---------------------------------------------------------------------------
// Progressions

/**
 * Whether the diatonic triad on a (1-based) degree is major or minor in `scale`.
 * Diminished/augmented chords (vi° in dorian, #iv° in lydian, III+ in harmonic
 * minor...) are avoided, except a half-diminished ii leading to V (minor ii–V).
 */
function isStableDegree(degree: number, scale: ScaleId, next: number): boolean {
  const harmony = harmonyScale(scale);
  const d = (((degree - 1) % 7) + 7) % 7;
  const chord = buildChord(60 + SCALES[harmony].intervals[d], 'triad', 0, harmony);
  const fifth = chord[2] - chord[0];
  return fifth === 7 || (fifth === 6 && d === 1 && next === 5);
}

/** True when every chord of the progression is major/minor in `scale` (see isStableDegree). */
export function isProgressionUsable(progression: Progression, scale: ScaleId): boolean {
  const { degrees } = progression;
  return degrees.every((deg, i) => isStableDegree(deg, scale, degrees[(i + 1) % degrees.length]));
}

/**
 * Chord roots (MIDI, 48..64) for the pattern: one per bar or per half bar,
 * `ceil(length / span)` of them. Later chords take the octave closest to the
 * previous one for smooth voice leading.
 */
export function generateProgression(genreId: GenreId, ctx: GenerateContext): number[] {
  const genre = GENRES[genreId];
  const rng = ctx.rng;
  const length = patternLength(ctx.length);
  const family = scaleFamily(ctx.scale);
  const usable = genre.progressions.filter((p) => isProgressionUsable(p, ctx.scale));
  const matching = usable.filter((p) => p.family === family);
  const candidates = matching.length ? matching : usable.length ? usable : [{ degrees: [1], family }];
  let progression = pick(rng, candidates);
  const spans = [...new Set(genre.chordRhythms.map((r) => r.span))];
  let span: number = pick(rng, spans);
  const fits = (p: Progression, s: number) => p.degrees.length * s <= length;
  // Prefer half-bar changes when that fits the whole progression into the pattern,
  // otherwise a shorter progression rather than a truncated one.
  if (!fits(progression, span) && spans.includes(8) && fits(progression, 8)) span = 8;
  if (!fits(progression, span)) {
    const fitting = candidates.filter((p) => fits(p, span));
    if (fitting.length) progression = pick(rng, fitting);
  }
  const chords = progression.degrees.length;
  const count = Math.max(1, Math.ceil(length / span));
  const intervals = SCALES[harmonyScale(ctx.scale)].intervals;
  const roots: number[] = [];
  for (let i = 0; i < count; i++) {
    const degree = progression.degrees[i % chords];
    const interval = intervals[(((degree - 1) % 7) + 7) % 7];
    const raw = snapToScale(48 + ((ctx.root + interval) % 12), ctx.root, ctx.scale);
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
// Drums

const FALLBACK_PARTS: Partial<Record<InstrumentId, string>> = {
  kick: 'X.........x.....',
  kick2: 'X.........x.....',
  kick3: 'X.......x...x...',
  snare: '....X.......X...',
  snare2: '....X.......X...',
  clap: '....X.......X...',
  hat: 'x.o.x.o.x.o.x.o.',
  hat2: 'x.o.x.o.x.o.x.o.',
  openhat: '................ | ..............o.',
  openhat2: '..............o. | ................',
  rim: '...........g.... | ...g......g.....',
  shaker: 'g.o.g.o.g.o.g.o.',
  shaker2: 'g.o.g.o.g.o.g.o.',
  tom: '................ | ..........o..o..',
};

const PART_ALIASES: Partial<Record<InstrumentId, InstrumentId>> = {
  clap: 'snare',
  snare: 'clap',
  '808': 'kick',
  kick2: 'kick',
  kick3: 'kick',
  snare2: 'snare',
  hat2: 'hat',
  openhat2: 'openhat',
  shaker2: 'shaker',
};

export const SNARE_FILLS = ['..g.', '.g.o', '..go', 'g.go', '...o', '.g.g'];
export const BUILD_FILLS = ['..x.', '..xx', '.x.x', 'x.xx'];
export const HAT_ROLLS = ['..34', '3.4.', '.234', '2.44', '..44'];
export const TOM_FILLS = ['.o.x', 'oo.x', '..ox', 'o.ox'];

type DrumRole = 'kick' | 'snare' | 'hat' | 'perc';

function drumRole(instrument: InstrumentId): DrumRole {
  if (instrument === 'kick' || instrument === 'kick2' || instrument === 'kick3' || instrument === '808') return 'kick';
  if (instrument === 'snare' || instrument === 'snare2' || instrument === 'clap') return 'snare';
  if (instrument === 'hat' || instrument === 'hat2' || instrument === 'shaker' || instrument === 'shaker2')
    return 'hat';
  return 'perc';
}

/** A drum that acts as the kick (the 808 is a bass instrument, not a kick track). */
function isKickDrum(instrument: InstrumentId): boolean {
  return instrument === 'kick' || instrument === 'kick2' || instrument === 'kick3';
}

export function grooveFor(genre: Genre, ctx: GenerateContext): DrumGroove {
  const n = genre.grooves.length;
  const index = ctx.groove ?? randInt(ctx.rng, 0, n - 1);
  return genre.grooves[((Math.floor(index) % n) + n) % n];
}

function partFor(groove: DrumGroove, instrument: InstrumentId): string {
  const alias = PART_ALIASES[instrument];
  return (
    groove.parts[instrument] ??
    (alias && groove.parts[alias]) ??
    FALLBACK_PARTS[instrument] ??
    (alias && FALLBACK_PARTS[alias]) ??
    ''
  );
}

/** Lay a short figure (groove notation) onto the steps starting at `start`; never softens a louder hit. */
export function applyFigure(steps: Step[], start: number, figure: string, note: number, rng: Rng, ramp: boolean): void {
  for (let k = 0; k < figure.length; k++) {
    const i = start + k;
    const hit = parseGroovePart(figure[k])[0];
    if (!hit || i < 0 || i >= steps.length) continue;
    const v = ramp ? 0.45 + (0.4 * k) / Math.max(1, figure.length - 1) : hit.vel;
    if (steps[i].on && steps[i].vel >= v && hit.ratchet === 1) continue;
    setHit(steps, i, { note, vel: human(v, rng), ratchet: hit.ratchet });
  }
}

function varyBar(
  steps: Step[],
  instrument: InstrumentId,
  genre: Genre,
  rng: Rng,
  bar: number,
  length: number,
  note: number,
  blank: Step,
): void {
  const start = bar * BAR;
  const end = Math.min(length, start + BAR);
  const role = drumRole(instrument);
  const isOn = (i: number) => i >= start && i < end && steps[i].on;

  if (role === 'kick' && bar > 0) {
    if (chance(rng, 0.3)) {
      const spots = [3, 7, 9, 11, 13, 14, 15]
        .map((r) => start + r)
        .filter((i) => i < end && !isOn(i) && !isOn(i - 1) && !isOn(i + 1));
      if (spots.length) setHit(steps, pick(rng, spots), { note, vel: human(0.62, rng) });
    } else if (chance(rng, 0.15)) {
      // Only syncopated kicks can go; kicks on the beat carry the groove.
      const extras: number[] = [];
      for (let i = start + 1; i < end; i++) if (steps[i].on && (i - start) % 4 !== 0) extras.push(i);
      if (extras.length) steps[pick(rng, extras)] = { ...blank };
    }
  }

  if (role === 'snare' && instrument === 'snare') {
    const amount = genre.drums.ghosts * (bar === 0 ? 0.06 : 0.12);
    for (const r of [1, 3, 6, 7, 9, 11, 14, 15]) {
      const i = start + r;
      if (i < end && !steps[i].on && chance(rng, amount)) setHit(steps, i, { note, vel: human(0.26, rng, 0.15) });
    }
  }

  if (role === 'hat') {
    for (let i = start + 1; i < end; i += 2) {
      if (!steps[i].on && chance(rng, genre.drums.ghosts * 0.06)) {
        setHit(steps, i, { note, vel: human(0.22, rng, 0.15) });
      }
    }
    if (instrument === 'hat' && chance(rng, genre.drums.rolls * 0.6)) {
      const spots: number[] = [];
      for (let i = start; i < end; i++) if ((i - start) % 4 !== 0 && steps[i].ratchet === 1) spots.push(i);
      if (spots.length) {
        const i = pick(rng, spots);
        setHit(steps, i, { note, vel: human(0.62, rng), ratchet: randInt(rng, 2, 4) });
      }
    }
    if (bar > 0 && chance(rng, 0.12)) {
      const weak: number[] = [];
      for (let i = start; i < end; i++)
        if (steps[i].on && (i - start) % 4 !== 0 && steps[i].ratchet === 1) weak.push(i);
      if (weak.length) steps[pick(rng, weak)] = { ...blank };
    }
  }
}

/** Drum fill over the last beat of the pattern in the genre's fill style (snare figure, build or hat roll). */
export function addDrumFill(
  steps: Step[],
  instrument: InstrumentId,
  genre: Genre,
  rng: Rng,
  length: number,
  note: number,
  blank: Step = createStep(note),
): void {
  const style = genre.drums.fill;
  if (style === 'none') return;
  const start = Math.max(0, length - 4);
  const role = drumRole(instrument);

  if (instrument === 'tom') {
    applyFigure(steps, start, pick(rng, TOM_FILLS), note, rng, false);
  } else if (role === 'kick') {
    // Make room for the fill.
    if (chance(rng, style === 'roll' ? 0.5 : 0.3)) {
      for (let i = length - 3; i < length; i++) if (i % BAR !== 0 && i >= 0) steps[i] = { ...blank };
    }
  } else if (role === 'snare') {
    if (style === 'roll') {
      if (chance(rng, 0.7)) applyFigure(steps, start, pick(rng, BUILD_FILLS), note, rng, true);
    } else if (instrument === 'snare' && chance(rng, 0.75)) {
      applyFigure(steps, start, pick(rng, SNARE_FILLS), note, rng, false);
    }
  } else if (instrument === 'hat' && style === 'roll') {
    applyFigure(steps, start, pick(rng, HAT_ROLLS), note, rng, true);
  }
}

/**
 * Drum part for one instrument: the genre groove tiled across the pattern with
 * humanized velocities, small variations in later bars, random ghost notes and
 * a fill at the end of multi-bar patterns. Returns MAX_STEPS steps.
 */
export function generateDrumSteps(genreId: GenreId, instrument: InstrumentId, ctx: GenerateContext): Step[] {
  const genre = GENRES[genreId];
  return drumStepsFromGroove(grooveFor(genre, ctx), genre, instrument, ctx);
}

/**
 * Drum part from an explicit groove (e.g. one borrowed from another genre),
 * varied with `genre`'s drum feel. `fill: false` leaves the end of the pattern
 * alone (song sections put their fills in a separate fill pattern).
 */
export function drumStepsFromGroove(
  groove: DrumGroove,
  genre: Genre,
  instrument: InstrumentId,
  ctx: GenerateContext,
  options: { fill?: boolean } = {},
): Step[] {
  const rng = ctx.rng;
  const length = patternLength(ctx.length);
  const note = rootNoteFor(instrument, ctx.root);
  const blank = createStep(note);
  const steps = createSteps(note);

  if (instrument === 'crash') {
    setHit(steps, 0, { note, vel: human(0.72, rng) });
    return steps;
  }

  const template = parseGroovePart(partFor(groove, instrument));
  if (!template.length) return steps;
  const spread = drumRole(instrument) === 'hat' ? 0.14 : 0.07;
  for (let i = 0; i < length; i++) {
    const hit = template[i % template.length];
    if (!hit || (hit.maybe && !chance(rng, 0.5))) continue;
    setHit(steps, i, { note, vel: human(hit.vel, rng, spread), ratchet: hit.ratchet });
  }

  const bars = Math.ceil(length / BAR);
  for (let bar = 0; bar < bars; bar++) varyBar(steps, instrument, genre, rng, bar, length, note, blank);
  if (length > BAR && options.fill !== false) addDrumFill(steps, instrument, genre, rng, length, note, blank);
  return steps;
}

// ---------------------------------------------------------------------------
// Chords

/**
 * Chord part: the chord root (snapped into the instrument range) at each change,
 * held until the next strike, with the genre's re-hits and anticipations.
 * Playback expands each root into a chord via `track.chord`.
 */
export function generateChordSteps(
  genreId: GenreId,
  track: Track,
  ctx: GenerateContext,
  progression: number[],
): Step[] {
  const genre = GENRES[genreId];
  const span = chordSpan(ctx.length, progression.length);
  const options = genre.chordRhythms.filter((r) => r.span === span);
  const rhythm = options.length ? pick(ctx.rng, options) : { hits: [0], push: 0 };
  return chordStepsWithRhythm(track, ctx, progression, rhythm);
}

/** Chord part with an explicit rhythm (onsets per chord slot, anticipation and gate). */
export function chordStepsWithRhythm(
  track: Track,
  ctx: GenerateContext,
  progression: number[],
  rhythm: Pick<ChordRhythm, 'hits' | 'push' | 'gate'>,
): Step[] {
  const rng = ctx.rng;
  const length = patternLength(ctx.length);
  const steps = blankSteps(track.instrument, ctx.root);
  if (!progression.length) return steps;
  const [lo, hi] = INSTRUMENTS[track.instrument].noteRange;
  const span = chordSpan(length, progression.length);

  const onsets = new Map<number, { slot: number; first: boolean }>();
  const slots = Math.ceil(length / span);
  for (let s = 0; s < slots; s++) {
    const start = s * span;
    rhythm.hits.forEach((h, j) => {
      if (h < 0 || h >= span) return;
      const pushed = h === 0 && s > 0;
      const at = pushed ? start - rhythm.push : start + h;
      // Don't re-strike the old chord after the next one has been anticipated.
      if (!pushed && s < slots - 1 && at >= start + span - rhythm.push) return;
      if (at >= 0 && at < length) onsets.set(at, { slot: s, first: j === 0 });
    });
  }

  const sorted = [...onsets.keys()].sort((a, b) => a - b);
  sorted.forEach((at, k) => {
    const { slot, first } = onsets.get(at)!;
    const next = sorted[k + 1] ?? length;
    let len = clamp(next - at, 1, 16);
    if (rhythm.gate) len = Math.min(len, rhythm.gate);
    const note = fitOctave(progression[slot % progression.length], lo, hi);
    setHit(steps, at, { note, vel: human(first ? 0.72 : 0.58, rng, 0.06), len });
  });
  return steps;
}

// ---------------------------------------------------------------------------
// Bass

/** A 12-semitone window where bass roots live. */
function bassWindow(instrument: InstrumentId): [number, number] {
  const [min, max] = INSTRUMENTS[instrument].noteRange;
  const low = clamp(instrument === '808' ? 30 : 33, min, Math.max(min, max - 11));
  return [low, low + 11];
}

function kickPositions(genre: Genre, ctx: GenerateContext, length: number): number[] {
  const positions: number[] = [];
  if (ctx.kick) {
    for (let i = 0; i < length; i++) if (ctx.kick[i]?.on) positions.push(i);
    return positions;
  }
  const template = parseGroovePart(partFor(grooveFor(genre, ctx), 'kick'));
  if (!template.length) return positions;
  for (let i = 0; i < length; i++) {
    const hit = template[i % template.length];
    if (hit && !hit.maybe) positions.push(i);
  }
  return positions;
}

interface BassNote {
  note: number;
  vel: number;
  len?: number;
}

const BASS_MAX_LEN: Record<BassStyle, number> = {
  syncopated: 8,
  walking: 4,
  '808': 16,
  offbeat: 2,
  sustain: 16,
};

/** Bass line in an explicit style; `genre` supplies the groove the line locks to when `ctx.kick` is missing. */
export function bassSteps(
  style: BassStyle,
  genre: Genre,
  track: Track,
  ctx: GenerateContext,
  progression: number[],
): Step[] {
  const rng = ctx.rng;
  const length = patternLength(ctx.length);
  const steps = blankSteps(track.instrument, ctx.root);
  if (!progression.length) return steps;
  const max = INSTRUMENTS[track.instrument].noteRange[1];
  const [lo, hi] = bassWindow(track.instrument);
  const span = chordSpan(length, progression.length);
  const slots = Math.ceil(length / span);
  const slotOf = (i: number) => (i >= slots ? 0 : i);
  const rootOf = (slot: number) => fitOctave(progression[slotOf(slot) % progression.length], lo, hi);
  const inRange = (n: number) => (n > max ? n - 12 : n);
  const chordTone = (root: number, index: 1 | 2) =>
    inRange(snapToScale(buildChord(root, 'triad', ctx.root, ctx.scale)[index], ctx.root, ctx.scale));
  const scaleStep = (n: number, dir: number) => inRange(transposeInScale(n, dir, ctx.root, ctx.scale));
  const octaveUp = (n: number) => (n + 12 <= max ? n + 12 : n);
  const notes = new Map<number, BassNote>();

  if (style === 'syncopated' || style === '808') {
    const is808 = style === '808';
    for (let s = 0; s < slots; s++) notes.set(s * span, { note: rootOf(s), vel: is808 ? 0.96 : 0.88 });
    const kicks = kickPositions(genre, ctx, length);
    if (is808) {
      // Trap bounce: an extra 808 hit off the kick now and then.
      for (let bar = 0; bar * BAR < length; bar++) {
        const at = bar * BAR + pick(rng, [3, 7, 11, 14]);
        if (at < length && chance(rng, 0.3) && !kicks.includes(at) && !kicks.includes(at - 1)) kicks.push(at);
      }
    }
    for (const k of kicks) {
      if (notes.has(k) || (!is808 && !chance(rng, 0.7))) continue;
      const slot = Math.floor(k / span);
      const nextStart = (slot + 1) * span;
      if (nextStart - k <= (span > 8 ? 2 : 1)) {
        // Anticipate the next chord together with the kick, sometimes tied over the change.
        notes.set(k, { note: rootOf(slot + 1), vel: is808 ? 0.94 : 0.82 });
        if (nextStart < length && chance(rng, 0.5)) notes.delete(nextStart);
        continue;
      }
      const root = rootOf(slot);
      const kind = is808
        ? weightedPick(rng, [
            ['root', 5],
            ['octave', 2.5],
            ['fifth', 1],
          ] as const)
        : weightedPick(rng, [
            ['root', 5],
            ['octave', 1.5],
            ['fifth', 2],
            ['third', 1],
          ] as const);
      const note =
        kind === 'octave'
          ? octaveUp(root)
          : kind === 'fifth'
            ? chordTone(root, 2)
            : kind === 'third'
              ? chordTone(root, 1)
              : root;
      notes.set(k, { note, vel: is808 ? 0.92 : 0.74 });
    }
    if (!is808) {
      // Approach tones leading into chord changes.
      for (let s = 0; s < slots; s++) {
        const at = (s + 1) * span - 2;
        if (at <= s * span || at >= length || notes.has(at) || notes.has(at + 1) || !chance(rng, 0.35)) continue;
        notes.set(at, { note: scaleStep(rootOf(s + 1), chance(rng, 0.5) ? 1 : -1), vel: 0.66 });
      }
    }
  } else if (style === 'walking') {
    for (let s = 0; s < slots; s++) {
      const start = s * span;
      const root = rootOf(s);
      const next = rootOf(s + 1);
      const beats: number[] = [];
      for (let b = start; b < Math.min(start + span, length); b += 4) beats.push(b);
      let prev = root;
      beats.forEach((at, j) => {
        let note: number;
        if (j === 0) note = root;
        else if (j === beats.length - 1) note = scaleStep(next, prev > next ? 1 : -1);
        else if (j === 1) note = chordTone(root, chance(rng, 0.5) ? 1 : 2);
        else note = scaleStep(prev, next >= prev ? 1 : -1);
        notes.set(at, { note, vel: j === 0 ? 0.86 : 0.72 });
        prev = note;
      });
      // A ghosted "skip" note swinging into the next bar.
      const skip = start + span - 1;
      const target = start + span - 4;
      if (span >= 8 && skip < length && notes.has(target) && chance(rng, 0.3)) {
        notes.set(skip, { note: notes.get(target)!.note, vel: 0.42, len: 1 });
      }
    }
  } else if (style === 'offbeat') {
    for (let bar = 0; bar * BAR < length; bar++) {
      const octaves = chance(rng, 0.4);
      for (const r of [2, 6, 10, 14]) {
        const at = bar * BAR + r;
        if (at >= length) break;
        const root = rootOf(Math.floor(at / span));
        notes.set(at, { note: octaves && (r === 6 || r === 14) ? octaveUp(root) : root, vel: r === 2 ? 0.88 : 0.8 });
      }
      const pickup = bar * BAR + 15;
      if (pickup < length && chance(rng, 0.3)) {
        notes.set(pickup, { note: scaleStep(rootOf(Math.floor((pickup + 1) / span)), -1), vel: 0.62, len: 1 });
      }
    }
  } else {
    for (let s = 0; s < slots; s++) {
      const at = s * span;
      const root = rootOf(s);
      if (span >= BAR && at + 8 < length && chance(rng, 0.3)) {
        notes.set(at, { note: root, vel: 0.8, len: 8 });
        notes.set(at + 8, { note: chordTone(root, 2), vel: 0.7, len: Math.min(8, length - at - 8) });
      } else {
        notes.set(at, { note: root, vel: 0.8, len: Math.min(span, 16, length - at) });
      }
    }
  }

  const positions = [...notes.keys()].filter((p) => p >= 0 && p < length).sort((a, b) => a - b);
  const maxLen = BASS_MAX_LEN[style];
  positions.forEach((at, k) => {
    const n = notes.get(at)!;
    const next = positions[k + 1] ?? length;
    let len = n.len ?? clamp(next - at, 1, maxLen);
    if (style === 'syncopated' && n.len === undefined && len >= 3 && chance(rng, 0.3)) len -= 1;
    setHit(steps, at, { note: n.note, vel: human(n.vel, rng, 0.06), len: clamp(len, 1, 16) });
  });
  return steps;
}

/**
 * Bass line following the progression roots (in the bass register), locked
 * partly to the kick, with fifths, octaves and approach tones per genre style.
 */
export function generateBassSteps(genreId: GenreId, track: Track, ctx: GenerateContext, progression: number[]): Step[] {
  const genre = GENRES[genreId];
  return bassSteps(genre.bass, genre, track, ctx, progression);
}

// ---------------------------------------------------------------------------
// Melody

const MOVES: [number, number][] = [
  [0, 0.06],
  [1, 0.26],
  [-1, 0.3],
  [2, 0.1],
  [-2, 0.12],
  [3, 0.04],
  [-3, 0.05],
  [4, 0.015],
  [-4, 0.015],
];

/** Comfortable melody register for an instrument, [low, high] MIDI. */
export function melodyWindow(instrument: InstrumentId, register: number): [number, number] {
  const def = INSTRUMENTS[instrument];
  const [min, max] = def.noteRange;
  const center = clamp(Math.max(def.defaultNote, 67) + register, min + 6, max - 6);
  return [Math.max(min, center - 7), Math.min(max, center + 10)];
}

function nearestIndex(pool: number[], note: number): number {
  let best = 0;
  for (let i = 1; i < pool.length; i++) {
    if (Math.abs(pool[i] - note) < Math.abs(pool[best] - note)) best = i;
  }
  return best;
}

/** Onsets (sorted, within `motifLen`) for a motif on a rhythmic grid. */
export function motifRhythm(grid: number, density: number, syncopation: number, motifLen: number, rng: Rng): number[] {
  const onsets = new Set<number>();
  for (let pos = 0; pos < motifLen; pos += grid) {
    const weight = pos % 8 === 0 ? 1.3 : pos % 4 === 0 ? 1.1 : 0.8;
    // Leave the end of the phrase a little emptier so it breathes.
    const tail = pos >= motifLen - 4 ? 0.6 : 1;
    if (!chance(rng, Math.min(0.95, density * weight * tail))) continue;
    let at = pos;
    if (grid > 1 && chance(rng, syncopation)) at = pos > 0 && chance(rng, 0.6) ? pos - 1 : pos + 1;
    if (at >= 0 && at < motifLen) onsets.add(at);
  }
  // Too sparse to be a motif: add notes on free beats.
  const minimum = Math.min(motifLen, motifLen >= BAR ? 3 : 2);
  for (let pos = 0; onsets.size < minimum && pos < motifLen; pos += Math.max(grid, 4)) {
    if (!onsets.has(pos) && (pos === 0 || chance(rng, 0.5))) onsets.add(pos);
  }
  for (let pos = 0; onsets.size < minimum && pos < motifLen; pos++) onsets.add(pos);
  return [...onsets].sort((a, b) => a - b);
}

/**
 * Motif-based melody: a 1–2 bar motif (chord tones on strong beats, stepwise
 * scale motion elsewhere) repeated across the pattern with variation, with
 * the last repetition answering the phrase and resolving to a chord tone.
 */
export function generateMelodySteps(
  genreId: GenreId,
  track: Track,
  ctx: GenerateContext,
  progression: number[],
): Step[] {
  const style = GENRES[genreId].melody;
  const rng = ctx.rng;
  const length = patternLength(ctx.length);
  const steps = blankSteps(track.instrument, ctx.root);
  const [lo, hi] = melodyWindow(track.instrument, style.register);
  const pool = scaleNotes(ctx.root, ctx.scale, lo, hi);
  if (pool.length < 3 || !progression.length) return steps;

  const span = chordSpan(length, progression.length);
  const last = pool.length - 1;
  const center = nearestIndex(pool, (lo + hi) / 2);
  const clampIdx = (i: number) => (i < 0 ? -i : i > last ? 2 * last - i : i);
  /** Nearest chord tone to pool[idx], searching first in direction `dir` (-1/1). */
  const toChordTone = (idx: number, at: number, rootOnly = false, dir = -1) => {
    const chordRoot = chordAt(progression, span, at);
    const pcs = rootOnly ? new Set([pitchClass(chordRoot)]) : chordPitchClasses(chordRoot, ctx);
    for (const d of [0, 1, 2, 3, 4].flatMap((k) => (k ? [k * dir, -k * dir] : [0]))) {
      const j = idx + d;
      if (j >= 0 && j <= last && pcs.has(pitchClass(pool[j]))) return j;
    }
    return idx;
  };
  const stepFrom = (idx: number) => {
    let move = weightedPick(rng, MOVES);
    // Pull back towards the middle of the register.
    if ((idx - center > 4 && move > 0) || (center - idx > 4 && move < 0)) move = -move;
    return clamp(clampIdx(idx + move), 0, last);
  };

  const motifLen = length <= BAR ? length : length >= 32 && chance(rng, 0.5) ? 32 : BAR;
  const onsets = motifRhythm(style.grid, style.density, style.syncopation, motifLen, rng);
  const motif: { at: number; idx: number }[] = [];
  let idx = center;
  onsets.forEach((at, j) => {
    const prev = idx;
    idx = j === 0 ? toChordTone(clamp(center + randInt(rng, -2, 2), 0, last), at) : stepFrom(idx);
    // Strong beats land on chord tones, continuing the melodic direction.
    if (j > 0 && at % 4 === 0) idx = toChordTone(idx, at, false, idx >= prev ? 1 : -1);
    motif.push({ at, idx });
  });

  const placed: { at: number; idx: number }[] = [];
  const reps = Math.ceil(length / motifLen);
  for (let r = 0; r < reps; r++) {
    const offset = r * motifLen;
    const answer = reps > 1 && r === reps - 1;
    const reharmonize = r > 0 && chance(rng, 0.6);
    let prev = placed.length ? placed[placed.length - 1].idx : motif[0].idx;
    motif.forEach((m, j) => {
      const at = offset + m.at;
      if (at >= length) return;
      let i = m.idx;
      if (answer && m.at >= motifLen / 2) {
        i = stepFrom(prev);
        if (at % 4 === 0) i = toChordTone(i, at);
      } else if (r > 0) {
        if (j > 0 && chance(rng, 0.08)) return;
        if (reharmonize && at % 4 === 0) i = toChordTone(i, at);
        else if (at % 4 !== 0 && chance(rng, 0.12)) i = clamp(clampIdx(i + (chance(rng, 0.5) ? 1 : -1)), 0, last);
      }
      placed.push({ at, idx: i });
      prev = i;
    });
  }
  if (placed.length) {
    // Resolve the phrase onto the chord root, or at least a chord tone.
    const end = placed[placed.length - 1];
    const rooted = toChordTone(end.idx, end.at, true);
    end.idx = Math.abs(rooted - end.idx) <= 3 ? rooted : toChordTone(end.idx, end.at);
  }

  placed.forEach((p, k) => {
    const next = placed[k + 1]?.at ?? length;
    let len = clamp(next - p.at, 1, style.maxLen);
    if (len > 1 && chance(rng, 0.2)) len -= 1;
    const accent = p.at % 4 === 0 ? 0.1 : 0;
    const downbeat = p.at % BAR === 0 ? 0.05 : 0;
    setHit(steps, p.at, { note: pool[p.idx], vel: human(0.6 + accent + downbeat, rng, 0.08), len });
  });
  return steps;
}

// ---------------------------------------------------------------------------
// Dispatch and whole beats

/**
 * Steps for any track: drums → groove, bass instruments → bass line,
 * polyphonic tracks with chord mode on → chord part, other melodic → melody.
 */
export function generateTrackSteps(
  genreId: GenreId,
  track: Track,
  ctx: GenerateContext,
  progression: number[],
): Step[] {
  const def = INSTRUMENTS[track.instrument];
  if (def.category === 'drums') return generateDrumSteps(genreId, track.instrument, ctx);
  if (def.category === 'bass') return generateBassSteps(genreId, track, ctx, progression);
  if (def.polyphonic && track.chord !== 'off') return generateChordSteps(genreId, track, ctx, progression);
  return generateMelodySteps(genreId, track, ctx, progression);
}

/** Default mixer settings per instrument. */
export const MIX: Record<InstrumentId, { volume: number; pan: number; reverb: number; delay: number }> = {
  kick: { volume: 0.88, pan: 0, reverb: 0.02, delay: 0 },
  // The 808's long sustained notes carry far more energy than a plucked bass line.
  '808': { volume: 0.58, pan: 0, reverb: 0, delay: 0 },
  snare: { volume: 0.76, pan: 0.02, reverb: 0.14, delay: 0 },
  clap: { volume: 0.72, pan: -0.04, reverb: 0.18, delay: 0 },
  hat: { volume: 0.64, pan: 0.22, reverb: 0.05, delay: 0 },
  openhat: { volume: 0.58, pan: -0.18, reverb: 0.1, delay: 0 },
  rim: { volume: 0.62, pan: -0.3, reverb: 0.16, delay: 0.12 },
  shaker: { volume: 0.55, pan: 0.35, reverb: 0.1, delay: 0 },
  tom: { volume: 0.66, pan: -0.25, reverb: 0.15, delay: 0 },
  crash: { volume: 0.55, pan: 0.15, reverb: 0.2, delay: 0 },
  kick2: { volume: 0.86, pan: 0, reverb: 0.02, delay: 0 },
  kick3: { volume: 0.9, pan: 0, reverb: 0.03, delay: 0 },
  snare2: { volume: 0.76, pan: 0.04, reverb: 0.18, delay: 0 },
  hat2: { volume: 0.6, pan: 0.26, reverb: 0.08, delay: 0 },
  openhat2: { volume: 0.54, pan: -0.14, reverb: 0.14, delay: 0 },
  shaker2: { volume: 0.5, pan: 0.3, reverb: 0.12, delay: 0 },
  keys: { volume: 0.68, pan: -0.12, reverb: 0.3, delay: 0.08 },
  pad: { volume: 0.62, pan: 0, reverb: 0.45, delay: 0.05 },
  pluck: { volume: 0.62, pan: 0.2, reverb: 0.28, delay: 0.3 },
  bell: { volume: 0.62, pan: 0.25, reverb: 0.4, delay: 0.28 },
  lead: { volume: 0.58, pan: 0.12, reverb: 0.3, delay: 0.22 },
  bass: { volume: 0.74, pan: 0, reverb: 0, delay: 0 },
  wurli: { volume: 0.66, pan: -0.1, reverb: 0.3, delay: 0.08 },
  guitar: { volume: 0.64, pan: 0.18, reverb: 0.26, delay: 0.12 },
  strings: { volume: 0.6, pan: 0, reverb: 0.45, delay: 0.05 },
  flute: { volume: 0.56, pan: 0.15, reverb: 0.35, delay: 0.25 },
  vox: { volume: 0.66, pan: -0.08, reverb: 0.5, delay: 0.15 },
  upright: { volume: 0.72, pan: 0, reverb: 0.06, delay: 0 },
  riser: { volume: 0.5, pan: 0, reverb: 0.35, delay: 0.2 },
  sampler: { volume: 0.7, pan: 0, reverb: 0.2, delay: 0 },
};

function createKitTracks(genre: Genre, rng: Rng): Track[] {
  const kit = genre.kits && genre.kits.length ? genre.kits[randInt(rng, 0, genre.kits.length - 1)] : genre.kit;
  let chordAssigned = false;
  return kit.slice(0, MAX_TRACKS).map((instrument) => {
    const def = INSTRUMENTS[instrument];
    const mix = MIX[instrument];
    const isChord = !chordAssigned && (instrument === 'keys' || instrument === 'pad');
    if (isChord) chordAssigned = true;
    const wet = genre.id === 'ambient' && def.melodic ? 1.4 : 1;
    return createTrack(instrument, {
      volume: mix.volume,
      pan: mix.pan,
      reverb: round2(Math.min(0.8, mix.reverb * wet)),
      delay: mix.delay,
      chord: isChord ? genre.chordType : 'off',
      params: genre.params[instrument],
    });
  });
}

function chokeRank(track: Track): number {
  return track.instrument === 'openhat' || track.instrument === 'openhat2' ? 2 : 1;
}

/**
 * Voices in one choke group (closed/open hat) sounding on the same step cut each
 * other off; keep the longer voice (or the one the user kept) and drop the rest.
 */
export function resolveChokes(
  tracks: Track[],
  steps: Record<string, Step[]>,
  length: number,
  root: number,
  editable: Set<string>,
): void {
  const groups = new Map<string, Track[]>();
  for (const track of tracks) {
    const group = INSTRUMENTS[track.instrument].chokeGroup;
    if (!group || !steps[track.id]) continue;
    groups.set(group, [...(groups.get(group) ?? []), track]);
  }
  for (const members of groups.values()) {
    if (members.length < 2) continue;
    const ranked = [...members].sort((a, b) => chokeRank(b) - chokeRank(a));
    for (let i = 0; i < length; i++) {
      const hitting = ranked.filter((t) => steps[t.id][i]?.on);
      if (hitting.length < 2) continue;
      const winner = hitting.find((t) => !editable.has(t.id)) ?? hitting[0];
      for (const t of hitting) {
        if (t === winner || !editable.has(t.id)) continue;
        steps[t.id][i] = createStep(rootNoteFor(t.instrument, root));
      }
    }
  }
}

type BaseContext = Omit<GenerateContext, 'rng'>;

export function isChordTrack(track: Track): boolean {
  return INSTRUMENTS[track.instrument].polyphonic && track.chord !== 'off';
}

/** Generate steps for `tracks`, the kick first so the bass can lock to it. */
function generateTracks(
  genreId: GenreId,
  tracks: Track[],
  base: BaseContext,
  progression: number[],
  seed: number,
  salt: string,
): Record<string, Step[]> {
  const result: Record<string, Step[]> = {};
  const ctxFor = (index: number, track: Track): GenerateContext => ({
    ...base,
    rng: seededRng(seed, `${salt}:${index}:${track.instrument}`),
  });
  let kick = base.kick;
  const kickIndex = tracks.findIndex((t) => isKickDrum(t.instrument));
  if (kickIndex >= 0) {
    const kickTrack = tracks[kickIndex];
    kick = generateDrumSteps(genreId, kickTrack.instrument, ctxFor(kickIndex, kickTrack));
    result[kickTrack.id] = kick;
  }
  tracks.forEach((track, index) => {
    if (result[track.id]) return;
    result[track.id] = generateTrackSteps(genreId, track, { ...ctxFor(index, track), kick }, progression);
  });
  return result;
}

/** A seed as a cover seed that survives the project file format (0..2^31-1). */
export function coverSeed(seed: number): number {
  return Number.isFinite(seed) ? Math.floor(Math.abs(seed)) % 2 ** 31 : 0;
}

const NAME_FIRST = [
  'Rainy',
  'Late',
  'Paper',
  'Velvet',
  'Faded',
  'Quiet',
  'Hazy',
  'Slow',
  'Golden',
  'Sleepy',
  'Dusty',
  'Lazy',
  'Midnight',
  'Sunday',
  'Soft',
  'Warm',
  'Blue',
  'Foggy',
  'Distant',
  'Amber',
  'Lunar',
  'Cozy',
  'Rusty',
  'Neon',
  'Mellow',
  'Hidden',
  'Autumn',
  'Frosted',
  'Silver',
  'Empty',
  'Low',
  'Morning',
];

const NAME_SECOND = [
  'Window',
  'Bus',
  'Moon',
  'Tape',
  'Static',
  'Streetlight',
  'Rooftop',
  'Cassette',
  'Letters',
  'Garden',
  'Coffee',
  'Library',
  'Polaroid',
  'Tram',
  'Harbor',
  'Balcony',
  'Notebook',
  'Radio',
  'Sweater',
  'Lanterns',
  'Platform',
  'Diner',
  'Clouds',
  'Pages',
  'Bloom',
  'Vinyl',
  'Porch',
  'Snowfall',
  'Echoes',
  'Skyline',
  'Ferry',
  'Postcards',
];

/** Evocative two-word beat name, deterministic for a seed (e.g. "Rainy Window"). */
export function beatName(seed: number, salt = ''): string {
  const rng = seededRng(seed, `name:${salt}`);
  return `${pick(rng, NAME_FIRST)} ${pick(rng, NAME_SECOND)}`;
}

export interface GenerateBeatOptions {
  seed: number;
  /** Key root pitch class 0..11 (random from the seed if omitted) */
  root?: number;
  scale?: ScaleId;
  bpm?: number;
  name?: string;
  /** Pattern length in steps, default 32 */
  length?: number;
}

/**
 * A complete fresh project in the genre: kit tracks with a mix, key/tempo/swing,
 * pattern A (main) and B (a variation: kick drop or new melody/drum variation),
 * chained A A B A.
 */
export function generateBeat(genreId: GenreId, options: GenerateBeatOptions): Project {
  const genre = GENRES[genreId];
  const seed = options.seed;
  const rng = seededRng(seed, `${genreId}:beat`);
  // Draw every choice up front so explicit options don't shift the others.
  const randomRoot = randInt(rng, 0, 11);
  const randomScale = pick(rng, genre.scales);
  const randomBpm = randInt(rng, genre.bpm[0], genre.bpm[1]);
  const swing = randInt(rng, genre.swing[0], genre.swing[1]);
  const groove = randInt(rng, 0, genre.grooves.length - 1);
  const drop = chance(rng, 0.5);

  const root = options.root === undefined ? randomRoot : ((Math.round(options.root) % 12) + 12) % 12;
  const scale = options.scale ?? randomScale;
  const bpm = clamp(Math.round(options.bpm ?? randomBpm), BPM_MIN, BPM_MAX);
  const length = patternLength(options.length ?? 32);
  const name = (options.name?.trim() || beatName(seed, genreId)).slice(0, 120);

  const tracks = createKitTracks(genre, seededRng(seed, `${genreId}:kit`));
  const project = createProject({
    name,
    bpm,
    swing,
    root,
    scale,
    tracks,
    fx: genre.fx,
    meta: { coverSeed: coverSeed(seed), styles: [genreId] },
  });
  const base: BaseContext = { root, scale, length, groove };
  const progression = generateProgression(genreId, { ...base, rng: seededRng(seed, `${genreId}:progression`) });
  const all = new Set(tracks.map((t) => t.id));

  const a = createPattern('A', tracks, root, length);
  a.steps = generateTracks(genreId, tracks, base, progression, seed, `${genreId}:A`);
  resolveChokes(tracks, a.steps, length, root, all);

  // B: fresh drum variations and a new melody over the same chords; half the
  // time the kick drops out and the bass just holds the roots.
  const b = createPattern('B', tracks, root, length);
  b.steps = generateTracks(genreId, tracks, base, progression, seed, `${genreId}:B`);
  tracks.forEach((track, index) => {
    const def = INSTRUMENTS[track.instrument];
    if (isChordTrack(track)) {
      b.steps[track.id] = a.steps[track.id].map((s) => ({ ...s }));
    } else if (drop && isKickDrum(track.instrument)) {
      b.steps[track.id] = blankSteps(track.instrument, root);
    } else if (drop && def.category === 'bass') {
      const ctx = { ...base, rng: seededRng(seed, `${genreId}:B:drop:${index}`) };
      b.steps[track.id] = bassSteps('sustain', genre, track, ctx, progression);
    }
  });
  resolveChokes(tracks, b.steps, length, root, all);

  project.patterns = [a, b];
  project.activePatternId = a.id;
  project.arrangement = [
    createSection(a.id, { name: 'A', repeats: 2 }),
    createSection(b.id, { name: 'B' }),
    createSection(a.id, { name: 'A' }),
  ];
  return project;
}

/** Read the chord roots back from an existing chord part (used when the user keeps it). */
export function progressionFromSteps(steps: Step[], length: number, root: number, scale: ScaleId): number[] | null {
  const onsets: number[] = [];
  for (let i = 0; i < length; i++) if (steps[i]?.on) onsets.push(i);
  if (!onsets.length) return null;
  const halfBar = onsets.some(
    (i, k) => k > 0 && steps[i].note !== steps[onsets[k - 1]].note && [6, 7, 8].includes(i % BAR),
  );
  const span = halfBar ? 8 : BAR;
  const roots: number[] = [];
  for (let start = 0; start < length; start += span) {
    const src =
      [start, start - 1, start - 2].find((i) => i >= 0 && steps[i]?.on) ??
      onsets.find((i) => i > start && i < start + span) ??
      [...onsets].reverse().find((i) => i < start) ??
      onsets[0];
    roots.push(fitOctave(snapToScale(steps[src].note, root, scale), 48, 64));
  }
  return roots;
}

/**
 * New steps for every track of the pattern except those in `keep`, using the
 * pattern length and the project key. Kept chord parts define the harmony and a
 * kept kick is what the bass locks to. Returns trackId → steps; the project is
 * not modified.
 */
export function regeneratePattern(
  project: Project,
  patternId: string,
  genreId: GenreId,
  options: { seed: number; keep?: Set<string> },
): Record<string, Step[]> {
  const pattern: Pattern | undefined = project.patterns.find((p) => p.id === patternId);
  if (!pattern) return {};
  const genre = GENRES[genreId];
  const keep = options.keep ?? new Set<string>();
  const seed = options.seed;
  const rng = seededRng(seed, `${genreId}:regenerate`);
  const length = patternLength(pattern.length);
  const base: BaseContext = {
    root: project.root,
    scale: project.scale,
    length,
    groove: randInt(rng, 0, genre.grooves.length - 1),
  };

  let progression: number[] | null = null;
  for (const track of project.tracks) {
    if (!keep.has(track.id) || !isChordTrack(track) || !pattern.steps[track.id]) continue;
    progression = progressionFromSteps(pattern.steps[track.id], length, project.root, project.scale);
    if (progression) break;
  }
  progression ??= generateProgression(genreId, { ...base, rng: seededRng(seed, `${genreId}:regen:progression`) });

  const keptKick = project.tracks.find((t) => isKickDrum(t.instrument) && keep.has(t.id));
  if (keptKick) base.kick = pattern.steps[keptKick.id];

  const targets = project.tracks.filter((t) => !keep.has(t.id));
  const fresh = generateTracks(genreId, targets, base, progression, seed, `${genreId}:regen`);
  const combined: Record<string, Step[]> = { ...fresh };
  for (const track of project.tracks) {
    if (keep.has(track.id) && pattern.steps[track.id]) combined[track.id] = pattern.steps[track.id];
  }
  resolveChokes(project.tracks, combined, length, project.root, new Set(targets.map((t) => t.id)));

  const result: Record<string, Step[]> = {};
  for (const track of targets) result[track.id] = combined[track.id];
  return result;
}

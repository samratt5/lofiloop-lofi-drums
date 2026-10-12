/**
 * Motifs: short melodic ideas stored as rhythm + scale-degree contour, so one
 * hook can be restated over different chords, varied for verses (sparser,
 * displaced, transposed, inverted) and split into call and response.
 */
import { chance, randInt, weightedPick, type Rng } from '@/lib/music/rng';
import { buildChord, isInScale, pitchClass, type ScaleId } from '@/lib/music/theory';
import type { Step } from '@/lib/project/types';
import { clamp } from '@/lib/utils/math';
import type { MelodyStyle } from './genres';
import { chordAt, human, motifRhythm, setHit } from './generators';

export interface MotifNote {
  /** Onset in steps from the start of the motif */
  at: number;
  /** Scale degrees above (+) or below (−) the phrase anchor */
  deg: number;
  /** Length in steps */
  len: number;
  /** Extra velocity 0..0.2 */
  accent: number;
}

export interface Motif {
  /** Span in steps (16 = one bar) */
  length: number;
  notes: MotifNote[];
}

const STEP_SIZES: [number, number][] = [
  [1, 0.5],
  [2, 0.26],
  [3, 0.1],
  [0, 0.09],
  [4, 0.05],
];

function withLengths(notes: MotifNote[], length: number, maxLen: number, tail: number): MotifNote[] {
  const sorted = [...notes].sort((a, b) => a.at - b.at);
  return sorted.map((n, i) => {
    const next = sorted[i + 1]?.at ?? length + tail;
    const room = Math.max(1, next - n.at);
    const cap = i === sorted.length - 1 ? maxLen + 2 : maxLen;
    return { ...n, len: clamp(Math.min(room, cap), 1, 16) };
  });
}

/**
 * A one-bar "call": onsets on the style's grid, an arch-shaped contour that
 * climbs to a peak and falls back, mostly stepwise with the odd leap.
 */
export function createMotif(rng: Rng, style: MelodyStyle, length = 16): Motif {
  const onsets = motifRhythm(style.grid, style.density, style.syncopation, length, rng);
  if (onsets[0] > 4) onsets.unshift(0);
  const peak = Math.max(1, Math.round(onsets.length * (0.4 + rng() * 0.3)));
  let deg = 0;
  const notes = onsets.map((at, j): MotifNote => {
    if (j > 0) {
      const rising = j <= peak;
      const dir = chance(rng, 0.22) ? (rising ? -1 : 1) : rising ? 1 : -1;
      deg = clamp(deg + dir * weightedPick(rng, STEP_SIZES), -4, 7);
    }
    return { at, deg, len: 1, accent: j === 0 ? 0.06 : at % 4 === 0 ? 0.03 : 0 };
  });
  // Land the phrase close to where it started.
  const last = notes[notes.length - 1];
  if (notes.length > 1 && Math.abs(last.deg) > 2) last.deg = last.deg > 0 ? 2 : -1;
  return { length, notes: withLengths(notes, length, style.maxLen, 0) };
}

/**
 * The "response" to a call: echoes the call's opening rhythm a third away,
 * then descends to the anchor with a long final note.
 */
export function answerMotif(call: Motif, rng: Rng, style: MelodyStyle): Motif {
  const half = call.length / 2;
  const shift = weightedPick(rng, [
    [2, 3],
    [-2, 2],
    [4, 1],
    [-1, 1],
  ] as const);
  const head = call.notes.filter((n) => n.at < half).map((n) => ({ ...n, deg: n.deg + shift }));
  const tailOnsets = motifRhythm(style.grid, style.density * 0.7, style.syncopation, half, rng)
    .map((at) => at + half)
    .filter((at) => at < call.length);
  let deg = head.length ? head[head.length - 1].deg : 0;
  const tail = tailOnsets.map((at, j): MotifNote => {
    const remaining = tailOnsets.length - j;
    // Walk down towards the anchor, arriving on the last note.
    deg = remaining === 1 ? 0 : deg - Math.sign(deg || 1) * Math.min(Math.abs(deg), randInt(rng, 1, 2));
    return { at, deg, len: 1, accent: at % 4 === 0 ? 0.03 : 0 };
  });
  const notes = [...head, ...tail];
  if (!tail.length && notes.length) notes[notes.length - 1] = { ...notes[notes.length - 1], deg: 0 };
  if (!notes.length) notes.push({ at: 0, deg: 0, len: 1, accent: 0 });
  return { length: call.length, notes: withLengths(notes, call.length, style.maxLen, 0) };
}

export interface Variation {
  /** Chance each note after the first is dropped */
  sparsity?: number;
  /** Rhythmic displacement in steps */
  shift?: number;
  /** Scale degrees added to every note */
  transpose?: number;
  /** Mirror the contour around the anchor */
  invert?: boolean;
  /** Keep only the notes before this fraction of the motif */
  fragment?: number;
  maxLen?: number;
}

/** A variation of a motif; at least two notes survive (when the motif has two). */
export function varyMotif(motif: Motif, rng: Rng, v: Variation): Motif {
  const cut = (v.fragment ?? 1) * motif.length;
  let notes = motif.notes
    .filter((n) => n.at < cut)
    .map((n) => ({
      ...n,
      at: n.at + (v.shift ?? 0),
      deg: (v.invert ? -n.deg : n.deg) + (v.transpose ?? 0),
    }))
    .filter((n) => n.at >= 0 && n.at < motif.length);
  if (v.sparsity) {
    const kept = notes.filter((n, i) => i === 0 || !chance(rng, v.sparsity!));
    notes = kept.length >= Math.min(2, notes.length) ? kept : notes.slice(0, 2);
  }
  if (!notes.length) notes = [{ at: 0, deg: v.transpose ?? 0, len: 1, accent: 0 }];
  const maxLen = v.maxLen ?? Math.max(...motif.notes.map((n) => n.len), 2);
  return { length: motif.length, notes: withLengths(notes, motif.length, maxLen, 0) };
}

export interface Voice {
  /** Scale notes available to the part, ascending */
  pool: number[];
  /** Pool index of degree 0 */
  anchor: number;
}

export interface Harmony {
  root: number;
  scale: ScaleId;
  /** Chord roots, one per `span` steps */
  roots: number[];
  span: number;
}

/** Pitch classes of the chord (seventh, in key) sounding at `step`. */
export function chordTonesAt(harmony: Harmony, step: number, rootOnly = false): Set<number> {
  const chordRoot = chordAt(harmony.roots, harmony.span, step);
  if (rootOnly) return new Set([pitchClass(chordRoot)]);
  const pcs = new Set<number>([pitchClass(chordRoot)]);
  for (const n of buildChord(chordRoot, 'seventh', harmony.root, harmony.scale)) {
    if (isInScale(n, harmony.root, harmony.scale)) pcs.add(pitchClass(n));
  }
  return pcs;
}

/** Pool index nearest to `idx` whose pitch is in `pcs`, searching in direction `dir` first. */
export function nearestTone(pool: number[], idx: number, pcs: Set<number>, dir = -1, reach = 4): number {
  const last = pool.length - 1;
  for (let k = 0; k <= reach; k++) {
    for (const d of k ? [k * dir, -k * dir] : [0]) {
      const j = idx + d;
      if (j >= 0 && j <= last && pcs.has(pitchClass(pool[j]))) return j;
    }
  }
  return clamp(idx, 0, last);
}

/** Anchor for a voice: the chord tone of the first chord closest to the middle of the pool. */
export function anchorFor(pool: number[], harmony: Harmony, offset = 0): number {
  const middle = Math.floor(pool.length / 2) + offset;
  return nearestTone(pool, clamp(middle, 0, pool.length - 1), chordTonesAt(harmony, 0), 1, 6);
}

export interface RenderOptions {
  /** 0..1 section energy, scales velocity */
  energy: number;
  /** Final note goes to the chord root */
  resolve?: boolean;
  /** Steps available (pattern length) */
  limit: number;
  /** Extra velocity scale */
  level?: number;
}

/**
 * Write a motif into `steps` starting at `start`: degrees become pool notes
 * around the voice anchor; notes on beats 1/3 and long notes land on chord
 * tones of the harmony underneath; velocity follows the phrase arc.
 */
export function renderMotif(
  steps: Step[],
  motif: Motif,
  start: number,
  voice: Voice,
  harmony: Harmony,
  rng: Rng,
  options: RenderOptions,
): void {
  const { pool } = voice;
  const last = pool.length - 1;
  if (last < 2) return;
  const reflect = (i: number) => (i < 0 ? Math.min(last, -i) : i > last ? Math.max(0, 2 * last - i) : i);
  const base = (0.5 + 0.2 * options.energy) * (options.level ?? 1);
  let prev: number | null = null;
  motif.notes.forEach((n, k) => {
    const at = start + n.at;
    if (at < 0 || at >= options.limit) return;
    let idx = reflect(voice.anchor + n.deg);
    const dir = prev === null ? -1 : idx >= prev ? 1 : -1;
    const final = options.resolve && k === motif.notes.length - 1;
    if (final) {
      const rooted = nearestTone(pool, idx, chordTonesAt(harmony, at, true), dir, 3);
      idx = pitchClass(pool[rooted]) === pitchClass(chordAt(harmony.roots, harmony.span, at)) ? rooted : idx;
      idx = nearestTone(pool, idx, chordTonesAt(harmony, at), dir, 2);
    } else if (at % 8 === 0 || n.len >= 3 || k === 0) {
      idx = nearestTone(pool, idx, chordTonesAt(harmony, at), dir, 2);
    }
    const arc = 0.08 * Math.sin((Math.PI * (n.at + 0.5)) / motif.length);
    const beat = at % 16 === 0 ? 0.06 : at % 4 === 0 ? 0.03 : -0.02;
    const len = clamp(Math.min(n.len, options.limit - at), 1, 16);
    setHit(steps, at, { note: pool[idx], vel: human(base + arc + beat + n.accent, rng, 0.05), len });
    prev = idx;
  });
}

/** Shorten notes so a monophonic part never overlaps itself. */
export function trimOverlaps(steps: Step[], limit: number): void {
  let prev = -1;
  for (let i = 0; i < limit; i++) {
    if (!steps[i].on) continue;
    if (prev >= 0 && prev + steps[prev].len > i) steps[prev] = { ...steps[prev], len: Math.max(1, i - prev) };
    prev = i;
  }
}

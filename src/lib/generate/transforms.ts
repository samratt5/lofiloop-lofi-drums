/**
 * Pure pattern transforms over a track's step array. Every function only
 * touches indices < `length` (the pattern length) and returns a new array;
 * inputs are never mutated.
 */
import { chance, type Rng } from '@/lib/music/rng';
import { createStep } from '@/lib/project/factory';
import type { Step } from '@/lib/project/types';
import { clamp } from '@/lib/utils/math';

/** Velocities are kept at 1/100 precision so they survive the project file format. */
function vel(value: number): number {
  return Math.round(clamp(value, 0.05, 1) * 100) / 100;
}

function copy(steps: Step[]): Step[] {
  return steps.map((s) => ({ ...s }));
}

/** Number of editable steps: the pattern length clamped to the array size. */
function span(steps: Step[], length: number): number {
  return Math.max(0, Math.min(steps.length, Math.floor(length)));
}

/**
 * Euclidean rhythm (Bjorklund): `hits` onsets spread as evenly as possible over
 * `length` steps, starting on step 0. `rotation` shifts the result later by
 * that many steps (wrapping). E.g. euclid(3, 8) → x..x..x.
 */
export function euclid(hits: number, length: number, rotation = 0): boolean[] {
  const n = Math.max(0, Math.floor(length));
  const k = Math.max(0, Math.min(n, Math.floor(hits)));
  if (n === 0) return [];
  let pattern: boolean[];
  if (k === 0) {
    pattern = new Array<boolean>(n).fill(false);
  } else {
    let groups: boolean[][] = Array.from({ length: k }, () => [true]);
    let remainders: boolean[][] = Array.from({ length: n - k }, () => [false]);
    while (remainders.length > 1) {
      const count = Math.min(groups.length, remainders.length);
      const merged = groups.slice(0, count).map((g, i) => [...g, ...remainders[i]]);
      remainders = groups.length > count ? groups.slice(count) : remainders.slice(count);
      groups = merged;
    }
    pattern = [...groups, ...remainders].flat();
  }
  const r = ((Math.round(rotation) % n) + n) % n;
  if (r === 0) return pattern;
  return pattern.map((_, i) => pattern[(i - r + n) % n]);
}

/**
 * Replace the rhythm with a Euclidean one. Hits that land on an already-on
 * step keep its note and velocity; new hits use `note`.
 */
export function applyEuclid(steps: Step[], length: number, hits: number, rotation: number, note: number): Step[] {
  const out = copy(steps);
  const n = span(steps, length);
  const pattern = euclid(hits, n, rotation);
  for (let i = 0; i < n; i++) {
    if (pattern[i]) {
      if (!out[i].on) out[i] = createStep(note, { on: true });
    } else {
      out[i] = { ...out[i], on: false };
    }
  }
  return out;
}

/** Rotate the first `length` steps by `amount` (positive = later), wrapping around. */
export function shiftSteps(steps: Step[], length: number, amount: number): Step[] {
  const out = copy(steps);
  const n = span(steps, length);
  if (n === 0) return out;
  const r = ((Math.round(amount) % n) + n) % n;
  for (let i = 0; i < n; i++) out[(i + r) % n] = { ...steps[i] };
  return out;
}

/** Play the first `length` steps backwards. */
export function reverseSteps(steps: Step[], length: number): Step[] {
  const out = copy(steps);
  const n = span(steps, length);
  for (let i = 0; i < n; i++) out[i] = { ...steps[n - 1 - i] };
  return out;
}

/** Swap on and off steps; newly enabled steps use `note` and default velocity. */
export function invertSteps(steps: Step[], length: number, note: number): Step[] {
  const out = copy(steps);
  const n = span(steps, length);
  for (let i = 0; i < n; i++) {
    out[i] = out[i].on ? { ...out[i], on: false } : createStep(note, { on: true });
  }
  return out;
}

/** Copy the first `sectionLength` steps across the rest of the pattern. */
export function repeatSection(steps: Step[], length: number, sectionLength: number): Step[] {
  const out = copy(steps);
  const n = span(steps, length);
  const section = Math.floor(sectionLength);
  if (section <= 0 || section >= n) return out;
  for (let i = section; i < n; i++) out[i] = { ...steps[i % section] };
  return out;
}

/** Turn every step within the pattern off. */
export function clearSteps(steps: Step[], length: number): Step[] {
  const out = copy(steps);
  const n = span(steps, length);
  for (let i = 0; i < n; i++) out[i] = { ...out[i], on: false };
  return out;
}

/**
 * Human feel: random velocity jitter plus gentle accents on the beat and
 * softer off-beat 16ths. `amount` 0..1 scales the effect.
 */
export function humanize(steps: Step[], length: number, amount: number, rng: Rng): Step[] {
  const out = copy(steps);
  const n = span(steps, length);
  const a = clamp(amount, 0, 1);
  if (a === 0) return out;
  for (let i = 0; i < n; i++) {
    if (!out[i].on) continue;
    const accent = i % 4 === 0 ? 0.08 : i % 2 === 1 ? -0.05 : 0;
    const jitter = (rng() - 0.5) * 0.3;
    out[i] = { ...out[i], vel: vel(out[i].vel + (accent + jitter) * a) };
  }
  return out;
}

/** Index of the pool note closest to `note`. */
function nearestIndex(pool: number[], note: number): number {
  let best = 0;
  for (let i = 1; i < pool.length; i++) {
    if (Math.abs(pool[i] - note) < Math.abs(pool[best] - note)) best = i;
  }
  return best;
}

/**
 * Random variation: drops some off-beat hits, adds soft ghost notes and, when a
 * `notePool` (e.g. scale notes) is given, nudges notes to a neighbouring pool note.
 * `amount` 0..1 scales how much changes.
 */
export function mutate(steps: Step[], length: number, amount: number, rng: Rng, notePool?: number[]): Step[] {
  const out = copy(steps);
  const n = span(steps, length);
  const a = clamp(amount, 0, 1);
  if (a === 0) return out;
  const pool = notePool?.length ? [...notePool].sort((x, y) => x - y) : null;
  let lastNote: number | null = null;
  for (let i = 0; i < n; i++) {
    const step = out[i];
    if (step.on) {
      if (i % 4 !== 0 && chance(rng, a * 0.25)) {
        out[i] = { ...step, on: false };
        continue;
      }
      if (pool && chance(rng, a * 0.35)) {
        const idx = nearestIndex(pool, step.note) + (chance(rng, 0.5) ? 1 : -1);
        out[i] = { ...step, note: pool[clamp(idx, 0, pool.length - 1)] };
      }
      lastNote = out[i].note;
    } else if (i % 2 === 1 && chance(rng, a * 0.12)) {
      const note = pool ? pool[nearestIndex(pool, lastNote ?? step.note)] : step.note;
      out[i] = { ...step, on: true, note, vel: vel(0.2 + rng() * 0.18), prob: 1, ratchet: 1, len: 1 };
    }
  }
  return out;
}

/** Linear velocity ramp across the pattern (crescendo/decrescendo) for the on steps. */
export function setVelocityRamp(steps: Step[], length: number, from: number, to: number): Step[] {
  const out = copy(steps);
  const n = span(steps, length);
  for (let i = 0; i < n; i++) {
    if (!out[i].on) continue;
    const t = n > 1 ? i / (n - 1) : 0;
    out[i] = { ...out[i], vel: vel(from + (to - from) * t) };
  }
  return out;
}

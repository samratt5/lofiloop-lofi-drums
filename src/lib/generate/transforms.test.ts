import { describe, expect, it } from 'vitest';
import { createRng } from '@/lib/music/rng';
import { createStep, createSteps } from '@/lib/project/factory';
import { MAX_STEPS, type Step } from '@/lib/project/types';
import {
  applyEuclid,
  clearSteps,
  euclid,
  humanize,
  invertSteps,
  mutate,
  repeatSection,
  reverseSteps,
  setVelocityRamp,
  shiftSteps,
} from './transforms';

const grid = (pattern: boolean[]) => pattern.map((on) => (on ? 'x' : '.')).join('');

/** Steps with hits at the given indices (vel/note derived from the index so moves are traceable). */
function stepsWith(indices: number[]): Step[] {
  const steps = createSteps(60);
  for (const i of indices)
    steps[i] = createStep(60 + (i % 12), { on: true, vel: 0.5 + (i % 5) / 10, len: 1 + (i % 3) });
  return steps;
}

const onIndices = (steps: Step[]) => steps.flatMap((s, i) => (s.on ? [i] : []));

describe('euclid', () => {
  it('produces the classic Bjorklund patterns', () => {
    expect(grid(euclid(3, 8))).toBe('x..x..x.');
    expect(grid(euclid(5, 8))).toBe('x.xx.xx.');
    expect(grid(euclid(4, 16))).toBe('x...x...x...x...');
    expect(grid(euclid(2, 5))).toBe('x.x..');
    expect(grid(euclid(3, 4))).toBe('xxx.');
    expect(euclid(7, 16).filter(Boolean)).toHaveLength(7);
  });

  it('rotates later by the rotation amount, wrapping around', () => {
    expect(grid(euclid(3, 8, 1))).toBe('.x..x..x');
    expect(grid(euclid(3, 8, 8))).toBe('x..x..x.');
    expect(grid(euclid(3, 8, -1))).toBe('..x..x.x');
  });

  it('handles edge cases', () => {
    expect(grid(euclid(0, 8))).toBe('........');
    expect(grid(euclid(8, 8))).toBe('xxxxxxxx');
    expect(grid(euclid(12, 8))).toBe('xxxxxxxx');
    expect(grid(euclid(-2, 4))).toBe('....');
    expect(euclid(3, 0)).toEqual([]);
  });
});

describe('applyEuclid', () => {
  it('writes the rhythm within the pattern and keeps existing hits', () => {
    const steps = stepsWith([3, 5, 40]);
    const out = applyEuclid(steps, 8, 3, 0, 64);
    expect(onIndices(out)).toEqual([0, 3, 6, 40]);
    expect(out[3]).toEqual(steps[3]);
    expect(out[0]).toMatchObject({ on: true, note: 64 });
    expect(out[5].on).toBe(false);
    expect(out[40]).toEqual(steps[40]);
  });
});

describe('transforms', () => {
  const steps = stepsWith([0, 2, 7, 15, 20]);
  const snapshot = JSON.parse(JSON.stringify(steps));

  it('never mutates the input and always returns 64 new steps', () => {
    const rng = createRng(1);
    const results = [
      applyEuclid(steps, 16, 5, 1, 60),
      shiftSteps(steps, 16, 3),
      reverseSteps(steps, 16),
      invertSteps(steps, 16, 60),
      repeatSection(steps, 16, 4),
      clearSteps(steps, 16),
      humanize(steps, 16, 1, rng),
      mutate(steps, 16, 1, rng, [60, 62, 64, 65, 67]),
      setVelocityRamp(steps, 16, 0.2, 1),
    ];
    for (const out of results) {
      expect(out).not.toBe(steps);
      expect(out).toHaveLength(MAX_STEPS);
      out.forEach((s, i) => expect(s).not.toBe(steps[i]));
      // Anything at or beyond the pattern length is untouched.
      expect(out.slice(16)).toEqual(steps.slice(16));
    }
    expect(steps).toEqual(snapshot);
  });

  it('shiftSteps rotates within the length and wraps around', () => {
    expect(onIndices(shiftSteps(steps, 16, 3))).toEqual([2, 3, 5, 10, 20]);
    expect(shiftSteps(steps, 16, 3)[3]).toEqual(steps[0]);
    expect(onIndices(shiftSteps(steps, 16, -1))).toEqual([1, 6, 14, 15, 20]);
    expect(onIndices(shiftSteps(steps, 16, 16))).toEqual(onIndices(steps));
  });

  it('reverseSteps mirrors the pattern', () => {
    const out = reverseSteps(steps, 16);
    expect(onIndices(out)).toEqual([0, 8, 13, 15, 20]);
    expect(out[15]).toEqual(steps[0]);
    expect(out[8]).toEqual(steps[7]);
    expect(reverseSteps(out, 16)).toEqual(steps);
  });

  it('invertSteps swaps on and off steps', () => {
    const out = invertSteps(steps, 8, 67);
    expect(onIndices(out)).toEqual([1, 3, 4, 5, 6, 15, 20]);
    expect(out[1]).toEqual(createStep(67, { on: true }));
  });

  it('repeatSection copies the first section across the pattern', () => {
    const out = repeatSection(steps, 16, 4);
    expect(onIndices(out)).toEqual([0, 2, 4, 6, 8, 10, 12, 14, 20]);
    expect(out[12]).toEqual(steps[0]);
    expect(out[14]).toEqual(steps[2]);
    expect(repeatSection(steps, 16, 16)).toEqual(steps);
    expect(repeatSection(steps, 16, 0)).toEqual(steps);
  });

  it('clearSteps turns off only steps within the length', () => {
    expect(onIndices(clearSteps(steps, 16))).toEqual([20]);
  });

  it('humanize keeps velocities in range and is deterministic', () => {
    const a = humanize(steps, 32, 1, createRng(7));
    const b = humanize(steps, 32, 1, createRng(7));
    expect(a).toEqual(b);
    expect(onIndices(a)).toEqual(onIndices(steps));
    for (const s of a) expect(s.vel).toBeGreaterThanOrEqual(0.05);
    for (const s of a) expect(s.vel).toBeLessThanOrEqual(1);
    expect(humanize(steps, 32, 0, createRng(7))).toEqual(steps);
  });

  it('mutate varies the pattern using the note pool', () => {
    const pool = [60, 62, 64, 65, 67, 69, 71, 72];
    const dense = stepsWith([0, 1, 2, 3, 4, 5, 6, 8, 10, 12, 14]);
    const out = mutate(dense, 16, 1, createRng(3), pool);
    expect(out).not.toEqual(dense);
    const ghosts = out.filter((s, i) => s.on && !dense[i].on);
    for (const s of ghosts) {
      expect(s.vel).toBeLessThanOrEqual(0.4);
      expect(pool).toContain(s.note);
    }
    const changedNotes = out.filter((s, i) => s.on && dense[i].on && s.note !== dense[i].note);
    for (const s of changedNotes) expect(pool).toContain(s.note);
    expect(mutate(dense, 16, 0, createRng(3), pool)).toEqual(dense);
  });

  it('setVelocityRamp ramps the on steps', () => {
    const out = setVelocityRamp(steps, 16, 0.2, 0.95);
    expect(out[0].vel).toBe(0.2);
    expect(out[15].vel).toBe(0.95);
    expect(out[7].vel).toBeCloseTo(0.2 + (0.75 * 7) / 15, 2);
    expect(out[1].vel).toBe(steps[1].vel);
  });
});

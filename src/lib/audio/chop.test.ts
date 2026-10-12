import { describe, expect, it } from 'vitest';
import { detectOnsets, equalSlices, monoData, waveformPeaks } from './chop';

const RATE = 8000;

/** A loop of decaying noise bursts at the given times (seconds). */
function hits(times: number[], seconds = 2): Float32Array {
  const data = new Float32Array(RATE * seconds);
  let seed = 1;
  const noise = () => {
    seed = (seed * 16807) % 2147483647;
    return seed / 2147483647 - 0.5;
  };
  for (const t of times) {
    const at = Math.round(t * RATE);
    for (let i = 0; i < RATE * 0.15 && at + i < data.length; i++) {
      data[at + i] += noise() * Math.exp(-i / (RATE * 0.03));
    }
  }
  return data;
}

describe('sampler chopping', () => {
  it('finds each hit in a drum loop', () => {
    const times = [0, 0.5, 0.75, 1.25, 1.5];
    const slices = detectOnsets(hits(times), RATE);
    expect(slices[0]).toBe(0);
    expect(slices).toHaveLength(times.length);
    for (let i = 1; i < times.length; i++) expect(Math.abs(slices[i] * 2 - times[i])).toBeLessThan(0.02);
  });

  it('respects the maximum and a region', () => {
    const times = [0.1, 0.3, 0.5, 0.7, 0.9, 1.1, 1.3, 1.5, 1.7];
    expect(detectOnsets(hits(times), RATE, undefined, { max: 4 })).toHaveLength(4);
    // Second half only: hits at 1.1..1.7 → 0.1, 0.3, 0.5, 0.7 of that half
    const half = detectOnsets(hits(times), RATE, { start: 0.5, end: 1 });
    expect(half.length).toBeGreaterThanOrEqual(3);
    expect(half.every((s) => s >= 0 && s < 1)).toBe(true);
  });

  it('returns a single slice for silence', () => {
    expect(detectOnsets(new Float32Array(RATE), RATE)).toEqual([0]);
  });

  it('makes equal slices and waveform peaks', () => {
    expect(equalSlices(4)).toEqual([0, 0.25, 0.5, 0.75]);
    const { min, max } = waveformPeaks(Float32Array.from([0, 1, -1, 0.5]), 2);
    expect(Array.from(max)).toEqual([1, 0.5]);
    expect(Array.from(min)).toEqual([0, -1]);
    expect(Array.from(monoData([Float32Array.from([1, 0]), Float32Array.from([0, 1])]))).toEqual([0.5, 0.5]);
  });
});

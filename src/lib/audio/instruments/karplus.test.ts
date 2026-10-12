import { describe, expect, it } from 'vitest';
import { FakeContext, asContext } from './fakeAudio';
import { renderString, stringBuffer, stringCacheSize, type StringOptions } from './karplus';

const RATE = 48000;
const base: StringOptions = {
  sampleRate: RATE,
  frequency: 220,
  decay: 1.5,
  brightness: 0.5,
  pickPosition: 0.13,
  softness: 0.2,
  seed: 1,
};

/** Fundamental from the autocorrelation peak (parabolic interpolation). */
function pitchOf(data: Float32Array, from: number, expected: number): number {
  const n = 8192;
  const x = data.subarray(from, from + n);
  const lo = Math.floor((RATE / expected) * 0.8);
  const hi = Math.ceil((RATE / expected) * 1.25);
  const ac = (lag: number) => {
    let s = 0;
    for (let i = 0; i + lag < x.length; i++) s += x[i] * x[i + lag];
    return s;
  };
  let best = lo;
  let bestValue = -Infinity;
  for (let lag = lo; lag <= hi; lag++) {
    const v = ac(lag);
    if (v > bestValue) {
      bestValue = v;
      best = lag;
    }
  }
  const a = ac(best - 1);
  const b = bestValue;
  const c = ac(best + 1);
  return RATE / (best + (0.5 * (a - c)) / (a - 2 * b + c));
}

function rms(data: Float32Array, from: number, length: number) {
  let s = 0;
  for (let i = from; i < from + length; i++) s += data[i] * data[i];
  return Math.sqrt(s / length);
}

describe('renderString', () => {
  it('is in tune across the range (within 3 cents)', () => {
    for (const frequency of [41.2, 82.41, 196, 440, 987.8]) {
      const data = renderString({ ...base, frequency, decay: 3 });
      const measured = pitchOf(data, Math.floor(RATE * 0.2), frequency);
      expect(Math.abs(1200 * Math.log2(measured / frequency))).toBeLessThan(3);
    }
  });

  it('decays about 60 dB over the decay time', () => {
    const data = renderString({ ...base, frequency: 110, decay: 1, brightness: 1 });
    const early = rms(data, Math.floor(RATE * 0.1), 4800);
    const late = rms(data, Math.floor(RATE * 0.6), 4800);
    // 0.5 s apart => about 30 dB for the fundamental (upper partials fall faster)
    const drop = 20 * Math.log10(early / late);
    expect(drop).toBeGreaterThan(24);
    expect(drop).toBeLessThan(45);
  });

  it('starts and ends without clicks and has no DC', () => {
    const data = renderString(base);
    expect(Math.abs(data[0])).toBeLessThan(1e-6);
    expect(Math.abs(data[data.length - 1])).toBeLessThan(1e-6);
    let mean = 0;
    for (const x of data) mean += x;
    expect(Math.abs(mean / data.length)).toBeLessThan(1e-3);
  });

  it('is deterministic per seed and varies between seeds', () => {
    expect(renderString(base)).toEqual(renderString(base));
    expect(renderString({ ...base, seed: 2 })).not.toEqual(renderString(base));
  });

  it('never produces NaN from garbage options', () => {
    const data = renderString({
      sampleRate: Number.NaN,
      frequency: Number.POSITIVE_INFINITY,
      decay: -1,
      brightness: Number.NaN,
      pickPosition: 9,
      softness: -3,
      seed: Number.NaN,
      maxSeconds: 0.2,
    });
    expect(data.length).toBeGreaterThan(0);
    expect(data.every((x) => Number.isFinite(x))).toBe(true);
  });

  it('bakes a body EQ in without blowing up', () => {
    const data = renderString({
      ...base,
      body: {
        peaks: [
          [100, 1.8, 9],
          [1400, 0.8, -4],
        ],
        highpass: 60,
      },
    });
    expect(data.every((x) => Number.isFinite(x) && Math.abs(x) < 4)).toBe(true);
  });

  it('renders a note in a few milliseconds', () => {
    renderString(base); // warm up the JIT
    const start = performance.now();
    for (let i = 0; i < 20; i++) renderString({ ...base, frequency: 82.41, decay: 1.6, seed: i });
    // Budget is 3 ms per note in the browser; leave room for slow CI machines.
    expect((performance.now() - start) / 20).toBeLessThan(15);
  });
});

describe('stringBuffer', () => {
  it('caches by note and settings and caps the cache', () => {
    const ctx = new FakeContext();
    const options = { decay: 1, brightness: 0.5, pickPosition: 0.13, softness: 0.2, seed: 1 };
    const a = stringBuffer(asContext(ctx), 60, options);
    const b = stringBuffer(asContext(ctx), 60, options);
    expect(a).toBe(b);
    expect(ctx.buffers).toBe(1);
    stringBuffer(asContext(ctx), 60, { ...options, brightness: 0.9 });
    expect(ctx.buffers).toBe(2);
    for (let note = 20; note < 140; note++) stringBuffer(asContext(ctx), note, { ...options, decay: 0.2 });
    expect(stringCacheSize()).toBeLessThanOrEqual(96);
  });
});

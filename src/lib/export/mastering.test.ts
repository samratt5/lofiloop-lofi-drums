import { describe, expect, it } from 'vitest';
import { integratedLoudness, samplePeak, truePeak } from './loudness';
import { limit, masterToTarget } from './mastering';
import type { PcmAudio } from './wav';

const RATE = 48000;

/** A deterministic, drum-and-chord-like test mix: decaying low hits over a chord with bright transients. */
function beat(seconds: number, level: number): PcmAudio {
  const n = Math.round(seconds * RATE);
  const left = new Float32Array(n);
  const right = new Float32Array(n);
  let seed = 12345;
  const rand = () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 4294967296 - 0.5;
  };
  const beatLength = Math.round(RATE * 0.5);
  for (let i = 0; i < n; i++) {
    const t = i / RATE;
    const inBeat = (i % beatLength) / RATE;
    const kick = Math.sin(2 * Math.PI * 55 * inBeat) * Math.exp(-inBeat * 9);
    const click = rand() * Math.exp(-inBeat * 120);
    const chord = 0.18 * (Math.sin(2 * Math.PI * 220 * t) + Math.sin(2 * Math.PI * 277.2 * t + 1));
    left[i] = level * (kick + click + chord);
    right[i] = level * (kick + click * 0.7 + chord * 0.9);
  }
  return { sampleRate: RATE, channels: [left, right] };
}

describe('limit', () => {
  it('never lets a sample past the threshold and leaves quiet audio alone', () => {
    const audio = beat(3, 0.9);
    const out = limit(audio, -6, 6);
    expect(samplePeak(out)).toBeLessThanOrEqual(-6 + 1e-4);
    const quiet = beat(1, 0.05);
    const untouched = limit(quiet, -1);
    expect(untouched.channels[0][1234]).toBeCloseTo(quiet.channels[0][1234], 6);
  });
});

describe('masterToTarget', () => {
  it('brings a quiet mix up to -14 LUFS under a -1 dBTP ceiling', () => {
    const input = beat(12, 0.08);
    const snapshot = input.channels[0].slice();
    const { audio, before, after, gainDb } = masterToTarget(input);
    expect(before.lufs).toBeLessThan(-25);
    expect(gainDb).toBeGreaterThan(10);
    expect(Math.abs(after.lufs + 14)).toBeLessThanOrEqual(0.3);
    expect(after.truePeak).toBeLessThanOrEqual(-1 + 0.05);
    expect(integratedLoudness(audio)).toBeCloseTo(after.lufs, 6);
    expect(truePeak(audio)).toBeCloseTo(after.truePeak, 6);
    // input untouched
    expect(input.channels[0]).toEqual(snapshot);
  });

  it('turns a hot, clipping mix down and holds the ceiling', () => {
    const input = beat(12, 1.4);
    const { after, gainDb } = masterToTarget(input, { targetLufs: -16, ceilingDbtp: -1.5 });
    expect(gainDb).toBeLessThan(0);
    expect(Math.abs(after.lufs + 16)).toBeLessThanOrEqual(0.3);
    expect(after.truePeak).toBeLessThanOrEqual(-1.5 + 0.05);
  });

  it('handles an inter-sample-peak-heavy signal', () => {
    const n = RATE * 5;
    const ch = new Float32Array(n);
    for (let i = 0; i < n; i++) ch[i] = 0.3 * Math.sin((2 * Math.PI * 11025 * i) / RATE + Math.PI / 4);
    const { after } = masterToTarget({ sampleRate: RATE, channels: [ch, ch] }, { targetLufs: -9 });
    expect(after.truePeak).toBeLessThanOrEqual(-1 + 0.05);
    expect(Math.abs(after.lufs + 9)).toBeLessThanOrEqual(0.3);
  });

  it('never raises silence or a bare noise floor', () => {
    const silent = masterToTarget({ sampleRate: RATE, channels: [new Float32Array(RATE), new Float32Array(RATE)] });
    expect(silent.gainDb).toBe(0);
    expect(silent.after.lufs).toBe(-Infinity);
    expect(samplePeak(silent.audio)).toBe(-Infinity);

    const hiss = new Float32Array(RATE * 3);
    let seed = 7;
    for (let i = 0; i < hiss.length; i++) {
      seed = (seed * 1664525 + 1013904223) >>> 0;
      hiss[i] = (seed / 4294967296 - 0.5) * 0.004;
    }
    const floor = masterToTarget({ sampleRate: RATE, channels: [hiss, hiss.slice()] });
    expect(floor.before.lufs).toBeLessThan(-50);
    expect(floor.gainDb).toBeLessThanOrEqual(0);
    expect(floor.after.lufs).toBeCloseTo(floor.before.lufs, 3);
  });

  it('handles empty and very short audio without NaN', () => {
    const empty = masterToTarget({ sampleRate: RATE, channels: [new Float32Array(0), new Float32Array(0)] });
    expect(empty.audio.channels[0].length).toBe(0);
    const short = masterToTarget(beat(0.2, 0.3));
    expect(Number.isFinite(short.after.lufs)).toBe(true);
    expect(short.audio.channels[0].every((x) => Number.isFinite(x))).toBe(true);
  });
});

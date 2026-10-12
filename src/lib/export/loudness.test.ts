import { describe, expect, it } from 'vitest';
import {
  integratedLoudness,
  kWeightingFilters,
  loudnessReport,
  meanSquareToLufs,
  samplePeak,
  shortTermLoudness,
  truePeak,
} from './loudness';
import type { PcmAudio } from './wav';

function sine(freq: number, dbfs: number, seconds: number, rate = 48000, phase = 0): Float32Array {
  const amp = Math.pow(10, dbfs / 20);
  const out = new Float32Array(Math.round(seconds * rate));
  for (let i = 0; i < out.length; i++) out[i] = amp * Math.sin((2 * Math.PI * freq * i) / rate + phase);
  return out;
}

const stereo = (ch: Float32Array, rate = 48000): PcmAudio => ({ sampleRate: rate, channels: [ch, ch.slice()] });

describe('K-weighting', () => {
  it('reproduces the BS.1770 coefficients at 48 kHz', () => {
    const [shelf, hp] = kWeightingFilters(48000);
    expect(shelf.b[0]).toBeCloseTo(1.53512485958697, 10);
    expect(shelf.b[1]).toBeCloseTo(-2.69169618940638, 10);
    expect(shelf.b[2]).toBeCloseTo(1.19839281085285, 10);
    expect(shelf.a[1]).toBeCloseTo(-1.69065929318241, 10);
    expect(shelf.a[2]).toBeCloseTo(0.73248077421585, 10);
    expect(hp.a[1]).toBeCloseTo(-1.99004745483398, 10);
    expect(hp.a[2]).toBeCloseTo(0.99007225036621, 10);
  });
});

describe('integratedLoudness', () => {
  it('reads a 997 Hz sine at -20 dBFS on both channels as about -20 LUFS', () => {
    for (const rate of [44100, 48000, 96000]) {
      expect(integratedLoudness(stereo(sine(997, -20, 5, rate), rate))).toBeCloseTo(-20, 1);
    }
  });

  it('reads the EBU -23 dBFS stereo 1 kHz reference as -23 LUFS', () => {
    expect(integratedLoudness(stereo(sine(1000, -23, 20)))).toBeCloseTo(-23, 1);
  });

  it('reads a mono signal in one channel of a stereo file 3 dB quieter', () => {
    const tone = sine(1000, -23, 10);
    const oneSided = integratedLoudness({ sampleRate: 48000, channels: [tone, new Float32Array(tone.length)] });
    expect(oneSided).toBeCloseTo(-26, 1);
    expect(integratedLoudness({ sampleRate: 48000, channels: [tone] })).toBeCloseTo(-26, 1);
  });

  it('returns -Infinity for silence and sub-gate noise', () => {
    expect(integratedLoudness(stereo(new Float32Array(48000 * 2)))).toBe(-Infinity);
    expect(integratedLoudness(stereo(sine(1000, -80, 2)))).toBe(-Infinity);
    expect(integratedLoudness({ sampleRate: 48000, channels: [] })).toBe(-Infinity);
  });

  it('gates out a very quiet section (relative gate)', () => {
    const loud = sine(1000, -20, 10);
    const quiet = sine(1000, -45, 10);
    const joined = new Float32Array(loud.length + quiet.length);
    joined.set(loud);
    joined.set(quiet, loud.length);
    // Without gating the average power would read about 3 dB lower; only the 3 blocks straddling the edge count.
    expect(Math.abs(integratedLoudness(stereo(joined)) + 20)).toBeLessThan(0.1);
  });

  it('keeps sections within 10 LU of the loud part (EBU Tech 3341 case 3 style)', () => {
    const a = sine(1000, -36, 10);
    const b = sine(1000, -23, 60);
    const c = sine(1000, -36, 10);
    const joined = new Float32Array(a.length + b.length + c.length);
    joined.set(a);
    joined.set(b, a.length);
    joined.set(c, a.length + b.length);
    expect(integratedLoudness(stereo(joined))).toBeCloseTo(-23, 1);
  });

  it('measures clips shorter than one block as a single block', () => {
    expect(integratedLoudness(stereo(sine(997, -20, 0.3)))).toBeCloseTo(-20, 0);
  });
});

describe('shortTermLoudness and meanSquareToLufs', () => {
  it('follows the level over a 3 s window', () => {
    const loud = sine(1000, -20, 4);
    const quiet = sine(1000, -30, 4);
    const joined = new Float32Array(loud.length + quiet.length);
    joined.set(loud);
    joined.set(quiet, loud.length);
    expect(shortTermLoudness(stereo(joined), 3.5)).toBeCloseTo(-20, 1);
    expect(shortTermLoudness(stereo(joined), 8)).toBeCloseTo(-30, 1);
  });

  it('converts mean square to LUFS', () => {
    expect(meanSquareToLufs(1)).toBeCloseTo(-0.691, 6);
    expect(meanSquareToLufs(0)).toBe(-Infinity);
    expect(meanSquareToLufs(Number.NaN)).toBe(-Infinity);
  });
});

describe('peaks', () => {
  it('reads sample peak in dBFS', () => {
    expect(samplePeak(stereo(sine(1000, -6, 1)))).toBeCloseTo(-6, 2);
    expect(samplePeak(stereo(new Float32Array(100)))).toBe(-Infinity);
  });

  it('finds inter-sample peaks that the samples miss', () => {
    // fs/4 sine at 45 degrees: every sample sits at ±0.707 of the true amplitude.
    const tone = sine(12000, 0, 1, 48000, Math.PI / 4);
    const audio = stereo(tone);
    expect(samplePeak(audio)).toBeCloseTo(-3.01, 1);
    expect(truePeak(audio)).toBeGreaterThan(-0.2);
    expect(truePeak(audio)).toBeLessThan(0.2);
  });

  it('agrees with the sample peak for low-frequency content', () => {
    const audio = stereo(sine(100, -3, 1));
    expect(Math.abs(truePeak(audio) - samplePeak(audio))).toBeLessThan(0.02);
    expect(truePeak(stereo(new Float32Array(1000)))).toBe(-Infinity);
  });

  it('bundles a report and stays fast on a minute of stereo', () => {
    const tone = sine(440, -10, 60);
    const start = performance.now();
    const report = loudnessReport(stereo(tone));
    expect(performance.now() - start).toBeLessThan(3000);
    expect(report.samplePeak).toBeCloseTo(-10, 1);
    expect(report.truePeak).toBeGreaterThanOrEqual(report.samplePeak - 1e-6);
    expect(Number.isFinite(report.lufs)).toBe(true);
  });
});

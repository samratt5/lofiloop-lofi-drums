import { describe, expect, it } from 'vitest';
import type { PcmAudio } from '@/lib/export/wav';
import { analyzeAudio, featuresAt, SPECTRUM_BANDS } from './features';
import { Fft } from './fft';

const SR = 44100;

function sine(freq: number, seconds: number, amp = 0.5, sr = SR): PcmAudio {
  const n = Math.round(seconds * sr);
  const ch = new Float32Array(n);
  for (let i = 0; i < n; i++) ch[i] = amp * Math.sin((2 * Math.PI * freq * i) / sr);
  return { sampleRate: sr, channels: [ch, ch.slice()] };
}

function mean(values: number[]): number {
  return values.reduce((a, b) => a + b, 0) / values.length;
}

/** Skip the first/last few frames where the window runs off the signal. */
function steady<T>(frames: T[]): T[] {
  return frames.slice(5, -5);
}

describe('Fft', () => {
  it('finds a pure tone in the right bin', () => {
    const n = 256;
    const fft = new Fft(n);
    const re = new Float64Array(n);
    const im = new Float64Array(n);
    for (let i = 0; i < n; i++) re[i] = Math.cos((2 * Math.PI * 10 * i) / n);
    fft.transform(re, im);
    const mags = Array.from(re, (r, i) => Math.hypot(r, im[i]));
    expect(mags[10]).toBeCloseTo(n / 2, 6);
    expect(mags[n - 10]).toBeCloseTo(n / 2, 6);
    expect(mags[11]).toBeLessThan(1e-9);
  });

  it('rejects non power-of-two sizes', () => {
    expect(() => new Fft(1000)).toThrow(RangeError);
  });
});

describe('analyzeAudio', () => {
  it('returns one frame per video frame', () => {
    expect(analyzeAudio(sine(440, 2), 30)).toHaveLength(60);
    expect(analyzeAudio(sine(440, 2.01), 30)).toHaveLength(61);
    expect(analyzeAudio({ sampleRate: SR, channels: [] }, 30)).toEqual([]);
  });

  it('keeps silence at zero', () => {
    const frames = analyzeAudio({ sampleRate: SR, channels: [new Float32Array(SR * 2)] }, 30);
    expect(frames).toHaveLength(60);
    for (const f of frames) {
      expect(f.rms + f.bass + f.mid + f.high + f.beat).toBe(0);
      expect(f.spectrum.every((v) => v === 0)).toBe(true);
    }
  });

  it('puts a 60 Hz sine in the bass', () => {
    const frames = steady(analyzeAudio(sine(60, 3), 30));
    const bass = mean(frames.map((f) => f.bass));
    expect(bass).toBeGreaterThan(0.6);
    expect(mean(frames.map((f) => f.mid))).toBeLessThan(0.15);
    expect(mean(frames.map((f) => f.high))).toBeLessThan(0.05);
    const spec = frames[20].spectrum;
    const loudest = spec.indexOf(Math.max(...spec));
    expect(loudest).toBeLessThan(6);
  });

  it('puts an 8 kHz sine in the highs', () => {
    const frames = steady(analyzeAudio(sine(8000, 3), 30));
    expect(mean(frames.map((f) => f.high))).toBeGreaterThan(0.6);
    expect(mean(frames.map((f) => f.bass))).toBeLessThan(0.05);
    expect(mean(frames.map((f) => f.mid))).toBeLessThan(0.15);
    const spec = frames[20].spectrum;
    expect(spec.indexOf(Math.max(...spec))).toBeGreaterThan(SPECTRUM_BANDS * 0.75);
  });

  it('is loudness normalised', () => {
    const loud = steady(analyzeAudio(sine(200, 2, 0.8), 30));
    const quiet = steady(analyzeAudio(sine(200, 2, 0.05), 30));
    expect(Math.abs(mean(loud.map((f) => f.mid)) - mean(quiet.map((f) => f.mid)))).toBeLessThan(0.05);
  });

  it('peaks the beat envelope on clicks', () => {
    const fps = 30;
    const seconds = 4;
    const ch = new Float32Array(SR * seconds);
    const clickTimes = [0.5, 1, 1.5, 2, 2.5, 3, 3.5];
    // Quiet noise bed so the detector has something to ignore.
    let seed = 1;
    for (let i = 0; i < ch.length; i++) {
      seed = (seed * 1664525 + 1013904223) >>> 0;
      ch[i] = ((seed / 4294967296) * 2 - 1) * 0.01;
    }
    for (const t of clickTimes) {
      const at = Math.round(t * SR);
      for (let i = 0; i < 64; i++) ch[at + i] += 0.9 * Math.exp(-i / 12) * (i % 2 ? -1 : 1);
    }
    const frames = analyzeAudio({ sampleRate: SR, channels: [ch] }, fps);
    for (const t of clickTimes) {
      const f = Math.round(t * fps);
      const near = Math.max(...[f - 1, f, f + 1].map((i) => frames[i].beat));
      expect(near).toBeGreaterThan(0.8);
      // Decays well before the next click.
      expect(frames[f + 10].beat).toBeLessThan(0.2);
    }
    // Quiet just before the next click
    expect(frames[Math.round(1.45 * fps)].beat).toBeLessThan(0.1);
  });

  it('keeps every value finite and within 0..1', () => {
    const a = sine(110, 2, 0.6);
    const b = sine(3000, 2, 0.3);
    for (let i = 0; i < a.channels[0].length; i++) a.channels[0][i] += b.channels[0][i];
    a.channels[1][100] = NaN;
    for (const f of analyzeAudio(a, 24)) {
      for (const v of [f.rms, f.bass, f.mid, f.high, f.beat, ...f.spectrum]) {
        expect(Number.isFinite(v)).toBe(true);
        expect(v).toBeGreaterThanOrEqual(0);
        expect(v).toBeLessThanOrEqual(1);
      }
    }
  });

  it('analyses a five-minute song in well under 3 s', () => {
    const sr = 48000;
    const n = sr * 300;
    const l = new Float32Array(n);
    const r = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const t = i / sr;
      l[i] = 0.3 * Math.sin(2 * Math.PI * 55 * t) + 0.1 * Math.sin(2 * Math.PI * 1760 * t);
      r[i] = l[i];
    }
    const start = performance.now();
    const frames = analyzeAudio({ sampleRate: sr, channels: [l, r] }, 30);
    const elapsed = performance.now() - start;
    expect(frames).toHaveLength(9000);
    expect(elapsed).toBeLessThan(3000);
  });

  it('featuresAt clamps to the analysed range', () => {
    const frames = analyzeAudio(sine(60, 1), 30);
    expect(featuresAt(frames, -5, 30)).toBe(frames[0]);
    expect(featuresAt(frames, 99, 30)).toBe(frames[frames.length - 1]);
    expect(featuresAt([], 1, 30).rms).toBe(0);
  });
});

/**
 * Per-video-frame audio features for audio-reactive visuals: loudness, three
 * broad bands, a 32-band log spectrum and a beat (onset) envelope. Values are
 * loudness-normalised per song so quiet and loud mixes animate alike.
 */
import type { PcmAudio } from '@/lib/export/wav';
import { Fft } from './fft';

export const SPECTRUM_BANDS = 32;

export interface FrameFeatures {
  /** Overall loudness 0..1 */
  rms: number;
  /** ~20-150 Hz energy 0..1 */
  bass: number;
  /** ~150-2000 Hz energy 0..1 */
  mid: number;
  /** ~2-16 kHz energy 0..1 */
  high: number;
  /** 32 log-spaced bands (40 Hz..16 kHz), each 0..1 */
  spectrum: Float32Array;
  /** Onset envelope: jumps towards 1 on a hit, then decays */
  beat: number;
}

export interface AnalyzeOptions {
  /** FFT window, power of two (default 2048) */
  fftSize?: number;
}

/** Features for silence / no audio. */
export function silentFeatures(): FrameFeatures {
  return { rms: 0, bass: 0, mid: 0, high: 0, spectrum: new Float32Array(SPECTRUM_BANDS), beat: 0 };
}

const MIN_HZ = 40;
const MAX_HZ = 16000;
const BASS: [number, number] = [20, 150];
const MID: [number, number] = [150, 2000];
const HIGH: [number, number] = [2000, 16000];
/** dB window mapped onto 0..1 after loudness normalisation. */
const FLOOR_DB = -54;
const RANGE_DB = 48;
/** Target RMS the loud parts of a song are normalised to (about -14 dBFS). */
const TARGET_RMS = 0.2;
/** Hann window equivalent noise bandwidth, in bins. */
const ENBW = 1.5;
/** Per-aggregate offsets: lofi mixes are dark, so highs get a lift. */
const BASS_OFFSET_DB = -5;
const MID_OFFSET_DB = 0;
const HIGH_OFFSET_DB = 9;
/** Spectrum display tilt per octave above 250 Hz. */
const TILT_DB_PER_OCT = 3;

interface BandWeights {
  bins: Int32Array;
  weights: Float32Array;
  /** Divider so narrow bands average and wide bands sum */
  norm: number;
}

/** Fractional overlap of FFT bins with [loHz, hiHz). */
function bandWeights(loHz: number, hiHz: number, binHz: number, maxBin: number): BandWeights {
  const lo = loHz / binHz;
  const hi = Math.max(lo + 1e-6, hiHz / binHz);
  const bins: number[] = [];
  const weights: number[] = [];
  for (let k = Math.max(0, Math.floor(lo - 0.5)); k <= Math.min(maxBin, Math.ceil(hi + 0.5)); k++) {
    const overlap = Math.min(hi, k + 0.5) - Math.max(lo, k - 0.5);
    if (overlap > 0) {
      bins.push(k);
      weights.push(overlap);
    }
  }
  const total = weights.reduce((a, b) => a + b, 0);
  if (!bins.length) {
    bins.push(Math.min(maxBin, Math.round(lo)));
    weights.push(1);
  }
  return { bins: Int32Array.from(bins), weights: Float32Array.from(weights), norm: total < 1 ? total || 1 : 1 };
}

function bandPower(power: Float64Array, band: BandWeights): number {
  let sum = 0;
  for (let i = 0; i < band.bins.length; i++) sum += power[band.bins[i]] * band.weights[i];
  return sum / band.norm;
}

function toUnit(amplitude: number, offsetDb = 0): number {
  if (!(amplitude > 0)) return 0;
  const db = 20 * Math.log10(amplitude) + offsetDb;
  const v = (db - FLOOR_DB) / RANGE_DB;
  return v <= 0 ? 0 : v >= 1 ? 1 : v;
}

function percentile(values: Float32Array | number[], p: number): number {
  const sorted = Float32Array.from(values).sort();
  if (!sorted.length) return 0;
  return sorted[Math.min(sorted.length - 1, Math.max(0, Math.floor(p * (sorted.length - 1))))];
}

/** Attack/release smoothing in place. */
function smooth(values: Float32Array, fps: number, attack: number, release: number) {
  const a = 1 - Math.exp(-1 / (fps * attack));
  const r = 1 - Math.exp(-1 / (fps * release));
  let y = 0;
  for (let i = 0; i < values.length; i++) {
    const x = values[i];
    y += (x - y) * (x > y ? a : r);
    values[i] = y;
  }
}

/**
 * Analyses `audio` into one feature set per video frame (`ceil(duration * fps)`
 * frames). Frame i describes the audio around time i / fps.
 */
export function analyzeAudio(audio: PcmAudio, fps: number, options: AnalyzeOptions = {}): FrameFeatures[] {
  const sr = audio.sampleRate;
  const channels = audio.channels.filter((c) => c && c.length);
  const length = channels.reduce((m, c) => Math.max(m, c.length), 0);
  if (!(fps > 0) || !(sr > 0) || length === 0) return [];
  const frames = Math.max(1, Math.ceil((length / sr) * fps - 1e-9));
  const n = options.fftSize ?? 2048;
  const fft = new Fft(n);
  const half = n / 2;
  const binHz = sr / n;
  const window = new Float64Array(n);
  for (let i = 0; i < n; i++) window[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / n);
  // Amplitude scale so a full-scale sine peaks at 1 (Hann coherent gain = 0.5).
  const ampScale = 4 / n;

  const topHz = Math.min(MAX_HZ, sr * 0.48);
  const edges = Array.from(
    { length: SPECTRUM_BANDS + 1 },
    (_, i) => MIN_HZ * Math.pow(topHz / MIN_HZ, i / SPECTRUM_BANDS),
  );
  const bands = edges.slice(0, -1).map((lo, i) => bandWeights(lo, edges[i + 1], binHz, half - 1));
  const tilt = edges.slice(0, -1).map((lo, i) => {
    const centre = Math.sqrt(lo * edges[i + 1]);
    return Math.max(0, Math.log2(centre / 250)) * TILT_DB_PER_OCT;
  });
  const bass = bandWeights(BASS[0], BASS[1], binHz, half - 1);
  const mid = bandWeights(MID[0], MID[1], binHz, half - 1);
  const high = bandWeights(HIGH[0], Math.min(HIGH[1], sr * 0.49), binHz, half - 1);

  const re = new Float64Array(n);
  const im = new Float64Array(n);
  const power = new Float64Array(half);
  const nch = channels.length;

  // Raw amplitudes per frame, normalised afterwards.
  const rawRms = new Float32Array(frames);
  const rawBass = new Float32Array(frames);
  const rawMid = new Float32Array(frames);
  const rawHigh = new Float32Array(frames);
  const rawSpec = new Float32Array(frames * SPECTRUM_BANDS);

  for (let f = 0; f < frames; f++) {
    const centre = Math.round((f / fps) * sr);
    const start = centre - half;
    let sq = 0;
    for (let i = 0; i < n; i++) {
      const idx = start + i;
      let s = 0;
      if (idx >= 0 && idx < length) {
        for (let c = 0; c < nch; c++) {
          const v = channels[c][idx];
          if (v === v) s += v; // skip NaN
        }
        s /= nch;
      }
      sq += s * s;
      re[i] = s * window[i];
      im[i] = 0;
    }
    rawRms[f] = Math.sqrt(sq / n);
    if (sq === 0) continue;
    fft.transform(re, im);
    for (let k = 0; k < half; k++) power[k] = (re[k] * re[k] + im[k] * im[k]) * ampScale * ampScale;
    rawBass[f] = Math.sqrt(bandPower(power, bass) / ENBW);
    rawMid[f] = Math.sqrt(bandPower(power, mid) / ENBW);
    rawHigh[f] = Math.sqrt(bandPower(power, high) / ENBW);
    for (let b = 0; b < SPECTRUM_BANDS; b++) {
      rawSpec[f * SPECTRUM_BANDS + b] = Math.sqrt(bandPower(power, bands[b]) / ENBW);
    }
  }

  const out: FrameFeatures[] = new Array(frames);
  const loudRef = percentile(rawRms, 0.9);
  if (!(loudRef > 1e-5)) {
    for (let f = 0; f < frames; f++) out[f] = silentFeatures();
    return out;
  }
  const gain = Math.min(40, Math.max(0.05, TARGET_RMS / loudRef));

  const rms = new Float32Array(frames);
  const bassV = new Float32Array(frames);
  const midV = new Float32Array(frames);
  const highV = new Float32Array(frames);
  const spec = new Float32Array(frames * SPECTRUM_BANDS);
  for (let f = 0; f < frames; f++) {
    rms[f] = toUnit(rawRms[f] * gain, -4);
    bassV[f] = toUnit(rawBass[f] * gain, BASS_OFFSET_DB);
    midV[f] = toUnit(rawMid[f] * gain, MID_OFFSET_DB);
    highV[f] = toUnit(rawHigh[f] * gain, HIGH_OFFSET_DB);
    for (let b = 0; b < SPECTRUM_BANDS; b++) {
      const i = f * SPECTRUM_BANDS + b;
      spec[i] = toUnit(rawSpec[i] * gain, tilt[b]);
    }
  }

  const beat = onsetEnvelope(spec, frames, fps, edges);

  smooth(rms, fps, 0.03, 0.2);
  smooth(bassV, fps, 0.02, 0.16);
  smooth(midV, fps, 0.02, 0.18);
  smooth(highV, fps, 0.01, 0.12);
  const column = new Float32Array(frames);
  for (let b = 0; b < SPECTRUM_BANDS; b++) {
    for (let f = 0; f < frames; f++) column[f] = spec[f * SPECTRUM_BANDS + b];
    smooth(column, fps, 0.02, 0.15);
    for (let f = 0; f < frames; f++) spec[f * SPECTRUM_BANDS + b] = column[f];
  }

  for (let f = 0; f < frames; f++) {
    out[f] = {
      rms: rms[f],
      bass: bassV[f],
      mid: midV[f],
      high: highV[f],
      spectrum: spec.slice(f * SPECTRUM_BANDS, (f + 1) * SPECTRUM_BANDS),
      beat: beat[f],
    };
  }
  return out;
}

/** Spectral-flux onset detection with an adaptive threshold, turned into a decaying envelope. */
function onsetEnvelope(spec: Float32Array, frames: number, fps: number, edges: number[]): Float32Array {
  const weights = edges.slice(0, -1).map((lo) => (lo < 150 ? 1.6 : lo < 4000 ? 1 : 0.5));
  const wsum = weights.reduce((a, b) => a + b, 0);
  const flux = new Float32Array(frames);
  for (let f = 0; f < frames; f++) {
    let sum = 0;
    for (let b = 0; b < SPECTRUM_BANDS; b++) {
      const cur = spec[f * SPECTRUM_BANDS + b];
      const prev = f > 0 ? spec[(f - 1) * SPECTRUM_BANDS + b] : 0;
      if (cur > prev) sum += (cur - prev) * weights[b];
    }
    flux[f] = sum / wsum;
  }
  // Local mean over +-0.4 s via a prefix sum.
  const radius = Math.max(1, Math.round(fps * 0.4));
  const prefix = new Float64Array(frames + 1);
  for (let f = 0; f < frames; f++) prefix[f + 1] = prefix[f] + flux[f];
  const strength = new Float32Array(frames);
  const peaks: number[] = [];
  const minGap = Math.max(1, Math.round(fps * 0.1));
  let last = -Infinity;
  for (let f = 0; f < frames; f++) {
    const lo = Math.max(0, f - radius);
    const hi = Math.min(frames, f + radius + 1);
    const mean = (prefix[hi] - prefix[lo]) / (hi - lo);
    const o = flux[f] - (1.3 * mean + 0.015);
    const isPeak = o > 0 && flux[f] >= (flux[f - 1] ?? 0) && flux[f] > (flux[f + 1] ?? 0);
    if (isPeak && f - last >= minGap) {
      strength[f] = o;
      peaks.push(o);
      last = f;
    }
  }
  const env = new Float32Array(frames);
  if (!peaks.length) return env;
  const ref = Math.max(0.02, percentile(peaks, 0.75));
  const decay = Math.exp(-1 / (fps * 0.14));
  let y = 0;
  for (let f = 0; f < frames; f++) {
    y *= decay;
    const hit = Math.sqrt(Math.min(1, strength[f] / ref));
    if (hit > y) y = hit;
    env[f] = y;
  }
  return env;
}

/** Feature set for time `t` (seconds), clamped to the analysed range. */
export function featuresAt(features: readonly FrameFeatures[], t: number, fps: number): FrameFeatures {
  if (!features.length) return silentFeatures();
  const i = Math.min(features.length - 1, Math.max(0, Math.round(t * fps)));
  return features[i];
}

/**
 * Loudness and peak measurement per ITU-R BS.1770-4 / EBU R 128, working on a
 * plain `PcmAudio` so it runs in Node, workers and the browser alike.
 *
 * - K-weighting: the two-stage pre-filter (head shelf + RLB high-pass) designed
 *   for any sample rate with the analogue prototype from libebur128, which
 *   reproduces the published 48 kHz coefficients exactly.
 * - Integrated loudness: 400 ms blocks with 75 % overlap, absolute gate at
 *   −70 LUFS and relative gate at −10 LU.
 * - True peak: 4× oversampling with a Kaiser-windowed sinc interpolator.
 */
import type { PcmAudio } from './wav';

export interface Biquad {
  b: [number, number, number];
  a: [number, number, number];
}

export interface LoudnessReport {
  /** Integrated loudness in LUFS (-Infinity for silence) */
  lufs: number;
  /** Maximum true peak in dBTP */
  truePeak: number;
  /** Maximum sample peak in dBFS */
  samplePeak: number;
}

const ABSOLUTE_GATE = -70;
const RELATIVE_GATE = -10;
const BLOCK_SECONDS = 0.4;
const HOP_SECONDS = 0.1;

/**
 * BS.1770 channel weights for up to 5.1 (L, R, C, LFE, Ls, Rs). LFE is ignored;
 * a 5-channel file is read as L, R, C, Ls, Rs.
 */
function channelWeights(count: number): number[] {
  if (count === 6) return [1, 1, 1, 0, 1.41, 1.41];
  return Array.from({ length: count }, (_, i) => (i < 3 ? 1 : 1.41));
}

/** Both K-weighting stages for a sample rate (feed-forward `b`, feedback `a`, a[0] = 1). */
export function kWeightingFilters(sampleRate: number): [Biquad, Biquad] {
  // Stage 1: high shelf modelling the acoustic effect of the head
  let f0 = 1681.974450955533;
  const G = 3.999843853973347;
  let Q = 0.7071752369554196;
  let K = Math.tan((Math.PI * f0) / sampleRate);
  const Vh = Math.pow(10, G / 20);
  const Vb = Math.pow(Vh, 0.4996667741545416);
  let a0 = 1 + K / Q + K * K;
  const shelf: Biquad = {
    b: [(Vh + (Vb * K) / Q + K * K) / a0, (2 * (K * K - Vh)) / a0, (Vh - (Vb * K) / Q + K * K) / a0],
    a: [1, (2 * (K * K - 1)) / a0, (1 - K / Q + K * K) / a0],
  };
  // Stage 2: revised low-frequency B-curve (RLB) high-pass
  f0 = 38.13547087602444;
  Q = 0.5003270373238773;
  K = Math.tan((Math.PI * f0) / sampleRate);
  a0 = 1 + K / Q + K * K;
  const highpass: Biquad = {
    b: [1, -2, 1],
    a: [1, (2 * (K * K - 1)) / a0, (1 - K / Q + K * K) / a0],
  };
  return [shelf, highpass];
}

/**
 * K-weighted energy (sum of squares) of each segment [bounds[j], bounds[j + 1]),
 * filtering continuously from bounds[0]. Float64 state, transposed direct form II.
 */
function segmentEnergies(data: Float32Array, sampleRate: number, bounds: number[]): Float64Array {
  const [s, h] = kWeightingFilters(sampleRate);
  const [sb0, sb1, sb2] = s.b;
  const [, sa1, sa2] = s.a;
  const [hb0, hb1, hb2] = h.b;
  const [, ha1, ha2] = h.a;
  let s1 = 0;
  let s2 = 0;
  let h1 = 0;
  let h2 = 0;
  const sums = new Float64Array(Math.max(0, bounds.length - 1));
  for (let j = 0; j < sums.length; j++) {
    let acc = 0;
    const end = Math.min(bounds[j + 1], data.length);
    for (let i = bounds[j]; i < end; i++) {
      const x = data[i] || 0;
      const y = sb0 * x + s1;
      s1 = sb1 * x - sa1 * y + s2;
      s2 = sb2 * x - sa2 * y;
      const z = hb0 * y + h1;
      h1 = hb1 * y - ha1 * z + h2;
      h2 = hb2 * y - ha2 * z;
      acc += z * z;
    }
    sums[j] = acc;
  }
  return sums;
}

function frames(audio: PcmAudio): number {
  return audio.channels.reduce((max, ch) => Math.max(max, ch.length), 0);
}

/** Loudness of a (channel-weighted) mean square: −0.691 + 10·log10(ms). */
export function meanSquareToLufs(ms: number): number {
  return ms > 0 && Number.isFinite(ms) ? -0.691 + 10 * Math.log10(ms) : -Infinity;
}

/**
 * Per-hop (100 ms) sums of K-weighted squares for every channel, so blocks and
 * windows of any length can be assembled without re-filtering.
 */
function hopEnergies(audio: PcmAudio): { hops: Float64Array[]; bounds: number[] } {
  const n = frames(audio);
  const hopLength = HOP_SECONDS * audio.sampleRate;
  const count = Math.floor(n / hopLength + 1e-9);
  const bounds = Array.from({ length: count + 1 }, (_, j) => Math.round(j * hopLength));
  const hops = audio.channels.map((ch) => segmentEnergies(ch, audio.sampleRate, bounds));
  return { hops, bounds };
}

/**
 * Gated integrated loudness (LUFS). Audio shorter than one 400 ms block is
 * measured as a single block; silence returns -Infinity.
 */
export function integratedLoudness(audio: PcmAudio): number {
  const n = frames(audio);
  if (n === 0 || audio.channels.length === 0 || !(audio.sampleRate > 0)) return -Infinity;
  const weights = channelWeights(audio.channels.length);
  const hopsPerBlock = Math.round(BLOCK_SECONDS / HOP_SECONDS);
  const { hops, bounds } = hopEnergies(audio);
  const blockCount = hops[0].length - hopsPerBlock + 1;

  // Channel-weighted mean square of every block
  const blocks: number[] = [];
  if (blockCount < 1) {
    let sum = 0;
    audio.channels.forEach((ch, c) => {
      sum += (weights[c] * segmentEnergies(ch, audio.sampleRate, [0, n])[0]) / n;
    });
    blocks.push(sum);
  } else {
    for (let j = 0; j < blockCount; j++) {
      const length = bounds[j + hopsPerBlock] - bounds[j];
      let sum = 0;
      for (let c = 0; c < hops.length; c++) {
        let acc = 0;
        for (let k = 0; k < hopsPerBlock; k++) acc += hops[c][j + k];
        sum += (weights[c] * acc) / length;
      }
      blocks.push(sum);
    }
  }

  const gatedMean = (threshold: number, strict: boolean) => {
    let sum = 0;
    let count = 0;
    for (const z of blocks) {
      const l = meanSquareToLufs(z);
      if (strict ? l > threshold : l >= threshold) {
        sum += z;
        count += 1;
      }
    }
    return count > 0 ? sum / count : 0;
  };
  const absolute = gatedMean(ABSOLUTE_GATE, true);
  if (absolute <= 0) return -Infinity;
  const relative = meanSquareToLufs(absolute) + RELATIVE_GATE;
  return meanSquareToLufs(gatedMean(Math.max(relative, ABSOLUTE_GATE), true));
}

/** Ungated short-term loudness (3 s window ending at `atSeconds`), EBU R 128 "S". */
export function shortTermLoudness(audio: PcmAudio, atSeconds: number, windowSeconds = 3): number {
  const n = frames(audio);
  if (n === 0 || audio.channels.length === 0) return -Infinity;
  const weights = channelWeights(audio.channels.length);
  const end = Math.min(n, Math.max(0, Math.round(atSeconds * audio.sampleRate)));
  const start = Math.max(0, end - Math.round(windowSeconds * audio.sampleRate));
  const length = Math.round(windowSeconds * audio.sampleRate);
  if (end <= start) return -Infinity;
  let sum = 0;
  // Filter from a little earlier so the window is measured with settled filter state
  const warm = Math.max(0, start - Math.round(0.5 * audio.sampleRate));
  audio.channels.forEach((ch, c) => {
    sum += (weights[c] * segmentEnergies(ch, audio.sampleRate, [warm, start, end])[1]) / length;
  });
  return meanSquareToLufs(sum);
}

/** Maximum absolute sample value in dBFS (-Infinity for silence). */
export function samplePeak(audio: PcmAudio): number {
  let max = 0;
  for (const ch of audio.channels) {
    for (let i = 0; i < ch.length; i++) {
      const a = Math.abs(ch[i]);
      if (a > max) max = a;
    }
  }
  return max > 0 ? 20 * Math.log10(max) : -Infinity;
}

const OVERSAMPLE = 4;
const TAPS_PER_PHASE = 16;
let polyphase: { phases: Float64Array[]; gainBound: number } | null = null;

function besselI0(x: number): number {
  let sum = 1;
  let term = 1;
  for (let k = 1; k < 40; k++) {
    term *= (x / (2 * k)) * (x / (2 * k));
    sum += term;
    if (term < 1e-12 * sum) break;
  }
  return sum;
}

/**
 * Kaiser-windowed sinc interpolator split into its fractional phases. Phase 0
 * is the original sample (the filter is Nyquist-M), so only phases 1..3 are kept.
 */
function interpolator() {
  if (polyphase) return polyphase;
  const length = OVERSAMPLE * TAPS_PER_PHASE;
  const centre = (length - 1) / 2 + 0.5; // integer centre => phase 0 lands on input samples
  const beta = 7;
  const i0 = besselI0(beta);
  const taps = new Float64Array(length);
  for (let i = 0; i < length; i++) {
    const x = (i - centre) / OVERSAMPLE;
    const sinc = x === 0 ? 1 : Math.sin(Math.PI * x) / (Math.PI * x);
    const r = (i - centre) / (length / 2);
    const w = Math.abs(r) <= 1 ? besselI0(beta * Math.sqrt(1 - r * r)) / i0 : 0;
    taps[i] = sinc * w;
  }
  const phases: Float64Array[] = [];
  let gainBound = 0;
  for (let p = 1; p < OVERSAMPLE; p++) {
    // The value at input position n + p/M is Σ h[p + M·k] · x[n + K/2 - k]
    const phase = new Float64Array(TAPS_PER_PHASE);
    let sum = 0;
    for (let k = 0; k < TAPS_PER_PHASE; k++) phase[k] = taps[p + OVERSAMPLE * k];
    for (let k = 0; k < TAPS_PER_PHASE; k++) sum += phase[k];
    let abs = 0;
    for (let k = 0; k < TAPS_PER_PHASE; k++) {
      phase[k] /= sum; // unity DC gain per phase
      abs += Math.abs(phase[k]);
    }
    gainBound = Math.max(gainBound, abs);
    phases.push(phase);
  }
  polyphase = { phases, gainBound };
  return polyphase;
}

const SKIP_BLOCK = 64;

/** Largest absolute value of a channel after 4× band-limited interpolation. */
function channelTruePeak(data: Float32Array, floor: number): number {
  const { phases, gainBound } = interpolator();
  const n = data.length;
  const half = TAPS_PER_PHASE / 2;
  let peak = floor;
  for (let i = 0; i < n; i++) peak = Math.max(peak, Math.abs(data[i]));
  if (peak === 0) return 0;

  // Zero-padded copy so the filter loop needs no bounds checks
  const padded = new Float32Array(n + TAPS_PER_PHASE + 1);
  padded.set(data, half);
  const [p1, p2, p3] = phases;

  // Skip regions that cannot beat the running peak even with worst-case interpolation gain.
  const blocks = Math.ceil(n / SKIP_BLOCK);
  const blockMax = new Float32Array(blocks);
  for (let b = 0; b < blocks; b++) {
    let m = 0;
    const end = Math.min(n, (b + 1) * SKIP_BLOCK);
    for (let i = b * SKIP_BLOCK; i < end; i++) m = Math.max(m, Math.abs(data[i]));
    blockMax[b] = m;
  }
  for (let b = 0; b < blocks; b++) {
    const local = Math.max(blockMax[b], b > 0 ? blockMax[b - 1] : 0, b + 1 < blocks ? blockMax[b + 1] : 0);
    if (local * gainBound <= peak) continue;
    const end = Math.min(n, (b + 1) * SKIP_BLOCK);
    for (let i = b * SKIP_BLOCK; i < end; i++) {
      // Interpolated values between x[i] and x[i+1]: x[i + half - k] sits at padded[i + 2·half - k]
      const base = i + 2 * half;
      let a1 = 0;
      let a2 = 0;
      let a3 = 0;
      for (let k = 0; k < TAPS_PER_PHASE; k++) {
        const x = padded[base - k];
        a1 += p1[k] * x;
        a2 += p2[k] * x;
        a3 += p3[k] * x;
      }
      const a = Math.max(Math.abs(a1), Math.abs(a2), Math.abs(a3));
      if (a > peak) peak = a;
    }
  }
  return peak;
}

/** Maximum true peak in dBTP (4× oversampled), -Infinity for silence. */
export function truePeak(audio: PcmAudio): number {
  let peak = 0;
  for (const ch of audio.channels) peak = Math.max(peak, channelTruePeak(ch, peak));
  return peak > 0 ? 20 * Math.log10(peak) : -Infinity;
}

/** Integrated loudness, true peak and sample peak in one go. */
export function loudnessReport(audio: PcmAudio): LoudnessReport {
  return { lufs: integratedLoudness(audio), truePeak: truePeak(audio), samplePeak: samplePeak(audio) };
}

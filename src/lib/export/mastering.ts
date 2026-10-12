/**
 * Loudness normalisation for exports: gain to an integrated-loudness target,
 * then a transparent stereo-linked lookahead limiter that keeps the true peak
 * under a ceiling. Pure functions on `PcmAudio`; the input is never mutated.
 */
import { integratedLoudness, loudnessReport, samplePeak, truePeak, type LoudnessReport } from './loudness';
import type { PcmAudio } from './wav';

export type { LoudnessReport } from './loudness';

export interface MasterOptions {
  /** Integrated loudness target in LUFS (default -14, streaming platforms) */
  targetLufs?: number;
  /** True-peak ceiling in dBTP (default -1) */
  ceilingDbtp?: number;
}

export interface MasterResult {
  audio: PcmAudio;
  before: LoudnessReport;
  after: LoudnessReport;
  /** Static gain applied before limiting, in dB */
  gainDb: number;
}

/** Audio quieter than this is treated as a noise floor and never boosted. */
const NOISE_FLOOR_LUFS = -50;
/** Upper bound on make-up gain, so a near-silent render is not blown up into hiss. */
const MAX_GAIN_DB = 30;
const LOOKAHEAD_SECONDS = 0.005;
const RELEASE_SECONDS = 0.08;
const LUFS_TOLERANCE = 0.1;
const MAX_PASSES = 8;

const dbToGain = (db: number) => Math.pow(10, db / 20);

function frameCount(audio: PcmAudio): number {
  return audio.channels.reduce((max, ch) => Math.max(max, ch.length), 0);
}

function copy(audio: PcmAudio): PcmAudio {
  return { sampleRate: audio.sampleRate, channels: audio.channels.map((ch) => new Float32Array(ch)) };
}

/**
 * Brick-wall limiter with lookahead: per-sample required gain, a running
 * minimum over the lookahead window, instant-attack/exponential-release
 * smoothing, then a moving average over the same window. Every value averaged
 * for sample m is ≤ its required gain, so no sample exceeds the threshold, and
 * the gain glides down over the whole lookahead instead of stepping.
 */
export function limit(audio: PcmAudio, thresholdDb: number, gainDb = 0): PcmAudio {
  const n = frameCount(audio);
  const rate = audio.sampleRate;
  const pre = dbToGain(gainDb);
  const limitAt = dbToGain(thresholdDb) / pre;
  const L = Math.max(1, Math.round(LOOKAHEAD_SECONDS * rate));
  const inputs = audio.channels.map((ch) => (ch.length >= n ? ch : padTo(ch, n)));
  const outputs = inputs.map(() => new Float32Array(n));
  const releaseCoef = 1 - Math.exp(-1 / (RELEASE_SECONDS * rate));

  // Streaming: a circular monotonic deque holds the running minimum of the
  // required gain over the last L samples; a ring holds the smoothed gains
  // for the moving average. Sample m is written once its window is complete.
  const cap = L + 2;
  const dequeIndex = new Int32Array(cap);
  const dequeValue = new Float32Array(cap);
  let head = 0; // oldest entry
  let tail = 0; // one past the newest entry
  const ring = new Float32Array(L);
  let r = 0;
  let sum = 0;
  let released = 1;
  const stereo = inputs.length === 2;
  const [left, right] = inputs;
  for (let i = 0; i < n + L - 1; i++) {
    let value = 1;
    if (i < n) {
      let peak = 0;
      if (stereo) peak = Math.max(Math.abs(left[i]), Math.abs(right[i]));
      else for (let c = 0; c < inputs.length; c++) peak = Math.max(peak, Math.abs(inputs[c][i]));
      if (peak > limitAt) value = limitAt / peak;
    }
    while (tail !== head) {
      const back = tail === 0 ? cap - 1 : tail - 1;
      if (dequeValue[back] < value) break;
      tail = back;
    }
    dequeIndex[tail] = i;
    dequeValue[tail] = value;
    tail = tail + 1 === cap ? 0 : tail + 1;
    if (dequeIndex[head] <= i - L) head = head + 1 === cap ? 0 : head + 1;
    // Instant drop, smooth recovery; never above the held minimum
    released += (1 - released) * releaseCoef;
    const min = dequeValue[head];
    if (min < released) released = min;

    sum += released - ring[r];
    ring[r] = released;
    r = r + 1 === L ? 0 : r + 1;
    const m = i - L + 1;
    if (m >= 0) {
      const g = (sum / L) * pre;
      if (stereo) {
        outputs[0][m] = left[m] * g;
        outputs[1][m] = right[m] * g;
      } else {
        for (let c = 0; c < inputs.length; c++) outputs[c][m] = inputs[c][m] * g;
      }
    }
  }
  return { sampleRate: rate, channels: outputs };
}

function padTo(ch: Float32Array, n: number): Float32Array {
  const out = new Float32Array(n);
  out.set(ch);
  return out;
}

function scale(audio: PcmAudio, gainDb: number): PcmAudio {
  const g = dbToGain(gainDb);
  return { sampleRate: audio.sampleRate, channels: audio.channels.map((ch) => ch.map((x) => x * g)) };
}

/**
 * Normalise to `targetLufs` with the true peak held at or below `ceilingDbtp`.
 * Limiting lowers loudness and sample-peak limiting can leave inter-sample
 * overs, so gain and threshold are refined over a few passes.
 */
export function masterToTarget(audio: PcmAudio, options: MasterOptions = {}): MasterResult {
  const target = Number.isFinite(options.targetLufs) ? (options.targetLufs as number) : -14;
  const ceiling = Number.isFinite(options.ceilingDbtp) ? Math.min(0, options.ceilingDbtp as number) : -1;
  const before = loudnessReport(audio);

  if (!Number.isFinite(before.lufs) || frameCount(audio) === 0) {
    const out = copy(audio);
    return { audio: out, before, after: loudnessReport(out), gainDb: 0 };
  }

  const boostable = before.lufs >= NOISE_FLOOR_LUFS;
  const maxGain = boostable ? MAX_GAIN_DB : 0;
  let gainDb = Math.min(maxGain, target - before.lufs);

  // Start a hair under the ceiling; the sample-peak detector can't see inter-sample overs.
  let threshold = ceiling - 0.1;
  let out = audio;
  let tp = -Infinity;
  let lufs = before.lufs;
  for (let pass = 0; pass < MAX_PASSES; pass++) {
    out = limit(audio, threshold, gainDb);
    tp = truePeak(out);
    lufs = integratedLoudness(out);
    const peakOk = tp <= ceiling;
    // Quieter than the target is fine once the gain is capped (noise floor or max boost).
    const loudOk = Math.abs(lufs - target) <= LUFS_TOLERANCE || (lufs < target && gainDb >= maxGain);
    if (peakOk && loudOk) break;
    if (!peakOk) threshold -= tp - ceiling + 0.02;
    if (!loudOk) gainDb = Math.min(maxGain, gainDb + (target - lufs));
  }
  // Last resort: a static trim guarantees the ceiling even if the passes ran out.
  if (tp > ceiling) {
    const trim = ceiling - tp - 0.01;
    out = scale(out, trim);
    tp += trim;
    lufs += trim;
  }
  return { audio: out, before, after: { lufs, truePeak: tp, samplePeak: samplePeak(out) }, gainDb };
}

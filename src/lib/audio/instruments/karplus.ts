/**
 * Plucked strings computed in JS (Karplus–Strong with Jaffe–Smith extensions)
 * and cached as AudioBuffers. Web Audio feedback loops can't be shorter than a
 * render quantum (128 samples), which rules out native KS above ~375 Hz, so the
 * string is rendered ahead of time and played with an AudioBufferSourceNode.
 */

export interface StringOptions {
  sampleRate: number;
  frequency: number;
  /** Time for the fundamental to fall 60 dB, seconds */
  decay: number;
  /** 0 = dark and dull, 1 = bright and ringing (loop filter and excitation) */
  brightness: number;
  /** Pluck point as a fraction of the string length (comb notch in the spectrum) */
  pickPosition: number;
  /** 0 = noise burst (pick/nail), 1 = smooth finger pulse (upright bass) */
  softness: number;
  /** Seed for the excitation noise, so round-robin variants differ */
  seed: number;
  /** Hard cap on the rendered length, seconds */
  maxSeconds?: number;
  /** Fixed body EQ baked into the buffer (cheaper than per-voice filters) */
  body?: BodyEq;
}

export interface BodyEq {
  /** Peaking resonances: [frequency Hz, Q, gain dB] */
  peaks: [number, number, number][];
  /** High-pass corner in Hz (12 dB/oct) */
  highpass: number;
}

const FADE_IN_SECONDS = 0.0015;
const FADE_OUT_SECONDS = 0.03;

function rng(seed: number) {
  let s = (seed * 2654435761) >>> 0 || 1;
  return () => {
    s ^= s << 13;
    s ^= s >>> 17;
    s ^= s << 5;
    return (s >>> 0) / 4294967296;
  };
}

const finite = (x: number, fallback: number) => (Number.isFinite(x) ? x : fallback);
const clamp01 = (x: number) => Math.min(1, Math.max(0, finite(x, 0.5)));

/** Render one plucked string to a Float32Array (mono). */
export function renderString(options: StringOptions): Float32Array {
  const rate = finite(options.sampleRate, 48000);
  const nyquist = rate / 2;
  const freq = Math.min(nyquist * 0.45, Math.max(20, finite(options.frequency, 220)));
  const decay = Math.min(12, Math.max(0.05, finite(options.decay, 1)));
  const bright = clamp01(options.brightness);
  const soft = clamp01(options.softness);
  const pick = Math.min(0.5, Math.max(0.02, finite(options.pickPosition, 0.13)));
  const rand = rng(Math.floor(finite(options.seed, 1)));

  // Loop low-pass H(z) = (1 - s) + s·z⁻¹: s = 0.5 is the classic averaging filter (dullest).
  const s = 0.5 - bright * 0.42;
  const w0 = (2 * Math.PI * freq) / rate;
  const re = 1 - s + s * Math.cos(w0);
  const im = -s * Math.sin(w0);
  const magnitude = Math.hypot(re, im);
  const filterDelay = -Math.atan2(im, re) / w0;

  // Per-period loss so the fundamental decays 60 dB in `decay` seconds
  const loss = Math.min(0.99999, Math.pow(0.001, 1 / (decay * freq)) / magnitude);

  // Integer delay plus a first-order all-pass for the fractional remainder (Δ in [0.1, 1.1))
  const period = rate / freq - filterDelay;
  const N = Math.max(2, Math.floor(period - 0.1));
  const delta = period - N;
  const apC = (1 - delta) / (1 + delta);

  // Excitation: one period of noise (or a smooth pulse), low-passed, with a pick-position comb.
  const excitation = new Float32Array(N);
  const cutoff = Math.min(nyquist * 0.9, freq * (2 + bright * 18) + 400 * bright);
  const a = 1 - Math.exp((-2 * Math.PI * cutoff) / rate);
  let lp = 0;
  for (let pass = 0; pass < 2; pass++) {
    // Two passes: the second starts from the settled filter state, so the period is seamless.
    for (let i = 0; i < N; i++) {
      const noise = rand() * 2 - 1;
      const pulse = Math.sin((Math.PI * i) / N) * 1.6;
      lp += a * (noise * (1 - soft) + pulse * soft - lp);
      if (pass === 1) excitation[i] = lp;
    }
  }
  const combDelay = Math.max(1, Math.round(pick * N));
  const shaped = new Float32Array(N);
  for (let i = 0; i < N; i++) shaped[i] = excitation[i] - excitation[(i - combDelay + N) % N];
  let mean = 0;
  let energy = 0;
  for (let i = 0; i < N; i++) mean += shaped[i];
  mean /= N;
  for (let i = 0; i < N; i++) {
    shaped[i] -= mean;
    energy += shaped[i] * shaped[i];
  }
  const norm = energy > 0 ? 1 / Math.sqrt(energy / N) : 0;
  for (let i = 0; i < N; i++) shaped[i] *= norm * 0.5;

  // Render until the string has decayed ~75 dB
  const seconds = Math.min(finite(options.maxSeconds ?? 8, 8), decay * 1.25 + 0.05);
  const length = Math.max(N * 2, Math.floor(seconds * rate));
  const out = new Float32Array(length);
  const line = shaped;
  let idx = 0;
  let prev = 0;
  let apIn = 0;
  let apOut = 0;
  for (let i = 0; i < length; i++) {
    const x = line[idx];
    out[i] = x;
    const filtered = (1 - s) * x + s * prev;
    prev = x;
    const y = apC * filtered + apIn - apC * apOut;
    apIn = filtered;
    apOut = y;
    line[idx] = y * loss;
    idx = idx + 1 === N ? 0 : idx + 1;
  }

  if (options.body) applyBody(out, rate, options.body);

  // Soft edges: no click at the onset and a clean tail
  const fadeIn = Math.min(length, Math.round(FADE_IN_SECONDS * rate));
  for (let i = 0; i < fadeIn; i++) out[i] *= 0.5 - 0.5 * Math.cos((Math.PI * i) / fadeIn);
  const fadeOut = Math.min(length, Math.round(FADE_OUT_SECONDS * rate));
  for (let i = 0; i < fadeOut; i++) out[length - 1 - i] *= i / fadeOut;
  return out;
}

/** RBJ-cookbook biquads run in place (transposed direct form II). */
function biquad(data: Float32Array, b0: number, b1: number, b2: number, a0: number, a1: number, a2: number) {
  const nb0 = b0 / a0;
  const nb1 = b1 / a0;
  const nb2 = b2 / a0;
  const na1 = a1 / a0;
  const na2 = a2 / a0;
  let z1 = 0;
  let z2 = 0;
  for (let i = 0; i < data.length; i++) {
    const x = data[i];
    const y = nb0 * x + z1;
    z1 = nb1 * x - na1 * y + z2;
    z2 = nb2 * x - na2 * y;
    data[i] = y;
  }
}

function applyBody(data: Float32Array, rate: number, body: BodyEq) {
  for (const [freq, q, db] of body.peaks) {
    if (Math.abs(db) < 0.05 || !(freq > 0 && freq < rate / 2)) continue;
    const A = Math.pow(10, db / 40);
    const w = (2 * Math.PI * freq) / rate;
    const alpha = Math.sin(w) / (2 * Math.max(0.1, q));
    const cos = Math.cos(w);
    biquad(data, 1 + alpha * A, -2 * cos, 1 - alpha * A, 1 + alpha / A, -2 * cos, 1 - alpha / A);
  }
  if (body.highpass > 0 && body.highpass < rate / 2) {
    const w = (2 * Math.PI * body.highpass) / rate;
    const alpha = Math.sin(w) / (2 * 0.7071);
    const cos = Math.cos(w);
    biquad(data, (1 + cos) / 2, -(1 + cos), (1 + cos) / 2, 1 + alpha, -2 * cos, 1 - alpha);
  }
}

interface CacheEntry {
  buffer: AudioBuffer;
  bytes: number;
}

const MAX_ENTRIES = 96;
const MAX_BYTES = 48 * 1024 * 1024;
const cache = new Map<string, CacheEntry>();
let cachedBytes = 0;

/** Quantise a 0..1 control so nearby settings share a cache entry. */
export const quantise = (x: number, steps = 20) => Math.round(clamp01(x) * steps) / steps;

/**
 * Cached plucked-string buffer (LRU, capped by entries and bytes). AudioBuffers
 * are not bound to a context, so one cache serves live playback and exports.
 */
export function stringBuffer(
  ctx: BaseAudioContext,
  note: number,
  options: Omit<StringOptions, 'sampleRate' | 'frequency'>,
): AudioBuffer {
  const rate = ctx.sampleRate;
  const decay = Math.round(Math.min(12, Math.max(0.05, finite(options.decay, 1))) * 20) / 20;
  const key = [
    rate,
    note,
    decay,
    quantise(options.brightness),
    quantise(options.pickPosition, 50),
    quantise(options.softness),
    options.seed,
    options.body
      ? options.body.peaks
          .flat()
          .map((x) => x.toFixed(1))
          .join(',') + `/${options.body.highpass}`
      : '',
  ].join('|');
  const hit = cache.get(key);
  if (hit) {
    cache.delete(key);
    cache.set(key, hit);
    return hit.buffer;
  }
  const data = renderString({
    ...options,
    decay,
    sampleRate: rate,
    frequency: 440 * Math.pow(2, (note - 69) / 12),
  });
  const buffer = ctx.createBuffer(1, data.length, rate);
  buffer.copyToChannel(data as Float32Array<ArrayBuffer>, 0);
  const entry = { buffer, bytes: data.length * 4 };
  cache.set(key, entry);
  cachedBytes += entry.bytes;
  while (cache.size > MAX_ENTRIES || (cachedBytes > MAX_BYTES && cache.size > 1)) {
    const oldest = cache.keys().next().value as string;
    cachedBytes -= cache.get(oldest)?.bytes ?? 0;
    cache.delete(oldest);
  }
  return buffer;
}

/** For tests: number of cached strings. */
export function stringCacheSize(): number {
  return cache.size;
}

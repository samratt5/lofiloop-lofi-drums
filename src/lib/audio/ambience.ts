/**
 * Procedural ambience beds (no samples): looping stereo buffers generated once
 * per audio context. Every generator is seeded so renders are repeatable.
 *
 * Loops are seamless by construction rather than by crossfading: filters are
 * run circularly (primed with the end of the buffer), slow modulations complete
 * whole cycles per loop, and one-shot events wrap around the loop point. Each
 * bed is normalised to the same integrated loudness (BS.1770), with a soft
 * ceiling so sparse textures like vinyl crackle don't spike.
 */
import { integratedLoudness } from '@/lib/export/loudness';
import type { AmbienceType } from '@/lib/project/types';

export type AmbienceKind = Exclude<AmbienceType, 'none'>;

export const AMBIENCE_LABELS: Record<AmbienceType, string> = {
  none: 'None',
  rain: 'Rain',
  cafe: 'Café',
  city: 'City',
  night: 'Night',
  room: 'Room tone',
  vinyl: 'Vinyl',
};

/** Loop lengths: long enough not to sound like a loop; vinyl is exactly 10 turns at 33⅓ rpm. */
const SECONDS: Record<AmbienceKind, number> = { rain: 16, cafe: 16, city: 24, night: 20, room: 12, vinyl: 18 };
const SEEDS: Record<AmbienceKind, number> = { rain: 11, cafe: 23, city: 37, night: 41, room: 53, vinyl: 67 };
/** Every bed lands here before the mixer's ambience level (≈ −31 LUFS in the mix at the default 0.4). */
const TARGET_LUFS = -19;
/** Soft ceiling: linear below 60 % of it, then a tanh knee up to it. */
const CEILING = 0.89;

const cache = new WeakMap<BaseAudioContext, Map<AmbienceKind, AudioBuffer>>();

type Rand = () => number;
type Stereo = [Float32Array, Float32Array];

function seeded(seed: number): Rand {
  let s = seed >>> 0 || 1;
  return () => {
    s ^= s << 13;
    s ^= s >>> 17;
    s ^= s << 5;
    return (s >>> 0) / 4294967296;
  };
}

const TAU = Math.PI * 2;
const between = (rand: Rand, lo: number, hi: number) => lo + (hi - lo) * rand();

/** Equal-power pan gains for p in [-1, 1]. */
function panGains(p: number): [number, number] {
  const a = ((Math.max(-1, Math.min(1, p)) + 1) * Math.PI) / 4;
  return [Math.cos(a), Math.sin(a)];
}

/** White noise; the generator is inlined (seeded from `rand`) because this is the hottest loop. */
function white(length: number, rand: Rand, amp = 1): Float32Array {
  const data = new Float32Array(length);
  let s = Math.floor(rand() * 4294967295) >>> 0 || 1;
  const scale = (2 * amp) / 4294967296;
  for (let i = 0; i < length; i++) {
    s ^= s << 13;
    s ^= s >>> 17;
    s ^= s << 5;
    data[i] = (s >>> 0) * scale - amp;
  }
  return data;
}

const SINE_SIZE = 4096;
const SINE = new Float32Array(SINE_SIZE + 1);
for (let i = 0; i <= SINE_SIZE; i++) SINE[i] = Math.sin((TAU * i) / SINE_SIZE);

/** Table sine of a phase in cycles (any sign), linearly interpolated. */
function sine(cycles: number): number {
  return lookup(SINE, cycles);
}

function lookup(table: Float32Array, cycles: number): number {
  const x = (cycles - Math.floor(cycles)) * SINE_SIZE;
  const i = x | 0;
  return table[i] + (table[i + 1] - table[i]) * (x - i);
}

/** One cycle of an engine's firing note: fundamental plus two harmonics. */
const ENGINE = new Float32Array(SINE_SIZE + 1);
for (let i = 0; i <= SINE_SIZE; i++) {
  const p = (TAU * i) / SINE_SIZE;
  ENGINE[i] = Math.sin(p) + 0.5 * Math.sin(2 * p + 0.7) + 0.3 * Math.sin(3 * p + 1.3);
}

/** Samples to prime a filter with so its state at the loop start matches the loop end. */
function warmup(length: number, rate: number, cutoff: number): number {
  return Math.min(length, Math.ceil((10 * rate) / (TAU * Math.max(1, cutoff))) + 64);
}

/** One-pole low-pass, in place and circular. */
function lowpass(data: Float32Array, cutoff: number, rate: number): Float32Array {
  const a = 1 - Math.exp((-TAU * cutoff) / rate);
  const n = data.length;
  let y = 0;
  for (let i = n - warmup(n, rate, cutoff); i < n; i++) y += a * (data[i] - y);
  for (let i = 0; i < n; i++) {
    y += a * (data[i] - y);
    data[i] = y;
  }
  return data;
}

/** One-pole high-pass, in place and circular. */
function highpass(data: Float32Array, cutoff: number, rate: number): Float32Array {
  const a = 1 - Math.exp((-TAU * cutoff) / rate);
  const n = data.length;
  let low = 0;
  for (let i = n - warmup(n, rate, cutoff); i < n; i++) low += a * (data[i] - low);
  for (let i = 0; i < n; i++) {
    low += a * (data[i] - low);
    data[i] -= low;
  }
  return data;
}

/** Constant-peak band-pass biquad (RBJ), in place and circular. */
function bandpass(data: Float32Array, centre: number, q: number, rate: number): Float32Array {
  const w = (TAU * Math.min(centre, rate * 0.45)) / rate;
  const alpha = Math.sin(w) / (2 * q);
  const a0 = 1 + alpha;
  const b0 = alpha / a0;
  const a1 = (-2 * Math.cos(w)) / a0;
  const a2 = (1 - alpha) / a0;
  const n = data.length;
  let x1 = 0;
  let x2 = 0;
  let y1 = 0;
  let y2 = 0;
  const warm = warmup(n, rate, centre / q);
  for (let pass = 0; pass < 2; pass++) {
    const from = pass === 0 ? n - warm : 0;
    for (let i = from; i < n; i++) {
      const x = data[i];
      const y = b0 * x - b0 * x2 - a1 * y1 - a2 * y2;
      x2 = x1;
      x1 = x;
      y2 = y1;
      y1 = y;
      if (pass === 1) data[i] = y;
    }
  }
  return data;
}

/** Pink noise (Paul Kellet's economy filter), circular. */
function pink(length: number, rand: Rand): Float32Array {
  const w = white(length, rand);
  const out = new Float32Array(length);
  let b0 = 0;
  let b1 = 0;
  let b2 = 0;
  const warm = Math.min(length, 8192);
  for (let pass = 0; pass < 2; pass++) {
    for (let i = pass === 0 ? length - warm : 0; i < length; i++) {
      const x = w[i];
      b0 = 0.99765 * b0 + x * 0.099046;
      b1 = 0.963 * b1 + x * 0.2965164;
      b2 = 0.57 * b2 + x * 1.0526913;
      if (pass === 1) out[i] = (b0 + b1 + b2 + x * 0.1848) * 0.2;
    }
  }
  return out;
}

/**
 * Smooth random curve in [-1, 1] that repeats every loop: a few sinusoids with
 * whole-cycle periods, evaluated at control rate and interpolated.
 */
function drift(length: number, rand: Rand, maxCycles: number, partials = 4): Float32Array {
  const step = 64;
  const points = Math.ceil(length / step) + 1;
  const control = new Float32Array(points);
  let norm = 0;
  for (let p = 0; p < partials; p++) {
    const cycles = 1 + Math.floor(rand() * maxCycles);
    const amp = 0.4 + rand() * 0.6;
    const phase = rand() * TAU;
    norm += amp;
    for (let j = 0; j < points; j++) control[j] += amp * Math.sin((TAU * cycles * j * step) / length + phase);
  }
  const out = new Float32Array(length);
  for (let j = 0; j * step < length; j++) {
    const a = control[j] / norm;
    const slope = (control[j + 1] / norm - a) / step;
    const end = Math.min(length, (j + 1) * step);
    for (let i = j * step, k = 0; i < end; i++, k++) out[i] = a + slope * k;
  }
  return out;
}

/** Add `source` into both channels at `at` (wrapping at the loop point), panned. */
function place(target: Stereo, source: Float32Array, at: number, pan: number, amp: number) {
  const [gl, gr] = panGains(pan);
  const [l, r] = target;
  const n = l.length;
  let idx = ((Math.floor(at) % n) + n) % n;
  for (let j = 0; j < source.length; j++) {
    const x = source[j] * amp;
    l[idx] += x * gl;
    r[idx] += x * gr;
    idx = idx + 1 === n ? 0 : idx + 1;
  }
}

/** Sum of exponentially decaying sine partials: [frequency, amplitude, decay seconds]. */
function modal(rate: number, partials: [number, number, number][], seconds: number, chirp = 0): Float32Array {
  const n = Math.floor(seconds * rate);
  const out = new Float32Array(n);
  for (const [freq, amp, decay] of partials) {
    if (freq >= rate / 2) continue;
    const k = Math.exp(-1 / (decay * rate));
    const length = Math.min(n, Math.ceil(decay * rate * 9));
    let env = amp;
    let phase = 0;
    for (let i = 0; i < length; i++) {
      phase += (freq * (1 + chirp * (i / rate))) / rate;
      out[i] += sine(phase) * env;
      env *= k;
    }
  }
  // 1 ms fade-in keeps strikes from clicking
  const fade = Math.min(n, Math.round(rate * 0.001));
  for (let i = 0; i < fade; i++) out[i] *= i / fade;
  return out;
}

function mixInto(target: Float32Array, source: Float32Array, amp: number, mod?: Float32Array, depth = 0) {
  if (mod) for (let i = 0; i < target.length; i++) target[i] += source[i] * amp * (1 - depth + depth * mod[i]);
  else for (let i = 0; i < target.length; i++) target[i] += source[i] * amp;
}

/** Wide stereo bed: independent noise per side with a shared centre component. */
function stereoBed(make: () => Float32Array, width = 0.8): Stereo {
  const l = make();
  const r = make();
  if (width >= 0.999) return [l, r];
  const centre = make();
  const side = width;
  const mid = Math.sqrt(Math.max(0, 1 - width * width));
  for (let i = 0; i < l.length; i++) {
    l[i] = l[i] * side + centre[i] * mid;
    r[i] = r[i] * side + centre[i] * mid;
  }
  return [l, r];
}

// --- scenes ---

function rain(length: number, rate: number, rand: Rand): Stereo {
  const out: Stereo = [new Float32Array(length), new Float32Array(length)];
  const gust = drift(length, rand, 3);
  const swell = new Float32Array(length);
  for (let i = 0; i < length; i++) swell[i] = 0.5 + 0.5 * gust[i];

  // Distant wash of countless drops
  const wash = stereoBed(() => lowpass(highpass(pink(length, rand), 300, rate), 6500, rate), 0.9);
  mixInto(out[0], wash[0], 0.55, swell, 0.3);
  mixInto(out[1], wash[1], 0.55, swell, 0.3);

  // Roof and window patter: dense tiny impacts through two surface resonances
  for (let ch = 0; ch < 2; ch++) {
    const hits = new Float32Array(length);
    const count = Math.floor((length / rate) * 900);
    for (let k = 0; k < count; k++) {
      const at = Math.floor(rand() * length);
      const a = Math.pow(rand(), 3) * (rand() < 0.5 ? -1 : 1);
      hits[at] += a * (0.7 + 0.3 * swell[at]);
    }
    const window = bandpass(new Float32Array(hits), 3200 + ch * 300, 0.9, rate);
    const roof = bandpass(hits, 850 - ch * 60, 2.5, rate);
    mixInto(out[ch], window, 2.5);
    mixInto(out[ch], roof, 3.2);
  }

  // Close droplets: bubble "plinks" whose pitch rises as they ring
  const drops = Math.floor((length / rate) * 7);
  for (let d = 0; d < drops; d++) {
    const f = between(rand, 1500, 4200);
    const plink = modal(rate, [[f, 1, between(rand, 0.004, 0.012)]], 0.06, between(rand, 4, 12));
    place(out, plink, rand() * length, between(rand, -0.9, 0.9), 0.1 + Math.pow(rand(), 2) * 0.32);
  }

  // A gutter dripping steadily off to one side
  const period = rate * between(rand, 0.95, 1.3);
  for (let at = rand() * period; at < length; at += period * between(rand, 0.85, 1.15)) {
    const f = between(rand, 1100, 1300);
    const drip = modal(
      rate,
      [
        [f, 1, 0.035],
        [f * 2.3, 0.3, 0.012],
      ],
      0.18,
      1.5,
    );
    place(out, drip, at, 0.6, 0.17);
  }

  // Heavy rain on the building: low rumble
  const rumble = lowpass(lowpass(white(length, rand), 140, rate), 140, rate);
  mixInto(out[0], rumble, 1.1, swell, 0.4);
  mixInto(out[1], rumble, 1.1, swell, 0.4);
  return out;
}

/** Vowel formant targets (F1, F2) for the babble talkers. */
const BABBLE_VOWELS: [number, number][] = [
  [730, 1090],
  [530, 1840],
  [270, 2290],
  [300, 870],
  [570, 840],
  [660, 1720],
  [490, 1350],
];

/** One talker at a reduced sample rate: phrases of syllables with pitch and formant movement. */
function talker(length: number, rate: number, rand: Rand): Float32Array {
  const amp = new Float32Array(length);
  const pitch = new Float32Array(length);
  const f1 = new Float32Array(length);
  const f2 = new Float32Array(length);
  const hiss = new Float32Array(length);
  const base = rand() < 0.5 ? between(rand, 95, 130) : between(rand, 180, 235);
  pitch.fill(base);
  f1.fill(500);
  f2.fill(1500);

  // The timeline wraps around the loop; synthesis starts inside a pause (at t0), so it is continuous at the seam.
  const t0 = Math.floor(rand() * length);
  let t = t0 + Math.floor(rate * between(rand, 0.1, 1.2));
  const stop = t0 + length - Math.floor(rate * 0.45);
  while (t < stop - rate * 0.3) {
    const phraseEnd = Math.min(stop, t + Math.floor(rate * between(rand, 0.8, 3.2)));
    let s = t;
    let syllable = 0;
    while (s < phraseEnd) {
      const dur = Math.floor(rate * between(rand, 0.11, 0.26));
      if (s + dur >= phraseEnd) break;
      const stressed = rand() < 0.3;
      const level = between(rand, 0.45, 0.9) * (stressed ? 1.25 : 1);
      const [v1, v2] = BABBLE_VOWELS[Math.floor(rand() * BABBLE_VOWELS.length)];
      // Declination across the phrase plus pitch accents on stressed syllables
      const f0 = base * (1.08 - 0.12 * ((s - t) / Math.max(1, phraseEnd - t))) * (stressed ? 1.12 : 1);
      let at = s % length;
      for (let i = 0; i < dur; i++) {
        const bump = sine(i / dur / 2);
        amp[at] = level * bump;
        pitch[at] = f0 * (1 + 0.04 * bump);
        f1[at] = v1;
        f2[at] = v2;
        at = at + 1 === length ? 0 : at + 1;
      }
      // Consonant hiss at some onsets
      if (rand() < 0.45) {
        const len = Math.floor(rate * between(rand, 0.02, 0.06));
        for (let i = 0; i < len; i++) hiss[(s + i) % length] = 0.35 * Math.sin((Math.PI * i) / len);
      }
      s += dur + Math.floor(rate * between(rand, 0, 0.05));
      syllable++;
    }
    t = phraseEnd + Math.floor(rate * between(rand, 0.35, 1.8));
    if (syllable === 0) t += Math.floor(rate * 0.2);
  }
  // Glide formants and pitch between syllables
  lowpass(f1, 18, rate);
  lowpass(f2, 18, rate);
  lowpass(pitch, 12, rate);

  const out = new Float32Array(length);
  let seed = Math.floor(rand() * 4294967295) >>> 0 || 1;
  let phase = 0;
  let a1 = 0;
  let a2 = 0;
  let c1 = 0;
  let c2 = 0;
  let g1 = 0;
  let g2 = 0;
  let y11 = 0;
  let y12 = 0;
  let y21 = 0;
  let y22 = 0;
  let i = t0 - 1;
  for (let k = 0; k < length; k++) {
    i = i + 1 === length ? 0 : i + 1;
    if ((k & 31) === 0) {
      // Two-pole resonators with unity peak gain, coefficients refreshed every 32 samples
      const r1 = Math.exp((-Math.PI * 90) / rate);
      const r2 = Math.exp((-Math.PI * 120) / rate);
      const w1 = (TAU * f1[i]) / rate;
      const w2 = (TAU * Math.min(f2[i], rate * 0.45)) / rate;
      a1 = 2 * r1 * Math.cos(w1);
      a2 = -r1 * r1;
      c1 = 2 * r2 * Math.cos(w2);
      c2 = -r2 * r2;
      g1 = (1 - r1) * Math.sqrt(1 - 2 * r1 * Math.cos(2 * w1) + r1 * r1);
      g2 = (1 - r2) * Math.sqrt(1 - 2 * r2 * Math.cos(2 * w2) + r2 * r2);
    }
    const envelope = amp[i];
    if (envelope < 1e-4 && hiss[i] === 0 && Math.abs(y11) + Math.abs(y21) < 1e-5) {
      out[i] = 0;
      continue;
    }
    phase += pitch[i] / rate;
    if (phase >= 1) phase -= 1;
    seed ^= seed << 13;
    seed ^= seed >>> 17;
    seed ^= seed << 5;
    const noise = (seed >>> 0) / 2147483648 - 1;
    const source = (phase * 2 - 1) * 0.8 + noise * 0.25;
    const x = source * envelope;
    const y1 = x * g1 + a1 * y11 + a2 * y12;
    y12 = y11;
    y11 = y1;
    const y2 = x * g2 + c1 * y21 + c2 * y22;
    y22 = y21;
    y21 = y2;
    out[i] = y1 + y2 * 0.8 + noise * hiss[i] * 0.3;
  }
  return out;
}

/** Schroeder reverb (four combs, two all-passes), primed with the loop's end so the tail wraps around. */
function roomVerb(data: Float32Array, rate: number, offset: number, feedback: number): Float32Array {
  const prime = Math.min(data.length, Math.floor(rate * 1.2));
  const combs = [0.0297, 0.0371, 0.0411, 0.0437].map((s) => Math.floor(s * rate) + offset);
  const allpasses = [0.005, 0.0017].map((s) => Math.floor(s * rate) + offset);
  const n = data.length;
  const wet = new Float32Array(n);
  const lines = combs.map((d) => new Float32Array(d));
  const idx = combs.map(() => 0);
  const lowState = combs.map(() => 0);
  for (let pass = 0; pass < 2; pass++) {
    for (let i = pass === 0 ? n - prime : 0; i < n; i++) {
      let sum = 0;
      for (let c = 0; c < combs.length; c++) {
        const line = lines[c];
        const y = line[idx[c]];
        lowState[c] += 0.55 * (y - lowState[c]);
        line[idx[c]] = data[i] + lowState[c] * feedback;
        idx[c] = idx[c] + 1 === line.length ? 0 : idx[c] + 1;
        sum += y;
      }
      if (pass === 1) wet[i] = sum * 0.25;
    }
  }
  for (const d of allpasses) {
    const line = new Float32Array(d);
    let j = 0;
    for (let pass = 0; pass < 2; pass++) {
      for (let i = pass === 0 ? n - prime : 0; i < n; i++) {
        const delayed = line[j];
        const x = wet[i];
        const y = -0.5 * x + delayed;
        line[j] = x + 0.5 * y;
        j = j + 1 === d ? 0 : j + 1;
        if (pass === 1) wet[i] = y;
      }
    }
  }
  return wet;
}

/** Linear-interpolating 4× upsampler (circular); a gentle low-pass tames the images. */
function upsample4(low: Float32Array, length: number, rate: number): Float32Array {
  const out = new Float32Array(length);
  const n = low.length;
  for (let j = 0; j < n; j++) {
    const a = low[j];
    const step = ((j + 1 === n ? low[0] : low[j + 1]) - a) / 4;
    const i = j * 4;
    out[i] = a;
    out[i + 1] = a + step;
    out[i + 2] = a + 2 * step;
    out[i + 3] = a + 3 * step;
  }
  return lowpass(out, 4200, rate);
}

function cafe(length: number, rate: number, rand: Rand): Stereo {
  const out: Stereo = [new Float32Array(length), new Float32Array(length)];

  // Murmur: six talkers at a quarter of the sample rate, spread out and reverberant
  const lowRate = rate / 4;
  const lowLength = length / 4;
  const babble: Stereo = [new Float32Array(lowLength), new Float32Array(lowLength)];
  for (let k = 0; k < 6; k++) {
    const voice = talker(lowLength, lowRate, rand);
    const distance = between(rand, 0.35, 1);
    // Distance: less bottom and less top the further away
    highpass(lowpass(voice, 2200 + distance * 2500, lowRate), 260 - distance * 100, lowRate);
    place(babble, voice, 0, between(rand, -0.8, 0.8), distance);
  }
  for (let ch = 0; ch < 2; ch++) {
    const verb = roomVerb(babble[ch], lowRate, ch * 23, 0.72);
    const dry = babble[ch];
    for (let i = 0; i < lowLength; i++) dry[i] = dry[i] * 0.85 + verb[i] * 0.6;
    mixInto(out[ch], upsample4(dry, length, rate), 2.4);
  }

  // Room air and the hum of the place
  const air = stereoBed(() => lowpass(highpass(pink(length, rand), 120, rate), 2500, rate), 1);
  mixInto(out[0], air[0], 0.12);
  mixInto(out[1], air[1], 0.12);

  // Cups and spoons: ceramic modes, sometimes a quick run of stirring taps
  const clinks = Math.floor((length / rate) * 0.55);
  for (let c = 0; c < clinks; c++) {
    const f = between(rand, 1900, 3300);
    const at = rand() * length;
    const pan = between(rand, -0.85, 0.85);
    const level = between(rand, 0.04, 0.15);
    const taps = rand() < 0.3 ? 2 + Math.floor(rand() * 3) : 1;
    for (let t = 0; t < taps; t++) {
      const cup = modal(
        rate,
        [
          [f, 1, between(rand, 0.08, 0.2)],
          [f * 2.32, 0.5, 0.06],
          [f * 4.25, 0.25, 0.03],
        ],
        0.35,
      );
      place(out, cup, at + t * rate * between(rand, 0.07, 0.11), pan, level * (1 - t * 0.2));
    }
  }

  // Plates and cups set down on wood
  for (let c = 0; c < 2; c++) {
    const f = between(rand, 380, 750);
    const clunk = modal(
      rate,
      [
        [f, 1, 0.04],
        [f * 2.7, 0.4, 0.02],
        [f * 5.1, 0.2, 0.01],
      ],
      0.15,
    );
    place(out, clunk, rand() * length, between(rand, -0.7, 0.7), 0.15);
  }

  // A chair scraping now and then: stick-slip friction through a moving resonance
  for (let c = 0; c < 2; c++) {
    const dur = Math.floor(rate * between(rand, 0.25, 0.55));
    const scrape = white(dur, rand);
    let chatter = 0;
    for (let i = 0; i < dur; i++) {
      chatter += (rand() < 45 / rate ? 1 : 0) - chatter * 0.004;
      const x = i / dur;
      scrape[i] *= Math.sin(Math.PI * x) * (0.4 + Math.min(1, chatter));
    }
    bandpass(scrape, between(rand, 280, 520), 4, rate);
    place(out, scrape, rand() * length, between(rand, -0.8, 0.8), 1.4);
  }
  return out;
}

/** A vehicle passing by: tyre roar plus a Doppler-shifted engine, panning across. */
function passingCar(out: Stereo, length: number, rate: number, rand: Rand) {
  const centre = rand() * length;
  const speed = between(rand, 9, 16); // m/s
  const closest = between(rand, 6, 30); // m
  const direction = rand() < 0.5 ? -1 : 1;
  const span = Math.floor(rate * Math.min(10, (2 * 45) / speed));
  const start = Math.floor(centre - span / 2);
  const tyres = lowpass(highpass(white(span, rand), 350, rate), 1600 - closest * 15, rate);
  const engine = between(rand, 28, 45);
  let phase = 0;
  const level = 6 / closest;
  const car = new Float32Array(span);
  const panCurve = new Float32Array(span);
  for (let i = 0; i < span; i++) {
    const t = (i - span / 2) / rate;
    const x = speed * t;
    const distance = Math.sqrt(x * x + closest * closest);
    // Radial velocity for the Doppler shift (343 m/s speed of sound)
    const radial = (speed * x) / distance;
    phase += (engine * (343 / (343 + radial))) / rate;
    const rumble = lookup(ENGINE, phase);
    // Level falls with distance (1/r); the closest approach is at `level`
    const gainAt = (level * closest) / distance;
    car[i] = (tyres[i] * 1.6 + rumble * 0.12) * gainAt;
    panCurve[i] = (direction * x) / distance;
  }
  const fade = Math.floor(rate * 0.5);
  for (let i = 0; i < fade; i++) {
    car[i] *= i / fade;
    car[span - 1 - i] *= i / fade;
  }
  const [l, r] = out;
  let gl = 0;
  let gr = 0;
  for (let i = 0; i < span; i++) {
    const idx = (((start + i) % length) + length) % length;
    if ((i & 63) === 0) [gl, gr] = panGains(panCurve[i] * 0.85);
    l[idx] += car[i] * gl;
    r[idx] += car[i] * gr;
  }
}

function city(length: number, rate: number, rand: Rand): Stereo {
  const out: Stereo = [new Float32Array(length), new Float32Array(length)];
  const hum = drift(length, rand, 4);

  // Distant traffic: low rumble and a band of far-off tyre noise
  // (Low end is effectively mono outdoors, so one rumble serves both sides.)
  const rumble = lowpass(lowpass(white(length, rand), 110, rate), 110, rate);
  const far = stereoBed(() => lowpass(highpass(pink(length, rand), 250, rate), 1300, rate), 1);
  const mod = new Float32Array(length);
  for (let i = 0; i < length; i++) mod[i] = 0.5 + 0.5 * hum[i];
  for (let ch = 0; ch < 2; ch++) {
    mixInto(out[ch], rumble, 1.9, mod, 0.3);
    mixInto(out[ch], far[ch], 0.4, mod, 0.4);
  }

  for (let c = 0; c < 5; c++) passingCar(out, length, rate, rand);

  // One distant siren, filtered by distance and faded in and out
  const sirenLength = Math.floor(rate * 7);
  const siren = new Float32Array(sirenLength);
  let phase = 0;
  for (let i = 0; i < sirenLength; i++) {
    const t = i / rate;
    const f = 950 + 380 * sine(t / 3.2 - 0.25);
    phase += f / rate;
    const env = sine(i / sirenLength / 2) ** 2;
    siren[i] = (sine(phase) + 0.25 * sine(2 * phase)) * env;
  }
  lowpass(lowpass(siren, 1800, rate), 1800, rate);
  place(out, siren, rand() * length, between(rand, -0.6, 0.6), 0.04);

  // A short horn and a couple of sparrows
  const horn = modal(
    rate,
    [
      [415, 1, 0.5],
      [523, 0.8, 0.5],
      [830, 0.3, 0.3],
    ],
    0.35,
  );
  for (let i = 0; i < horn.length; i++) horn[i] *= Math.min(1, (horn.length - i) / (rate * 0.05));
  place(out, lowpass(horn, 1500, rate), rand() * length, between(rand, -0.8, 0.8), 0.036);
  for (let b = 0; b < 3; b++) {
    const at = rand() * length;
    const pan = between(rand, -0.9, 0.9);
    for (let k = 0; k < 2 + Math.floor(rand() * 3); k++) {
      const f = between(rand, 3800, 5200);
      const chirp = modal(rate, [[f, 1, 0.025]], 0.07, -3);
      place(out, chirp, at + k * rate * between(rand, 0.09, 0.14), pan, 0.024);
    }
  }
  return out;
}

/** A field cricket: chirps of 3–4 pulses around 4.5 kHz. */
function cricket(out: Stereo, length: number, rate: number, rand: Rand, level: number, pan: number, bright: number) {
  const carrier = between(rand, 4200, 5100);
  const period = between(rand, 0.45, 0.85);
  const pulses = 3 + Math.floor(rand() * 2);
  const pulseLength = Math.floor(rate * between(rand, 0.012, 0.018));
  const gap = between(rand, 0.03, 0.04);
  const pulse = new Float32Array(pulseLength);
  let phase = 0;
  for (let i = 0; i < pulseLength; i++) {
    const x = i / pulseLength;
    phase += (carrier * (1 - 0.02 * x)) / rate;
    pulse[i] = sine(phase) * sine(x / 2) ** 1.5;
  }
  if (bright < 1) lowpass(pulse, 3000 + bright * 6000, rate);
  for (let t = rand() * period * rate; t < length; t += period * rate * between(rand, 0.94, 1.06)) {
    const chirpLevel = level * between(rand, 0.8, 1);
    for (let p = 0; p < pulses; p++) place(out, pulse, t + p * gap * rate, pan, chirpLevel * (p === 0 ? 0.8 : 1));
  }
}

function night(length: number, rate: number, rand: Rand): Stereo {
  const out: Stereo = [new Float32Array(length), new Float32Array(length)];
  const gust = drift(length, rand, 3, 5);
  const strength = new Float32Array(length);
  for (let i = 0; i < length; i++) strength[i] = 0.3 + 0.7 * (0.5 + 0.5 * gust[i]) ** 1.5;

  // Soft wind with a faint moving whistle
  const wind = stereoBed(() => highpass(lowpass(lowpass(pink(length, rand), 520, rate), 900, rate), 70, rate), 1);
  for (let ch = 0; ch < 2; ch++) mixInto(out[ch], wind[ch], 0.62, strength, 1);
  const whistle = bandpass(white(length, rand), 640, 9, rate);
  for (let i = 0; i < length; i++) {
    const s = strength[i];
    const x = whistle[i] * 0.14 * s * s;
    out[0][i] += x * 0.7;
    out[1][i] += x;
  }

  // Leaves rustling as gusts pick up
  const flutter = lowpass(white(length, rand), 8, rate);
  for (let ch = 0; ch < 2; ch++) {
    const leaves = highpass(lowpass(white(length, rand), 7000, rate), 2200, rate);
    for (let i = 0; i < length; i++) {
      const s = Math.max(0, strength[i] - 0.55);
      out[ch][i] += leaves[i] * s * s * (1 + flutter[i] * 20) * 0.28;
    }
  }

  // Three crickets nearby, a few further out
  cricket(out, length, rate, rand, 0.18, -0.55, 1);
  cricket(out, length, rate, rand, 0.13, 0.65, 0.9);
  cricket(out, length, rate, rand, 0.09, 0.1, 0.8);
  for (let c = 0; c < 5; c++) cricket(out, length, rate, rand, 0.024, between(rand, -1, 1), 0.4);

  // A distant tree cricket's trill, slowly waxing and waning
  const trill = new Float32Array(length);
  const swell = drift(length, rand, 2, 2);
  for (let i = 0; i < length; i++) {
    const gate = 0.5 + 0.5 * sine((45 * i) / rate);
    trill[i] = sine((2900 * i) / rate) * gate * gate * (0.5 + 0.5 * swell[i]);
  }
  place(out, trill, 0, 0.3, 0.02);
  return out;
}

function room(length: number, rate: number, rand: Rand): Stereo {
  const out: Stereo = [new Float32Array(length), new Float32Array(length)];
  const air = stereoBed(() => lowpass(highpass(pink(length, rand), 40, rate), 1800, rate), 0.7);
  const hvac = stereoBed(() => bandpass(white(length, rand), 240, 0.9, rate), 0.5);
  const breathe = drift(length, rand, 3);
  const mod = new Float32Array(length);
  for (let i = 0; i < length; i++) mod[i] = 0.5 + 0.5 * breathe[i];
  for (let ch = 0; ch < 2; ch++) {
    mixInto(out[ch], air[ch], 1, mod, 0.15);
    mixInto(out[ch], hvac[ch], 0.12, mod, 0.3);
  }
  // Mains hum with a couple of harmonics (whole cycles per loop, so it wraps cleanly)
  for (let i = 0; i < length; i++) {
    const t = i / rate;
    const h = sine(60 * t) * 0.012 + sine(120 * t + 0.08) * 0.006 + sine(180 * t + 0.18) * 0.004;
    out[0][i] += h;
    out[1][i] += h;
  }
  return out;
}

function vinyl(length: number, rate: number, rand: Rand): Stereo {
  const out: Stereo = [new Float32Array(length), new Float32Array(length)];
  const turn = rate * 1.8;

  // Surface hiss, breathing slightly with each rotation (warp)
  const hiss = stereoBed(() => lowpass(highpass(white(length, rand), 1800, rate), 9000, rate), 0.5);
  const warp = new Float32Array(length);
  for (let i = 0; i < length; i++) warp[i] = 0.5 + 0.5 * sine(i / turn);
  for (let ch = 0; ch < 2; ch++) mixInto(out[ch], hiss[ch], 0.1, warp, 0.25);

  // Crackle: many faint ticks and a few pops, usually louder on one groove wall
  const ticks: Stereo = [new Float32Array(length), new Float32Array(length)];
  const count = Math.floor((length / rate) * 28);
  for (let t = 0; t < count; t++) {
    const at = Math.floor(rand() * length);
    const a = Math.pow(rand(), 2.5) * 0.9 * (rand() < 0.5 ? -1 : 1);
    const pan = between(rand, -1, 1);
    const [gl, gr] = panGains(pan);
    ticks[0][at] += a * gl;
    ticks[1][at] += a * gr;
  }
  for (let ch = 0; ch < 2; ch++) {
    highpass(ticks[ch], 600, rate);
    mixInto(out[ch], lowpass(ticks[ch], 7000, rate), 1);
  }
  const pops = Math.floor((length / rate) * 0.8);
  for (let p = 0; p < pops; p++) {
    const pop = modal(rate, [[between(rand, 120, 260), 1, 0.004]], 0.02);
    place(out, pop, rand() * length, between(rand, -0.5, 0.5), between(rand, 0.1, 0.3));
  }

  // A scratch that comes round every revolution
  const scratch = highpass(lowpass(white(Math.floor(rate * 0.004), rand), 5000, rate), 400, rate);
  const spot = rand() * turn;
  for (let at = spot; at < length; at += turn) place(out, scratch, at, -0.3, 0.35);

  // Tonearm rumble
  const rumble = lowpass(lowpass(white(length, rand), 45, rate), 45, rate);
  mixInto(out[0], rumble, 0.8);
  mixInto(out[1], rumble, 0.8);
  return out;
}

const GENERATORS: Record<AmbienceKind, (length: number, rate: number, rand: Rand) => Stereo> = {
  rain,
  cafe,
  city,
  night,
  room,
  vinyl,
};

/** Generate a bed's raw channels (exported for tests; `ambienceBuffer` is the cached entry point). */
export function generateAmbience(kind: AmbienceKind, rate: number): Stereo {
  const length = Math.round((SECONDS[kind] * rate) / 4) * 4;
  const channels = GENERATORS[kind](length, rate, seeded(SEEDS[kind] * 7919));
  // Loudness-normalise (K-weighting ignores DC, so measure first), remove DC and round off
  // any peaks above the ceiling, which barely moves the loudness.
  const lufs = integratedLoudness({ sampleRate: rate, channels });
  const g = Number.isFinite(lufs) ? Math.pow(10, (TARGET_LUFS - lufs) / 20) : 1;
  const knee = CEILING * 0.6;
  const range = CEILING - knee;
  for (const ch of channels) {
    let mean = 0;
    for (let i = 0; i < ch.length; i++) mean += ch[i];
    mean /= ch.length;
    for (let i = 0; i < ch.length; i++) {
      const x = (ch[i] - mean) * g;
      const a = Math.abs(x);
      ch[i] = a > knee ? Math.sign(x) * (knee + range * Math.tanh((a - knee) / range)) : x;
    }
  }
  return channels;
}

/** Stereo looping bed for an ambience type, normalised to a consistent perceived level. */
export function ambienceBuffer(ctx: BaseAudioContext, type: AmbienceKind): AudioBuffer {
  let byType = cache.get(ctx);
  if (!byType) {
    byType = new Map();
    cache.set(ctx, byType);
  }
  const cached = byType.get(type);
  if (cached) return cached;

  const rate = ctx.sampleRate;
  const channels = generateAmbience(type, rate);
  const buffer = ctx.createBuffer(2, channels[0].length, rate);
  channels.forEach((data, ch) => buffer.copyToChannel(data as Float32Array<ArrayBuffer>, ch));
  byType.set(type, buffer);
  return buffer;
}

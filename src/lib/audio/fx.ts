import type { DelayDivision } from '@/lib/project/types';

const DIVISION_BEATS: Record<DelayDivision, number> = {
  '1/4': 1,
  '1/8d': 0.75,
  '1/8': 0.5,
  '1/8t': 1 / 3,
  '1/16': 0.25,
};

export function delaySeconds(division: DelayDivision, bpm: number): number {
  return (60 / bpm) * DIVISION_BEATS[division];
}

/** Tape tone knob (0..1) to low-pass cutoff in Hz. */
export function toneFrequency(tone: number): number {
  return 2000 * Math.pow(10, Math.min(1, Math.max(0, tone)));
}

export function reverbSeconds(size: number): number {
  return 0.6 + size * 4.4;
}

/** Stereo decaying-noise impulse response that darkens over time like a real room. */
export function impulseResponse(ctx: BaseAudioContext, size: number): AudioBuffer {
  const seconds = reverbSeconds(size);
  const rate = ctx.sampleRate;
  const length = Math.floor(rate * seconds);
  const preDelay = Math.floor(rate * (0.005 + size * 0.02));
  const buffer = ctx.createBuffer(2, length, rate);
  for (let ch = 0; ch < 2; ch++) {
    const data = buffer.getChannelData(ch);
    let y = 0;
    let seed = ch === 0 ? 0x1234567 : 0x7654321;
    for (let i = 0; i < length; i++) {
      seed ^= seed << 13;
      seed ^= seed >>> 17;
      seed ^= seed << 5;
      const noise = ((seed >>> 0) / 4294967296) * 2 - 1;
      const t = i / length;
      const damping = 0.85 - t * 0.7;
      y += damping * (noise - y);
      const fadeIn = Math.min(1, Math.max(0, (i - preDelay) / (rate * 0.004)));
      data[i] = y * Math.pow(1 - t, 2.4) * fadeIn;
    }
  }
  return buffer;
}

const crackleCache = new WeakMap<BaseAudioContext, AudioBuffer>();

/** Looping vinyl surface noise: soft hiss, dust ticks and the occasional pop. */
export function crackleBuffer(ctx: BaseAudioContext): AudioBuffer {
  const cached = crackleCache.get(ctx);
  if (cached) return cached;
  const rate = ctx.sampleRate;
  const length = rate * 6;
  const buffer = ctx.createBuffer(2, length, rate);
  let seed = 0xc0ffee;
  const rand = () => {
    seed ^= seed << 13;
    seed ^= seed >>> 17;
    seed ^= seed << 5;
    return (seed >>> 0) / 4294967296;
  };
  const left = buffer.getChannelData(0);
  const right = buffer.getChannelData(1);
  let brown = 0;
  for (let i = 0; i < length; i++) {
    brown = (brown + (rand() * 2 - 1) * 0.02) * 0.995;
    const hiss = brown * 0.25;
    left[i] = hiss;
    right[i] = hiss * 0.9;
  }
  const addClick = (at: number, amp: number, width: number) => {
    const polarity = rand() < 0.5 ? -1 : 1;
    const spread = 0.6 + rand() * 0.4;
    for (let j = 0; j < width && at + j < length; j++) {
      const decay = Math.exp(-j / (width / 4));
      const value = polarity * amp * decay * (j % 2 === 0 ? 1 : -0.6);
      left[at + j] += value;
      right[at + j] += value * spread;
    }
  };
  const ticks = Math.floor(6 * 28);
  for (let i = 0; i < ticks; i++)
    addClick(Math.floor(rand() * length), 0.05 + rand() * 0.2, 6 + Math.floor(rand() * 10));
  const pops = 7;
  for (let i = 0; i < pops; i++)
    addClick(Math.floor(rand() * length), 0.4 + rand() * 0.4, 30 + Math.floor(rand() * 40));
  crackleCache.set(ctx, buffer);
  return buffer;
}

/** Soft clipper: linear below `knee`, then a tanh shoulder that never exceeds `ceiling`. */
/** Ceiling sits below full scale: the 4× oversampling filter rings a little past it. */
export function safetyCurve(knee = 0.82, ceiling = 0.94): Float32Array<ArrayBuffer> {
  const n = 4096;
  const curve = new Float32Array(n);
  const range = ceiling - knee;
  for (let i = 0; i < n; i++) {
    const x = (i / (n - 1)) * 4 - 2;
    const a = Math.abs(x);
    const y = a <= knee ? a : knee + range * Math.tanh((a - knee) / range);
    curve[i] = Math.sign(x) * y;
  }
  return curve;
}

/** Perceptual fader law: 0.8 ≈ unity, 1.0 ≈ +2 dB. */
export function faderGain(value: number): number {
  return value * value * 1.25;
}

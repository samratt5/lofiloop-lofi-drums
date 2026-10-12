import { INSTRUMENTS, type InstrumentId } from '@/lib/project/instruments';
import { drumVariants } from '../drumkit';
import {
  SILENCE,
  VoiceBuilder,
  filter,
  gain,
  noiseSource,
  osc,
  percEnvelope,
  saturationCurve,
  shaper,
  velocityGain,
  type Voice,
  type VoiceFn,
  type VoiceInput,
  type VoiceParams,
} from './utils';

/** Inharmonic square cluster from the TR-808 cymbal circuit. */
const METAL_RATIOS = [2, 3, 4.16, 5.43, 6.79, 8.21];

interface SampledOptions {
  /** Output level, matched to the synthesised voice's loudness. */
  level: number;
  /** Param that nudges playback pitch around the sample's own tuning. */
  tuneId?: string;
  /** Param (seconds) that caps the tail, so the decay knob still bites. */
  decayId?: string;
}

/**
 * Play one sample variant for a drum hit, shaped by velocity and the
 * instrument's params. Returns null when no kit is loaded, so every voice can
 * fall back to synthesis. The variant is fixed per track (from `variantSeed`),
 * so a song keeps one kick/snare/hat character while the next song gets a
 * different one; without a seed it falls back to a random pick.
 */
function playSampled(
  instrument: InstrumentId,
  ctx: BaseAudioContext,
  out: AudioNode,
  { time, velocity, variantSeed }: VoiceInput,
  p: VoiceParams,
  opts: SampledOptions,
): Voice | null {
  const variants = drumVariants(instrument);
  if (!variants || !variants.length) return null;

  const index = variantSeed === undefined ? (Math.random() * variants.length) | 0 : variantSeed % variants.length;
  const buffer = variants[index];
  const v = new VoiceBuilder(ctx, out, time);

  let rate = 1;
  if (opts.tuneId) {
    const def = INSTRUMENTS[instrument].params.find((param) => param.id === opts.tuneId);
    if (def && def.max > def.min) {
      const value = Number.isFinite(p[opts.tuneId]) ? p[opts.tuneId] : def.default;
      rate = 1 + 0.12 * ((value - def.default) / (def.max - def.min));
    }
  }

  const bufferSeconds = buffer.duration / Math.max(rate, 0.01);
  let decay = bufferSeconds;
  if (opts.decayId) {
    const value = p[opts.decayId];
    if (Number.isFinite(value) && value > 0.01) decay = value;
  }

  const attack = 0.001;
  const level = Math.max(velocityGain(velocity) * opts.level, 0.0005);
  const amp = gain(ctx, 0);
  const g = amp.gain;
  const decayEnd = time + attack + Math.max(decay, 0.02);
  g.setValueAtTime(0, time);
  g.linearRampToValueAtTime(level, time + attack);
  g.exponentialRampToValueAtTime(SILENCE, decayEnd);

  const src = ctx.createBufferSource();
  src.buffer = buffer;
  src.playbackRate.value = rate;
  src.connect(amp).connect(v.output);

  v.source(src, Math.min(time + bufferSeconds, decayEnd) + 0.02, time);
  return v.finish();
}

const synthKick: VoiceFn = (ctx, out, { time, velocity }, p) => {
  const v = new VoiceBuilder(ctx, out, time);
  const level = velocityGain(velocity);
  const decay = p.decay;
  const end = time + decay + 0.05;

  const body = osc(ctx, 'sine', p.tune);
  body.frequency.setValueAtTime(p.tune * (1.5 + p.punch * 4), time);
  body.frequency.exponentialRampToValueAtTime(p.tune, time + 0.025 + p.punch * 0.05);
  const bodyAmp = gain(ctx, 0);
  percEnvelope(bodyAmp.gain, time, 1, decay, 0.002);
  const drive = shaper(ctx, saturationCurve(p.drive * 0.8));
  const tone = filter(ctx, 'lowpass', 2200 + p.drive * 3000);
  body.connect(bodyAmp).connect(drive).connect(tone).connect(v.output);
  v.source(body, end);

  if (p.click > 0.01) {
    const noise = noiseSource(ctx, v, time, time + 0.03);
    const hp = filter(ctx, 'highpass', 1800);
    const clickAmp = gain(ctx, 0);
    percEnvelope(clickAmp.gain, time, p.click * 0.5, 0.012);
    noise.connect(hp).connect(clickAmp).connect(v.output);
  }

  v.output.gain.value = level * 0.56;
  return v.finish();
};

export const kick: VoiceFn = (ctx, out, input, p) =>
  playSampled('kick', ctx, out, input, p, { level: 0.56, tuneId: 'tune', decayId: 'decay' }) ??
  synthKick(ctx, out, input, p);

const synthSnare: VoiceFn = (ctx, out, { time, velocity }, p) => {
  const v = new VoiceBuilder(ctx, out, time);
  const level = velocityGain(velocity);
  const decay = p.decay;
  const end = time + decay + 0.05;

  const bodyAmp = gain(ctx, 0);
  percEnvelope(bodyAmp.gain, time, 0.7 * (1 - p.snappy * 0.4), decay * 0.55 + 0.03);
  bodyAmp.connect(v.output);
  for (const ratio of [1, 1.62]) {
    const o = osc(ctx, 'triangle', p.tune * ratio);
    o.frequency.setValueAtTime(p.tune * ratio * 1.35, time);
    o.frequency.exponentialRampToValueAtTime(p.tune * ratio, time + 0.03);
    o.connect(bodyAmp);
    v.source(o, end);
  }

  const noise = noiseSource(ctx, v, time, end);
  const bp = filter(ctx, 'bandpass', 1400 + p.tone * 5000, 0.7);
  const hp = filter(ctx, 'highpass', 700);
  const noiseAmp = gain(ctx, 0);
  percEnvelope(noiseAmp.gain, time, 0.25 + p.snappy * 0.75, decay);
  noise.connect(bp).connect(hp).connect(noiseAmp).connect(v.output);

  v.output.gain.value = level * 0.62;
  return v.finish();
};

export const snare: VoiceFn = (ctx, out, input, p) =>
  playSampled('snare', ctx, out, input, p, { level: 0.62, tuneId: 'tune', decayId: 'decay' }) ??
  synthSnare(ctx, out, input, p);

const synthClap: VoiceFn = (ctx, out, { time, velocity }, p) => {
  const v = new VoiceBuilder(ctx, out, time);
  const level = velocityGain(velocity);
  const spacing = 0.006 + p.spread * 0.014;
  const tailStart = time + spacing * 3;
  const end = tailStart + p.decay + 0.05;

  const noise = noiseSource(ctx, v, time, end);
  const bp = filter(ctx, 'bandpass', 900 + p.tone * 1900, 1.1);
  const hp = filter(ctx, 'highpass', 500);
  const amp = gain(ctx, 0);
  const g = amp.gain;
  g.setValueAtTime(0, time);
  for (let i = 0; i < 3; i++) {
    const t = time + i * spacing;
    g.setValueAtTime(1 - i * 0.12, t);
    g.exponentialRampToValueAtTime(0.12, t + spacing * 0.95);
  }
  g.setValueAtTime(0.85, tailStart);
  g.exponentialRampToValueAtTime(SILENCE, tailStart + p.decay);
  noise.connect(bp).connect(hp).connect(amp).connect(v.output);

  v.output.gain.value = level * 1.35;
  return v.finish();
};

export const clap: VoiceFn = (ctx, out, input, p) =>
  playSampled('clap', ctx, out, input, p, { level: 1.35, decayId: 'decay' }) ?? synthClap(ctx, out, input, p);

function metallic(
  v: VoiceBuilder,
  ctx: BaseAudioContext,
  dest: AudioNode,
  base: number,
  start: number,
  stop: number,
  level: number,
) {
  const mix = gain(ctx, level / METAL_RATIOS.length);
  for (const ratio of METAL_RATIOS) {
    const o = osc(ctx, 'square', base * ratio);
    o.connect(mix);
    v.source(o, stop, start);
  }
  mix.connect(dest);
}

function hatVoice(open: boolean): VoiceFn {
  return (ctx, out, { time, velocity }, p) => {
    const v = new VoiceBuilder(ctx, out, time);
    const level = velocityGain(velocity);
    const end = time + p.decay + 0.05;

    const bp = filter(ctx, 'bandpass', 5500 + p.tone * 4500, 0.8);
    const hp = filter(ctx, 'highpass', (open ? 4000 : 5000) + p.tone * 2500);
    const amp = gain(ctx, 0);
    percEnvelope(amp.gain, time, 1, p.decay);
    bp.connect(hp).connect(amp).connect(v.output);

    metallic(v, ctx, bp, 95 + p.tone * 30, time, end, p.metal * 1.6);
    const noise = noiseSource(ctx, v, time, end);
    const noiseAmp = gain(ctx, 1 - p.metal * 0.6);
    noise.connect(noiseAmp).connect(bp);

    v.output.gain.value = level * (open ? 0.55 : 0.65);
    return v.finish();
  };
}

const synthHat = hatVoice(false);
const synthOpenHat = hatVoice(true);

export const hat: VoiceFn = (ctx, out, input, p) =>
  playSampled('hat', ctx, out, input, p, { level: 0.65, decayId: 'decay' }) ?? synthHat(ctx, out, input, p);

export const openhat: VoiceFn = (ctx, out, input, p) =>
  playSampled('openhat', ctx, out, input, p, { level: 0.55, decayId: 'decay' }) ?? synthOpenHat(ctx, out, input, p);

const synthRim: VoiceFn = (ctx, out, { time, velocity }, p) => {
  const v = new VoiceBuilder(ctx, out, time);
  const level = velocityGain(velocity);
  const end = time + p.decay + 0.03;
  const pitch = 0.7 + p.tune * 0.6;

  const amp = gain(ctx, 0);
  percEnvelope(amp.gain, time, 1, p.decay);
  const bp = filter(ctx, 'bandpass', 1200 + p.tone * 2400, 1.4);
  amp.connect(bp).connect(v.output);

  const high = osc(ctx, 'triangle', 1700 * pitch);
  const low = osc(ctx, 'sine', 460 * pitch);
  const lowAmp = gain(ctx, 0.6);
  high.connect(amp);
  low.connect(lowAmp).connect(amp);
  v.source(high, end);
  v.source(low, end);

  const noise = noiseSource(ctx, v, time, time + 0.02);
  const clickAmp = gain(ctx, 0);
  percEnvelope(clickAmp.gain, time, 0.4, 0.008);
  noise.connect(clickAmp).connect(bp);

  v.output.gain.value = level * 0.8;
  return v.finish();
};

export const rim: VoiceFn = (ctx, out, input, p) =>
  playSampled('rim', ctx, out, input, p, { level: 0.8, tuneId: 'tune', decayId: 'decay' }) ??
  synthRim(ctx, out, input, p);

const synthShaker: VoiceFn = (ctx, out, { time, velocity }, p) => {
  const v = new VoiceBuilder(ctx, out, time);
  const level = velocityGain(velocity);
  const attack = 0.002 + p.swell * p.decay * 0.6;
  const end = time + attack + p.decay + 0.03;

  const noise = noiseSource(ctx, v, time, end);
  const bp = filter(ctx, 'bandpass', 4500 + p.tone * 5000, 1.2);
  const hp = filter(ctx, 'highpass', 3000);
  const amp = gain(ctx, 0);
  percEnvelope(amp.gain, time, 1, p.decay, attack);
  noise.connect(bp).connect(hp).connect(amp).connect(v.output);

  v.output.gain.value = level * 0.42;
  return v.finish();
};

export const shaker: VoiceFn = (ctx, out, input, p) =>
  playSampled('shaker', ctx, out, input, p, { level: 0.42, decayId: 'decay' }) ?? synthShaker(ctx, out, input, p);

const synthTom: VoiceFn = (ctx, out, { time, velocity }, p) => {
  const v = new VoiceBuilder(ctx, out, time);
  const level = velocityGain(velocity);
  const end = time + p.decay + 0.05;

  const body = osc(ctx, 'sine', p.tune);
  body.frequency.setValueAtTime(p.tune * (1 + p.bend * 0.8), time);
  body.frequency.exponentialRampToValueAtTime(p.tune, time + p.decay * 0.6);
  const amp = gain(ctx, 0);
  percEnvelope(amp.gain, time, 1, p.decay, 0.002);
  body.connect(amp).connect(v.output);
  v.source(body, end);

  const noise = noiseSource(ctx, v, time, time + 0.03);
  const lp = filter(ctx, 'lowpass', 3000);
  const clickAmp = gain(ctx, 0);
  percEnvelope(clickAmp.gain, time, 0.25, 0.015);
  noise.connect(lp).connect(clickAmp).connect(v.output);

  v.output.gain.value = level * 0.67;
  return v.finish();
};

export const tom: VoiceFn = (ctx, out, input, p) =>
  playSampled('tom', ctx, out, input, p, { level: 0.67, tuneId: 'tune', decayId: 'decay' }) ??
  synthTom(ctx, out, input, p);

const synthCrash: VoiceFn = (ctx, out, { time, velocity }, p) => {
  const v = new VoiceBuilder(ctx, out, time);
  const level = velocityGain(velocity);
  const end = time + p.decay + 0.1;

  const hp = filter(ctx, 'highpass', 3500 + p.tone * 3000);
  const shimmer = filter(ctx, 'peaking', 9000, 0.8);
  shimmer.gain.value = 4;
  const amp = gain(ctx, 0);
  percEnvelope(amp.gain, time, 1, p.decay, 0.003);
  hp.connect(shimmer).connect(amp).connect(v.output);

  metallic(v, ctx, hp, 70 + p.tone * 20, time, end, 0.9);
  const noise = noiseSource(ctx, v, time, end);
  noise.connect(gain(ctx, 0.8)).connect(hp);

  v.output.gain.value = level * 0.28;
  return v.finish();
};

export const crash: VoiceFn = (ctx, out, input, p) =>
  playSampled('crash', ctx, out, input, p, { level: 0.28, decayId: 'decay' }) ?? synthCrash(ctx, out, input, p);

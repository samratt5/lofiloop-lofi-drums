import { midiToFreq } from '@/lib/music/theory';
import { expMap } from '@/lib/utils/math';
import {
  VoiceBuilder,
  filter,
  gain,
  gateEnvelope,
  osc,
  percEnvelope,
  saturationCurve,
  shaper,
  velocityGain,
  type VoiceFn,
} from './utils';

/** Slide from the previous note when gliding, otherwise start on pitch. */
function pitch(param: AudioParam, time: number, freq: number, glideFrom: number | undefined, glide: number) {
  if (glideFrom !== undefined && glide > 0.001) {
    param.setValueAtTime(midiToFreq(glideFrom), time);
    param.exponentialRampToValueAtTime(freq, time + glide);
  } else {
    param.setValueAtTime(freq, time);
  }
}

export const bass808: VoiceFn = (ctx, out, { time, note, velocity, glideFrom }, p) => {
  const v = new VoiceBuilder(ctx, out, time);
  const freq = midiToFreq(note);
  const end = time + p.decay + 0.05;

  const body = osc(ctx, 'sine', freq);
  if (glideFrom !== undefined && p.glide > 0.001) {
    pitch(body.frequency, time, freq, glideFrom, p.glide);
  } else {
    body.frequency.setValueAtTime(freq * (1 + p.punch * 1.8), time);
    body.frequency.exponentialRampToValueAtTime(freq, time + 0.03 + p.punch * 0.03);
  }
  const amp = gain(ctx, 0);
  // Legato glides skip the attack transient so slides sound connected.
  const attack = glideFrom !== undefined ? 0.008 : 0.002;
  percEnvelope(amp.gain, time, 1, p.decay, attack);
  const drive = shaper(ctx, saturationCurve(p.drive));
  const lp = filter(ctx, 'lowpass', 700 + p.drive * 2600);
  body.connect(amp).connect(drive).connect(lp).connect(v.output);
  v.source(body, end);

  v.output.gain.value = velocityGain(velocity) * 0.44;
  return v.finish();
};

export const subBass: VoiceFn = (ctx, out, { time, note, velocity, duration }, p) => {
  const v = new VoiceBuilder(ctx, out, time);
  const freq = midiToFreq(note);
  const end = gateEnvelope(
    v.output.gain,
    time,
    velocityGain(velocity) * 0.38,
    0.006,
    0.3,
    0.85,
    time + duration,
    p.release,
  );

  const sine = osc(ctx, 'sine', freq);
  const tri = osc(ctx, 'triangle', freq);
  const sineAmp = gain(ctx, 0.75);
  const triAmp = gain(ctx, p.tone * 0.4);
  const drive = shaper(ctx, saturationCurve(p.drive * 0.7));
  const lp = filter(ctx, 'lowpass', 180 + p.tone * 1400, 0.9);
  sine.connect(sineAmp).connect(drive);
  tri.connect(triAmp).connect(drive);
  drive.connect(lp).connect(v.output);
  v.source(sine, end);
  v.source(tri, end);
  return v.finish();
};

/** FM electric piano with a tine "bark" and tremolo. */
export const keys: VoiceFn = (ctx, out, { time, note, velocity, duration }, p) => {
  const v = new VoiceBuilder(ctx, out, time);
  const freq = midiToFreq(note);
  const level = velocityGain(velocity);
  const end = gateEnvelope(v.output.gain, time, level * 0.3, 0.004, p.decay, 0.05, time + duration, p.release);

  const carrier = osc(ctx, 'sine', freq);
  const modulator = osc(ctx, 'sine', freq);
  const index = gain(ctx, 0);
  const brightness = (0.4 + p.tone * 2.6) * (0.5 + velocity * 0.7);
  index.gain.setValueAtTime(freq * brightness, time);
  index.gain.setTargetAtTime(freq * 0.15, time, 0.25);
  modulator.connect(index).connect(carrier.frequency);

  const tine = osc(ctx, 'sine', freq * 7);
  const tineAmp = gain(ctx, 0);
  percEnvelope(tineAmp.gain, time, 0.08 * velocity * (0.3 + p.tone), 0.06);

  const tremolo = gain(ctx, 1 - p.tremolo * 0.25);
  const lfo = osc(ctx, 'sine', 4.2);
  const lfoDepth = gain(ctx, p.tremolo * 0.25);
  lfo.connect(lfoDepth).connect(tremolo.gain);

  const lp = filter(ctx, 'lowpass', Math.min(18000, freq * 6 + 1200 + p.tone * 5000));
  carrier.connect(tremolo);
  tine.connect(tineAmp).connect(tremolo);
  tremolo.connect(lp).connect(v.output);

  for (const node of [carrier, modulator, tine, lfo]) v.source(node, end);
  return v.finish();
};

export const pad: VoiceFn = (ctx, out, { time, note, velocity, duration }, p) => {
  const v = new VoiceBuilder(ctx, out, time);
  const freq = midiToFreq(note);
  const level = velocityGain(velocity) * 0.38;
  const end = gateEnvelope(v.output.gain, time, level, p.attack, 1, 0.9, time + duration, p.release);

  const cutoff = expMap(p.cutoff, 250, 9000);
  const lp = filter(ctx, 'lowpass', cutoff, 0.8);
  lp.frequency.setValueAtTime(cutoff * 0.6, time);
  lp.frequency.linearRampToValueAtTime(cutoff, time + p.attack + 0.2);
  lp.connect(v.output);

  const spread = 4 + p.detune * 20;
  for (const detune of [-spread, 0, spread]) {
    const o = osc(ctx, 'sawtooth', freq);
    o.detune.value = detune;
    o.connect(gain(ctx, 0.33)).connect(lp);
    v.source(o, end);
  }
  const sub = osc(ctx, 'sine', freq / 2);
  sub.connect(gain(ctx, 0.25)).connect(lp);
  v.source(sub, end);
  return v.finish();
};

/** Plucks always ring out naturally, so the gate length is ignored. */
export const pluck: VoiceFn = (ctx, out, { time, note, velocity }, p) => {
  const v = new VoiceBuilder(ctx, out, time);
  const freq = midiToFreq(note);
  const level = velocityGain(velocity) * 0.3;
  const end = percEnvelope(v.output.gain, time, level, p.decay, 0.002) + 0.05;

  const peak = Math.min(16000, freq * 2 + expMap(p.cutoff, 400, 9000));
  const lp = filter(ctx, 'lowpass', peak, 0.5 + p.resonance * 10);
  lp.frequency.setValueAtTime(peak, time);
  lp.frequency.exponentialRampToValueAtTime(Math.max(freq * 1.2, 120), time + p.decay * 0.6 + 0.02);
  lp.connect(v.output);

  const saw = osc(ctx, 'sawtooth', freq);
  const square = osc(ctx, 'square', freq * 1.002);
  saw.connect(lp);
  square.connect(gain(ctx, 0.4)).connect(lp);
  v.source(saw, end);
  v.source(square, end);
  return v.finish();
};

/** FM music box / glockenspiel. */
export const bell: VoiceFn = (ctx, out, { time, note, velocity }, p) => {
  const v = new VoiceBuilder(ctx, out, time);
  const freq = midiToFreq(note);
  const level = velocityGain(velocity) * 0.38;
  const end = percEnvelope(v.output.gain, time, level, p.decay, 0.002) + 0.05;

  const carrier = osc(ctx, 'sine', freq);
  const modulator = osc(ctx, 'sine', freq * 3.5);
  const index = gain(ctx, 0);
  percEnvelope(index.gain, time, freq * (0.5 + p.tone * 3), p.decay * 0.3);
  modulator.connect(index).connect(carrier.frequency);

  const partial = osc(ctx, 'sine', freq * 2.76);
  const partialAmp = gain(ctx, 0);
  percEnvelope(partialAmp.gain, time, 0.25, p.decay * 0.25);

  carrier.connect(v.output);
  partial.connect(partialAmp).connect(v.output);
  for (const node of [carrier, modulator, partial]) v.source(node, end);
  return v.finish();
};

export const lead: VoiceFn = (ctx, out, { time, note, velocity, duration, glideFrom }, p) => {
  const v = new VoiceBuilder(ctx, out, time);
  const freq = midiToFreq(note);
  const level = velocityGain(velocity) * 0.52;
  const end = gateEnvelope(v.output.gain, time, level, p.attack, 0.4, 0.85, time + duration, p.release);

  const lp = filter(ctx, 'lowpass', expMap(p.cutoff, 500, 8000), 1.5);
  lp.connect(v.output);

  const vibrato = osc(ctx, 'sine', 5.3);
  const depth = gain(ctx, 0);
  depth.gain.setValueAtTime(0, time);
  depth.gain.linearRampToValueAtTime(p.vibrato * 18, time + 0.25);
  vibrato.connect(depth);
  v.source(vibrato, end);

  const voices: [OscillatorType, number][] = [
    ['triangle', 0.8],
    ['sawtooth', 0.25],
  ];
  for (const [type, amount] of voices) {
    const o = osc(ctx, type, freq);
    pitch(o.frequency, time, freq, glideFrom, p.glide);
    depth.connect(o.detune);
    o.connect(gain(ctx, amount)).connect(lp);
    v.source(o, end);
  }
  return v.finish();
};

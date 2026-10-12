/** Wurlitzer-style reed electric piano: FM reed tone into a velocity-driven "bark" saturator, with tremolo. */
import { midiToFreq } from '@/lib/music/theory';
import { gate, num, retrigger, vel } from './shared';
import { VoiceBuilder, filter, gain, gateEnvelope, osc, percEnvelope, velocityGain, type VoiceFn } from './utils';

const curves = new Map<number, Float32Array<ArrayBuffer>>();

/**
 * Soft clipper for inputs in ±2 (fed at half scale, so the shaper's ±1 input
 * range never hard-clips), with unity small-signal gain overall.
 */
function barkCurve(drive: number): Float32Array<ArrayBuffer> {
  const key = Math.round(drive * 20) / 20;
  let curve = curves.get(key);
  if (!curve) {
    const n = 1024;
    const k = 0.4 + key * 2.6;
    curve = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const x = (i / (n - 1)) * 2 - 1;
      curve[i] = Math.tanh(2 * k * x) / k;
    }
    curves.set(key, curve);
  }
  return curve;
}

export const wurli: VoiceFn = (ctx, out, { time, note, velocity, duration }, p) => {
  const v = new VoiceBuilder(ctx, out, time);
  const velo = vel(velocity);
  const tone = num(p, 'tone', 0.45, 0, 1);
  const bark = num(p, 'bark', 0.4, 0, 1);
  const decay = num(p, 'decay', 1.4, 0.1, 8);
  const tremolo = num(p, 'tremolo', 0.35, 0, 1);
  const release = num(p, 'release', 0.3, 0.02, 4);
  const freq = midiToFreq(note);

  // Reed amplitude: struck, then a long decay while held; release after the gate. The
  // harder the strike, the harder it drives the saturating preamp ("bark").
  const drive = 0.5 + bark * velo * 1.1;
  const reed = gain(ctx, 0);
  const end = gateEnvelope(
    reed.gain,
    time,
    (0.55 + velo * 0.45) * drive * 0.5,
    0.002,
    decay,
    0.06,
    time + gate(duration),
    release,
  );

  // FM: modulator at the fundamental, index falling from a bright strike
  const carrier = osc(ctx, 'sine', freq);
  const modulator = osc(ctx, 'sine', freq);
  const index = gain(ctx, 0);
  const strike = freq * (0.6 + tone * 1.8) * (0.4 + velo * 0.8);
  index.gain.setValueAtTime(strike, time);
  index.gain.setTargetAtTime(freq * (0.25 + tone * 0.35), time, 0.08 + decay * 0.05);
  modulator.connect(index).connect(carrier.frequency);

  // Second reed mode (~2.8×) gives the characteristic hollow attack
  const mode = osc(ctx, 'sine', freq * 2.76);
  const modeAmp = gain(ctx, 0);
  percEnvelope(modeAmp.gain, time, 0.18 * (0.4 + tone) * velo, 0.05 + decay * 0.03);

  const shaper = ctx.createWaveShaper();
  shaper.curve = barkCurve(bark);
  // No oversampling: the reed is nearly sinusoidal and low-passed, and 2× costs more than the rest of the voice.
  shaper.oversample = 'none';

  const trem = gain(ctx, 1 - tremolo * 0.3);
  const lfo = osc(ctx, 'sine', 5.6);
  lfo.connect(gain(ctx, tremolo * 0.3)).connect(trem.gain);

  const lp = filter(ctx, 'lowpass', Math.min(16000, freq * 5 + 900 + tone * 4200), 0.7);
  carrier.connect(reed);
  mode.connect(modeAmp).connect(reed);
  reed.connect(shaper).connect(trem).connect(lp).connect(v.output);

  for (const node of [carrier, modulator, mode, lfo]) v.source(node, end);
  v.output.gain.value = velocityGain(velo) * 0.5;
  return retrigger(out, note, time, v.finish(), 0.03);
};

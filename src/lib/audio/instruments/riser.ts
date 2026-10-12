/** Riser FX: a filtered-noise and detuned-saw sweep that builds over exactly the step length. */
import { gate, kRate, num, vel } from './shared';
import { VoiceBuilder, filter, gain, noiseSource, osc, velocityGain, type VoiceFn } from './utils';

const FADE_OUT = 0.012;
const curveCache = new Map<number, Float32Array<ArrayBuffer>>();

/** Level swell: slow start, strong finish (power curve), 64 points. */
function swellCurve(shape: number): Float32Array<ArrayBuffer> {
  const key = Math.round(shape * 10) / 10;
  let curve = curveCache.get(key);
  if (!curve) {
    const n = 64;
    curve = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const t = i / (n - 1);
      curve[i] = 0.02 + 0.98 * Math.pow(t, key);
    }
    curveCache.set(key, curve);
  }
  return curve;
}

/**
 * Rises in pitch, brightness and level across `input.duration` and is silent
 * at `time + duration`. `tone` sets how bright it ends, `noise` the noise
 * layer and `pitch` the pitched layer and how far it climbs.
 */
export const riser: VoiceFn = (ctx, out, { time, velocity, duration }, p) => {
  const v = new VoiceBuilder(ctx, out, time);
  const velo = vel(velocity);
  const tone = num(p, 'tone', 0.5, 0, 1);
  const noiseMix = num(p, 'noise', 0.7, 0, 1);
  const pitch = num(p, 'pitch', 0.5, 0, 1);
  // Some pitched body remains when both layers are turned down, so the riser never goes silent.
  const pitchMix = Math.max(pitch, (1 - noiseMix) * 0.3);
  const length = Math.max(0.08, gate(duration));
  const end = time + length;
  const swellEnd = end - FADE_OUT;
  const nyquist = ctx.sampleRate / 2;

  // Keep the overall level similar whatever the layer balance
  const total = Math.max(0.35, Math.hypot(noiseMix, pitchMix));

  const bus = gain(ctx, 0);
  bus.gain.setValueCurveAtTime(swellCurve(1.6 + (1 - tone) * 0.8), time, swellEnd - time);
  bus.gain.setValueAtTime(1, swellEnd);
  bus.gain.linearRampToValueAtTime(0, end);
  const sweep = filter(ctx, 'lowpass', 300, 1.2 + tone * 2);
  const top = Math.min(nyquist - 200, 4000 + tone * 12000);
  kRate(sweep.frequency).setValueAtTime(250 + tone * 150, time);
  sweep.frequency.exponentialRampToValueAtTime(top, swellEnd);
  const hp = filter(ctx, 'highpass', 90, 0.7);
  kRate(hp.frequency).setValueAtTime(90, time);
  hp.frequency.exponentialRampToValueAtTime(260 + tone * 400, swellEnd);
  bus.connect(sweep).connect(hp).connect(v.output);

  if (noiseMix > 0.005) {
    const noise = noiseSource(ctx, v, time, end + 0.01);
    const bp = filter(ctx, 'bandpass', 600, 0.6);
    kRate(bp.frequency).setValueAtTime(500, time);
    bp.frequency.exponentialRampToValueAtTime(Math.min(nyquist - 200, 2500 + tone * 7000), swellEnd);
    noise
      .connect(bp)
      .connect(gain(ctx, (noiseMix / total) * 1.4))
      .connect(bus);
  }

  if (pitchMix > 0.005) {
    // Climb one to three octaves from C3
    const from = 130.81;
    const to = from * Math.pow(2, 1 + pitch * 2);
    const pitched = gain(ctx, (pitchMix / total) * 0.55);
    pitched.connect(bus);
    for (const detune of [-12, 0, 12]) {
      const saw = osc(ctx, 'sawtooth', from);
      saw.detune.value = detune;
      kRate(saw.frequency).setValueAtTime(from, time);
      saw.frequency.exponentialRampToValueAtTime(to, swellEnd);
      saw.connect(pitched);
      v.source(saw, end + 0.01);
    }
  }

  v.output.gain.value = velocityGain(velo) * 0.3;
  return v.finish();
};

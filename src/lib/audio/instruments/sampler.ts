import { clamp, expMap } from '@/lib/utils/math';
import { num, vel } from './shared';
import { VoiceBuilder, filter, gateEnvelope, velocityGain, type VoiceFn } from './utils';

/** In chop mode, C3 plays slice 1, C#3 slice 2 and so on. */
export const CHOP_BASE_NOTE = 48;

/** Plays the track's uploaded sample: pitched across the keyboard, or as chopped slices. */
export const sampler: VoiceFn = (ctx, out, { time, note, velocity, duration, sample }, p) => {
  const v = new VoiceBuilder(ctx, out, time);
  if (!sample) return v.finish();
  const { buffer, ref } = sample;
  const total = buffer.duration;
  const trimStart = clamp(ref.start, 0, 1) * total;
  const trimEnd = Math.max(trimStart + 0.005, clamp(ref.end, 0, 1) * total);

  let offset: number;
  let length: number;
  let rate = Math.pow(2, num(p, 'tune', 0, -48, 48) / 12);
  let oneShot = false;
  if (ref.mode === 'chop') {
    const index = note - CHOP_BASE_NOTE;
    if (index < 0 || index >= ref.slices.length) return v.finish();
    const span = trimEnd - trimStart;
    offset = trimStart + ref.slices[index] * span;
    const next = index + 1 < ref.slices.length ? trimStart + ref.slices[index + 1] * span : trimEnd;
    length = Math.max(0.005, next - offset);
    oneShot = true;
  } else {
    offset = trimStart;
    length = trimEnd - trimStart;
    rate *= Math.pow(2, (note - ref.root) / 12);
  }

  const playable = length / rate;
  const gateEnd = oneShot
    ? time + playable
    : time + Math.min(Number.isFinite(duration) ? duration : playable, playable);
  const release = num(p, 'release', 0.08, 0.005, 10);
  const end = Math.min(
    time + playable + 0.01,
    gateEnvelope(
      v.output.gain,
      time,
      velocityGain(vel(velocity)),
      num(p, 'attack', 0.003, 0.001, 10),
      0.01,
      1,
      gateEnd,
      release,
    ),
  );

  const src = ctx.createBufferSource();
  src.buffer = buffer;
  src.playbackRate.value = rate;
  const cutoff = num(p, 'cutoff', 1, 0, 1);
  const lp = filter(ctx, 'lowpass', cutoff >= 0.999 ? 20000 : expMap(cutoff, 200, 20000), 0.7);
  src.connect(lp).connect(v.output);
  v.source(src, end + 0.02, time, offset);
  return v.finish();
};

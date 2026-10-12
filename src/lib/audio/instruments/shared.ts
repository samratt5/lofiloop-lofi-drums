/** Helpers shared by the band, keys and FX voices. */
import type { Voice, VoiceParams } from './utils';

/** Read a param as a finite number clamped to [min, max], falling back to `fallback`. */
export function num(p: VoiceParams | undefined, key: string, fallback: number, min: number, max: number): number {
  const value = p?.[key];
  const x = typeof value === 'number' && Number.isFinite(value) ? value : fallback;
  return Math.min(max, Math.max(min, x));
}

/** Finite 0..1 velocity (NaN → 0.8). */
export function vel(velocity: number): number {
  return Number.isFinite(velocity) ? Math.min(1, Math.max(0, velocity)) : 0.8;
}

/** Positive, finite gate length in seconds. */
export function gate(duration: number): number {
  return Number.isFinite(duration) ? Math.min(60, Math.max(0.02, duration)) : 0.25;
}

/** Deterministic round-robin variant so repeated notes don't sound machine-gunned. */
export function variant(time: number, note: number, count: number): number {
  const n = Math.abs(Math.round(time * 997) + note * 7);
  return Number.isFinite(n) ? n % count : 0;
}

/** Delayed vibrato: depth (in cents) fades in after `delay` over `ramp` seconds. */
export function vibratoDepth(param: AudioParam, time: number, cents: number, delay: number, ramp: number): void {
  param.setValueAtTime(0, time);
  param.setValueAtTime(0, time + delay);
  param.linearRampToValueAtTime(cents, time + delay + ramp);
}

/**
 * Compute a param once per render quantum instead of per sample. Slow
 * modulation (vibrato, filter sweeps) sounds the same and costs far less:
 * Chromium recomputes biquad coefficients and oscillator increments per sample
 * whenever an a-rate param is automated or modulated.
 */
export function kRate<T extends AudioParam>(param: T): T {
  try {
    param.automationRate = 'k-rate';
  } catch {
    // Older engines only support a-rate here; it still works, just costs more.
  }
  return param;
}

const ringing = new WeakMap<AudioNode, Map<number, { start: number; voice: Voice }>>();

/**
 * Re-striking a pitch on the same track damps the note still ringing there (a
 * string or reed can only sound once), fading it over `fade` seconds. This
 * keeps long-ringing polyphonic voices from piling up on repeated chords.
 */
export function retrigger(out: AudioNode, note: number, start: number, voice: Voice, fade: number): Voice {
  let byNote = ringing.get(out);
  if (!byNote) {
    byNote = new Map();
    ringing.set(out, byNote);
  }
  const previous = byNote.get(note);
  // Only notes that started earlier; an out-of-order preview must not cut a scheduled note.
  if (previous && previous.start < start && previous.voice.end > start) previous.voice.stop(start, fade);
  if (!previous || previous.start <= start) byNote.set(note, { start, voice });
  return voice;
}

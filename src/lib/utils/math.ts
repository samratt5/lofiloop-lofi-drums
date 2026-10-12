export function clamp(value: number, min: number, max: number): number {
  if (Number.isNaN(value)) return min;
  return Math.min(max, Math.max(min, value));
}

export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/** Round to the nearest multiple of `step`, avoiding floating point noise. */
export function snap(value: number, step: number): number {
  if (step <= 0) return value;
  const decimals = Math.max(0, Math.ceil(-Math.log10(step)));
  return Number((Math.round(value / step) * step).toFixed(decimals));
}

/** Map 0..1 onto an exponential range, useful for frequencies and times. */
export function expMap(t: number, min: number, max: number): number {
  return min * Math.pow(max / min, clamp(t, 0, 1));
}

export function dbToGain(db: number): number {
  return Math.pow(10, db / 20);
}

export function gainToDb(gain: number): number {
  return gain <= 0 ? -Infinity : 20 * Math.log10(gain);
}

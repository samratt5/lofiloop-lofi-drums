const taps: number[] = [];

/** Register a tap; returns the averaged BPM once there are at least two recent taps. */
export function tapTempo(now = performance.now()): number | null {
  if (taps.length && now - taps[taps.length - 1] > 2000) taps.length = 0;
  taps.push(now);
  if (taps.length > 6) taps.shift();
  if (taps.length < 2) return null;
  const intervals = taps.slice(1).map((t, i) => t - taps[i]);
  const avg = intervals.reduce((a, b) => a + b, 0) / intervals.length;
  return Math.round(60000 / avg);
}

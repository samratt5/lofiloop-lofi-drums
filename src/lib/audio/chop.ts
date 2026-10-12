/** Waveform overviews and slice detection for the sampler. Pure functions over sample data. */

/** Mono mix of all channels (reference to channel 0 when mono). */
export function monoData(channels: Float32Array[]): Float32Array {
  if (channels.length === 1) return channels[0];
  const out = new Float32Array(channels[0].length);
  for (const ch of channels) for (let i = 0; i < out.length; i++) out[i] += ch[i] / channels.length;
  return out;
}

/** Min/max pairs for `buckets` columns, for drawing a waveform. */
export function waveformPeaks(data: Float32Array, buckets: number): { min: Float32Array; max: Float32Array } {
  const min = new Float32Array(buckets);
  const max = new Float32Array(buckets);
  const per = data.length / buckets;
  for (let b = 0; b < buckets; b++) {
    const from = Math.floor(b * per);
    const to = Math.max(from + 1, Math.floor((b + 1) * per));
    let lo = 0;
    let hi = 0;
    for (let i = from; i < to && i < data.length; i++) {
      const v = data[i];
      if (v < lo) lo = v;
      if (v > hi) hi = v;
    }
    min[b] = lo;
    max[b] = hi;
  }
  return { min, max };
}

/** `count` evenly spaced slice starts in 0..1 (first is 0). */
export function equalSlices(count: number): number[] {
  const n = Math.max(1, Math.min(64, Math.round(count)));
  return Array.from({ length: n }, (_, i) => i / n);
}

export interface OnsetOptions {
  /** Most slices to return (default 16) */
  max?: number;
  /** Shortest slice in seconds (default 0.08) */
  minGap?: number;
  /** 0..1, higher finds fewer onsets (default 0.5) */
  threshold?: number;
}

/**
 * Finds hits (transients) in a region of a sample and returns slice starts in
 * 0..1 relative to that region. Uses a spectral-flux-like rise in short-time
 * energy compared with its recent average, which works well on drum loops.
 */
export function detectOnsets(
  data: Float32Array,
  sampleRate: number,
  region: { start: number; end: number } = { start: 0, end: 1 },
  { max = 16, minGap = 0.08, threshold = 0.5 }: OnsetOptions = {},
): number[] {
  const from = Math.floor(region.start * data.length);
  const to = Math.max(from + 1, Math.floor(region.end * data.length));
  const hop = Math.max(1, Math.round(sampleRate * 0.005));
  const frames = Math.floor((to - from) / hop);
  if (frames < 4) return [0];

  const energy = new Float32Array(frames);
  for (let f = 0; f < frames; f++) {
    let sum = 0;
    const base = from + f * hop;
    for (let i = 0; i < hop; i++) {
      const v = data[base + i] ?? 0;
      sum += v * v;
    }
    energy[f] = Math.sqrt(sum / hop);
  }

  // Positive changes in log energy, so quiet and loud hits count alike.
  const flux = new Float32Array(frames);
  for (let f = 1; f < frames; f++) {
    const rise = Math.log10(energy[f] + 1e-4) - Math.log10(energy[f - 1] + 1e-4);
    flux[f] = rise > 0 ? rise : 0;
  }
  let peak = 0;
  for (const v of flux) peak = Math.max(peak, v);
  if (peak <= 0) return [0];

  const window = 10;
  const minFrames = Math.max(1, Math.round(minGap / 0.005));
  const floor = 0.05 + threshold * 0.4;
  const candidates: { frame: number; strength: number }[] = [];
  for (let f = 1; f < frames - 1; f++) {
    if (flux[f] < flux[f - 1] || flux[f] < flux[f + 1]) continue;
    let avg = 0;
    let n = 0;
    for (let k = Math.max(0, f - window); k < f; k++, n++) avg += flux[k];
    avg = n ? avg / n : 0;
    const strength = flux[f] / peak;
    if (strength > floor && flux[f] > avg * 1.5) candidates.push({ frame: f, strength });
  }

  // Strongest first, keep those far enough from ones already chosen.
  candidates.sort((a, b) => b.strength - a.strength);
  const chosen: number[] = [];
  for (const c of candidates) {
    if (chosen.length >= max - 1) break;
    if (c.frame < minFrames) continue;
    if (chosen.every((f) => Math.abs(f - c.frame) >= minFrames)) chosen.push(c.frame);
  }
  // Nudge each start back a couple of frames so the attack isn't clipped.
  const starts = chosen.map((f) => Math.max(0, f - 1) / frames).sort((a, b) => a - b);
  return [0, ...starts];
}

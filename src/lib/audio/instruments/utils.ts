/** Building blocks shared by every voice. All helpers work on BaseAudioContext so they run offline too. */
import type { SampleRef } from '@/lib/project/types';

export const SILENCE = 0.0001;

export interface SampleVoiceData {
  buffer: AudioBuffer;
  ref: SampleRef;
}

export interface VoiceInput {
  time: number;
  note: number;
  /** 0..1 */
  velocity: number;
  /** Gate length in seconds */
  duration: number;
  /** Previous note for monophonic glides */
  glideFrom?: number;
  /** Decoded audio for the sampler instrument */
  sample?: SampleVoiceData;
  /**
   * Stable per-track seed. Sampled drum voices use it to pick one sample variant
   * for the whole track, so a song's kit is consistent but differs from the next
   * song's — and live playback and exports pick the same one.
   */
  variantSeed?: number;
}

export interface Voice {
  /** Time the voice falls silent on its own */
  end: number;
  /**
   * Fade out from `time` over `fade` seconds (default 12 ms): choke groups,
   * mono retrigger, transport stop and releasing held live notes.
   */
  stop(time: number, fade?: number): void;
}

export type VoiceParams = Record<string, number>;
export type VoiceFn = (ctx: BaseAudioContext, out: AudioNode, input: VoiceInput, params: VoiceParams) => Voice;

/** Perceptual velocity curve. */
export function velocityGain(velocity: number): number {
  const v = Math.min(1, Math.max(0, velocity));
  return v * v * 0.6 + v * 0.4;
}

/**
 * Collects the nodes of one voice, wires a choke-able output stage and
 * disconnects everything once the last source has finished.
 */
export class VoiceBuilder {
  readonly output: GainNode;
  private readonly choke: GainNode;
  private readonly sources: AudioScheduledSourceNode[] = [];
  private end: number;

  constructor(
    ctx: BaseAudioContext,
    destination: AudioNode,
    private readonly start: number,
  ) {
    this.end = start;
    this.output = ctx.createGain();
    this.choke = ctx.createGain();
    this.output.connect(this.choke);
    this.choke.connect(destination);
  }

  /** Register a source to start at `start` and stop at `stop`. */
  source<T extends AudioScheduledSourceNode>(node: T, stop: number, start = this.start, offset?: number): T {
    if (node instanceof AudioBufferSourceNode && offset !== undefined) node.start(start, offset);
    else node.start(start);
    node.stop(stop);
    this.sources.push(node);
    this.end = Math.max(this.end, stop);
    return node;
  }

  finish(): Voice {
    const { choke, output, sources, start } = this;
    let remaining = sources.length;
    for (const s of sources) {
      s.onended = () => {
        s.disconnect();
        remaining -= 1;
        if (remaining === 0) {
          output.disconnect();
          choke.disconnect();
        }
      };
    }
    const end = this.end;
    return {
      end,
      stop: (time: number, fade = 0.012) => {
        const t = Math.max(time, start);
        if (t >= end) return;
        choke.gain.cancelScheduledValues(t);
        choke.gain.setValueAtTime(1, t);
        if (fade > 0.05) choke.gain.setTargetAtTime(0, t, fade / 4);
        else choke.gain.linearRampToValueAtTime(0, t + fade);
        for (const s of sources) {
          try {
            s.stop(t + (fade > 0.05 ? fade * 1.5 : fade + 0.003));
          } catch {
            // Some engines reject a second stop(); the fade above already silences the voice.
          }
        }
      },
    };
  }
}

const noiseCache = new WeakMap<BaseAudioContext, AudioBuffer>();
const NOISE_SECONDS = 2;

/** Two seconds of white noise per context; voices start at a random offset for variety. */
export function noiseBuffer(ctx: BaseAudioContext): AudioBuffer {
  let buffer = noiseCache.get(ctx);
  if (!buffer) {
    const length = Math.floor(ctx.sampleRate * NOISE_SECONDS);
    buffer = ctx.createBuffer(1, length, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    let seed = 0x9e3779b9;
    for (let i = 0; i < length; i++) {
      // xorshift keeps the buffer deterministic across renders
      seed ^= seed << 13;
      seed ^= seed >>> 17;
      seed ^= seed << 5;
      data[i] = ((seed >>> 0) / 4294967296) * 2 - 1;
    }
    noiseCache.set(ctx, buffer);
  }
  return buffer;
}

export function noiseSource(
  ctx: BaseAudioContext,
  builder: VoiceBuilder,
  start: number,
  stop: number,
): AudioBufferSourceNode {
  const src = ctx.createBufferSource();
  src.buffer = noiseBuffer(ctx);
  src.loop = true;
  const offset = Math.random() * (NOISE_SECONDS - 0.5);
  return builder.source(src, stop, start, offset);
}

const curveCache = new Map<string, Float32Array<ArrayBuffer>>();

/** tanh saturation curve normalised to unity at full scale. */
export function saturationCurve(amount: number): Float32Array<ArrayBuffer> {
  const key = `sat:${amount.toFixed(3)}`;
  let curve = curveCache.get(key);
  if (!curve) {
    const n = 2048;
    curve = new Float32Array(n);
    const k = 1 + amount * 12;
    const norm = Math.tanh(k);
    for (let i = 0; i < n; i++) {
      const x = (i / (n - 1)) * 2 - 1;
      curve[i] = Math.tanh(k * x) / norm;
    }
    curveCache.set(key, curve);
  }
  return curve;
}

/** Staircase curve that quantises amplitude, i.e. a bit crusher. */
export function crushCurve(bits: number): Float32Array<ArrayBuffer> {
  const key = `crush:${bits.toFixed(2)}`;
  let curve = curveCache.get(key);
  if (!curve) {
    const n = 8192;
    curve = new Float32Array(n);
    const levels = Math.pow(2, bits) / 2;
    for (let i = 0; i < n; i++) {
      const x = (i / (n - 1)) * 2 - 1;
      curve[i] = Math.round(x * levels) / levels;
    }
    curveCache.set(key, curve);
  }
  return curve;
}

export function shaper(ctx: BaseAudioContext, curve: Float32Array<ArrayBuffer>): WaveShaperNode {
  const node = ctx.createWaveShaper();
  node.curve = curve;
  node.oversample = '2x';
  return node;
}

export function filter(ctx: BaseAudioContext, type: BiquadFilterType, frequency: number, q = 0.707): BiquadFilterNode {
  const node = ctx.createBiquadFilter();
  node.type = type;
  node.frequency.value = Math.min(frequency, ctx.sampleRate / 2 - 100);
  node.Q.value = q;
  return node;
}

export function gain(ctx: BaseAudioContext, value = 1): GainNode {
  const node = ctx.createGain();
  node.gain.value = value;
  return node;
}

export function osc(ctx: BaseAudioContext, type: OscillatorType, frequency: number): OscillatorNode {
  const node = ctx.createOscillator();
  node.type = type;
  node.frequency.value = frequency;
  return node;
}

/** Instant attack, exponential decay to silence. Returns the end time. */
export function percEnvelope(param: AudioParam, time: number, peak: number, decay: number, attack = 0.001): number {
  param.setValueAtTime(0, time);
  param.linearRampToValueAtTime(peak, time + attack);
  param.exponentialRampToValueAtTime(SILENCE, time + attack + decay);
  return time + attack + decay;
}

/**
 * Attack/decay-to-sustain with a gate and release (setTarget curves chain
 * smoothly from whatever value the previous segment reached).
 */
export function gateEnvelope(
  param: AudioParam,
  time: number,
  peak: number,
  attack: number,
  decay: number,
  sustain: number,
  gateEnd: number,
  release: number,
): number {
  param.setValueAtTime(0, time);
  param.linearRampToValueAtTime(peak, time + attack);
  param.setTargetAtTime(peak * sustain, time + attack, Math.max(0.001, decay / 3));
  const releaseStart = Math.max(gateEnd, time + attack);
  param.setTargetAtTime(0, releaseStart, Math.max(0.001, release / 4));
  return releaseStart + release * 1.2;
}

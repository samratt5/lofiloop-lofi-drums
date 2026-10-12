/**
 * MP3 encoding via lamejs (pure JS). The encoder is loaded with a dynamic
 * import so its ~250 KB only ships when someone actually exports an MP3.
 *
 * lamejs does not resample: render the mix at 44100 or 48000 Hz before
 * encoding (32000 also works but is not recommended).
 */
import type { PcmAudio } from './wav';

export type Mp3Bitrate = 128 | 192 | 256 | 320;

/** MPEG-1 Layer III sample rates, the only ones that support 128-320 kbps. */
export const MP3_SAMPLE_RATES = [32000, 44100, 48000] as const;

export interface Mp3Options {
  kbps?: Mp3Bitrate;
  /** Called with 0..1 as encoding proceeds; always ends with 1. */
  onProgress?: (progress: number) => void;
  signal?: AbortSignal;
}

/** Samples per MP3 frame; chunks are a whole number of frames. */
const FRAME = 1152;
const CHUNK = FRAME * 16;
/** Audio seconds to encode between yields to the event loop. */
const YIELD_EVERY_SECONDS = 0.5;

function abortError(): DOMException {
  return new DOMException('Aborted', 'AbortError');
}

function toInt16(source: Float32Array, start: number, target: Int16Array): Int16Array {
  const n = Math.min(target.length, Math.max(0, source.length - start));
  for (let i = 0; i < n; i++) {
    const s = source[start + i];
    // Int16Array wraps out-of-range values, so clip first. NaN stores as 0.
    target[i] = Math.round((s > 1 ? 1 : s < -1 ? -1 : s) * 0x7fff);
  }
  target.fill(0, n);
  return target;
}

export async function encodeMp3(audio: PcmAudio, options: Mp3Options = {}): Promise<Blob> {
  const { kbps = 192, onProgress, signal } = options;
  if (signal?.aborted) throw abortError();

  const numChannels = Math.min(2, audio.channels.length);
  if (numChannels < 1) throw new RangeError('encodeMp3: audio has no channels');
  const sampleRate = Math.round(audio.sampleRate);
  if (!(MP3_SAMPLE_RATES as readonly number[]).includes(sampleRate)) {
    throw new RangeError(`encodeMp3: unsupported sample rate ${sampleRate} Hz (use ${MP3_SAMPLE_RATES.join(', ')})`);
  }

  const { Mp3Encoder } = await import('@breezystack/lamejs');
  if (signal?.aborted) throw abortError();

  const encoder = new Mp3Encoder(numChannels, sampleRate, kbps);
  const [left, right] = audio.channels;
  const total = numChannels === 2 ? Math.max(left.length, right.length) : left.length;
  const leftBuf = new Int16Array(CHUNK);
  const rightBuf = numChannels === 2 ? new Int16Array(CHUNK) : undefined;
  const parts: Uint8Array<ArrayBuffer>[] = [];
  const push = (chunk: ArrayLike<number>) => {
    // lamejs returns an Int8Array; copying to Uint8Array keeps the byte values.
    if (chunk.length) parts.push(new Uint8Array(chunk));
  };

  onProgress?.(0);
  let sinceYield = 0;
  for (let start = 0; start < total; start += CHUNK) {
    const size = Math.min(CHUNK, total - start);
    const l = toInt16(left, start, leftBuf).subarray(0, size);
    const r = rightBuf ? toInt16(right, start, rightBuf).subarray(0, size) : undefined;
    push(encoder.encodeBuffer(l, r));

    sinceYield += size;
    if (sinceYield >= sampleRate * YIELD_EVERY_SECONDS && start + size < total) {
      sinceYield = 0;
      onProgress?.((start + size) / total);
      await new Promise((resolve) => setTimeout(resolve, 0));
      if (signal?.aborted) throw abortError();
    }
  }
  push(encoder.flush());
  onProgress?.(1);

  return new Blob(parts, { type: 'audio/mpeg' });
}

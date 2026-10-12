/**
 * WAV (RIFF/WAVE) encoding plus a couple of level helpers. Works on a plain
 * `PcmAudio` shape so it can be unit tested in Node without Web Audio.
 */
import { createRng } from '@/lib/music/rng';
import { dbToGain } from '@/lib/utils/math';

/** 16/24 = integer PCM (format tag 1), 32 = IEEE float (format tag 3). */
export type WavBitDepth = 16 | 24 | 32;

/** Structural stand-in for AudioBuffer. */
export interface PcmAudio {
  sampleRate: number;
  channels: Float32Array[];
}

export interface WavOptions {
  /** TPDF dither before integer quantization. Defaults to on for 16-bit only. */
  dither?: boolean;
}

const FORMAT_PCM = 1;
const FORMAT_FLOAT = 3;

/** Channel views share memory with the AudioBuffer (no copy). */
export function audioBufferToPcm(buffer: AudioBuffer): PcmAudio {
  const channels: Float32Array[] = [];
  for (let i = 0; i < buffer.numberOfChannels; i++) channels.push(buffer.getChannelData(i));
  return { sampleRate: buffer.sampleRate, channels };
}

function frameCount(audio: PcmAudio): number {
  return audio.channels.reduce((max, ch) => Math.max(max, ch.length), 0);
}

function writeAscii(view: DataView, offset: number, text: string): void {
  for (let i = 0; i < text.length; i++) view.setUint8(offset + i, text.charCodeAt(i));
}

function clip(sample: number): number {
  if (Number.isNaN(sample)) return 0;
  return sample > 1 ? 1 : sample < -1 ? -1 : sample;
}

export function encodeWavBytes(
  audio: PcmAudio,
  bitDepth: WavBitDepth = 16,
  options: WavOptions = {},
): Uint8Array<ArrayBuffer> {
  const numChannels = audio.channels.length;
  if (numChannels < 1) throw new RangeError('encodeWav: audio has no channels');
  if (!(audio.sampleRate > 0)) throw new RangeError('encodeWav: invalid sample rate');

  const isFloat = bitDepth === 32;
  const frames = frameCount(audio);
  const bytesPerSample = bitDepth / 8;
  const blockAlign = numChannels * bytesPerSample;
  const sampleRate = Math.round(audio.sampleRate);
  const dataSize = frames * blockAlign;
  const pad = dataSize % 2; // RIFF chunks are word aligned
  // Non-PCM formats use the 18-byte WAVEFORMATEX (cbSize = 0) and need a fact chunk.
  const fmtSize = isFloat ? 18 : 16;
  const factSize = isFloat ? 12 : 0;
  const headerSize = 12 + 8 + fmtSize + factSize + 8;
  const totalSize = headerSize + dataSize + pad;
  if (totalSize - 8 > 0xffffffff) throw new RangeError('encodeWav: audio too long for a WAV file');

  const bytes = new Uint8Array(totalSize);
  const view = new DataView(bytes.buffer);

  writeAscii(view, 0, 'RIFF');
  view.setUint32(4, totalSize - 8, true);
  writeAscii(view, 8, 'WAVE');

  let o = 12;
  writeAscii(view, o, 'fmt ');
  view.setUint32(o + 4, fmtSize, true);
  view.setUint16(o + 8, isFloat ? FORMAT_FLOAT : FORMAT_PCM, true);
  view.setUint16(o + 10, numChannels, true);
  view.setUint32(o + 12, sampleRate, true);
  view.setUint32(o + 16, sampleRate * blockAlign, true);
  view.setUint16(o + 20, blockAlign, true);
  view.setUint16(o + 22, bitDepth, true);
  if (isFloat) view.setUint16(o + 24, 0, true);
  o += 8 + fmtSize;

  if (isFloat) {
    writeAscii(view, o, 'fact');
    view.setUint32(o + 4, 4, true);
    view.setUint32(o + 8, frames, true);
    o += 12;
  }

  writeAscii(view, o, 'data');
  view.setUint32(o + 4, dataSize, true);
  o += 8;

  const channels = audio.channels;

  if (isFloat) {
    for (let i = 0; i < frames; i++) {
      for (let c = 0; c < numChannels; c++) {
        view.setFloat32(o, clip(channels[c][i] ?? 0), true);
        o += 4;
      }
    }
    return bytes;
  }

  const max = bitDepth === 16 ? 0x7fff : 0x7fffff;
  const min = -max - 1;
  const dither = options.dither ?? bitDepth === 16;
  // Seeded so identical renders produce identical files.
  const rng = createRng(0x5eed);

  for (let i = 0; i < frames; i++) {
    for (let c = 0; c < numChannels; c++) {
      const sample = clip(channels[c][i] ?? 0);
      let scaled = sample * max;
      // TPDF (+-1 LSB); exact digital silence stays silent.
      if (dither && sample !== 0) scaled += rng() - rng();
      let value = Math.round(scaled);
      if (value > max) value = max;
      else if (value < min) value = min;
      if (bitDepth === 16) {
        view.setInt16(o, value, true);
        o += 2;
      } else {
        bytes[o] = value & 0xff;
        bytes[o + 1] = (value >> 8) & 0xff;
        bytes[o + 2] = (value >> 16) & 0xff;
        o += 3;
      }
    }
  }
  return bytes;
}

export function encodeWav(audio: PcmAudio, bitDepth: WavBitDepth = 16, options?: WavOptions): Blob {
  return new Blob([encodeWavBytes(audio, bitDepth, options)], { type: 'audio/wav' });
}

/** Absolute sample peak across all channels (linear, 0 for silence). */
export function peakLevel(audio: PcmAudio): number {
  let peak = 0;
  for (const channel of audio.channels) {
    for (let i = 0; i < channel.length; i++) {
      const v = Math.abs(channel[i]);
      if (v > peak) peak = v;
    }
  }
  return peak;
}

/** Scale so the peak sits at `targetDb` dBFS. Always returns new channel arrays. */
export function normalize(audio: PcmAudio, targetDb = -0.3): PcmAudio {
  const peak = peakLevel(audio);
  const gain = peak > 0 && Number.isFinite(peak) ? dbToGain(targetDb) / peak : 1;
  return {
    sampleRate: audio.sampleRate,
    channels: audio.channels.map((channel) => {
      const out = new Float32Array(channel.length);
      for (let i = 0; i < channel.length; i++) out[i] = channel[i] * gain;
      return out;
    }),
  };
}

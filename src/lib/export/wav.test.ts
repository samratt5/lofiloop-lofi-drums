import { describe, expect, it } from 'vitest';
import { encodeWav, encodeWavBytes, normalize, peakLevel, type PcmAudio } from './wav';

function pcm(channels: number[][], sampleRate = 44100): PcmAudio {
  return { sampleRate, channels: channels.map((c) => Float32Array.from(c)) };
}

function ascii(bytes: Uint8Array, offset: number, length = 4): string {
  return String.fromCharCode(...bytes.subarray(offset, offset + length));
}

function view(bytes: Uint8Array): DataView {
  return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
}

describe('encodeWavBytes', () => {
  it.each([16, 24] as const)('writes a canonical %i-bit PCM header', (bits) => {
    const frames = 10;
    const bytes = encodeWavBytes(pcm([new Array(frames).fill(0), new Array(frames).fill(0)], 48000), bits);
    const v = view(bytes);
    const dataSize = frames * 2 * (bits / 8);

    expect(bytes.length).toBe(44 + dataSize);
    expect(ascii(bytes, 0)).toBe('RIFF');
    expect(v.getUint32(4, true)).toBe(bytes.length - 8);
    expect(ascii(bytes, 8)).toBe('WAVE');
    expect(ascii(bytes, 12)).toBe('fmt ');
    expect(v.getUint32(16, true)).toBe(16);
    expect(v.getUint16(20, true)).toBe(1); // PCM
    expect(v.getUint16(22, true)).toBe(2);
    expect(v.getUint32(24, true)).toBe(48000);
    expect(v.getUint32(28, true)).toBe(48000 * 2 * (bits / 8));
    expect(v.getUint16(32, true)).toBe(2 * (bits / 8));
    expect(v.getUint16(34, true)).toBe(bits);
    expect(ascii(bytes, 36)).toBe('data');
    expect(v.getUint32(40, true)).toBe(dataSize);
  });

  it('writes an IEEE float header with a fact chunk for 32-bit', () => {
    const bytes = encodeWavBytes(pcm([[0.5, -0.25, 1]]), 32);
    const v = view(bytes);

    expect(bytes.length).toBe(58 + 12);
    expect(v.getUint32(4, true)).toBe(bytes.length - 8);
    expect(v.getUint32(16, true)).toBe(18);
    expect(v.getUint16(20, true)).toBe(3); // IEEE float
    expect(v.getUint16(22, true)).toBe(1);
    expect(v.getUint32(28, true)).toBe(44100 * 4);
    expect(v.getUint16(32, true)).toBe(4);
    expect(v.getUint16(34, true)).toBe(32);
    expect(v.getUint16(36, true)).toBe(0); // cbSize
    expect(ascii(bytes, 38)).toBe('fact');
    expect(v.getUint32(46, true)).toBe(3); // frames
    expect(ascii(bytes, 50)).toBe('data');
    expect(v.getUint32(54, true)).toBe(12);
    expect(v.getFloat32(58, true)).toBe(0.5);
    expect(v.getFloat32(62, true)).toBe(-0.25);
    expect(v.getFloat32(66, true)).toBe(1);
  });

  it('interleaves stereo samples left then right', () => {
    const bytes = encodeWavBytes(
      pcm([
        [0.5, 0.25],
        [-0.5, -0.25],
      ]),
      16,
      { dither: false },
    );
    const v = view(bytes);
    expect([0, 1, 2, 3].map((i) => v.getInt16(44 + i * 2, true))).toEqual([
      Math.round(0.5 * 32767),
      Math.round(-0.5 * 32767),
      Math.round(0.25 * 32767),
      Math.round(-0.25 * 32767),
    ]);
  });

  it('clips out-of-range and NaN samples', () => {
    const b16 = encodeWavBytes(pcm([[2, -3, NaN, 1, -1]]), 16, { dither: false });
    const v16 = view(b16);
    expect([0, 1, 2, 3, 4].map((i) => v16.getInt16(44 + i * 2, true))).toEqual([32767, -32767, 0, 32767, -32767]);

    const b32 = view(encodeWavBytes(pcm([[1.5, -9]]), 32));
    expect(b32.getFloat32(58, true)).toBe(1);
    expect(b32.getFloat32(62, true)).toBe(-1);
  });

  it("packs 24-bit samples as little-endian two's complement", () => {
    const bytes = encodeWavBytes(pcm([[0.5, -0.5, 1, -1]]), 24);
    // 0.5 * 8388607 = 4194303.5 -> 4194304 = 0x400000
    expect(Array.from(bytes.subarray(44, 47))).toEqual([0x00, 0x00, 0x40]);
    // -4194303.5 -> -4194303 = 0xC00001
    expect(Array.from(bytes.subarray(47, 50))).toEqual([0x01, 0x00, 0xc0]);
    // 8388607 = 0x7FFFFF
    expect(Array.from(bytes.subarray(50, 53))).toEqual([0xff, 0xff, 0x7f]);
    // -8388607 = 0x800001
    expect(Array.from(bytes.subarray(53, 56))).toEqual([0x01, 0x00, 0x80]);
  });

  it('pads odd-sized data chunks to a word boundary', () => {
    const bytes = encodeWavBytes(pcm([[0.1]]), 24);
    const v = view(bytes);
    expect(v.getUint32(40, true)).toBe(3);
    expect(bytes.length).toBe(48);
    expect(v.getUint32(4, true)).toBe(40);
  });

  it('dithers 16-bit by default within +-1 LSB, deterministically, keeping silence silent', () => {
    const input = pcm([Array.from({ length: 512 }, (_, i) => (i % 2 ? 0 : 0.3))]);
    const a = encodeWavBytes(input, 16);
    const b = encodeWavBytes(input, 16);
    expect(a).toEqual(b);

    const v = view(a);
    const exact = Math.round(0.3 * 32767);
    let changed = 0;
    for (let i = 0; i < 512; i++) {
      const s = v.getInt16(44 + i * 2, true);
      if (i % 2) expect(s).toBe(0);
      else {
        expect(Math.abs(s - exact)).toBeLessThanOrEqual(1);
        if (s !== exact) changed++;
      }
    }
    expect(changed).toBeGreaterThan(0);
  });

  it('handles channels of different lengths by padding with silence', () => {
    const bytes = encodeWavBytes(pcm([[0.5, 0.5], [0.5]]), 16, { dither: false });
    const v = view(bytes);
    expect(v.getUint32(40, true)).toBe(8);
    expect(v.getInt16(50, true)).toBe(0);
  });

  it('rejects audio without channels', () => {
    expect(() => encodeWavBytes({ sampleRate: 44100, channels: [] })).toThrow(RangeError);
  });
});

describe('encodeWav', () => {
  it('returns an audio/wav Blob of the encoded bytes', async () => {
    const audio = pcm([[0, 0.5, -0.5]]);
    const blob = encodeWav(audio, 24);
    expect(blob.type).toBe('audio/wav');
    expect(new Uint8Array(await blob.arrayBuffer())).toEqual(encodeWavBytes(audio, 24));
  });
});

describe('peakLevel / normalize', () => {
  it('finds the absolute peak across channels', () => {
    expect(
      peakLevel(
        pcm([
          [0.1, -0.2],
          [0.05, -0.6],
        ]),
      ),
    ).toBeCloseTo(0.6);
    expect(peakLevel(pcm([[0, 0]]))).toBe(0);
  });

  it('scales the peak to the target level and returns new arrays', () => {
    const input = pcm([
      [0.25, -0.5],
      [0.1, 0],
    ]);
    const out = normalize(input, -6);
    const target = Math.pow(10, -6 / 20);

    expect(peakLevel(out)).toBeCloseTo(target, 5);
    expect(out.channels[0][0]).toBeCloseTo(target / 2, 5);
    expect(out.channels[1][0]).toBeCloseTo(target / 5, 5);
    expect(out.channels[0]).not.toBe(input.channels[0]);
    expect(Array.from(input.channels[0])).toEqual([0.25, -0.5]);
    expect(out.sampleRate).toBe(44100);
  });

  it('defaults to -0.3 dBFS', () => {
    expect(peakLevel(normalize(pcm([[0.1]])))).toBeCloseTo(Math.pow(10, -0.3 / 20), 5);
  });

  it('leaves silence untouched', () => {
    const input = pcm([[0, 0, 0]]);
    const out = normalize(input);
    expect(Array.from(out.channels[0])).toEqual([0, 0, 0]);
    expect(out.channels[0]).not.toBe(input.channels[0]);
  });
});

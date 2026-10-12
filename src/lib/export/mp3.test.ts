import { describe, expect, it } from 'vitest';
import { encodeMp3 } from './mp3';
import type { PcmAudio } from './wav';

function sine(seconds: number, sampleRate = 44100, channels = 2): PcmAudio {
  const n = Math.round(seconds * sampleRate);
  const data = new Float32Array(n);
  for (let i = 0; i < n; i++) data[i] = 0.5 * Math.sin((2 * Math.PI * 440 * i) / sampleRate);
  return { sampleRate, channels: Array.from({ length: channels }, () => data.slice()) };
}

async function header(blob: Blob): Promise<Uint8Array> {
  return new Uint8Array(await blob.slice(0, 4).arrayBuffer());
}

describe('encodeMp3', () => {
  it('encodes stereo audio to an audio/mpeg Blob and reports progress', async () => {
    const progress: number[] = [];
    const blob = await encodeMp3(sine(0.5), { kbps: 128, onProgress: (p) => progress.push(p) });

    expect(blob.type).toBe('audio/mpeg');
    expect(blob.size).toBeGreaterThan(1000);
    const [b0, b1] = await header(blob);
    expect(b0).toBe(0xff); // MPEG frame sync
    expect(b1 & 0xe0).toBe(0xe0);

    expect(progress[0]).toBe(0);
    expect(progress[progress.length - 1]).toBe(1);
    for (let i = 1; i < progress.length; i++) expect(progress[i]).toBeGreaterThanOrEqual(progress[i - 1]);
  });

  it('yields intermediate progress for longer audio', async () => {
    const progress: number[] = [];
    await encodeMp3(sine(2, 48000, 1), { onProgress: (p) => progress.push(p) });
    expect(progress.some((p) => p > 0 && p < 1)).toBe(true);
    expect(progress[progress.length - 1]).toBe(1);
  });

  it('rejects with AbortError when the signal is already aborted', async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(encodeMp3(sine(0.5), { signal: controller.signal })).rejects.toMatchObject({
      name: 'AbortError',
    });
  });

  it('stops when aborted mid-encode', async () => {
    const controller = new AbortController();
    const promise = encodeMp3(sine(3), {
      signal: controller.signal,
      onProgress: (p) => {
        if (p > 0) controller.abort();
      },
    });
    await expect(promise).rejects.toMatchObject({ name: 'AbortError' });
  });

  it('rejects unsupported sample rates', async () => {
    await expect(encodeMp3(sine(0.1, 22050))).rejects.toThrow(RangeError);
  });
});

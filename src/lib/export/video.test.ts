import { describe, expect, it } from 'vitest';
import { defaultVideoBitrate, exportVideo, videoSupport } from './video';

const audio = { sampleRate: 48000, channels: [new Float32Array(48000)] };
const base = { audio, scene: 'window' as const, width: 640, height: 360, title: 'T', seed: 1 };

describe('video export (outside a browser)', () => {
  it('reports no support without WebCodecs', async () => {
    const support = await videoSupport();
    expect(support.mp4).toBe(false);
    expect(support.webm).toBe(false);
    expect(support.mp4Compatible).toBe(false);
  });

  it('rejects an already aborted export with an AbortError', async () => {
    const ctrl = new AbortController();
    ctrl.abort();
    await expect(exportVideo({ ...base, signal: ctrl.signal })).rejects.toMatchObject({ name: 'AbortError' });
  });

  it('rejects empty audio', async () => {
    await expect(exportVideo({ ...base, audio: { sampleRate: 48000, channels: [] } })).rejects.toThrow(RangeError);
  });

  it('explains missing WebCodecs', async () => {
    await expect(exportVideo(base)).rejects.toThrow(/WebCodecs/);
  });

  it('picks sensible default bitrates', () => {
    expect(defaultVideoBitrate(1920, 1080, 30)).toBeGreaterThan(3e6);
    expect(defaultVideoBitrate(1920, 1080, 30)).toBeLessThan(6e6);
    expect(defaultVideoBitrate(320, 180, 24)).toBe(1.5e6);
    expect(defaultVideoBitrate(3840, 2160, 60)).toBe(16e6);
  });
});

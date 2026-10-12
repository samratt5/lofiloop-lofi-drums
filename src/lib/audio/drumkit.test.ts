import { beforeAll, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { defaultParams } from '@/lib/project/instruments';
import { VOICES } from './instruments';
import { FakeBuffer, FakeContext, FakeSource, asContext } from './instruments/fakeAudio';
import type { VoiceInput } from './instruments/utils';

const ROOT = join(process.cwd(), 'public/drums');

/** Decoded buffers come back as FakeBuffers tagged by identity, so tests can trace them. */
class FakeOfflineAudioContext {
  async decodeAudioData() {
    return new FakeBuffer(1, 4410, 44100) as unknown as AudioBuffer;
  }
}

function installFetch() {
  const seen: string[] = [];
  global.fetch = (async (url: string) => {
    const rel = String(url).replace(/^\/drums\//, '');
    seen.push(rel);
    const buf = readFileSync(join(ROOT, rel));
    return {
      ok: true,
      arrayBuffer: async () => buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength),
      json: async () => JSON.parse(buf.toString('utf8')),
    } as unknown as Response;
  }) as unknown as typeof fetch;
  return seen;
}

function sampleBuffer(ctx: FakeContext): unknown {
  const used = ctx.sources.map((source) => (source as unknown as { buffer?: unknown }).buffer).filter(Boolean);
  expect(used).toHaveLength(1);
  return used[0];
}

function playKick(seed?: number, instrument: 'kick' | 'snare' = 'kick') {
  const ctx = new FakeContext();
  const out = ctx.createGain();
  const input: VoiceInput = { time: 1, note: 60, velocity: 0.8, duration: 0.2, variantSeed: seed };
  VOICES[instrument](asContext(ctx), out as unknown as AudioNode, input, defaultParams(instrument));
  return ctx;
}

describe('drumkit', () => {
  let drumkit: typeof import('./drumkit');
  let manifest: Record<string, string[]>;

  beforeAll(async () => {
    vi.stubGlobal('AudioBufferSourceNode', FakeSource);
    vi.stubGlobal('OfflineAudioContext', FakeOfflineAudioContext);
    const seen = installFetch();
    manifest = JSON.parse(readFileSync(join(ROOT, 'manifest.json'), 'utf8')) as Record<string, string[]>;
    drumkit = await import('./drumkit');
    await drumkit.loadDrumKit();
    // The manifest is fetched once, then every listed file is decoded.
    expect(seen[0]).toBe('manifest.json');
    expect(seen).toHaveLength(1 + Object.values(manifest).flat().length);
  });

  it('exposes a variant pool per instrument', () => {
    expect(drumkit.drumKitLoaded()).toBe(true);
    for (const [instrument, files] of Object.entries(manifest)) {
      expect(drumkit.drumVariants(instrument)).toHaveLength(files.length);
    }
    expect(drumkit.drumVariants('not-an-instrument')).toBeUndefined();
  });

  it('plays a decoded sample instead of synthesis once loaded', () => {
    const ctx = playKick(3);
    expect(drumkit.drumVariants('kick')).toContain(sampleBuffer(ctx));
  });

  it('picks the same variant for the same track seed, and a different one for another seed', () => {
    expect(sampleBuffer(playKick(7, 'snare'))).toBe(sampleBuffer(playKick(7, 'snare')));
    expect(sampleBuffer(playKick(7, 'snare'))).not.toBe(sampleBuffer(playKick(1234, 'snare')));
  });
});

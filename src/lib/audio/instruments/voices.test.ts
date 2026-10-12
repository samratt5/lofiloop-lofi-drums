import { beforeEach, describe, expect, it, vi } from 'vitest';
import { INSTRUMENTS, defaultParams, type InstrumentId } from '@/lib/project/instruments';
import { FakeContext, FakeSource, asContext } from './fakeAudio';
import { VOICES } from './index';
import type { VoiceInput } from './utils';

const NEW_VOICES: InstrumentId[] = ['wurli', 'guitar', 'strings', 'flute', 'vox', 'upright', 'riser'];

beforeEach(() => {
  // VoiceBuilder checks `instanceof AudioBufferSourceNode`, which Node lacks.
  vi.stubGlobal('AudioBufferSourceNode', FakeSource);
});

function play(id: InstrumentId, input: Partial<VoiceInput> = {}, params = defaultParams(id), ctx = new FakeContext()) {
  const out = ctx.createGain();
  const voice = VOICES[id](
    asContext(ctx),
    out as unknown as AudioNode,
    { time: 1, note: INSTRUMENTS[id].defaultNote, velocity: 0.8, duration: 0.25, ...input },
    params,
  );
  return { ctx, out, voice };
}

function expectSane(ctx: FakeContext, start: number, end: number) {
  expect(ctx.sources.length).toBeGreaterThan(0);
  for (const s of ctx.sources) {
    expect(s.startTime).not.toBeNull();
    expect(s.startTime).toBeGreaterThanOrEqual(start - 1e-9);
    expect(s.stopTime).not.toBeNull();
    expect(s.stopTime as number).toBeLessThanOrEqual(end + 0.1);
  }
  for (const p of ctx.params) for (const n of p.numbers()) expect(Number.isFinite(n)).toBe(true);
}

describe('new instrument voices', () => {
  it('replace every temporary stand-in', () => {
    for (const id of NEW_VOICES) expect(VOICES[id].name).not.toBe('');
    // Stand-ins were anonymous arrow wrappers; the real voices are named exports.
    expect(NEW_VOICES.map((id) => VOICES[id].name)).toEqual(NEW_VOICES);
  });

  for (const id of NEW_VOICES) {
    describe(id, () => {
      it('builds a finite, self-ending voice at default settings', () => {
        const { ctx, voice } = play(id);
        expect(Number.isFinite(voice.end)).toBe(true);
        expect(voice.end).toBeGreaterThan(1);
        expectSane(ctx, 1, voice.end);
      });

      it('survives extreme, missing and garbage params and inputs', () => {
        const def = INSTRUMENTS[id];
        const variants: Record<string, number>[] = [
          Object.fromEntries(def.params.map((p) => [p.id, p.min])),
          Object.fromEntries(def.params.map((p) => [p.id, p.max])),
          Object.fromEntries(def.params.map((p) => [p.id, Number.NaN])),
          Object.fromEntries(def.params.map((p) => [p.id, Number.POSITIVE_INFINITY])),
          {},
        ];
        for (const params of variants) {
          for (const input of [
            { velocity: 0 },
            { velocity: 1, duration: 8 },
            { velocity: Number.NaN, duration: Number.NaN },
            { duration: 0 },
            { note: def.noteRange[0] },
            { note: def.noteRange[1] },
          ]) {
            const { ctx, voice } = play(id, input, params);
            expect(Number.isFinite(voice.end)).toBe(true);
            expectSane(ctx, 1, voice.end);
          }
        }
      });

      it('can be stopped early without throwing', () => {
        const { ctx, voice } = play(id, { duration: 2 });
        voice.stop(1.1);
        voice.stop(1.2, 0.3);
        expectSane(ctx, 1, voice.end);
      });
    });
  }
});

describe('gates and envelopes', () => {
  it('sustaining voices hold for the gate, then release', () => {
    for (const id of ['strings', 'vox', 'flute', 'wurli'] as InstrumentId[]) {
      // (Gates longer than the attack: a release never starts before the attack completes.)
      const short = play(id, { duration: 0.5 }).voice.end;
      const long = play(id, { duration: 3.3 }).voice.end;
      expect(long - short).toBeCloseTo(2.8, 1);
    }
  });

  it('release params lengthen the tail', () => {
    const quick = play('strings', {}, { ...defaultParams('strings'), release: 0.1 }).voice.end;
    const slow = play('strings', {}, { ...defaultParams('strings'), release: 3 }).voice.end;
    expect(slow - quick).toBeGreaterThan(2.5);
  });

  it('plucked strings ring for their decay and ignore the gate', () => {
    const a = play('guitar', { duration: 0.1 }).voice.end;
    const b = play('guitar', { duration: 3 }).voice.end;
    expect(a).toBeCloseTo(b, 6);
    const long = play('guitar', {}, { ...defaultParams('guitar'), decay: 4 }).voice.end;
    expect(long - 1).toBeGreaterThan(4);
  });

  it('the riser spans exactly the step length', () => {
    for (const duration of [0.5, 2.3, 8]) {
      const { ctx, voice } = play('riser', { duration });
      expect(voice.end).toBeGreaterThanOrEqual(1 + duration);
      expect(voice.end).toBeLessThan(1 + duration + 0.05);
      // Filter sweeps and pitch ramps finish at the end of the swell, just before the cut
      const rampEnds = ctx.params.flatMap((p) => p.numbers()).filter((t) => t > 1 + duration - 0.05);
      expect(rampEnds.length).toBeGreaterThan(0);
    }
  });

  it('the riser never goes silent when both layers are turned down', () => {
    const { ctx } = play('riser', {}, { tone: 0, noise: 0, pitch: 0 });
    expect(ctx.sources.length).toBeGreaterThan(0);
  });
});

describe('retriggering', () => {
  it('damps a ringing note when the same pitch is plucked again on the same track', () => {
    const ctx = new FakeContext();
    const out = ctx.createGain() as unknown as AudioNode;
    const params = defaultParams('guitar');
    const first = VOICES.guitar(asContext(ctx), out, { time: 1, note: 60, velocity: 0.8, duration: 0.2 }, params);
    const sources = ctx.sources.length;
    VOICES.guitar(asContext(ctx), out, { time: 1.5, note: 60, velocity: 0.8, duration: 0.2 }, params);
    const firstSources = ctx.sources.slice(0, sources);
    expect(first.end).toBeGreaterThan(1.5);
    for (const s of firstSources) expect(s.stopTime as number).toBeLessThan(1.6);
  });

  it('leaves other pitches, other tracks and out-of-order previews alone', () => {
    const ctx = new FakeContext();
    const trackA = ctx.createGain() as unknown as AudioNode;
    const trackB = ctx.createGain() as unknown as AudioNode;
    const params = defaultParams('guitar');
    VOICES.guitar(asContext(ctx), trackA, { time: 2, note: 60, velocity: 0.8, duration: 0.2 }, params);
    const n = ctx.sources.length;
    VOICES.guitar(asContext(ctx), trackA, { time: 2.1, note: 64, velocity: 0.8, duration: 0.2 }, params);
    VOICES.guitar(asContext(ctx), trackB, { time: 2.2, note: 60, velocity: 0.8, duration: 0.2 }, params);
    // A preview at an earlier time must not cut the note scheduled later
    VOICES.guitar(asContext(ctx), trackA, { time: 1.5, note: 60, velocity: 0.8, duration: 0.2 }, params);
    for (const s of ctx.sources.slice(0, n)) expect(s.stopTime as number).toBeGreaterThan(3);
  });
});

describe('sampler', () => {
  it('shrugs off garbage params instead of throwing', () => {
    const ctx = new FakeContext();
    const buffer = ctx.createBuffer(1, 48000, 48000) as unknown as AudioBuffer;
    const ref = { id: 's', name: 's', root: 60, start: 0, end: 1, mode: 'pitch', slices: [] } as never;
    const voice = VOICES.sampler(
      asContext(ctx),
      ctx.createGain() as unknown as AudioNode,
      { time: 1, note: 64, velocity: Number.NaN, duration: Number.NaN, sample: { buffer, ref } },
      { tune: Number.NaN, attack: Number.NaN, release: Number.NaN, cutoff: Number.NaN },
    );
    expect(Number.isFinite(voice.end)).toBe(true);
    expectSane(ctx, 1, voice.end);
  });
});

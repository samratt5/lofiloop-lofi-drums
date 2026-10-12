import { describe, expect, it } from 'vitest';
import { integratedLoudness } from '@/lib/export/loudness';
import { AMBIENCE_LABELS, ambienceBuffer, generateAmbience, type AmbienceKind } from './ambience';
import { FakeContext, asContext } from './instruments/fakeAudio';

const KINDS: AmbienceKind[] = ['rain', 'cafe', 'city', 'night', 'room', 'vinyl'];
const RATE = 48000;

const beds = new Map<AmbienceKind, { channels: [Float32Array, Float32Array]; ms: number }>();
function bed(kind: AmbienceKind) {
  let entry = beds.get(kind);
  if (!entry) {
    const start = performance.now();
    const channels = generateAmbience(kind, RATE);
    entry = { channels, ms: performance.now() - start };
    beds.set(kind, entry);
  }
  return entry;
}

describe('ambience beds', () => {
  it('has a label for every type', () => {
    for (const kind of KINDS) expect(AMBIENCE_LABELS[kind]).toBeTruthy();
  });

  for (const kind of KINDS) {
    describe(kind, () => {
      it('is stereo, finite, DC-free and under the ceiling', () => {
        const [l, r] = bed(kind).channels;
        expect(l.length).toBe(r.length);
        expect(l.length / RATE).toBeGreaterThanOrEqual(12);
        let peak = 0;
        let meanL = 0;
        let diff = 0;
        let nonFinite = 0;
        for (let i = 0; i < l.length; i++) {
          if (!Number.isFinite(l[i]) || !Number.isFinite(r[i])) nonFinite++;
          peak = Math.max(peak, Math.abs(l[i]), Math.abs(r[i]));
          meanL += l[i];
          diff += Math.abs(l[i] - r[i]);
        }
        expect(nonFinite).toBe(0);
        expect(peak).toBeLessThanOrEqual(0.9);
        expect(Math.abs(meanL / l.length)).toBeLessThan(1e-4);
        expect(diff / l.length).toBeGreaterThan(1e-4);
      });

      it('sits at the shared loudness target', () => {
        const lufs = integratedLoudness({ sampleRate: RATE, channels: bed(kind).channels });
        expect(Math.abs(lufs + 19)).toBeLessThan(0.5);
      });

      it('loops without a seam', () => {
        for (const ch of bed(kind).channels) {
          const n = ch.length;
          const seam = Math.abs(ch[0] - ch[n - 1]);
          // The step across the loop point must look like any other step: under the 99th percentile.
          const steps = new Float32Array(n - 1);
          for (let i = 1; i < n; i++) steps[i - 1] = Math.abs(ch[i] - ch[i - 1]);
          steps.sort();
          expect(seam).toBeLessThanOrEqual(steps[Math.floor(steps.length * 0.99)]);
          // …and the level either side of the seam matches.
          const w = RATE / 2;
          let before = 0;
          let after = 0;
          for (let i = 0; i < w; i++) {
            before += ch[n - 1 - i] ** 2;
            after += ch[i] ** 2;
          }
          expect(Math.abs(10 * Math.log10(before / after))).toBeLessThan(3);
        }
      });

      it('generates quickly', () => {
        // About 100–350 ms in Chromium; generous here for loaded CI machines.
        expect(bed(kind).ms).toBeLessThan(2000);
      });
    });
  }

  it('is deterministic', () => {
    const again = generateAmbience('vinyl', RATE)[0];
    const first = bed('vinyl').channels[0];
    let differences = 0;
    for (let i = 0; i < first.length; i++) if (again[i] !== first[i]) differences++;
    expect(again.length).toBe(first.length);
    expect(differences).toBe(0);
  });

  it('works at 44.1 kHz and caches per context', () => {
    const ctx = new FakeContext(44100);
    const a = ambienceBuffer(asContext(ctx), 'room');
    const b = ambienceBuffer(asContext(ctx), 'room');
    expect(a).toBe(b);
    expect(ctx.buffers).toBe(1);
    expect(a.numberOfChannels).toBe(2);
    expect(a.duration).toBeCloseTo(12, 2);
    const lufs = integratedLoudness({ sampleRate: 44100, channels: [a.getChannelData(0), a.getChannelData(1)] });
    expect(Math.abs(lufs + 19)).toBeLessThan(0.5);
  });
});

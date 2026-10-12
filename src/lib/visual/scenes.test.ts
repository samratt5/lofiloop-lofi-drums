import { describe, expect, it } from 'vitest';
import { createFakeContext } from './fakeContext';
import { silentFeatures, SPECTRUM_BANDS, type FrameFeatures } from './features';
import { drawScene, drawScenePreview, isSceneId, SCENE_IDS, SCENES } from './scenes';

function features(t: number): FrameFeatures {
  const f = silentFeatures();
  f.beat = Math.exp(-((t * 1.5) % 1) * 5);
  f.bass = 0.5 + 0.4 * f.beat;
  f.mid = 0.5;
  f.high = 0.4 + 0.3 * Math.sin(t);
  f.rms = 0.6;
  for (let i = 0; i < SPECTRUM_BANDS; i++) f.spectrum[i] = Math.max(0, 0.9 - i / 40);
  return f;
}

const SIZES: [number, number][] = [
  [1920, 1080],
  [1080, 1080],
  [1080, 1920],
  [640, 360],
];

describe('SCENES', () => {
  it('lists the five scenes', () => {
    expect(SCENE_IDS).toEqual(['window', 'city', 'room', 'vinyl', 'visualizer']);
    for (const s of SCENES) expect(s.label.length).toBeGreaterThan(2);
    expect(isSceneId('city')).toBe(true);
    expect(isSceneId('nope')).toBe(false);
  });
});

describe('drawScene', () => {
  it('renders every scene at common sizes without invalid numbers', () => {
    for (const scene of SCENE_IDS) {
      for (const [width, height] of SIZES) {
        for (const seed of [0, 7, 123456]) {
          for (const t of [0, 3.7, 181.2]) {
            const fake = createFakeContext();
            drawScene(fake.ctx, scene, {
              t,
              width,
              height,
              seed,
              features: features(t),
              title: 'Rainy Days in Kyoto',
              artist: 'lo.fi collective',
              progress: t / 200,
            });
            expect(fake.problems, `${scene} ${width}x${height} seed ${seed} t ${t}`).toEqual([]);
            expect(fake.calls.length).toBeGreaterThan(40);
          }
        }
      }
    }
  });

  it('survives hostile inputs', () => {
    const bad = {
      ...silentFeatures(),
      rms: NaN,
      bass: Infinity,
      mid: -3,
      high: 9,
      beat: NaN,
      spectrum: new Float32Array(3),
    };
    for (const scene of SCENE_IDS) {
      const fake = createFakeContext();
      drawScene(fake.ctx, scene, {
        t: NaN,
        width: 0,
        height: NaN,
        seed: -Infinity,
        features: bad,
        title: '',
        progress: NaN,
        mood: { valence: 5 },
        overlay: false,
      });
      expect(fake.problems, scene).toEqual([]);
    }
  });

  it('is deterministic in t', () => {
    for (const scene of SCENE_IDS) {
      const a = createFakeContext();
      const b = createFakeContext();
      const frame = { t: 12.5, width: 1280, height: 720, seed: 9, features: features(12.5), title: 'X', progress: 0.5 };
      drawScene(a.ctx, scene, frame);
      drawScene(b.ctx, scene, frame);
      expect(JSON.stringify(a.calls)).toBe(JSON.stringify(b.calls));
    }
  });

  it('draws the overlay only when asked', () => {
    const on = createFakeContext();
    const off = createFakeContext();
    const frame = { t: 1, width: 1280, height: 720, seed: 1, features: features(1), title: 'Hello', progress: 0.2 };
    drawScene(on.ctx, 'city', frame);
    drawScene(off.ctx, 'city', { ...frame, overlay: false });
    const hasTitle = (c: ReturnType<typeof createFakeContext>) =>
      c.calls.some((call) => call.name === 'fillText' && call.args[0] === 'Hello');
    expect(hasTitle(on)).toBe(true);
    expect(hasTitle(off)).toBe(false);
  });

  it('renders previews', () => {
    for (const scene of SCENE_IDS) {
      const fake = createFakeContext();
      drawScenePreview(fake.ctx, scene, { width: 480, height: 270, seed: 4, title: 'Preview' });
      expect(fake.problems).toEqual([]);
    }
  });
});

import { describe, expect, it } from 'vitest';
import { COVER_LAYOUTS, coverDataUrl, coverLayoutFor, drawCover, renderCover } from './cover';
import { createFakeContext } from './fakeContext';

describe('coverLayoutFor', () => {
  it('is deterministic and uses every layout across seeds', () => {
    const seen = new Set<string>();
    for (let seed = 0; seed < 300; seed++) {
      const layout = coverLayoutFor(seed);
      expect(coverLayoutFor(seed)).toBe(layout);
      expect(COVER_LAYOUTS).toContain(layout);
      seen.add(layout);
    }
    expect(seen.size).toBe(COVER_LAYOUTS.length);
  });

  it('leans towards layouts matching the style tags', () => {
    const count = (styles: string[], layout: string) =>
      Array.from({ length: 400 }, (_, s) => coverLayoutFor(s, styles)).filter((l) => l === layout).length;
    expect(count(['rainy'], 'window')).toBeGreaterThan(count([], 'window') * 1.8);
    expect(count(['jazzhop'], 'vinyl')).toBeGreaterThan(count([], 'vinyl') * 1.8);
  });
});

describe('drawCover', () => {
  it('draws every layout without errors or invalid numbers', () => {
    for (const layout of COVER_LAYOUTS) {
      for (const size of [64, 512, 1400]) {
        for (const seed of [0, 1, 99, 2 ** 31 - 1]) {
          const fake = createFakeContext();
          drawCover(fake.ctx, {
            size,
            seed,
            layout,
            title: 'A very long song title that needs wrapping',
            artist: 'Someone',
          });
          expect(fake.problems, `${layout} ${size} ${seed}`).toEqual([]);
          expect(fake.calls.length).toBeGreaterThan(50);
          expect(fake.calls.some((c) => c.name === 'fillText')).toBe(true);
        }
      }
    }
  });

  it('handles odd inputs', () => {
    for (let seed = 0; seed < 60; seed++) {
      const fake = createFakeContext();
      drawCover(fake.ctx, {
        size: 300,
        seed: seed * 104729 - 5e6,
        title: seed % 3 ? '' : '   ',
        artist: seed % 2 ? undefined : '',
        mood: seed % 4 ? { valence: seed / 60, energy: 2, brightness: -1 } : undefined,
        styles: ['lofi', 'rain'],
      });
      expect(fake.problems).toEqual([]);
    }
  });

  it('can skip the typography', () => {
    const fake = createFakeContext();
    drawCover(fake.ctx, { size: 256, seed: 3, title: 'Hello', text: false });
    expect(fake.calls.some((c) => c.name === 'fillText' && c.args[0] === 'Hello')).toBe(false);
  });

  it('is deterministic', () => {
    const a = createFakeContext();
    const b = createFakeContext();
    drawCover(a.ctx, { size: 400, seed: 1234, title: 'Same', artist: 'Me' });
    drawCover(b.ctx, { size: 400, seed: 1234, title: 'Same', artist: 'Me' });
    expect(JSON.stringify(a.calls)).toBe(JSON.stringify(b.calls));
  });
});

describe('outside a browser', () => {
  it('reports missing canvas support clearly', async () => {
    await expect(renderCover({ seed: 1, title: 'x' })).rejects.toThrow(/canvas/);
    expect(coverDataUrl({ seed: 1, title: 'x' })).toBe('');
  });
});

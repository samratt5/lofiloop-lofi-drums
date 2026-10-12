import { describe, expect, it } from 'vitest';
import { hexToRgb, hsl, luminance, mixColor, moodFromProject, paletteFor, PALETTE_FAMILIES, rgba } from './palette';

const HEX = /^#[0-9a-f]{6}$/;
const COLOR_KEYS = [
  'skyTop',
  'skyMid',
  'skyBottom',
  'glow',
  'accent',
  'accent2',
  'ink',
  'inkSoft',
  'haze',
  'window',
  'paper',
  'text',
  'textSoft',
] as const;

describe('colour helpers', () => {
  it('converts HSL to hex', () => {
    expect(hsl(0, 1, 0.5)).toBe('#ff0000');
    expect(hsl(120, 1, 0.5)).toBe('#00ff00');
    expect(hsl(240, 1, 0.5)).toBe('#0000ff');
    expect(hsl(-120, 1, 0.5)).toBe('#0000ff');
    expect(hsl(0, 0, 1)).toBe('#ffffff');
  });

  it('parses, mixes and formats colours', () => {
    expect(hexToRgb('#ff8000')).toEqual([255, 128, 0]);
    expect(hexToRgb('#fff')).toEqual([255, 255, 255]);
    expect(hexToRgb('nope')).toEqual([0, 0, 0]);
    expect(mixColor('#000000', '#ffffff', 0.5)).toBe('#808080');
    expect(rgba('#ff0000', 0.25)).toBe('rgba(255,0,0,0.25)');
    expect(rgba('#ff0000', NaN)).toBe('rgba(255,0,0,0)');
    expect(luminance('#ffffff')).toBeCloseTo(1);
    expect(luminance('#000000')).toBe(0);
  });
});

describe('paletteFor', () => {
  it('is deterministic per seed and mood', () => {
    expect(paletteFor(42)).toEqual(paletteFor(42));
    const mood = { valence: 0.8, energy: 0.3, brightness: 0.7 };
    expect(paletteFor(7, mood)).toEqual(paletteFor(7, mood));
  });

  it('varies across seeds and only emits valid colours', () => {
    const families = new Set<string>();
    for (let seed = 0; seed < 200; seed++) {
      const p = paletteFor(seed * 7919);
      families.add(p.family);
      for (const key of COLOR_KEYS) expect(p[key]).toMatch(HEX);
    }
    expect(families.size).toBeGreaterThanOrEqual(PALETTE_FAMILIES.length - 1);
  });

  it('follows the mood: sad and dark songs get night skies, happy and bright ones warm skies', () => {
    const sad = Array.from({ length: 60 }, (_, s) => paletteFor(s, { valence: 0.05, energy: 0.3, brightness: 0.1 }));
    const happy = Array.from({ length: 60 }, (_, s) => paletteFor(s, { valence: 0.95, energy: 0.6, brightness: 0.9 }));
    const avgLum = (ps: typeof sad) => ps.reduce((a, p) => a + luminance(p.skyMid), 0) / ps.length;
    expect(sad.filter((p) => p.night).length).toBeGreaterThan(50);
    expect(happy.filter((p) => p.night).length).toBe(0);
    expect(avgLum(happy)).toBeGreaterThan(avgLum(sad) * 4);
    expect(new Set(sad.map((p) => p.family))).not.toContain('goldenHour');
    expect(new Set(happy.map((p) => p.family))).not.toContain('midnight');
  });

  it('picks readable title colours on bright skies', () => {
    for (let seed = 0; seed < 40; seed++) {
      const p = paletteFor(seed, { valence: 0.95, energy: 0.5, brightness: 0.95 });
      if (luminance(p.skyBottom) > 0.4 && luminance(p.skyMid) > 0.3) expect(p.text).toBe(p.ink);
    }
  });

  it('raises saturation with energy', () => {
    const sat = (hex: string) => {
      const [r, g, b] = hexToRgb(hex);
      return Math.max(r, g, b) - Math.min(r, g, b);
    };
    const calm = paletteFor(5, { valence: 0.5, energy: 0, brightness: 0.5 });
    const wild = paletteFor(5, { valence: 0.5, energy: 1, brightness: 0.5 });
    expect(calm.family).toBe(wild.family);
    expect(sat(wild.accent)).toBeGreaterThan(sat(calm.accent));
  });
});

describe('moodFromProject', () => {
  const base = { bpm: 80, fx: { tone: 0.5 } as never, meta: { artist: '', coverSeed: 1, styles: [] as string[] } };
  it('reads key, tempo and style tags', () => {
    const minor = moodFromProject({ ...base, scale: 'minor' });
    const major = moodFromProject({ ...base, scale: 'major' });
    expect(major.valence).toBeGreaterThan(minor.valence);
    expect(moodFromProject({ ...base, scale: 'minor', bpm: 130 }).energy).toBeGreaterThan(minor.energy);
    const rainy = moodFromProject({ ...base, scale: 'minor', meta: { ...base.meta, styles: ['rainy night'] } });
    expect(rainy.valence).toBeLessThan(minor.valence);
    for (const v of Object.values(rainy)) expect(v).toBeGreaterThanOrEqual(0);
  });
});

/**
 * Mood-aware colour palettes for cover art and video scenes. Everything is
 * derived from a seed so the same project always gets the same colours.
 */
import { createRng, type Rng } from '@/lib/music/rng';
import type { Project } from '@/lib/project/types';

/** How a song feels, each 0..1. Low valence = sad/dark, high = happy/warm. */
export interface Mood {
  valence: number;
  energy: number;
  brightness: number;
}

export interface Palette {
  /** Family the palette was built from, e.g. 'midnight' or 'goldenHour' */
  family: PaletteFamily;
  /** True when the sky is dark enough for stars, moon and lit windows */
  night: boolean;
  skyTop: string;
  skyMid: string;
  skyBottom: string;
  /** Light source: moon, sun, lamp */
  glow: string;
  /** Warm highlight (lamps, trails, progress) */
  accent: string;
  /** Secondary highlight, usually a cool counterpoint */
  accent2: string;
  /** Darkest silhouettes (foreground) */
  ink: string;
  /** Mid-distance silhouettes */
  inkSoft: string;
  /** Far layers and atmosphere */
  haze: string;
  /** Warm lit window colour */
  window: string;
  /** Light "paper" colour for labels and sleeves */
  paper: string;
  /** Title colour that reads well on the sky */
  text: string;
  /** Secondary text colour */
  textSoft: string;
}

type Hsl = readonly [number, number, number];

interface FamilySpec {
  valence: number;
  brightness: number;
  weight: number;
  skyTop: Hsl;
  skyMid: Hsl;
  skyBottom: Hsl;
  glow: Hsl;
  accent: Hsl;
  accent2: Hsl;
  ink: Hsl;
  inkSoft: Hsl;
  haze: Hsl;
  window: Hsl;
  paper: Hsl;
}

const FAMILIES = {
  midnight: {
    valence: 0.15,
    brightness: 0.15,
    weight: 1.2,
    skyTop: [236, 0.48, 0.07],
    skyMid: [252, 0.4, 0.15],
    skyBottom: [282, 0.34, 0.27],
    glow: [42, 0.75, 0.82],
    accent: [30, 0.95, 0.68],
    accent2: [188, 0.5, 0.55],
    ink: [246, 0.38, 0.05],
    inkSoft: [252, 0.3, 0.12],
    haze: [268, 0.26, 0.3],
    window: [38, 0.92, 0.66],
    paper: [36, 0.35, 0.9],
  },
  tealNight: {
    valence: 0.25,
    brightness: 0.25,
    weight: 1,
    skyTop: [212, 0.55, 0.08],
    skyMid: [198, 0.45, 0.17],
    skyBottom: [176, 0.33, 0.3],
    glow: [52, 0.55, 0.85],
    accent: [22, 0.9, 0.64],
    accent2: [168, 0.5, 0.55],
    ink: [212, 0.42, 0.05],
    inkSoft: [206, 0.32, 0.12],
    haze: [190, 0.26, 0.3],
    window: [40, 0.88, 0.64],
    paper: [44, 0.3, 0.9],
  },
  emberNight: {
    valence: 0.35,
    brightness: 0.3,
    weight: 0.9,
    skyTop: [252, 0.45, 0.07],
    skyMid: [326, 0.38, 0.15],
    skyBottom: [14, 0.58, 0.33],
    glow: [28, 0.95, 0.7],
    accent: [18, 0.95, 0.6],
    accent2: [44, 0.9, 0.62],
    ink: [262, 0.36, 0.05],
    inkSoft: [318, 0.26, 0.12],
    haze: [10, 0.34, 0.3],
    window: [36, 0.95, 0.64],
    paper: [30, 0.45, 0.9],
  },
  plumDusk: {
    valence: 0.45,
    brightness: 0.45,
    weight: 1.1,
    skyTop: [262, 0.4, 0.13],
    skyMid: [302, 0.34, 0.28],
    skyBottom: [346, 0.55, 0.56],
    glow: [32, 0.92, 0.74],
    accent: [22, 0.92, 0.66],
    accent2: [318, 0.45, 0.62],
    ink: [270, 0.36, 0.07],
    inkSoft: [286, 0.28, 0.17],
    haze: [322, 0.3, 0.4],
    window: [36, 0.95, 0.7],
    paper: [30, 0.5, 0.92],
  },
  rosewood: {
    valence: 0.58,
    brightness: 0.55,
    weight: 0.9,
    skyTop: [232, 0.34, 0.22],
    skyMid: [330, 0.38, 0.45],
    skyBottom: [20, 0.72, 0.68],
    glow: [42, 0.96, 0.8],
    accent: [12, 0.78, 0.62],
    accent2: [262, 0.35, 0.56],
    ink: [262, 0.32, 0.11],
    inkSoft: [300, 0.22, 0.24],
    haze: [340, 0.32, 0.55],
    window: [40, 0.96, 0.72],
    paper: [34, 0.6, 0.94],
  },
  lavender: {
    valence: 0.65,
    brightness: 0.72,
    weight: 0.8,
    skyTop: [248, 0.38, 0.54],
    skyMid: [284, 0.38, 0.68],
    skyBottom: [332, 0.62, 0.8],
    glow: [48, 0.92, 0.88],
    accent: [14, 0.85, 0.64],
    accent2: [198, 0.5, 0.52],
    ink: [258, 0.36, 0.18],
    inkSoft: [268, 0.26, 0.36],
    haze: [300, 0.32, 0.7],
    window: [44, 0.98, 0.74],
    paper: [36, 0.55, 0.95],
  },
  goldenHour: {
    valence: 0.82,
    brightness: 0.78,
    weight: 1,
    skyTop: [26, 0.62, 0.6],
    skyMid: [18, 0.78, 0.68],
    skyBottom: [42, 0.9, 0.77],
    glow: [48, 1, 0.86],
    accent: [8, 0.72, 0.56],
    accent2: [338, 0.46, 0.52],
    ink: [14, 0.36, 0.16],
    inkSoft: [14, 0.34, 0.32],
    haze: [22, 0.5, 0.6],
    window: [46, 1, 0.76],
    paper: [40, 0.7, 0.96],
  },
  peachMorning: {
    valence: 0.92,
    brightness: 0.92,
    weight: 0.7,
    skyTop: [202, 0.42, 0.74],
    skyMid: [22, 0.78, 0.8],
    skyBottom: [36, 0.9, 0.85],
    glow: [46, 1, 0.9],
    accent: [10, 0.78, 0.64],
    accent2: [190, 0.42, 0.46],
    ink: [220, 0.26, 0.2],
    inkSoft: [212, 0.2, 0.38],
    haze: [20, 0.42, 0.74],
    window: [44, 1, 0.76],
    paper: [30, 0.45, 0.97],
  },
} satisfies Record<string, FamilySpec>;

export type PaletteFamily = keyof typeof FAMILIES;
export const PALETTE_FAMILIES = Object.keys(FAMILIES) as PaletteFamily[];

const NEUTRAL_MOOD: Mood = { valence: 0.35, energy: 0.4, brightness: 0.35 };

// ---- colour helpers ------------------------------------------------------

function clamp01(v: number): number {
  return Number.isFinite(v) ? (v < 0 ? 0 : v > 1 ? 1 : v) : 0;
}

function hex2(v: number): string {
  return Math.round(clamp01(v) * 255)
    .toString(16)
    .padStart(2, '0');
}

/** HSL (h in degrees, s/l 0..1) to `#rrggbb`. */
export function hsl(h: number, s: number, l: number): string {
  const hue = (((h % 360) + 360) % 360) / 360;
  s = clamp01(s);
  l = clamp01(l);
  if (s === 0) return `#${hex2(l)}${hex2(l)}${hex2(l)}`;
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  const channel = (t: number) => {
    if (t < 0) t += 1;
    if (t > 1) t -= 1;
    if (t < 1 / 6) return p + (q - p) * 6 * t;
    if (t < 1 / 2) return q;
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
    return p;
  };
  return `#${hex2(channel(hue + 1 / 3))}${hex2(channel(hue))}${hex2(channel(hue - 1 / 3))}`;
}

/** Parses `#rgb` / `#rrggbb` into 0..255 channels (black when invalid). */
export function hexToRgb(color: string): [number, number, number] {
  let h = color.startsWith('#') ? color.slice(1) : color;
  if (h.length === 3) h = h.replace(/./g, (c) => c + c);
  const n = parseInt(h.slice(0, 6), 16);
  if (!Number.isFinite(n) || h.length < 6) return [0, 0, 0];
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/** `rgba()` string for a hex colour with the given alpha. */
export function rgba(color: string, alpha: number): string {
  const [r, g, b] = hexToRgb(color);
  return `rgba(${r},${g},${b},${Math.round(clamp01(alpha) * 1000) / 1000})`;
}

/** Linear mix of two hex colours, t = 0 gives `a`. */
export function mixColor(a: string, b: string, t: number): string {
  const ca = hexToRgb(a);
  const cb = hexToRgb(b);
  const k = clamp01(t);
  return `#${ca.map((v, i) => hex2((v + (cb[i] - v) * k) / 255)).join('')}`;
}

/** Relative luminance 0..1 (sRGB, WCAG formula). */
export function luminance(color: string): number {
  const [r, g, b] = hexToRgb(color).map((v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

// ---- palettes ------------------------------------------------------------

function normalizeMood(mood?: Partial<Mood>): Mood {
  return {
    valence: clamp01(mood?.valence ?? NEUTRAL_MOOD.valence),
    energy: clamp01(mood?.energy ?? NEUTRAL_MOOD.energy),
    brightness: clamp01(mood?.brightness ?? NEUTRAL_MOOD.brightness),
  };
}

function chooseFamily(rng: Rng, mood: Partial<Mood> | undefined): PaletteFamily {
  const entries = Object.entries(FAMILIES) as [PaletteFamily, FamilySpec][];
  let weights: number[];
  if (!mood) {
    weights = entries.map(([, f]) => f.weight);
  } else {
    const m = normalizeMood(mood);
    weights = entries.map(([, f]) => {
      const d = Math.abs(m.valence - f.valence) + 0.8 * Math.abs(m.brightness - f.brightness);
      return f.weight * Math.exp(-((d / 0.2) ** 2));
    });
  }
  const total = weights.reduce((a, b) => a + b, 0);
  let r = rng() * total;
  for (let i = 0; i < entries.length; i++) {
    r -= weights[i];
    if (r <= 0) return entries[i][0];
  }
  return entries[entries.length - 1][0];
}

/**
 * Deterministic palette for a seed. With a mood, sad/dark songs lean indigo,
 * plum and teal nights while happy/bright ones lean peach, coral and golden
 * hour; energy raises saturation and contrast.
 */
export function paletteFor(seed: number, mood?: Partial<Mood>): Palette {
  const rng = createRng((seed ^ 0x9a1e77e) >>> 0);
  const family = chooseFamily(rng, mood);
  const spec: FamilySpec = FAMILIES[family];
  const m = normalizeMood(mood);
  const hueShift = (rng() - 0.5) * 24;
  const satScale = 0.78 + m.energy * 0.42;
  const contrast = (m.energy - 0.4) * 0.05;
  const lift = mood ? (m.brightness - spec.brightness) * 0.08 : 0;

  const make = (c: Hsl, lightBias = 0) => {
    const l = c[2] + lift + lightBias;
    return hsl(c[0] + hueShift, c[1] * satScale, l);
  };
  const skyBottom = make(spec.skyBottom);
  const skyMid = make(spec.skyMid);
  const skyTop = make(spec.skyTop);
  const night = luminance(skyMid) < 0.08;
  const bright = luminance(skyBottom) > 0.4 && luminance(skyMid) > 0.3;
  const ink = make(spec.ink, -contrast);
  const paper = make(spec.paper);
  return {
    family,
    night,
    skyTop,
    skyMid,
    skyBottom,
    glow: make(spec.glow, contrast * 0.5),
    accent: make(spec.accent),
    accent2: make(spec.accent2),
    ink,
    inkSoft: make(spec.inkSoft, -contrast * 0.5),
    haze: make(spec.haze),
    window: make(spec.window),
    paper,
    text: bright ? ink : paper,
    textSoft: bright ? mixColor(ink, skyMid, 0.35) : mixColor(paper, skyMid, 0.35),
  };
}

const HAPPY_SCALES = new Set(['major', 'lydian', 'mixolydian', 'pentatonicMajor']);
const SAD_WORDS = /sad|melanch|dark|rain|night|lonely|blue|moody|ambient|sleep|midnight/i;
const HAPPY_WORDS = /happy|sun|summer|bright|morning|chill|jazz|house|funk|dance|warm/i;

/** Rough mood guess from the project's key, tempo, tone and style tags. */
export function moodFromProject(project: Pick<Project, 'scale' | 'bpm' | 'fx' | 'meta'>): Mood {
  let valence = HAPPY_SCALES.has(project.scale) ? 0.66 : project.scale === 'dorian' ? 0.45 : 0.28;
  let brightness = 0.25 + 0.5 * clamp01(project.fx?.tone ?? 0.5);
  const styles = (project.meta?.styles ?? []).join(' ');
  if (SAD_WORDS.test(styles)) {
    valence -= 0.12;
    brightness -= 0.1;
  }
  if (HAPPY_WORDS.test(styles)) {
    valence += 0.12;
    brightness += 0.1;
  }
  const energy = clamp01((project.bpm - 60) / 80);
  return { valence: clamp01(valence), energy, brightness: clamp01(brightness) };
}

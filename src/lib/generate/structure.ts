/**
 * Song-level genre knowledge (arrangement templates, feel, mix and ambience
 * defaults) and the arithmetic that fits an arrangement to a target length.
 */
import type { InstrumentId } from '@/lib/project/instruments';
import type { AmbienceType, SectionKind } from '@/lib/project/types';
import type { GenreId } from './genres';

export interface SectionTemplate {
  kind: SectionKind;
  /** Natural length in bars (a multiple of 4) */
  bars: number;
  /** Removal rank when the song must be shorter: lower goes first, 0 = never removed */
  drop?: number;
  /** Display name, e.g. "Build" for a house prechorus */
  name?: string;
}

export interface StructureTemplate {
  sections: SectionTemplate[];
  /** Groups inserted (cycled) before the last hook/drop to make a song longer */
  extend: SectionTemplate[][];
}

/** Track timing feel per part, −1..1 (+ = laid back), and humanize 0..1. */
export interface FeelSettings {
  kick: number;
  snare: number;
  hat: number;
  perc: number;
  bass: number;
  chords: number;
  melody: number;
  humanizeDrums: number;
  humanizeMelodic: number;
  /** 0..1 how much ghost notes are nudged off the grid */
  ghostOffset: number;
}

export interface SongStyle {
  structures: StructureTemplate[];
  /** Grooves are written in half time (snare on 3) at roughly double the felt tempo. */
  halfTime: boolean;
  feel: FeelSettings;
  /** Sidechain amount for the bass; pads/keys get a share of it. */
  duck: number;
  ambience: [AmbienceType, number][];
  /** 0..1 chance of a riser/crash kit and of cutting to silence before a hook */
  energy: number;
  /** Pop-leaning styles may lift the key for the last hook. */
  keyLift: boolean;
  /** Tape-stop endings suit dusty styles. */
  tapeStop: boolean;
  /** Extra instruments a song in this style adds to the genre kit */
  extras: InstrumentId[];
}

const s = (kind: SectionKind, bars: number, drop = 0, name?: string): SectionTemplate => ({ kind, bars, drop, name });

const LOFI_FEEL: FeelSettings = {
  kick: 0,
  snare: 0.2,
  hat: 0.4,
  perc: 0.3,
  bass: 0.1,
  chords: 0.15,
  melody: 0.1,
  humanizeDrums: 0.3,
  humanizeMelodic: 0.25,
  ghostOffset: 1,
};

const TIGHT_FEEL: FeelSettings = {
  kick: 0,
  snare: 0,
  hat: 0,
  perc: 0,
  bass: 0,
  chords: 0,
  melody: 0,
  humanizeDrums: 0,
  humanizeMelodic: 0.05,
  ghostOffset: 0,
};

export const SONG_STYLES: Record<GenreId, SongStyle> = {
  lofi: {
    structures: [
      {
        sections: [
          s('intro', 4, 9),
          s('verse', 8),
          s('hook', 8),
          s('verse', 8, 3),
          s('break', 4, 1),
          s('hook', 8, 3),
          s('outro', 4, 8),
        ],
        extend: [
          [s('verse', 8), s('hook', 8)],
          [s('bridge', 8), s('hook', 8)],
        ],
      },
      {
        sections: [
          s('intro', 4, 9),
          s('hook', 8),
          s('verse', 8),
          s('hook', 8, 3),
          s('bridge', 8, 1),
          s('hook', 8, 2),
          s('outro', 4, 8),
        ],
        extend: [
          [s('verse', 8), s('hook', 8)],
          [s('break', 4), s('hook', 8)],
        ],
      },
    ],
    halfTime: false,
    feel: LOFI_FEEL,
    duck: 0.15,
    ambience: [
      ['rain', 3],
      ['vinyl', 2],
      ['none', 3],
    ],
    energy: 0.15,
    keyLift: false,
    tapeStop: true,
    extras: ['rim', 'shaker', 'tom', 'shaker2'],
  },
  jazzhop: {
    structures: [
      {
        sections: [
          s('intro', 4, 9),
          s('verse', 8),
          s('hook', 8),
          s('verse', 8, 3),
          s('bridge', 8, 1),
          s('hook', 8, 3),
          s('outro', 4, 8),
        ],
        extend: [
          [s('verse', 8), s('hook', 8)],
          [s('break', 4), s('hook', 8)],
        ],
      },
    ],
    halfTime: false,
    feel: { ...LOFI_FEEL, snare: 0.15, hat: 0.35, perc: 0.25, bass: 0.05, chords: 0.1, humanizeDrums: 0.35 },
    duck: 0.1,
    ambience: [
      ['cafe', 5],
      ['vinyl', 1],
      ['none', 2],
    ],
    energy: 0.1,
    keyLift: false,
    tapeStop: true,
    extras: [],
  },
  boombap: {
    structures: [
      {
        sections: [
          s('intro', 4, 9),
          s('verse', 16),
          s('hook', 8),
          s('verse', 16, 3),
          s('hook', 8, 3),
          s('break', 4, 1),
          s('hook', 8, 2),
          s('outro', 4, 8),
        ],
        extend: [[s('verse', 16), s('hook', 8)]],
      },
    ],
    halfTime: false,
    feel: { ...LOFI_FEEL, snare: 0.15, hat: 0.25, bass: 0.05, chords: 0.1, humanizeDrums: 0.2, humanizeMelodic: 0.15 },
    duck: 0.15,
    ambience: [
      ['city', 2],
      ['vinyl', 2],
      ['none', 3],
    ],
    energy: 0.3,
    keyLift: false,
    tapeStop: true,
    extras: [],
  },
  chillhop: {
    structures: [
      {
        sections: [
          s('intro', 4, 9),
          s('verse', 8),
          s('hook', 8),
          s('verse', 8, 3),
          s('break', 8, 1),
          s('hook', 8, 3),
          s('outro', 4, 8),
        ],
        extend: [
          [s('verse', 8), s('hook', 8)],
          [s('bridge', 8), s('hook', 8)],
        ],
      },
    ],
    halfTime: false,
    feel: {
      ...LOFI_FEEL,
      snare: 0.1,
      hat: 0.2,
      perc: 0.15,
      bass: 0.05,
      chords: 0.1,
      humanizeDrums: 0.15,
      humanizeMelodic: 0.15,
      ghostOffset: 0.6,
    },
    duck: 0.2,
    ambience: [
      ['city', 2],
      ['none', 3],
      ['vinyl', 1],
    ],
    energy: 0.4,
    keyLift: true,
    tapeStop: false,
    extras: [],
  },
  trap: {
    structures: [
      {
        // Half time: twice the bars of a straight style for the same musical length.
        sections: [
          s('intro', 8, 9),
          s('hook', 16),
          s('verse', 16),
          s('hook', 16, 3),
          s('bridge', 8, 1),
          s('hook', 16, 2),
          s('outro', 8, 8),
        ],
        extend: [
          [s('verse', 16), s('hook', 16)],
          [s('bridge', 8), s('hook', 16)],
        ],
      },
    ],
    halfTime: true,
    feel: TIGHT_FEEL,
    duck: 0.45,
    ambience: [['none', 1]],
    energy: 0.9,
    keyLift: false,
    tapeStop: false,
    extras: ['crash', 'riser'],
  },
  rnb: {
    structures: [
      {
        sections: [
          s('intro', 4, 9),
          s('verse', 8),
          s('prechorus', 4, 3),
          s('hook', 8),
          s('verse', 8, 2),
          s('prechorus', 4, 1),
          s('hook', 8, 2),
          s('bridge', 8, 1),
          s('hook', 8, 4),
          s('outro', 4, 8),
        ],
        extend: [[s('verse', 8), s('prechorus', 4), s('hook', 8)]],
      },
    ],
    halfTime: false,
    feel: {
      ...LOFI_FEEL,
      snare: 0.2,
      hat: 0.3,
      bass: 0.05,
      chords: 0.1,
      humanizeDrums: 0.2,
      humanizeMelodic: 0.2,
      ghostOffset: 0.7,
    },
    duck: 0.2,
    ambience: [
      ['none', 3],
      ['night', 1],
      ['room', 1],
    ],
    energy: 0.3,
    keyLift: true,
    tapeStop: false,
    extras: [],
  },
  house: {
    structures: [
      {
        sections: [
          s('intro', 8, 9),
          s('prechorus', 8, 0, 'Build'),
          s('drop', 16),
          s('break', 8, 2),
          s('prechorus', 8, 2, 'Build'),
          s('drop', 16, 3),
          s('outro', 8, 8),
        ],
        extend: [[s('break', 8), s('prechorus', 8, 0, 'Build'), s('drop', 16)]],
      },
    ],
    halfTime: false,
    feel: { ...TIGHT_FEEL, hat: 0.1, humanizeDrums: 0.05 },
    duck: 0.55,
    ambience: [['none', 1]],
    energy: 0.8,
    keyLift: false,
    tapeStop: false,
    extras: ['crash', 'riser'],
  },
  ambient: {
    structures: [
      {
        sections: [
          s('intro', 8, 9),
          s('verse', 16),
          s('hook', 16),
          s('break', 8, 1),
          s('hook', 16, 3),
          s('outro', 8, 8),
        ],
        extend: [
          [s('verse', 16), s('hook', 16)],
          [s('bridge', 16), s('hook', 16)],
        ],
      },
    ],
    halfTime: false,
    feel: { ...TIGHT_FEEL, humanizeDrums: 0.2, humanizeMelodic: 0.3 },
    duck: 0.05,
    ambience: [
      ['night', 3],
      ['rain', 2],
      ['none', 1],
    ],
    energy: 0,
    keyLift: false,
    tapeStop: false,
    extras: [],
  },
};

/** Default energy (0..1) of each kind of section. */
export const KIND_ENERGY: Record<SectionKind, number> = {
  intro: 0.2,
  verse: 0.55,
  prechorus: 0.7,
  hook: 0.82,
  break: 0.3,
  bridge: 0.5,
  drop: 1,
  outro: 0.25,
  custom: 0.6,
};

/** Smallest and largest bar counts a section of each kind is stretched to. */
const MIN_BARS: Record<SectionKind, number> = {
  intro: 4,
  verse: 4,
  prechorus: 4,
  hook: 4,
  break: 4,
  bridge: 4,
  drop: 8,
  outro: 4,
  custom: 4,
};

const MAX_BARS: Record<SectionKind, number> = {
  intro: 8,
  verse: 16,
  prechorus: 8,
  hook: 16,
  break: 8,
  bridge: 16,
  drop: 32,
  outro: 8,
  custom: 16,
};

/** Order in which sections grow by 8 bars (whole phrases) when the song must be longer. */
const GROW_ORDER: SectionKind[] = ['verse', 'hook', 'drop', 'bridge', 'break', 'intro', 'outro', 'prechorus', 'custom'];
/** Order for the last 4 bars of growth: framing sections first, so verses and hooks stay 8/16 bars. */
const FINE_GROW_ORDER: SectionKind[] = [
  'intro',
  'outro',
  'break',
  'bridge',
  'prechorus',
  'verse',
  'hook',
  'drop',
  'custom',
];
/** Order in which sections shrink when the song must be shorter. */
const SHRINK_ORDER: SectionKind[] = [
  'verse',
  'hook',
  'drop',
  'bridge',
  'break',
  'custom',
  'outro',
  'intro',
  'prechorus',
];
const FINE_SHRINK_ORDER: SectionKind[] = [
  'break',
  'bridge',
  'prechorus',
  'outro',
  'intro',
  'verse',
  'hook',
  'drop',
  'custom',
];

/** Collapse neighbouring sections of the same kind (left behind when the section between them is cut). */
function mergeRuns(list: SectionTemplate[]): SectionTemplate[] {
  const out: SectionTemplate[] = [];
  for (const t of list) {
    const last = out[out.length - 1];
    if (last && last.kind === t.kind) out[out.length - 1] = { ...last, bars: Math.max(last.bars, t.bars) };
    else out.push(t);
  }
  return out;
}

export interface FittedSection {
  kind: SectionKind;
  bars: number;
  name?: string;
}

/** Target song length in bars: a multiple of 4, at least 4. */
export function targetBars(minutes: number, bpm: number): number {
  return Math.max(4, Math.round((minutes * bpm) / 4 / 4) * 4);
}

/**
 * When whole 4-bar phrases would miss the requested duration by more than a
 * bar, nudge the tempo by up to ±`reach` BPM (within [lo, hi]) so they fit.
 * Tempos that already fit are left alone to keep the variety between seeds.
 */
export function fitTempo(bpm: number, minutes: number, lo: number, hi: number, reach = 3): number {
  const error = (b: number) => Math.abs((targetBars(minutes, b) * 240) / b - minutes * 60);
  const fits = (b: number) => error(b) <= 240 / b;
  if (fits(bpm)) return bpm;
  let best = bpm;
  for (let d = 1; d <= reach; d++) {
    for (const b of [bpm - d, bpm + d]) {
      if (b < lo || b > hi) continue;
      if (fits(b)) return b;
      if (error(b) < error(best)) best = b;
    }
  }
  return best;
}

export interface FitOptions {
  /** Long ambient pieces let verses, hooks and bridges run to 32 bars. */
  long?: boolean;
  /** Half-time styles: every section may run twice as long. */
  wide?: boolean;
}

function limits(kind: SectionKind, options: FitOptions): [number, number] {
  let max = options.long && (kind === 'verse' || kind === 'hook' || kind === 'bridge') ? 32 : MAX_BARS[kind];
  if (options.wide) max = Math.min(32, max * 2);
  return [MIN_BARS[kind], max];
}

/** Every arrangement the template allows: removal ranks cut, extension groups added. */
function variants(template: StructureTemplate, maxExtensions: number): SectionTemplate[][] {
  const out: SectionTemplate[][] = [];
  const ranks = [...new Set(template.sections.map((t) => t.drop ?? 0).filter((r) => r > 0))].sort((a, b) => a - b);
  // Cutting ranks in increasing order: none, rank 1, ranks 1–2, ...
  for (let cut = 0; cut <= ranks.length; cut++) {
    const removed = new Set(ranks.slice(0, cut));
    const kept = template.sections.filter((t) => !removed.has(t.drop ?? 0));
    if (!kept.some((t) => t.kind === 'hook' || t.kind === 'drop' || t.kind === 'verse')) continue;
    out.push(mergeRuns(kept));
  }
  const base = template.sections;
  for (let n = 1; n <= maxExtensions && template.extend.length; n++) {
    const list = [...base];
    // After the second-to-last hook, so the song keeps cycling verse → hook before its ending.
    const hooks = list.flatMap((t, i) => (t.kind === 'hook' || t.kind === 'drop' ? [i] : []));
    const insertAt = hooks.length >= 2 ? hooks[hooks.length - 2] + 1 : hooks.length ? hooks[0] : list.length - 1;
    const extra: SectionTemplate[] = [];
    for (let i = 0; i < n; i++) extra.push(...template.extend[i % template.extend.length]);
    list.splice(insertAt, 0, ...extra);
    out.push(list);
  }
  return out;
}

/**
 * Pick the arrangement variant whose natural length is closest to `target`
 * bars, then grow/shrink sections in 4-bar steps (within per-kind limits) until
 * the total is exactly `target` when possible.
 */
export function fitStructure(template: StructureTemplate, target: number, options: FitOptions = {}): FittedSection[] {
  const candidates = variants(template, 12).map((list) => {
    const min = list.reduce((n, t) => n + limits(t.kind, options)[0], 0);
    const max = list.reduce((n, t) => n + limits(t.kind, options)[1], 0);
    const natural = list.reduce((n, t) => n + t.bars, 0);
    return { list, min, max, natural };
  });
  // Closest natural length wins; songs keep their intro and outro unless nothing else fits.
  const score = (o: (typeof candidates)[number]) =>
    Math.abs(o.natural - target) +
    (target < o.min || target > o.max ? 10000 : 0) +
    (o.list.some((t) => t.kind === 'intro') ? 0 : 500) +
    (o.list.some((t) => t.kind === 'outro') ? 0 : 500);
  const best = candidates.reduce((a, b) => (score(b) < score(a) ? b : a));
  const sections: FittedSection[] = best.list.map((t) => ({
    kind: t.kind,
    name: t.name,
    bars: Math.min(Math.max(t.bars, limits(t.kind, options)[0]), limits(t.kind, options)[1]),
  }));
  const total = () => sections.reduce((n, sec) => n + sec.bars, 0);

  const adjust = (order: SectionKind[], delta: number) => {
    // Passes over the kinds in priority order, one section at a time, so sizes stay balanced.
    let changed = true;
    while (changed) {
      changed = false;
      for (const kind of order) {
        for (const sec of sections) {
          if (sec.kind !== kind) continue;
          const after = total() + delta;
          if (delta > 0 ? after > target : after < target) continue;
          const [lo, hi] = limits(kind, options);
          const next = sec.bars + delta;
          if (next < lo || next > hi) continue;
          sec.bars = next;
          changed = true;
        }
      }
    }
  };
  adjust(GROW_ORDER, 8);
  adjust(FINE_GROW_ORDER, 4);
  adjust(SHRINK_ORDER, -8);
  adjust(FINE_SHRINK_ORDER, -4);

  // Tiny songs: drop the outro, then the intro, until it fits.
  while (total() > target && sections.length > 1) {
    const index = sections.findIndex((sec) => sec.kind === 'outro');
    sections.splice(index >= 0 ? index : 0, 1);
  }
  return sections;
}

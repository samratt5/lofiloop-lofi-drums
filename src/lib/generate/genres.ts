/**
 * Genre knowledge used by the beat generator: tempo/swing ranges, kits, drum
 * grooves, chord progressions, harmonic rhythm, bass and melody styles.
 * Pure data plus a tiny parser for the groove notation.
 */
import type { ChordType, ScaleId } from '@/lib/music/theory';
import type { InstrumentId } from '@/lib/project/instruments';
import type { MasterFx } from '@/lib/project/types';

export type GenreId = 'lofi' | 'jazzhop' | 'boombap' | 'chillhop' | 'trap' | 'rnb' | 'house' | 'ambient';

export const GENRE_IDS: GenreId[] = ['lofi', 'jazzhop', 'boombap', 'chillhop', 'trap', 'rnb', 'house', 'ambient'];

/**
 * Drum parts are step strings, one character per 16th note ('|' and spaces are
 * ignored). A 16 or 32 step part is tiled across the pattern.
 *
 *   X accent   x normal   o soft   g ghost   . rest
 *   ? ghost that plays half the time   * hit that plays half the time
 *   2 / 3 / 4  a roll: the step retriggers that many times (ratchet)
 */
export interface DrumGroove {
  name: string;
  parts: Partial<Record<InstrumentId, string>>;
}

export type ScaleFamily = 'major' | 'minor';

export interface Progression {
  /** 1-based scale degrees of the chord roots, e.g. [2, 5, 1, 6] = ii–V–I–vi */
  degrees: number[];
  family: ScaleFamily;
}

export interface ChordRhythm {
  /** Steps per chord: 16 = one chord per bar, 8 = two per bar. */
  span: 8 | 16;
  /** Onsets relative to the chord's slot (0..span-1); the first one sounds the change. */
  hits: number[];
  /** Anticipate each chord change (onset 0) by this many 16ths. */
  push: number;
  /** Cap on each strike's gate length in steps (stabs); sustains until the next strike if omitted. */
  gate?: number;
}

/**
 * - syncopated: roots on the change, extra notes locked to the kick, fifths and approach tones
 * - walking: quarter-note jazz walk towards the next chord
 * - 808: long 808 notes on the kick pattern with octave jumps
 * - offbeat: house bass on the off-beat 8ths
 * - sustain: long held roots
 */
export type BassStyle = 'syncopated' | 'walking' | '808' | 'offbeat' | 'sustain';

export interface MelodyStyle {
  /** 0..1 chance that a rhythmic slot gets a note */
  density: number;
  /** Rhythmic grid in steps: 1 = 16ths, 2 = 8ths, 4 = quarters */
  grid: 1 | 2 | 4;
  /** Longest note in steps (1..4) */
  maxLen: number;
  /** 0..1 chance a note is nudged a 16th off the grid */
  syncopation: number;
  /** Semitone offset of the melody register */
  register: number;
}

export type FillStyle = 'snare' | 'roll' | 'none';

export interface DrumFeel {
  /** 0..1 amount of random snare/hat ghost notes */
  ghosts: number;
  /** 0..1 chance of extra hi-hat ratchet rolls per bar */
  rolls: number;
  /** What happens in the last steps of a multi-bar pattern */
  fill: FillStyle;
}

export interface Genre {
  id: GenreId;
  name: string;
  description: string;
  bpm: [number, number];
  swing: [number, number];
  scales: ScaleId[];
  /** Tracks for a fresh beat, in display order (<= 8). The first keys/pad plays the chords. */
  kit: InstrumentId[];
  /** Alternative kits; one is chosen per generation so beats don't share a lineup. */
  kits?: InstrumentId[][];
  chordType: ChordType;
  fx: Partial<MasterFx>;
  /** Instrument parameter tweaks for a fresh beat */
  params: Partial<Record<InstrumentId, Record<string, number>>>;
  grooves: DrumGroove[];
  drums: DrumFeel;
  progressions: Progression[];
  chordRhythms: ChordRhythm[];
  bass: BassStyle;
  melody: MelodyStyle;
}

const major = (...degrees: number[]): Progression => ({ degrees, family: 'major' });
const minor = (...degrees: number[]): Progression => ({ degrees, family: 'minor' });

export const GENRES: Record<GenreId, Genre> = {
  lofi: {
    id: 'lofi',
    name: 'Lofi',
    description: 'Dusty, lazy swung drums, jazzy seventh chords and tape wobble.',
    bpm: [72, 90],
    swing: [56, 64],
    scales: ['minor', 'dorian', 'major'],
    kit: ['kick', 'snare', 'hat', 'openhat', 'keys', 'bass', 'bell'],
    kits: [
      ['kick', 'snare', 'hat', 'openhat', 'keys', 'bass', 'bell'],
      ['kick', 'snare', 'hat', 'openhat', 'shaker', 'keys', 'bass'],
      ['kick', 'snare', 'hat', 'openhat', 'rim', 'keys', 'bass'],
      ['kick', 'clap', 'hat', 'openhat', 'keys', 'bass', 'bell'],
      ['kick', 'snare', 'hat', 'shaker', 'keys', 'bass', 'bell'],
      ['kick', 'snare', 'hat', 'openhat', 'keys', 'bass', 'bell', 'tom'],
      ['kick', 'snare', 'hat', 'openhat', 'keys', 'bass', 'bell', 'shaker'],
      ['kick', 'snare', 'hat', 'openhat', 'rim', 'keys', 'bass', 'bell'],
    ],
    chordType: 'seventh',
    fx: {
      tone: 0.62,
      crackle: 0.35,
      wow: 0.28,
      drive: 0.22,
      reverbSize: 0.55,
      reverbMix: 0.32,
      delayDivision: '1/8d',
      delayFeedback: 0.35,
      delayMix: 0.22,
      glue: 0.45,
    },
    params: {
      kick: { decay: 0.45, drive: 0.3 },
      snare: { tone: 0.35, decay: 0.22 },
      hat: { tone: 0.4 },
      keys: { tone: 0.35, tremolo: 0.3 },
      bell: { tone: 0.4, decay: 1.6 },
    },
    grooves: [
      {
        name: 'Dusty',
        parts: {
          kick: 'X.....x...x..... | X.....x..x....?.',
          snare: '....X..g....X..? | ....X..g.?..X...',
          hat: 'x.o.x.o.x.o.x.o. | x.o.x.o.x.o.x...',
          openhat: '................ | ..............o.',
        },
      },
      {
        name: 'Sleepy',
        parts: {
          kick: 'X.......x.x..... | X......x..x.....',
          snare: '....X.......X... | ....X..g....X..g',
          hat: 'x.o.x.ogx.o.x.o.',
          openhat: '................ | ......o.........',
        },
      },
      {
        name: 'Rainy',
        parts: {
          kick: 'X.........X..... | X.x.......x.....',
          snare: '....X.......X... | ....X.....g.X.g.',
          hat: 'x..ox..ox..ox..o',
          openhat: '..............o. | ................',
        },
      },
      {
        name: 'Tape',
        parts: {
          kick: 'X.......x.x..... | X......x..x.....',
          snare: '....X.......X... | ....X..g....X.g.',
          hat: 'x.o.x.o.x.o.x.oo',
          openhat: '................ | ..........o.....',
        },
      },
      {
        name: 'Head nod',
        parts: {
          kick: 'X..x......x..... | X..x....x.x.....',
          snare: '....X...g...X... | ....X...g...X..?',
          hat: 'x.x.x.x.x.x.x.x.',
          openhat: '..............o. | ................',
        },
      },
      {
        name: 'Jazzy',
        parts: {
          kick: 'X......x..x..... | X.....x...x.....',
          snare: '....X..g....X..? | ....X..g....X...',
          hat: 'x.o.x.o.x.o.x.o. | x.o.x.o.x.o.x.o.',
          openhat: '................ | ....o...........',
        },
      },
      {
        name: 'Boom',
        parts: {
          kick: 'X.....x...x..... | X.....x...x.....',
          snare: '....X.......X... | ....X.......X..g',
          hat: 'x.x.x.x.x.x.x.x. | x.x.x.x.x.x.x.x.',
          openhat: '....o.......o... | ....o.......o...',
        },
      },
      {
        name: 'Drift',
        parts: {
          kick: 'X.........X..... | X.......x.X.....',
          snare: '....X.....g.X... | ....X.......X...',
          hat: 'x..ox..ox..ox..o | x..ox..ox..ox..o',
          openhat: '................ | ....o...........',
        },
      },
      {
        name: 'Lazy',
        parts: {
          kick: 'X.......x....... | X.......x.......',
          snare: '....X.......X.g. | ....X.......X...',
          hat: 'x.o.x.o.x.o.x.oo | x.o.x.o.x.o.x.o.',
          openhat: '..o.....o.....o. | ..o.....o.....o.',
        },
      },
      {
        name: 'Smoke',
        parts: {
          kick: 'X..x......x..... | X..x......x.x...',
          snare: '....X..g....X... | ....X..g....X...',
          hat: 'x.x.x.x.x.x.x.x. | x.x.x.x.x.x.x.x.',
          openhat: '................ | ..............o.',
        },
      },
      {
        name: 'Vinyl',
        parts: {
          kick: 'X.........X.x... | X.........X.....',
          snare: '....X.......X... | ....X.......X.g.',
          hat: 'x..ox..ox..ox..o | x..ox..ox..ox..o',
          openhat: '................ | ......o.........',
          rim: '...........g.... | ......g.........',
        },
      },
      {
        name: 'Sunday',
        parts: {
          kick: 'X.....x...x..... | X.....x...x..x..',
          snare: '....X.......X..? | ....X.......X...',
          hat: 'x.o.x.o.x.o.x.o. | x.o.x.o.x.o.x.o.',
          openhat: '..............o. | ................',
          shaker: 'g.o.g.o.g.o.g.o. | g.o.g.o.g.o.g.o.',
        },
      },
      {
        name: 'Mellow',
        parts: {
          kick: 'X.........x...x. | X.........x.....',
          snare: '....X..g....X... | ....X..g....X...',
          hat: 'x.x.x.x.x.x.x.x. | x.x.x.x.x.x.x.x.',
          openhat: '................ | ..........o.....',
        },
      },
      {
        name: 'Haze',
        parts: {
          kick: 'X.....x..x...... | X.....x..x......',
          snare: '....X.......X... | ....X.......X...',
          hat: 'x.oxx.oxx.oxx.ox | x.oxx.oxx.oxx.ox',
          openhat: '..............o. | ..............o.',
        },
      },
      {
        name: 'Cassette',
        parts: {
          kick: 'X..x....x.x..... | X..x....x.x.....',
          snare: '....X...g...X... | ....X...g...X..?',
          hat: 'x.o.x.o.x.o.x.o. | x.o.x.o.x.o.x.oo',
          openhat: '......o......... | ......o.........',
          rim: '...........g.... | ...g......g.....',
        },
      },
      {
        name: 'Lantern',
        parts: {
          kick: 'X.........X..... | X.........X.....',
          snare: '....X.......X.g. | ....X.......X...',
          hat: 'x..ox..ox..ox..o | x..ox..ox..ox..o',
          openhat: '....o.......o... | ....o.......o...',
        },
      },
      {
        name: 'Tram',
        parts: {
          kick: 'X.....x...x..... | X.....x...x.....',
          snare: '....X..g....X..? | ....X..g....X..?',
          hat: 'x.o.x.o.x.o.x.o. | x.o.x.o.x.o.x...',
          openhat: '................ | ..........o.....',
        },
      },
      {
        name: 'Coffee',
        parts: {
          kick: 'X.....x...x..... | X.....x...x..x..',
          snare: '....X.......X... | ....X.......X...',
          hat: 'x.o.x.o.x.o.x.o. | x.o.x.o.x.o.x.o.',
          openhat: '..o.....o.....o. | ..o.....o.....o.',
          shaker: 'g.o.g.o.g.o.g.o. | g.o.g.o.g.o.g.o.',
        },
      },
      {
        name: 'Porch',
        parts: {
          kick: 'X.......x.x..... | X.......x.x.....',
          snare: '....X.......X... | ....X..g....X...',
          hat: 'x.x.x.x.x.x.x.x. | x.x.x.x.x.x.x.x.',
          openhat: '................ | ..............o.',
          shaker: 'g.o.g.o.g.o.g.o. | g.o.g.o.g.o.g.o.',
        },
      },
      {
        name: 'Static',
        parts: {
          kick: 'X.........X..... | X.........X.x...',
          snare: '....X.......X... | ....X.......X...',
          hat: 'x..ox..ox..ox..o | x..ox..ox..ox..o',
          openhat: '................ | ......o.........',
          rim: '...........g.... | ....g......g....',
        },
      },
      {
        name: 'Noturno',
        parts: {
          kick: 'X.....x...x..... | X.....x...x.....',
          snare: '....X..g....X... | ....X..g....X..g',
          hat: 'x.o.x.o.x.o.x.oo | x.o.x.o.x.o.x.o.',
          openhat: '..............o. | ................',
        },
      },
      {
        name: 'Two step',
        parts: {
          kick: 'X.......X....... | X.......X.......',
          snare: '....X.......X... | ....X.......X..?',
          hat: 'x.o.x.o.x.o.x.o. | x.o.x.o.x.o.x.o.',
          openhat: '................ | ..........o.....',
        },
      },
      {
        name: 'Shuffle',
        parts: {
          kick: 'X..x....x....... | X..x....x.......',
          snare: '....X..g....X... | ....X..g....X...',
          hat: 'x.oxx.oxx.oxx.ox | x.oxx.oxx.oxx.ox',
          openhat: '..............o. | ..............o.',
        },
      },
      {
        name: 'Wobble',
        parts: {
          kick: 'X.......x....... | X.......x.......',
          snare: '....X.....g.X... | ....X.....g.X...',
          hat: 'x.o.x.o.x.o.x.o. | x.o.x.o.x.o.x.oo',
          openhat: '......o......... | ......o.........',
        },
      },
      {
        name: 'Foggy',
        parts: {
          kick: 'X.........x..... | X.........x.....',
          snare: '....X.......X... | ....X.......X...',
          hat: 'x..ox..ox..ox..o | x..ox..ox..ox..o',
          openhat: '..............o. | ................',
        },
      },
      {
        name: 'Amber',
        parts: {
          kick: 'X.....x...x..... | X.....x...x.....',
          snare: '....X..g....X..? | ....X..g....X...',
          hat: 'x.o.x.o.x.o.x.o. | x.o.x.o.x.o.x.o.',
          openhat: '................ | ....o...........',
          tom: '................ | ..........o..o..',
        },
      },
      {
        name: 'Polaroid',
        parts: {
          kick: 'X.....x..x...... | X.....x..x......',
          snare: '....X.......X... | ....X.......X...',
          hat: 'x.x.x.x.x.x.x.x. | x.x.x.x.x.x.x.x.',
          openhat: '..o.....o.....o. | ..o.....o.....o.',
          shaker: 'g.o.g.o.g.o.g.o. | g.o.g.o.g.o.g.o.',
        },
      },
      {
        name: 'Autumn',
        parts: {
          kick: 'X.......x.x..... | X.......x.x.....',
          snare: '....X.......X... | ....X..g....X...',
          hat: 'x.o.x.o.x.o.x.o. | x.o.x.o.x.o.x.oo',
          openhat: '................ | ..............o.',
          rim: '...........g.... | ...g......g.....',
        },
      },
      {
        name: 'Midnight',
        parts: {
          kick: 'X.........X..... | X.........X.....',
          snare: '....X.......X.g. | ....X..g....X...',
          hat: 'x..ox..ox..ox..o | x..ox..ox..ox..o',
          openhat: '..............o. | ................',
          rim: '...........g.... | ....g......g....',
        },
      },
    ],
    drums: { ghosts: 0.5, rolls: 0, fill: 'snare' },
    progressions: [
      major(2, 5, 1, 6),
      major(1, 6, 2, 5),
      major(4, 3, 2, 1),
      major(4, 5, 3, 6),
      major(1, 5, 6, 4),
      major(6, 4, 1, 5),
      major(1, 4, 6, 5),
      major(2, 5, 1, 1),
      major(4, 1, 5, 6),
      major(1, 6, 4, 5),
      major(5, 6, 4, 1),
      minor(1, 6, 3, 7),
      minor(4, 7, 3, 1),
      minor(2, 5, 1, 6),
      minor(1, 4),
      minor(4, 5, 1, 1),
      minor(1, 7, 6, 7),
      minor(6, 4, 1, 5),
      minor(1, 5, 6, 4),
      minor(1, 3, 4, 4),
      minor(4, 5, 1, 6),
    ],
    chordRhythms: [
      { span: 16, hits: [0], push: 0 },
      { span: 16, hits: [0, 10], push: 1 },
      { span: 16, hits: [0, 6], push: 2 },
      { span: 16, hits: [0, 8], push: 0 },
      { span: 16, hits: [0, 4, 10], push: 1 },
      { span: 8, hits: [0], push: 1 },
      { span: 8, hits: [0, 4], push: 1 },
      { span: 8, hits: [0, 6], push: 2 },
    ],
    bass: 'syncopated',
    melody: { density: 0.36, grid: 2, maxLen: 4, syncopation: 0.25, register: 0 },
  },
  jazzhop: {
    id: 'jazzhop',
    name: 'Jazz hop',
    description: 'Shuffled ride-style hats, walking bass and lush ninth chords.',
    bpm: [80, 95],
    swing: [60, 68],
    scales: ['dorian', 'minor', 'major', 'mixolydian'],
    kit: ['kick', 'snare', 'hat', 'rim', 'keys', 'bass', 'lead'],
    chordType: 'ninth',
    fx: {
      tone: 0.66,
      crackle: 0.3,
      wow: 0.2,
      drive: 0.18,
      reverbSize: 0.5,
      reverbMix: 0.3,
      delayDivision: '1/8',
      delayFeedback: 0.3,
      delayMix: 0.18,
      glue: 0.4,
    },
    params: {
      keys: { tone: 0.45, tremolo: 0.2, decay: 2.2 },
      lead: { attack: 0.03, vibrato: 0.35, cutoff: 0.4 },
      snare: { snappy: 0.45, decay: 0.18 },
    },
    grooves: [
      {
        name: 'Spang',
        parts: {
          kick: 'X.........x..... | X.....x.........',
          snare: '....X..g.g..X..g | ....X..g....X.g.',
          hat: 'X...x..oX...x..o',
          rim: '..........g..... | ......g.......g.',
        },
      },
      {
        name: 'Brushes',
        parts: {
          kick: 'X......x..x.....',
          snare: '....x..g.g.gx..g',
          hat: 'x.o.x.o.x.o.x.o.',
          rim: '....g.......g...',
        },
      },
      {
        name: 'Head nod',
        parts: {
          kick: 'X..x......x..x.. | X.........x.....',
          snare: '....X.......X... | ....X..g....X..g',
          hat: 'x.oox.o.x.oox.o.',
          rim: '..g.......g.....',
        },
      },
      {
        name: 'Ride',
        parts: {
          kick: 'X.....x.......x. | X.........x.....',
          snare: '....X..g....X.g. | ....X....g..X..g',
          hat: 'X...x..xX...x..x',
          rim: '..g.......g..... | ..g.......g...g.',
        },
      },
      {
        name: 'Smoky',
        parts: {
          kick: 'X......x..x..... | X.x.......x.....',
          snare: '....X.......X..g | ....X..g.g..X...',
          hat: 'x.oxx.oxx.oxx.ox',
          rim: '......g.......g. | ......g.........',
        },
      },
    ],
    drums: { ghosts: 0.7, rolls: 0, fill: 'snare' },
    progressions: [
      major(2, 5, 1, 1),
      major(2, 5, 1, 6),
      major(3, 6, 2, 5),
      major(1, 6, 2, 5),
      minor(2, 5, 1, 1),
      minor(4, 7, 3, 6),
      minor(1, 4, 2, 5),
      minor(4, 7, 3, 1),
    ],
    chordRhythms: [
      { span: 8, hits: [0], push: 1 },
      { span: 16, hits: [0, 6], push: 0, gate: 4 },
      { span: 16, hits: [0], push: 2 },
      { span: 8, hits: [0, 6], push: 0, gate: 3 },
    ],
    bass: 'walking',
    melody: { density: 0.5, grid: 2, maxLen: 3, syncopation: 0.35, register: 0 },
  },

  boombap: {
    id: 'boombap',
    name: 'Boom bap',
    description: 'Hard-hitting 90s kicks and snares with a head-nod pocket.',
    bpm: [86, 98],
    swing: [54, 62],
    scales: ['minor', 'dorian', 'phrygian', 'harmonicMinor'],
    kit: ['kick', 'snare', 'hat', 'openhat', 'keys', 'bass', 'pluck'],
    chordType: 'seventh',
    fx: {
      tone: 0.68,
      crackle: 0.28,
      wow: 0.15,
      crush: 0.12,
      drive: 0.35,
      reverbSize: 0.4,
      reverbMix: 0.22,
      delayDivision: '1/8d',
      delayFeedback: 0.3,
      delayMix: 0.15,
      glue: 0.55,
    },
    params: {
      kick: { punch: 0.7, drive: 0.35 },
      snare: { snappy: 0.7, tone: 0.5 },
    },
    grooves: [
      {
        name: 'Classic',
        parts: {
          kick: 'X.....x...x..... | X.x.......x.....',
          snare: '....X.......X... | ....X......gX...',
          hat: 'X.o.x.o.X.o.x.o.',
          openhat: '................ | ..............o.',
        },
      },
      {
        name: 'Double kick',
        parts: {
          kick: 'X......xX.x..... | X......x..x..x..',
          snare: '....X..g....X..g',
          hat: 'x.o.x.o.x.o.x.oo',
          openhat: '................ | ......o.........',
        },
      },
      {
        name: 'Break',
        parts: {
          kick: 'X.x.......x..x..',
          snare: '....X..g.g..X..g',
          hat: 'xoxoxoxoxoxoxoxo',
          openhat: '......o......... | ................',
        },
      },
      {
        name: 'Crate',
        parts: {
          kick: 'X.x.......x...x. | X.........x.x...',
          snare: '....X.......X... | ....X.....g.X...',
          hat: 'x.x.x.x.x.x.x.x.',
          openhat: '......o......... | ..............o.',
        },
      },
      {
        name: 'Shuffle',
        parts: {
          kick: 'X......x.x...... | X..x......x.....',
          snare: '....X..g....X..g | ....X..g....X.gg',
          hat: 'x.oxx.oxx.oxx.ox',
          openhat: '................ | ..........o.....',
        },
      },
    ],
    drums: { ghosts: 0.4, rolls: 0, fill: 'snare' },
    progressions: [
      minor(1, 6),
      minor(1, 4),
      minor(1, 7, 6, 7),
      minor(1, 4, 6, 5),
      minor(6, 5, 1, 1),
      major(1, 4),
      major(6, 4, 1, 5),
    ],
    chordRhythms: [
      { span: 16, hits: [0], push: 0 },
      { span: 16, hits: [0, 8], push: 0 },
      { span: 16, hits: [0, 6, 10], push: 0, gate: 3 },
    ],
    bass: 'syncopated',
    melody: { density: 0.34, grid: 2, maxLen: 2, syncopation: 0.2, register: -5 },
  },

  chillhop: {
    id: 'chillhop',
    name: 'Chillhop',
    description: 'Bouncy, sunny grooves with shakers, plucks and bright seventh chords.',
    bpm: [82, 100],
    swing: [54, 60],
    scales: ['major', 'dorian', 'lydian', 'mixolydian'],
    kit: ['kick', 'snare', 'hat', 'shaker', 'keys', 'bass', 'pluck'],
    chordType: 'seventh',
    fx: {
      tone: 0.74,
      crackle: 0.2,
      wow: 0.15,
      drive: 0.18,
      reverbSize: 0.5,
      reverbMix: 0.3,
      delayDivision: '1/8d',
      delayFeedback: 0.38,
      delayMix: 0.24,
      glue: 0.45,
    },
    params: {
      pluck: { cutoff: 0.55, decay: 0.4 },
      keys: { tone: 0.5, tremolo: 0.2 },
    },
    grooves: [
      {
        name: 'Bounce',
        parts: {
          kick: 'X.....x..x...... | X.....x...x..x..',
          snare: '....X.......X...',
          hat: 'x.oxx.oxx.oxx.ox',
          shaker: '..o...o...o...o.',
        },
      },
      {
        name: 'Glide',
        parts: {
          kick: 'X..x..x...x.....',
          snare: '....X..g....X...',
          hat: 'x.o.x.o.x.o.x.o.',
          shaker: 'g.o.g.o.g.o.g.o.',
        },
      },
      {
        name: 'Sunny',
        parts: {
          kick: 'X.......X.x..... | X......x..x.....',
          snare: '....X.......X..g',
          hat: 'x.o.x.o.x.oox.o.',
          shaker: 'gogogogogogogogo',
        },
      },
      {
        name: 'Skip',
        parts: {
          kick: 'X.....x.x.....x. | X.....x...x.....',
          snare: '....X.......X... | ....X..g....X...',
          hat: 'x.xox.xox.xox.xo',
          shaker: 'g.g.o.g.g.g.o.g.',
        },
      },
      {
        name: 'Stroll',
        parts: {
          kick: 'X.........x.x... | X......x..x.....',
          snare: '....X......gX... | ....X.......X..g',
          hat: 'x.o.x.oxx.o.x.ox',
          shaker: '..g.o.g...g.o.g.',
        },
      },
    ],
    drums: { ghosts: 0.35, rolls: 0.05, fill: 'snare' },
    progressions: [
      major(4, 5, 3, 6),
      major(2, 5, 1, 6),
      major(1, 5, 6, 4),
      major(4, 3, 2, 1),
      major(1, 4),
      major(1, 2, 6, 5),
      minor(1, 4, 7, 3),
      minor(6, 7, 1, 1),
      minor(1, 6, 3, 7),
    ],
    chordRhythms: [
      { span: 16, hits: [0], push: 0 },
      { span: 16, hits: [0, 10], push: 2 },
      { span: 8, hits: [0], push: 1 },
      { span: 16, hits: [0, 3, 8, 11], push: 0, gate: 2 },
    ],
    bass: 'syncopated',
    melody: { density: 0.45, grid: 2, maxLen: 2, syncopation: 0.3, register: 0 },
  },

  trap: {
    id: 'trap',
    name: 'Trap',
    description: 'Half-time snares, rolling hi-hats and gliding 808s.',
    bpm: [130, 160],
    swing: [50, 54],
    scales: ['minor', 'harmonicMinor', 'phrygian'],
    kit: ['kick', '808', 'snare', 'clap', 'hat', 'openhat', 'pad', 'bell'],
    chordType: 'triad',
    fx: {
      tone: 0.88,
      crackle: 0.06,
      wow: 0.06,
      drive: 0.3,
      reverbSize: 0.55,
      reverbMix: 0.25,
      delayDivision: '1/8',
      delayFeedback: 0.3,
      delayMix: 0.15,
      glue: 0.55,
    },
    params: {
      kick: { tune: 55, decay: 0.3, punch: 0.7 },
      '808': { decay: 1.6, drive: 0.45, glide: 0.08 },
      hat: { decay: 0.04, tone: 0.7 },
      pad: { attack: 0.6, release: 1.8, cutoff: 0.35 },
      bell: { decay: 1.2 },
    },
    grooves: [
      {
        name: 'Bounce',
        parts: {
          kick: 'X.........X..... | X......X..X.....',
          snare: '........X.......',
          clap: '........x.......',
          hat: 'x.x.x.x.x.x.x.x. | x.x.x.x.x.x.3.2.',
          openhat: '................ | ......o.........',
        },
      },
      {
        name: 'Skrrt',
        parts: {
          kick: 'X......X..X..... | X.X.......X..X..',
          snare: '........X....... | ........X..x....',
          clap: '........x.......',
          hat: 'xoxoxoxoxoxoxo3. | xoxoxo3oxoxo3344',
          openhat: '................ | ..............o.',
        },
      },
      {
        name: 'Triplet',
        parts: {
          kick: 'X.........X..X.. | X......X..X.....',
          snare: '........X.......',
          clap: '........x.......',
          hat: 'x..x..x..x..x.x. | x..x..x..x..3.3.',
          openhat: '..............o. | ................',
        },
      },
      {
        name: 'Slide',
        parts: {
          kick: 'X......X........ | X.........X..X..',
          snare: '........X....... | ........X.....x.',
          clap: '........x.......',
          hat: 'x..x..x.x..x..x. | x..x..x.x..x3.4.',
          openhat: '................ | ....o...........',
        },
      },
      {
        name: 'Stomp',
        parts: {
          kick: 'X.....X...X..... | X..X......X...X.',
          snare: '........X.......',
          clap: '........x.......',
          hat: 'xoxoxoxoxoxoxoxo | xoxoxoxo3.3.44..',
          openhat: '..............o. | ................',
        },
      },
    ],
    drums: { ghosts: 0.05, rolls: 0.6, fill: 'roll' },
    progressions: [minor(1, 6), minor(1, 6, 4, 5), minor(1, 4, 6, 5), minor(1, 2), minor(1, 7, 6, 7), minor(6, 1)],
    chordRhythms: [
      { span: 16, hits: [0], push: 0 },
      { span: 16, hits: [0, 8], push: 0 },
    ],
    bass: '808',
    melody: { density: 0.5, grid: 2, maxLen: 2, syncopation: 0.3, register: 0 },
  },

  rnb: {
    id: 'rnb',
    name: 'R&B',
    description: 'Smooth neo-soul pocket with ninth chords and a singing lead.',
    bpm: [66, 90],
    swing: [52, 60],
    scales: ['major', 'dorian', 'minor', 'mixolydian'],
    kit: ['kick', 'snare', 'hat', 'rim', 'keys', 'bass', 'lead'],
    chordType: 'ninth',
    fx: {
      tone: 0.75,
      crackle: 0.12,
      wow: 0.12,
      drive: 0.15,
      reverbSize: 0.6,
      reverbMix: 0.32,
      delayDivision: '1/8d',
      delayFeedback: 0.35,
      delayMix: 0.2,
      glue: 0.5,
    },
    params: {
      keys: { tone: 0.45, tremolo: 0.35 },
      lead: { vibrato: 0.4, attack: 0.04 },
    },
    grooves: [
      {
        name: 'Slow jam',
        parts: {
          kick: 'X......x..x..... | X..x...x..x.....',
          snare: '....X.......X...',
          hat: 'x.oxx.oxx.oxx.ox',
          rim: '..........o.....',
        },
      },
      {
        name: 'Neo',
        parts: {
          kick: 'X.....x.......x. | X.x...x...x.....',
          snare: '....X..g....X... | ....X......gX...',
          hat: 'x.o.x.o.x.o.x.oo',
          rim: '...o......o.....',
        },
      },
      {
        name: 'Late night',
        parts: {
          kick: 'X.........x..x..',
          snare: '....X.......X..g',
          hat: 'x.x.x.x.x.x.x.x.',
          rim: '.......o......o.',
        },
      },
      {
        name: 'Velvet',
        parts: {
          kick: 'X.......x..x.... | X......x.x......',
          snare: '....X.......X... | ....X.......X.g.',
          hat: 'x.x.x.xox.x.x.xo',
          rim: '...o.......o.... | ...o............',
        },
      },
      {
        name: 'Sway',
        parts: {
          kick: 'X.....x...x..... | X..x..x.........',
          snare: '....X..g....X... | ....X...g...X..g',
          hat: 'x.oxx.o.x.oxx.o.',
          rim: '..........o..... | ..o.......o.....',
        },
      },
    ],
    drums: { ghosts: 0.4, rolls: 0.15, fill: 'snare' },
    progressions: [
      major(2, 5, 1, 6),
      major(4, 3, 2, 1),
      major(1, 6, 2, 5),
      major(4, 5, 3, 6),
      minor(1, 4, 7, 3),
      minor(4, 7, 3, 6),
      minor(1, 4),
    ],
    chordRhythms: [
      { span: 16, hits: [0], push: 0 },
      { span: 16, hits: [0, 10], push: 1 },
      { span: 8, hits: [0], push: 1 },
    ],
    bass: 'syncopated',
    melody: { density: 0.4, grid: 2, maxLen: 4, syncopation: 0.35, register: -2 },
  },

  house: {
    id: 'house',
    name: 'Deep house',
    description: 'Four-on-the-floor kick, off-beat open hats and chord stabs.',
    bpm: [118, 126],
    swing: [50, 56],
    scales: ['minor', 'dorian', 'major'],
    kit: ['kick', 'clap', 'hat', 'openhat', 'shaker', 'keys', 'bass', 'pluck'],
    chordType: 'seventh',
    fx: {
      tone: 0.85,
      crackle: 0.04,
      wow: 0.05,
      drive: 0.2,
      reverbSize: 0.5,
      reverbMix: 0.25,
      delayDivision: '1/8d',
      delayFeedback: 0.4,
      delayMix: 0.2,
      glue: 0.6,
    },
    params: {
      kick: { tune: 50, decay: 0.5, punch: 0.7, click: 0.4 },
      keys: { tone: 0.6, decay: 0.8 },
      pluck: { cutoff: 0.6, resonance: 0.4 },
    },
    grooves: [
      {
        name: 'Classic',
        parts: {
          kick: 'X...X...X...X...',
          clap: '....X.......X...',
          hat: 'x..gx..gx..gx..g',
          openhat: '..x...x...x...x.',
          shaker: 'goxogoxogoxogoxo',
        },
      },
      {
        name: 'Deep',
        parts: {
          kick: 'X...X...X...X...',
          clap: '....X.......X...',
          hat: 'g.x.g.x.g.x.g.x.',
          openhat: '................ | ..............x.',
          shaker: 'g.g.g.g.g.g.g.g.',
        },
      },
      {
        name: 'Shuffle',
        parts: {
          kick: 'X...X...X...X..g | X...X...X...X...',
          clap: '....X.......X... | ....X.......X..g',
          hat: 'xx.xxx.xxx.xxx.x',
          openhat: '..o...o...o...o.',
          shaker: '...g...g...g...g',
        },
      },
      {
        name: 'Jack',
        parts: {
          kick: 'X...X...X...X...',
          clap: '....X.......X...',
          hat: 'xg.gxg.gxg.gxg.g',
          openhat: '..x...x...x...x.',
          shaker: '.g.g.g.g.g.g.g.g',
        },
      },
      {
        name: 'Tech',
        parts: {
          kick: 'X...X...X...X...',
          clap: '....X.......X... | ....X.......X..x',
          hat: 'x.x.x.x.x.x.x.x.',
          openhat: '................ | ..o.......o.....',
          shaker: 'g..gg..gg..gg..g',
        },
      },
    ],
    drums: { ghosts: 0.1, rolls: 0.1, fill: 'roll' },
    progressions: [
      minor(1, 7, 6, 7),
      minor(1, 4),
      minor(1, 6, 3, 7),
      minor(4, 5, 1, 1),
      major(1, 5, 6, 4),
      major(6, 4, 1, 5),
      major(2, 5, 1, 1),
    ],
    chordRhythms: [
      { span: 16, hits: [0, 3, 6, 10], push: 0, gate: 2 },
      { span: 16, hits: [2, 6, 10, 14], push: 0, gate: 2 },
      { span: 16, hits: [0, 3, 6, 11, 14], push: 0, gate: 1 },
      { span: 8, hits: [0, 3, 6], push: 0, gate: 2 },
    ],
    bass: 'offbeat',
    melody: { density: 0.45, grid: 2, maxLen: 2, syncopation: 0.4, register: 0 },
  },

  ambient: {
    id: 'ambient',
    name: 'Ambient',
    description: 'Slow, sparse and spacious: long pads, music box and soft percussion.',
    bpm: [60, 80],
    swing: [50, 56],
    scales: ['lydian', 'major', 'dorian', 'minor'],
    kit: ['kick', 'rim', 'shaker', 'pad', 'bell', 'bass'],
    chordType: 'ninth',
    fx: {
      tone: 0.6,
      crackle: 0.18,
      wow: 0.22,
      drive: 0.1,
      reverbSize: 0.85,
      reverbMix: 0.5,
      delayDivision: '1/4',
      delayFeedback: 0.45,
      delayMix: 0.3,
      glue: 0.3,
    },
    params: {
      pad: { attack: 1.2, release: 2.8, cutoff: 0.35 },
      bell: { decay: 2.6 },
      kick: { decay: 0.6, punch: 0.4 },
    },
    grooves: [
      {
        name: 'Drift',
        parts: {
          kick: 'X............... | ........x.......',
          rim: '........o....... | ...........g....',
          shaker: 'g...o...g...o...',
        },
      },
      {
        name: 'Tide',
        parts: {
          kick: 'X.......x....... | X...............',
          rim: '....g.......o...',
          shaker: '..g...g...g...g.',
        },
      },
      {
        name: 'Pulse',
        parts: {
          kick: 'X............... | X.........x.....',
          rim: '........g....... | ....g.......o...',
          shaker: 'o...g...o...g...',
        },
      },
    ],
    drums: { ghosts: 0.1, rolls: 0, fill: 'none' },
    progressions: [
      major(1, 4),
      major(1, 2),
      major(4, 1),
      major(1, 5, 6, 5),
      major(1, 6, 4, 5),
      minor(1, 6),
      minor(1, 4),
      minor(6, 1),
    ],
    chordRhythms: [{ span: 16, hits: [0], push: 0 }],
    bass: 'sustain',
    melody: { density: 0.5, grid: 4, maxLen: 4, syncopation: 0.15, register: 0 },
  },
};

export const GENRE_LIST: Genre[] = GENRE_IDS.map((id) => GENRES[id]);

export function isGenreId(value: unknown): value is GenreId {
  return typeof value === 'string' && (GENRE_IDS as string[]).includes(value);
}

export interface GrooveHit {
  vel: number;
  ratchet: number;
  /** Plays only half the time (decided when generating) */
  maybe: boolean;
}

const HIT_CHARS: Record<string, GrooveHit> = {
  X: { vel: 0.95, ratchet: 1, maybe: false },
  x: { vel: 0.78, ratchet: 1, maybe: false },
  o: { vel: 0.58, ratchet: 1, maybe: false },
  g: { vel: 0.3, ratchet: 1, maybe: false },
  '?': { vel: 0.28, ratchet: 1, maybe: true },
  '*': { vel: 0.66, ratchet: 1, maybe: true },
  '2': { vel: 0.66, ratchet: 2, maybe: false },
  '3': { vel: 0.64, ratchet: 3, maybe: false },
  '4': { vel: 0.62, ratchet: 4, maybe: false },
};

/** Parse a groove step string into one entry per step (null = rest). */
export function parseGroovePart(part: string): (GrooveHit | null)[] {
  const hits: (GrooveHit | null)[] = [];
  for (const ch of part) {
    if (ch === ' ' || ch === '|') continue;
    const hit = HIT_CHARS[ch];
    hits.push(hit ? { ...hit } : null);
  }
  return hits;
}

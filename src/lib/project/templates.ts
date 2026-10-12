/**
 * Starting points for new projects: a blank kit, the hand-made demo, full
 * generated songs and two-pattern loops per genre (fixed seeds, so they are
 * always the same).
 */
import { generateBeat } from '@/lib/generate/generators';
import { GENRES, type GenreId } from '@/lib/generate/genres';
import { generateSong, type SongOptions } from '@/lib/generate/song';
import {
  createPattern,
  createProject,
  createSection,
  createStep,
  createSteps,
  createTrack,
  rootNoteFor,
} from './factory';
import type { InstrumentId } from './instruments';
import type { Project, Step, Track } from './types';

export type TemplateKind = 'blank' | 'demo' | 'song' | 'loop';

export interface ProjectTemplate {
  id: string;
  name: string;
  description: string;
  genre: GenreId | null;
  /** blank kit, hand-made demo, arranged song or two-pattern loop */
  kind: TemplateKind;
  /** Approximate length for songs */
  minutes?: number;
  create: () => Project;
}

/** [step, velocity, note?, length?] */
type Hit = [number, number, number?, number?];

function hits(instrument: InstrumentId, root: number, list: Hit[]): Step[] {
  const base = rootNoteFor(instrument, root);
  const steps = createSteps(base);
  for (const [index, vel, note = base, len = 1] of list) {
    steps[index] = createStep(note, { on: true, vel, len });
  }
  return steps;
}

// MIDI notes used by the demo (key of D minor).
const D3 = 50;
const F3 = 53;
const G3 = 55;
const C4 = 60;
const C2 = 36;
const D2 = 38;
const E2 = 40;
const F2 = 41;
const G2 = 43;
const A2 = 45;
const C3 = 48;
const A4 = 69;
const C5 = 72;
const D5 = 74;
const E5 = 76;
const F5 = 77;
const G5 = 79;
const A5 = 81;

/**
 * "Midnight Tape": D minor at 82 BPM with a lazy swing. Keys play
 * Gm7 – C7 – Fmaj7 – Dm7 (a ii–V–I–vi in the relative major) over two bars,
 * with the 2nd and 4th chords pushed ahead of the beat. Pattern B is a
 * kick-less breakdown; the song runs A A B A.
 */
export function createDemoProject(): Project {
  const root = 2;
  const kick = createTrack('kick', { volume: 0.88, reverb: 0.02, params: { decay: 0.45, drive: 0.3 } });
  const snare = createTrack('snare', { volume: 0.72, pan: 0.02, reverb: 0.14, params: { tone: 0.35, decay: 0.22 } });
  const hat = createTrack('hat', { volume: 0.62, pan: 0.22, reverb: 0.05, params: { tone: 0.4 } });
  const openhat = createTrack('openhat', { volume: 0.58, pan: -0.18, reverb: 0.1 });
  const keys = createTrack('keys', {
    volume: 0.68,
    pan: -0.12,
    reverb: 0.3,
    delay: 0.08,
    chord: 'seventh',
    params: { tone: 0.35, tremolo: 0.3 },
  });
  const bass = createTrack('bass', { volume: 0.74, reverb: 0 });
  const bell = createTrack('bell', {
    volume: 0.6,
    pan: 0.25,
    reverb: 0.4,
    delay: 0.28,
    params: { tone: 0.4, decay: 1.6 },
  });
  const tracks: Track[] = [kick, snare, hat, openhat, keys, bass, bell];

  const project = createProject({
    name: 'Midnight Tape',
    bpm: 82,
    swing: 60,
    root,
    scale: 'minor',
    tracks,
    fx: {
      tone: 0.65,
      crackle: 0.35,
      wow: 0.25,
      crush: 0,
      drive: 0.22,
      reverbSize: 0.55,
      reverbMix: 0.3,
      delayDivision: '1/8d',
      delayFeedback: 0.35,
      delayMix: 0.2,
      glue: 0.45,
    },
  });

  const a = createPattern('A', tracks, root, 32);
  a.steps[kick.id] = hits('kick', root, [
    [0, 0.95],
    [10, 0.8],
    [16, 0.95],
    [22, 0.62],
    [26, 0.82],
  ]);
  a.steps[snare.id] = hits('snare', root, [
    [4, 0.88],
    [7, 0.26],
    [12, 0.92],
    [15, 0.3],
    [20, 0.88],
    [25, 0.24],
    [28, 0.94],
    [31, 0.34],
  ]);
  a.steps[hat.id] = hits('hat', root, [
    [0, 0.72],
    [2, 0.42],
    [4, 0.66],
    [6, 0.44],
    [8, 0.7],
    [10, 0.42],
    [11, 0.26],
    [12, 0.66],
    [14, 0.46],
    [16, 0.72],
    [18, 0.42],
    [20, 0.66],
    [22, 0.44],
    [24, 0.7],
    [26, 0.42],
    [27, 0.24],
    [28, 0.66],
  ]);
  a.steps[openhat.id] = hits('openhat', root, [[30, 0.5]]);
  a.steps[keys.id] = hits('keys', root, [
    [0, 0.7, G3, 7],
    [7, 0.66, C4, 9],
    [16, 0.7, F3, 6],
    [22, 0.64, D3, 10],
  ]);
  a.steps[bass.id] = hits('bass', root, [
    [0, 0.85, G2, 6],
    [7, 0.8, C2, 3],
    [10, 0.68, C3, 2],
    [14, 0.6, E2, 2],
    [16, 0.85, F2, 5],
    [22, 0.8, D2, 3],
    [26, 0.7, A2, 3],
    [30, 0.6, F2, 2],
  ]);
  a.steps[bell.id] = hits('bell', root, [
    [2, 0.56, D5, 2],
    [5, 0.5, F5, 2],
    [8, 0.58, E5, 3],
    [12, 0.5, C5, 3],
    [18, 0.55, A4, 2],
    [20, 0.5, C5, 2],
    [23, 0.56, F5, 3],
    [27, 0.48, E5, 2],
    [29, 0.52, D5, 3],
  ]);

  // B: breakdown. No kick, soft backbeat, quarter-note hats, held bass roots
  // and an answering music-box phrase over the same chords.
  const b = createPattern('B', tracks, root, 32);
  b.steps[snare.id] = hits('snare', root, [
    [12, 0.5],
    [28, 0.56],
    [31, 0.3],
  ]);
  b.steps[hat.id] = hits(
    'hat',
    root,
    [0, 4, 8, 12, 16, 20, 24, 28].map((i): Hit => [i, i % 8 === 0 ? 0.45 : 0.38]),
  );
  b.steps[openhat.id] = hits('openhat', root, [[30, 0.4]]);
  b.steps[keys.id] = hits('keys', root, [
    [0, 0.6, G3, 7],
    [7, 0.58, C4, 9],
    [16, 0.6, F3, 6],
    [22, 0.56, D3, 10],
  ]);
  b.steps[bass.id] = hits('bass', root, [
    [0, 0.72, G2, 7],
    [7, 0.7, C2, 9],
    [16, 0.72, F2, 6],
    [22, 0.7, D2, 10],
  ]);
  b.steps[bell.id] = hits('bell', root, [
    [3, 0.5, F5, 3],
    [6, 0.46, G5, 2],
    [8, 0.52, E5, 4],
    [19, 0.5, A5, 3],
    [24, 0.5, F5, 3],
    [28, 0.5, D5, 4],
  ]);

  project.patterns = [a, b];
  project.activePatternId = a.id;
  project.arrangement = [
    createSection(a.id, { name: 'A', repeats: 2 }),
    createSection(b.id, { name: 'B' }),
    createSection(a.id, { name: 'A' }),
  ];
  return project;
}

/** Full songs from the song generator; seeds picked by eye so each is a good first impression. */
const SONG_TEMPLATES: (Omit<ProjectTemplate, 'kind' | 'create' | 'genre'> & { options: SongOptions })[] = [
  {
    id: 'late-night-study',
    name: 'Late Night Study',
    description: 'A 2½ minute lofi song: dusty drums, jazzy keys and a music-box hook over soft vinyl.',
    minutes: 2.5,
    options: {
      seed: 11,
      styles: [{ genre: 'lofi', weight: 1 }],
      minutes: 2.5,
      mood: { valence: 0.4, energy: 0.35, brightness: 0.35 },
      ambience: 'vinyl',
    },
  },
  {
    id: 'rainy-commute',
    name: 'Rainy Commute',
    description: 'Lofi blended with jazz hop: walking bass, ninth chords, a bell and lead in conversation, and rain.',
    minutes: 2.5,
    options: {
      seed: 4,
      styles: [
        { genre: 'lofi', weight: 0.6 },
        { genre: 'jazzhop', weight: 0.4 },
      ],
      minutes: 2.5,
      mood: { valence: 0.35, energy: 0.4, brightness: 0.35 },
      ambience: 'rain',
    },
  },
  {
    id: 'sunday-cafe',
    name: 'Sunday Café',
    description:
      'Warm jazz hop: walking bass, ninth chords and a flute trading phrases with a soft lead in a busy café.',
    minutes: 2.5,
    options: {
      seed: 8,
      styles: [{ genre: 'jazzhop', weight: 1 }],
      minutes: 2.5,
      mood: { valence: 0.68, energy: 0.45, brightness: 0.5 },
      instruments: ['flute'],
      ambience: 'cafe',
    },
  },
  {
    id: 'neon-drive',
    name: 'Neon Drive',
    description: 'Deep house with a chillhop bounce: filtered builds, risers, drops and a sidechained bass.',
    minutes: 3,
    options: {
      seed: 2,
      styles: [
        { genre: 'house', weight: 0.55 },
        { genre: 'chillhop', weight: 0.45 },
      ],
      minutes: 3,
      mood: { valence: 0.7, energy: 0.7, brightness: 0.75 },
      ambience: 'city',
    },
  },
  {
    id: 'night-shift',
    name: 'Night Shift',
    description: 'Dark trap: half-time drums, rolling hats, gliding 808s and a bell hook.',
    minutes: 2.5,
    options: {
      seed: 3,
      styles: [{ genre: 'trap', weight: 1 }],
      minutes: 2.5,
      mood: { valence: 0.2, energy: 0.7, brightness: 0.6 },
    },
  },
  {
    id: 'velvet-hour',
    name: 'Velvet Hour',
    description: 'Neo-soul R&B with lush ninth chords, strings in the hooks and a key lift at the end.',
    minutes: 2.5,
    options: {
      seed: 6,
      styles: [{ genre: 'rnb', weight: 1 }],
      minutes: 2.5,
      mood: { valence: 0.62, energy: 0.45, brightness: 0.55 },
      instruments: ['strings'],
    },
  },
  {
    id: 'crate-digger',
    name: 'Crate Digger',
    description: 'Head-nod 90s boom bap with punchy drums, a plucked hook and street noise.',
    minutes: 2.5,
    options: {
      seed: 9,
      styles: [{ genre: 'boombap', weight: 1 }],
      minutes: 2.5,
      mood: { valence: 0.35, energy: 0.6, brightness: 0.3 },
      ambience: 'city',
    },
  },
  {
    id: 'slow-tides',
    name: 'Slow Tides',
    description: 'Three minutes of slow ambient: evolving pads, music box and night air.',
    minutes: 3,
    options: {
      seed: 2,
      styles: [{ genre: 'ambient', weight: 1 }],
      minutes: 3,
      mood: { valence: 0.55, energy: 0.15, brightness: 0.45 },
      ambience: 'night',
    },
  },
];

/** Fixed seeds picked by ear/eye so each genre template is a good first impression. */
const GENRE_TEMPLATES: [GenreId, number][] = [
  ['lofi', 6],
  ['jazzhop', 1],
  ['boombap', 5],
  ['chillhop', 7],
  ['trap', 2],
  ['rnb', 5],
  ['house', 9],
  ['ambient', 1],
];

export const TEMPLATES: ProjectTemplate[] = [
  {
    id: 'blank',
    name: 'Blank',
    description: 'An empty beat with kick, snare, hat, keys and bass.',
    genre: null,
    kind: 'blank',
    create: () => createProject({ name: 'Untitled beat' }),
  },
  {
    id: 'demo',
    name: 'Midnight Tape',
    description: 'Hand-made lofi demo: jazzy seventh chords, lazy swung drums and a music-box melody.',
    genre: 'lofi',
    kind: 'demo',
    create: createDemoProject,
  },
  ...SONG_TEMPLATES.map(({ options, ...template }): ProjectTemplate => ({
    ...template,
    genre: options.styles[0].genre,
    kind: 'song',
    create: () => generateSong({ ...options, name: template.name }),
  })),
  ...GENRE_TEMPLATES.map(([genre, seed]): ProjectTemplate => ({
    id: genre,
    name: GENRES[genre].name,
    description: GENRES[genre].description,
    genre,
    kind: 'loop',
    create: () => generateBeat(genre, { seed }),
  })),
];

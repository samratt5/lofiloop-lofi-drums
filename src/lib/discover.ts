/**
 * The Discover gallery and radio stations. Everything is generated on the
 * device from fixed seeds, so the gallery is the same for everyone and works
 * offline, with no server or accounts.
 */
import type { GenreId } from '@/lib/generate/genres';
import { generateSong, type Mood, type SongOptions, type StyleWeight } from '@/lib/generate/song';
import { createRng } from '@/lib/music/rng';
import type { AmbienceType, Project } from '@/lib/project/types';
import type { ListenItem, ListenSource } from '@/lib/listen';

export interface DiscoverPick {
  id: string;
  /** Short line under the title */
  blurb: string;
  options: SongOptions;
}

const s = (...pairs: [GenreId, number][]): StyleWeight[] => pairs.map(([genre, weight]) => ({ genre, weight }));
const mood = (valence: number, energy: number, brightness: number): Mood => ({ valence, energy, brightness });

/** Hand-tuned blends that show off what the generator can do. */
export const DISCOVER_PICKS: DiscoverPick[] = [
  {
    id: 'rain-study',
    blurb: 'Dusty keys and rain on the window',
    options: { seed: 11, styles: s(['lofi', 1]), minutes: 2.5, mood: mood(0.35, 0.3, 0.3), ambience: 'rain' },
  },
  {
    id: 'cafe-jazz',
    blurb: 'Walking bass and jazz chords, café chatter',
    options: {
      seed: 23,
      styles: s(['jazzhop', 1], ['lofi', 0.4]),
      minutes: 3,
      mood: mood(0.6, 0.45, 0.5),
      ambience: 'cafe',
      instruments: ['upright', 'guitar'],
    },
  },
  {
    id: 'sunday-sun',
    blurb: 'Bright, bouncy and warm',
    options: { seed: 37, styles: s(['chillhop', 1]), minutes: 2.25, mood: mood(0.85, 0.6, 0.75) },
  },
  {
    id: 'night-drive',
    blurb: 'Neon, slow 808s and a city at night',
    options: {
      seed: 41,
      styles: s(['trap', 0.6], ['rnb', 1]),
      minutes: 2.75,
      mood: mood(0.3, 0.55, 0.4),
      ambience: 'city',
    },
  },
  {
    id: 'cypher',
    blurb: 'Hard drums from the golden era',
    options: { seed: 53, styles: s(['boombap', 1]), minutes: 2, mood: mood(0.45, 0.75, 0.45), ambience: 'vinyl' },
  },
  {
    id: 'deep-focus',
    blurb: 'Long pads for deep work',
    options: {
      seed: 67,
      styles: s(['ambient', 1], ['lofi', 0.3]),
      minutes: 4,
      mood: mood(0.5, 0.15, 0.4),
      ambience: 'night',
      instruments: ['strings'],
    },
  },
  {
    id: 'slow-jam',
    blurb: 'Neo-soul chords and a lazy groove',
    options: {
      seed: 71,
      styles: s(['rnb', 1], ['jazzhop', 0.5]),
      minutes: 2.5,
      mood: mood(0.55, 0.4, 0.55),
      instruments: ['wurli'],
    },
  },
  {
    id: 'late-club',
    blurb: 'Deep house for the walk home',
    options: { seed: 83, styles: s(['house', 1]), minutes: 3, mood: mood(0.55, 0.7, 0.6) },
  },
  {
    id: 'bittersweet',
    blurb: 'Minor keys, flute and memories',
    options: {
      seed: 97,
      styles: s(['lofi', 1], ['jazzhop', 0.35]),
      minutes: 2.5,
      mood: mood(0.2, 0.35, 0.35),
      instruments: ['flute'],
      ambience: 'room',
    },
  },
  {
    id: 'morning-coffee',
    blurb: 'Soft guitar and a slow start',
    options: {
      seed: 103,
      styles: s(['chillhop', 1], ['lofi', 0.6]),
      minutes: 2,
      mood: mood(0.7, 0.35, 0.6),
      instruments: ['guitar'],
      ambience: 'cafe',
    },
  },
  {
    id: 'moonlight',
    blurb: 'Choir pads and a sleepy tempo',
    options: {
      seed: 109,
      styles: s(['ambient', 0.7], ['rnb', 0.5]),
      minutes: 3,
      mood: mood(0.4, 0.2, 0.3),
      instruments: ['vox'],
      ambience: 'night',
    },
  },
  {
    id: 'tape-fever',
    blurb: 'Crunchy boom bap with jazz samples',
    options: { seed: 127, styles: s(['boombap', 1], ['jazzhop', 0.6]), minutes: 2.5, mood: mood(0.5, 0.65, 0.35) },
  },
];

export interface Station {
  id: string;
  name: string;
  blurb: string;
  styles: StyleWeight[];
  mood: Mood;
  ambience?: AmbienceType;
}

export const STATIONS: Station[] = [
  {
    id: 'study',
    name: 'Rainy study',
    blurb: 'Lofi to focus to',
    styles: s(['lofi', 1], ['jazzhop', 0.3]),
    mood: mood(0.4, 0.3, 0.35),
    ambience: 'rain',
  },
  {
    id: 'cafe',
    name: 'Jazz café',
    blurb: 'Jazz hop and soul',
    styles: s(['jazzhop', 1], ['rnb', 0.4]),
    mood: mood(0.6, 0.45, 0.5),
    ambience: 'cafe',
  },
  {
    id: 'sunny',
    name: 'Sunny side',
    blurb: 'Upbeat chillhop',
    styles: s(['chillhop', 1], ['house', 0.2]),
    mood: mood(0.8, 0.6, 0.7),
  },
  {
    id: 'night',
    name: 'After dark',
    blurb: 'R&B and slow trap',
    styles: s(['rnb', 1], ['trap', 0.5]),
    mood: mood(0.35, 0.5, 0.4),
    ambience: 'city',
  },
  {
    id: 'sleep',
    name: 'Sleep',
    blurb: 'Ambient drift',
    styles: s(['ambient', 1]),
    mood: mood(0.45, 0.1, 0.3),
    ambience: 'night',
  },
  {
    id: 'beats',
    name: 'Beat tape',
    blurb: 'Boom bap and lofi',
    styles: s(['boombap', 1], ['lofi', 0.6]),
    mood: mood(0.5, 0.65, 0.4),
    ambience: 'vinyl',
  },
];

const cache = new Map<string, Project>();

/** Generates (once) the song behind a gallery pick. */
export function pickProject(pick: DiscoverPick): Project {
  let project = cache.get(pick.id);
  if (!project) {
    project = generateSong(pick.options);
    cache.set(pick.id, project);
  }
  return project;
}

function itemFor(project: Project, key: string): ListenItem {
  return {
    key,
    title: project.name,
    artist: project.meta.artist,
    seed: project.meta.coverSeed,
    styles: project.meta.styles,
    load: async () => project,
  };
}

export function discoverSource(): ListenSource {
  return {
    label: 'Discover',
    kind: 'discover',
    size: DISCOVER_PICKS.length,
    item: (i) => (DISCOVER_PICKS[i] ? itemFor(pickProject(DISCOVER_PICKS[i]), DISCOVER_PICKS[i].id) : null),
  };
}

/**
 * An endless station: every song is new, drifting a little in mood and length
 * around the station's sound so a long session doesn't feel samey.
 */
export function radioSource(station: Station, salt = Date.now()): ListenSource {
  return {
    label: `Radio · ${station.name}`,
    kind: 'radio',
    item: (i) => {
      const rng = createRng(((salt >>> 0) ^ (i * 0x9e3779b1)) >>> 0);
      const jitter = (v: number) => Math.min(1, Math.max(0, v + (rng() - 0.5) * 0.2));
      const project = generateSong({
        seed: Math.floor(rng() * 2 ** 31),
        styles: station.styles.map((st) => ({ ...st, weight: Math.max(0.1, st.weight + (rng() - 0.5) * 0.3) })),
        minutes: 2 + rng() * 1.25,
        mood: {
          valence: jitter(station.mood.valence),
          energy: jitter(station.mood.energy),
          brightness: jitter(station.mood.brightness),
        },
        ...(station.ambience ? { ambience: station.ambience } : {}),
      });
      return itemFor(project, `${station.id}-${i}`);
    },
  };
}

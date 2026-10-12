/**
 * Instrument catalogue: metadata only (no Web Audio code), so it can be shared
 * by the UI, validation, generators and exporters. Voices live in lib/audio.
 */

export type InstrumentCategory = 'drums' | 'bass' | 'keys' | 'synth' | 'band' | 'fx' | 'sampler';

export type ParamUnit = 'hz' | 's' | 'percent' | 'number';

export interface ParamDef {
  id: string;
  label: string;
  min: number;
  max: number;
  default: number;
  step?: number;
  unit: ParamUnit;
}

export interface InstrumentDef {
  id: InstrumentId;
  name: string;
  short: string;
  category: InstrumentCategory;
  color: string;
  melodic: boolean;
  /** Supports stacking diatonic chords from a single step note. */
  polyphonic: boolean;
  /** Voices in the same group cut each other off (e.g. closed hat chokes open hat). */
  chokeGroup?: string;
  /** Monophonic instruments choke their own previous note. */
  mono?: boolean;
  defaultNote: number;
  noteRange: [number, number];
  /** General MIDI drum note for exports; melodic instruments export their own pitch. */
  gmNote?: number;
  /** Non-melodic instruments whose sound follows the step length (e.g. risers). */
  usesLength?: boolean;
  /** Plays an uploaded sample (the track's `sample`). */
  sampler?: boolean;
  params: ParamDef[];
}

export const INSTRUMENT_IDS = [
  'kick',
  '808',
  'snare',
  'clap',
  'hat',
  'openhat',
  'rim',
  'shaker',
  'tom',
  'crash',
  'keys',
  'pad',
  'pluck',
  'bell',
  'lead',
  'bass',
  'wurli',
  'guitar',
  'strings',
  'flute',
  'vox',
  'upright',
  'riser',
  'sampler',
] as const;

export type InstrumentId = (typeof INSTRUMENT_IDS)[number];

const pct = (id: string, label: string, def: number): ParamDef => ({
  id,
  label,
  min: 0,
  max: 1,
  default: def,
  step: 0.01,
  unit: 'percent',
});

const secs = (id: string, label: string, min: number, max: number, def: number): ParamDef => ({
  id,
  label,
  min,
  max,
  default: def,
  step: 0.005,
  unit: 's',
});

const hz = (id: string, label: string, min: number, max: number, def: number): ParamDef => ({
  id,
  label,
  min,
  max,
  default: def,
  step: 1,
  unit: 'hz',
});

const DRUM_RANGE: [number, number] = [60, 60];

export const INSTRUMENTS: Record<InstrumentId, InstrumentDef> = {
  kick: {
    id: 'kick',
    name: 'Dusty Kick',
    short: 'KCK',
    category: 'drums',
    color: '#ff7a6b',
    melodic: false,
    polyphonic: false,
    defaultNote: 60,
    noteRange: DRUM_RANGE,
    gmNote: 36,
    params: [
      hz('tune', 'Tune', 35, 90, 52),
      secs('decay', 'Decay', 0.1, 1.2, 0.42),
      pct('punch', 'Punch', 0.55),
      pct('click', 'Click', 0.3),
      pct('drive', 'Drive', 0.25),
    ],
  },
  '808': {
    id: '808',
    name: '808',
    short: '808',
    category: 'bass',
    color: '#ff5d8f',
    melodic: true,
    polyphonic: false,
    mono: true,
    defaultNote: 36,
    noteRange: [24, 55],
    params: [
      secs('decay', 'Decay', 0.2, 3, 1.1),
      pct('punch', 'Punch', 0.5),
      pct('drive', 'Drive', 0.35),
      secs('glide', 'Glide', 0, 0.25, 0.05),
    ],
  },
  snare: {
    id: 'snare',
    name: 'Snare',
    short: 'SNR',
    category: 'drums',
    color: '#ffc857',
    melodic: false,
    polyphonic: false,
    defaultNote: 60,
    noteRange: DRUM_RANGE,
    gmNote: 38,
    params: [
      hz('tune', 'Tune', 140, 300, 190),
      pct('snappy', 'Snappy', 0.6),
      secs('decay', 'Decay', 0.06, 0.6, 0.2),
      pct('tone', 'Tone', 0.45),
    ],
  },
  clap: {
    id: 'clap',
    name: 'Clap',
    short: 'CLP',
    category: 'drums',
    color: '#ffa552',
    melodic: false,
    polyphonic: false,
    defaultNote: 60,
    noteRange: DRUM_RANGE,
    gmNote: 39,
    params: [secs('decay', 'Decay', 0.08, 0.8, 0.28), pct('tone', 'Tone', 0.5), pct('spread', 'Spread', 0.5)],
  },
  hat: {
    id: 'hat',
    name: 'Closed Hat',
    short: 'HAT',
    category: 'drums',
    color: '#5ed6c9',
    melodic: false,
    polyphonic: false,
    chokeGroup: 'hat',
    defaultNote: 60,
    noteRange: DRUM_RANGE,
    gmNote: 42,
    params: [secs('decay', 'Decay', 0.02, 0.3, 0.06), pct('tone', 'Tone', 0.55), pct('metal', 'Metal', 0.5)],
  },
  openhat: {
    id: 'openhat',
    name: 'Open Hat',
    short: 'OHT',
    category: 'drums',
    color: '#7fc8f8',
    melodic: false,
    polyphonic: false,
    chokeGroup: 'hat',
    defaultNote: 60,
    noteRange: DRUM_RANGE,
    gmNote: 46,
    params: [secs('decay', 'Decay', 0.15, 1.2, 0.42), pct('tone', 'Tone', 0.5), pct('metal', 'Metal', 0.55)],
  },
  rim: {
    id: 'rim',
    name: 'Rim',
    short: 'RIM',
    category: 'drums',
    color: '#b99cff',
    melodic: false,
    polyphonic: false,
    defaultNote: 60,
    noteRange: DRUM_RANGE,
    gmNote: 37,
    params: [pct('tune', 'Tune', 0.5), secs('decay', 'Decay', 0.02, 0.25, 0.07), pct('tone', 'Tone', 0.5)],
  },
  shaker: {
    id: 'shaker',
    name: 'Shaker',
    short: 'SHK',
    category: 'drums',
    color: '#a3e36b',
    melodic: false,
    polyphonic: false,
    defaultNote: 60,
    noteRange: DRUM_RANGE,
    gmNote: 70,
    params: [secs('decay', 'Decay', 0.03, 0.3, 0.09), pct('tone', 'Tone', 0.55), pct('swell', 'Swell', 0.4)],
  },
  tom: {
    id: 'tom',
    name: 'Perc Tom',
    short: 'TOM',
    category: 'drums',
    color: '#ff9ecd',
    melodic: false,
    polyphonic: false,
    defaultNote: 60,
    noteRange: DRUM_RANGE,
    gmNote: 45,
    params: [hz('tune', 'Tune', 60, 420, 150), secs('decay', 'Decay', 0.08, 1, 0.32), pct('bend', 'Bend', 0.4)],
  },
  crash: {
    id: 'crash',
    name: 'Crash',
    short: 'CRS',
    category: 'drums',
    color: '#c9d1e0',
    melodic: false,
    polyphonic: false,
    defaultNote: 60,
    noteRange: DRUM_RANGE,
    gmNote: 49,
    params: [secs('decay', 'Decay', 0.5, 4, 1.8), pct('tone', 'Tone', 0.5)],
  },
  keys: {
    id: 'keys',
    name: 'Electric Piano',
    short: 'KEYS',
    category: 'keys',
    color: '#8fb8ff',
    melodic: true,
    polyphonic: true,
    defaultNote: 60,
    noteRange: [36, 84],
    params: [
      pct('tone', 'Tone', 0.4),
      secs('decay', 'Decay', 0.3, 4, 1.8),
      pct('tremolo', 'Tremolo', 0.25),
      secs('release', 'Release', 0.05, 1.5, 0.4),
    ],
  },
  pad: {
    id: 'pad',
    name: 'Warm Pad',
    short: 'PAD',
    category: 'synth',
    color: '#9f8cff',
    melodic: true,
    polyphonic: true,
    defaultNote: 60,
    noteRange: [36, 84],
    params: [
      secs('attack', 'Attack', 0.01, 2, 0.4),
      secs('release', 'Release', 0.1, 4, 1.2),
      pct('cutoff', 'Cutoff', 0.4),
      pct('detune', 'Detune', 0.4),
    ],
  },
  pluck: {
    id: 'pluck',
    name: 'Pluck',
    short: 'PLK',
    category: 'synth',
    color: '#6ee7b7',
    melodic: true,
    polyphonic: true,
    defaultNote: 72,
    noteRange: [48, 96],
    params: [pct('cutoff', 'Cutoff', 0.5), secs('decay', 'Decay', 0.05, 1.5, 0.35), pct('resonance', 'Reso', 0.3)],
  },
  bell: {
    id: 'bell',
    name: 'Music Box',
    short: 'BELL',
    category: 'keys',
    color: '#ffe38f',
    melodic: true,
    polyphonic: true,
    defaultNote: 72,
    noteRange: [60, 96],
    params: [pct('tone', 'Tone', 0.5), secs('decay', 'Decay', 0.2, 4, 1.4)],
  },
  lead: {
    id: 'lead',
    name: 'Soft Lead',
    short: 'LEAD',
    category: 'synth',
    color: '#f7a1ff',
    melodic: true,
    polyphonic: false,
    mono: true,
    defaultNote: 72,
    noteRange: [48, 96],
    params: [
      secs('attack', 'Attack', 0.005, 0.5, 0.02),
      pct('cutoff', 'Bright', 0.5),
      pct('vibrato', 'Vibrato', 0.3),
      secs('glide', 'Glide', 0, 0.3, 0.04),
      secs('release', 'Release', 0.02, 1.5, 0.2),
    ],
  },
  bass: {
    id: 'bass',
    name: 'Sub Bass',
    short: 'BASS',
    category: 'bass',
    color: '#ff8f5a',
    melodic: true,
    polyphonic: false,
    mono: true,
    defaultNote: 36,
    noteRange: [24, 55],
    params: [pct('tone', 'Tone', 0.35), pct('drive', 'Drive', 0.2), secs('release', 'Release', 0.02, 1, 0.12)],
  },
  wurli: {
    id: 'wurli',
    name: 'Wurli',
    short: 'WURL',
    category: 'keys',
    color: '#7fb0e8',
    melodic: true,
    polyphonic: true,
    defaultNote: 60,
    noteRange: [36, 84],
    params: [
      pct('tone', 'Tone', 0.45),
      pct('bark', 'Bark', 0.4),
      secs('decay', 'Decay', 0.3, 4, 1.4),
      pct('tremolo', 'Tremolo', 0.35),
      secs('release', 'Release', 0.05, 1.5, 0.3),
    ],
  },
  guitar: {
    id: 'guitar',
    name: 'Nylon Guitar',
    short: 'GTR',
    category: 'band',
    color: '#e8b27a',
    melodic: true,
    polyphonic: true,
    defaultNote: 60,
    noteRange: [40, 84],
    params: [
      pct('tone', 'Tone', 0.45),
      secs('decay', 'Decay', 0.3, 4, 1.6),
      pct('body', 'Body', 0.5),
      secs('strum', 'Strum', 0, 0.08, 0.025),
    ],
  },
  strings: {
    id: 'strings',
    name: 'Strings',
    short: 'STR',
    category: 'band',
    color: '#c7a0e8',
    melodic: true,
    polyphonic: true,
    defaultNote: 60,
    noteRange: [36, 88],
    params: [
      secs('attack', 'Attack', 0.02, 2, 0.35),
      secs('release', 'Release', 0.1, 4, 1),
      pct('bright', 'Bright', 0.45),
      pct('vibrato', 'Vibrato', 0.3),
      pct('ensemble', 'Ensemble', 0.5),
    ],
  },
  flute: {
    id: 'flute',
    name: 'Flute',
    short: 'FLT',
    category: 'band',
    color: '#9fe0d0',
    melodic: true,
    polyphonic: false,
    mono: true,
    defaultNote: 72,
    noteRange: [60, 96],
    params: [
      secs('attack', 'Attack', 0.01, 0.5, 0.06),
      pct('breath', 'Breath', 0.35),
      pct('vibrato', 'Vibrato', 0.35),
      pct('bright', 'Bright', 0.5),
      secs('release', 'Release', 0.02, 1, 0.15),
    ],
  },
  vox: {
    id: 'vox',
    name: 'Vocal Oohs',
    short: 'VOX',
    category: 'band',
    color: '#f2b8c6',
    melodic: true,
    polyphonic: true,
    defaultNote: 60,
    noteRange: [48, 84],
    params: [
      pct('vowel', 'Vowel', 0.2),
      secs('attack', 'Attack', 0.02, 1.5, 0.25),
      secs('release', 'Release', 0.1, 3, 0.8),
      pct('vibrato', 'Vibrato', 0.3),
      pct('air', 'Air', 0.3),
    ],
  },
  upright: {
    id: 'upright',
    name: 'Upright Bass',
    short: 'UPR',
    category: 'bass',
    color: '#d99a6c',
    melodic: true,
    polyphonic: false,
    mono: true,
    defaultNote: 36,
    noteRange: [28, 55],
    params: [pct('tone', 'Tone', 0.4), secs('decay', 'Decay', 0.2, 3, 0.9), pct('thump', 'Thump', 0.5)],
  },
  riser: {
    id: 'riser',
    name: 'Riser',
    short: 'RSR',
    category: 'fx',
    color: '#b0b8ff',
    melodic: false,
    polyphonic: false,
    usesLength: true,
    defaultNote: 60,
    noteRange: [60, 60],
    params: [pct('tone', 'Tone', 0.5), pct('noise', 'Noise', 0.7), pct('pitch', 'Pitch', 0.5)],
  },
  sampler: {
    id: 'sampler',
    name: 'Sampler',
    short: 'SMP',
    category: 'sampler',
    color: '#8fd3ff',
    melodic: true,
    polyphonic: true,
    sampler: true,
    defaultNote: 60,
    noteRange: [36, 96],
    params: [
      {
        id: 'tune',
        label: 'Tune',
        min: -24,
        max: 24,
        default: 0,
        step: 1,
        unit: 'number',
      },
      secs('attack', 'Attack', 0.001, 1, 0.003),
      secs('release', 'Release', 0.01, 2, 0.08),
      pct('cutoff', 'Cutoff', 1),
    ],
  },
};

export const INSTRUMENT_LIST: InstrumentDef[] = INSTRUMENT_IDS.map((id) => INSTRUMENTS[id]);

export const CATEGORY_LABELS: Record<InstrumentCategory, string> = {
  drums: 'Drums',
  bass: 'Bass',
  keys: 'Keys',
  synth: 'Synths',
  band: 'Band',
  fx: 'FX',
  sampler: 'Sampler',
};

export function isInstrumentId(value: unknown): value is InstrumentId {
  return typeof value === 'string' && (INSTRUMENT_IDS as readonly string[]).includes(value);
}

export function getInstrument(id: InstrumentId): InstrumentDef {
  return INSTRUMENTS[id];
}

export function defaultParams(id: InstrumentId): Record<string, number> {
  const params: Record<string, number> = {};
  for (const p of INSTRUMENTS[id].params) params[p.id] = p.default;
  return params;
}

/** Read a param with a safe fallback to its default. */
export function paramValue(id: InstrumentId, params: Record<string, number>, key: string): number {
  const value = params[key];
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  return INSTRUMENTS[id].params.find((p) => p.id === key)?.default ?? 0;
}

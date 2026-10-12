/**
 * Deterministic keyword parser that turns a free-text description ("sad jazzy
 * lofi with rain and a flute, 3 minutes in D minor") into song options. No AI:
 * just phrase tables, so the same text always gives the same result.
 */
import { NOTE_NAMES, SCALES, type ScaleId } from '@/lib/music/theory';
import { INSTRUMENTS, type InstrumentId } from '@/lib/project/instruments';
import { AMBIENCE_TYPES, BPM_MAX, BPM_MIN, type AmbienceType } from '@/lib/project/types';
import { clamp } from '@/lib/utils/math';
import { GENRES, type GenreId } from './genres';
import { DEFAULT_MOOD, SONG_MINUTES, normalizeStyles, type Mood, type SongOptions, type StyleWeight } from './song';

export interface ParsedPrompt {
  options: Partial<SongOptions>;
  /** Recognised phrases, in the order they appear, for UI chips */
  matched: string[];
}

type Rule<T> = [RegExp, T];

/** Whole-word, case-insensitive alternatives (accented letters count as letters). */
const w = (words: string) => new RegExp(`\\b(?:${words})(?![\\p{L}\\p{N}_])`, 'giu');

const STYLE_RULES: Rule<GenreId>[] = [
  [w('lo-?fi hip ?hop|lo-?fi|lo fi'), 'lofi'],
  [w('jazzy|jazz(?: ?hop)?|bebop|swing(?:ing|y)'), 'jazzhop'],
  [w('boom ?bap|90s hip ?hop|90s rap|old ?school|hip ?hop|golden era'), 'boombap'],
  [w('chill ?hop|chill(?:ed|y)?|sunny'), 'chillhop'],
  [w('trap|drill|808 ?beat'), 'trap'],
  [w('r ?& ?b|r ?n ?b|rnb|neo[- ]?soul|soul(?:ful)?|slow jam'), 'rnb'],
  [w('deep house|house|dance|club|disco|edm'), 'house'],
  [w('ambient|sleep(?:ing|y)?|meditation|meditative|drone|spa|yoga'), 'ambient'],
];

/** Mood words: each sets some mood axes; several are averaged. */
const MOOD_RULES: Rule<Partial<Mood>>[] = [
  [w('sad|sadness|heartbroken|heartbreak|crying|tears'), { valence: 0.15, energy: 0.35 }],
  [w('melanchol(?:y|ic)|bittersweet|wistful'), { valence: 0.25, energy: 0.35 }],
  [w('lonely|alone|longing'), { valence: 0.22, energy: 0.3 }],
  [w('dark|moody|gloomy|eerie|spooky|haunting|sinister|menacing'), { valence: 0.12, brightness: 0.25 }],
  [w('happy|joyful|cheerful|fun|playful|feel ?good'), { valence: 0.88 }],
  [w('uplifting|hopeful|optimistic|inspiring|positive'), { valence: 0.8, energy: 0.62 }],
  [w('romantic|love|lovely|tender|sweet'), { valence: 0.65, energy: 0.4 }],
  [w('dreamy|floaty|ethereal|hazy|dreamlike'), { valence: 0.55, energy: 0.28, brightness: 0.4 }],
  [w('nostalgic|nostalgia|memories|retro|vintage|old'), { valence: 0.42, brightness: 0.25 }],
  [w('energetic|hype|hyped|intense|aggressive|banger|hard|powerful'), { energy: 0.9 }],
  [w('groovy|funky|bouncy|danceable'), { energy: 0.7, valence: 0.65 }],
  [w('calm|relaxed|relaxing|peaceful|soothing|gentle|mellow|laid[- ]back|lazy|soft'), { energy: 0.22 }],
  [w('focus|study|studying|concentration|work(?:ing)?'), { energy: 0.35 }],
  [w('warm|cozy|cosy|fireplace'), { brightness: 0.3, valence: 0.6 }],
  [w('dusty|lo-?fi sounding|crackly|gritty|grainy|tape'), { brightness: 0.15 }],
  [w('bright|clean|crisp|shiny|sparkly|glossy'), { brightness: 0.88 }],
  [w('rainy|stormy|gray|grey|overcast'), { valence: 0.35, brightness: 0.35 }],
  [w('night|late ?night|midnight|nocturnal'), { valence: 0.4, energy: 0.35 }],
  [w('morning|sunrise|summer|spring'), { valence: 0.72, brightness: 0.7 }],
];

/** Tempo words map to energy (the tempo range follows the style). */
const TEMPO_RULES: Rule<Partial<Mood>>[] = [
  [w('very slow|super slow|slowed'), { energy: 0.05 }],
  [w('slow|downtempo'), { energy: 0.15 }],
  [w('mid-?tempo|medium tempo'), { energy: 0.5 }],
  [w('upbeat|up-?tempo'), { energy: 0.75, valence: 0.7 }],
  [w('fast|quick|rapid|speedy'), { energy: 0.9 }],
];

const INSTRUMENT_RULES: Rule<InstrumentId>[] = [
  [w('electric piano|e-?piano|rhodes|piano|keys|keyboard'), 'keys'],
  [w('wurli(?:tzer)?'), 'wurli'],
  [w('guitars?|nylon|acoustic guitar'), 'guitar'],
  [w('flutes?|woodwinds?'), 'flute'],
  [w('strings|violins?|cellos?|orchestra(?:l)?|string section'), 'strings'],
  [w('choir|vocals?|voices?|oohs?|aahs?|vox|singing'), 'vox'],
  [w('808s?'), '808'],
  [w('bells?|music ?box|glockenspiel|chimes|celesta'), 'bell'],
  [w('synth ?pads?|pads?'), 'pad'],
  [w('upright(?: bass)?|double bass|acoustic bass|jazz bass|contrabass'), 'upright'],
  [w('synth lead|lead synth|leads?'), 'lead'],
  [w('plucks?|pluck(?:ed|y) synth'), 'pluck'],
  [w('shakers?'), 'shaker'],
  [w('crash(?:es)?|cymbals?'), 'crash'],
  [w('risers?|sweeps?|build ?ups?'), 'riser'],
  [w('toms?'), 'tom'],
  [w('claps?'), 'clap'],
];

const DRUM_KIT: InstrumentId[] = ['kick', 'snare', 'clap', 'hat', 'openhat', 'rim', 'shaker', 'tom', 'crash'];

const AMBIENCE_RULES: Rule<AmbienceType>[] = [
  [w('rain|raining|rainfall|storm|thunder'), 'rain'],
  [w('caf[eé]|coffee ?shop|coffee|diner|restaurant'), 'cafe'],
  [w('city|street|streets|traffic|urban|subway|commute'), 'city'],
  [w('crickets|night sounds|nature|forest|countryside|summer night'), 'night'],
  [w('vinyl|record player|records?|crackle'), 'vinyl'],
  [w('room tone|bedroom|living room'), 'room'],
];

const SCALE_WORDS: Rule<ScaleId>[] = [
  [/^(?:harmonic minor)$/i, 'harmonicMinor'],
  [/^(?:minor pentatonic|pentatonic minor)$/i, 'pentatonicMinor'],
  [/^(?:major pentatonic|pentatonic major|pentatonic)$/i, 'pentatonicMajor'],
  [/^(?:major|maj|ionian)$/i, 'major'],
  [/^(?:minor|min|aeolian|m)$/i, 'minor'],
  [/^dorian$/i, 'dorian'],
  [/^mixolydian$/i, 'mixolydian'],
  [/^lydian$/i, 'lydian'],
  [/^phrygian$/i, 'phrygian'],
  [/^blues$/i, 'blues'],
];

const NUMBER_WORDS: Record<string, number> = {
  a: 1,
  an: 1,
  one: 1,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
  half: 0.5,
  'one and a half': 1.5,
  'two and a half': 2.5,
  'three and a half': 3.5,
};

interface Hit {
  index: number;
  phrase: string;
}

/** Matches of a rule set in text order; longer phrases win over overlapping shorter ones. */
function scan<T>(text: string, rules: Rule<T>[]): { value: T; hit: Hit }[] {
  const found: { value: T; hit: Hit }[] = [];
  for (const [re, value] of rules) {
    re.lastIndex = 0;
    for (let m = re.exec(text); m; m = re.exec(text)) {
      found.push({ value, hit: { index: m.index, phrase: m[0] } });
      if (!re.global) break;
    }
  }
  const kept: { value: T; hit: Hit }[] = [];
  for (const f of found.sort((a, b) => b.hit.phrase.length - a.hit.phrase.length || a.hit.index - b.hit.index)) {
    const end = f.hit.index + f.hit.phrase.length;
    const overlaps = kept.some((k) => f.hit.index < k.hit.index + k.hit.phrase.length && end > k.hit.index);
    if (!overlaps) kept.push(f);
  }
  return kept.sort((a, b) => a.hit.index - b.hit.index);
}

function pitchClassOf(name: string): number | null {
  const letter = name[0].toUpperCase();
  const base = NOTE_NAMES.indexOf(letter as (typeof NOTE_NAMES)[number]);
  if (base < 0) return null;
  const accidental = name.slice(1);
  const shift = /^(#|♯|sharp)$/i.test(accidental) ? 1 : /^(b|♭|flat)$/i.test(accidental) ? -1 : 0;
  return (base + shift + 12) % 12;
}

function parseKey(text: string, hits: Hit[]): { root?: number; scale?: ScaleId } {
  const modes =
    'harmonic minor|minor pentatonic|pentatonic minor|major pentatonic|pentatonic major|pentatonic|major|maj|ionian|minor|min|aeolian|dorian|mixolydian|lydian|phrygian|blues';
  // "in D minor", "F# major", "A dorian", "in Eb", "Dm"
  const withMode = new RegExp(
    `\\b(?:in\\s+(?:the\\s+key\\s+of\\s+)?)?([A-Ga-g])(#|♯|b|♭|\\s?sharp|\\s?flat)?\\s*(${modes})\\b`,
    'g',
  );
  for (let m = withMode.exec(text); m; m = withMode.exec(text)) {
    const explicit = /^in\s/i.test(m[0]);
    // A lone lower-case "a" is an article ("a major vibe"), not a key.
    if (!explicit && m[1] === 'a' && !m[2]) continue;
    const root = pitchClassOf(m[1] + (m[2] ?? '').trim());
    const scale = SCALE_WORDS.find(([re]) => re.test(m![3]))?.[1];
    if (root === null || !scale) continue;
    hits.push({ index: m.index, phrase: m[0].trim() });
    return { root, scale };
  }
  const short = /\b([A-G])(#|b)?m\b/.exec(text);
  if (short) {
    const root = pitchClassOf(short[1] + (short[2] ?? ''));
    if (root !== null) {
      hits.push({ index: short.index, phrase: short[0] });
      return { root, scale: 'minor' };
    }
  }
  const bare = /\bin\s+(?:the\s+key\s+of\s+)?([A-G])(#|♯|b|♭)?(?![\w#♯♭])/.exec(text);
  if (bare) {
    const root = pitchClassOf(bare[1] + (bare[2] ?? ''));
    if (root !== null) {
      hits.push({ index: bare.index, phrase: bare[0].trim() });
      return { root };
    }
  }
  return {};
}

function parseLength(text: string, hits: Hit[]): number | undefined {
  const clock = /\b(\d{1,2}):([0-5]\d)\b/.exec(text);
  if (clock) {
    hits.push({ index: clock.index, phrase: clock[0] });
    return Number(clock[1]) + Number(clock[2]) / 60;
  }
  const words = Object.keys(NUMBER_WORDS)
    .sort((a, b) => b.length - a.length)
    .join('|');
  const minutes = new RegExp(`\\b(\\d+(?:\\.\\d+)?|${words})[\\s-]*(?:minutes?|mins?|m)\\b`, 'i').exec(text);
  // Bare "s" is left out on purpose: "90s hip hop" is a decade, not a length.
  const seconds = /\b(\d+)\s*(?:seconds?|secs?)\b/i.exec(text);
  let value: number | undefined;
  if (minutes) {
    const raw = minutes[1].toLowerCase();
    value = NUMBER_WORDS[raw] ?? Number(raw);
    hits.push({ index: minutes.index, phrase: minutes[0] });
    if (seconds && seconds.index > minutes.index) {
      value += Number(seconds[1]) / 60;
      hits.push({ index: seconds.index, phrase: seconds[0] });
    }
  } else if (seconds) {
    value = Number(seconds[1]) / 60;
    hits.push({ index: seconds.index, phrase: seconds[0] });
  } else {
    const size = /\b(short|quick one|brief|long|extended|epic)\b/i.exec(text);
    if (size) {
      hits.push({ index: size.index, phrase: size[0] });
      value = /short|quick|brief/i.test(size[1]) ? 1.5 : 4;
    }
  }
  return value === undefined || !Number.isFinite(value)
    ? undefined
    : clamp(Math.round(value * 100) / 100, SONG_MINUTES.min, SONG_MINUTES.max);
}

/** Parse a free-text description into song options plus the phrases it recognised. */
export function parsePrompt(text: string): ParsedPrompt {
  const source = (text ?? '').slice(0, 1000);
  const hits: Hit[] = [];
  const options: Partial<SongOptions> = {};

  // Tempo first, so "90 bpm" isn't read as a length.
  const bpm = /\b(\d{2,3})\s*(?:bpm|beats per minute)\b/i.exec(source);
  if (bpm) {
    options.bpm = clamp(Number(bpm[1]), BPM_MIN, BPM_MAX);
    hits.push({ index: bpm.index, phrase: bpm[0] });
  }
  const scrubbed = bpm ? source.replace(bpm[0], ' '.repeat(bpm[0].length)) : source;

  // Negations: "no drums", "without 808s", "no vocals".
  const exclude = new Set<InstrumentId>();
  const negation =
    /\b(?:no|without|minus|skip|zero)\s+(?:the\s+|any\s+)?([a-z0-9&' -]+?)(?=[,.;!?]|\band\b|\bwith\b|\bbut\b|$)/gi;
  const negated: [number, number][] = [];
  let noAmbience = false;
  for (let m = negation.exec(scrubbed); m; m = negation.exec(scrubbed)) {
    const phrase = m[1];
    const found = /\b(drums?|percussion)\b/i.test(phrase)
      ? DRUM_KIT
      : scan(phrase, INSTRUMENT_RULES).map((f) => f.value);
    const quiet = scan(phrase, AMBIENCE_RULES).length > 0;
    if (!found.length && !quiet && !scan(phrase, STYLE_RULES).length) continue;
    for (const id of found) exclude.add(id);
    noAmbience ||= quiet;
    negated.push([m.index, m.index + m[0].length]);
    hits.push({ index: m.index, phrase: m[0].trim() });
  }
  const free = (index: number) => !negated.some(([a, b]) => index >= a && index < b);

  const styles = scan(scrubbed, STYLE_RULES).filter((f) => free(f.hit.index));
  if (styles.length) {
    // Earlier mentions weigh more: 1, 0.7, 0.5, then 0.4 for every style after that.
    const weights = [1, 0.7, 0.5];
    const order: GenreId[] = [];
    for (const s of styles) if (!order.includes(s.value)) order.push(s.value);
    const list: StyleWeight[] = order.map((genre, i) => ({ genre, weight: weights[i] ?? 0.4 }));
    options.styles = normalizeStyles(list);
    hits.push(...styles.map((s) => s.hit));
  }

  const moods = [...scan(scrubbed, MOOD_RULES), ...scan(scrubbed, TEMPO_RULES)].filter((f) => free(f.hit.index));
  // "chill" is a style but also says something about energy.
  if (styles.some((s) => s.value === 'chillhop' && /^chill(ed|y)?$/i.test(s.hit.phrase))) {
    moods.push({ value: { energy: 0.3 }, hit: { index: -1, phrase: '' } });
  }
  if (styles.some((s) => s.value === 'ambient' && /sleep|meditat|spa|yoga/i.test(s.hit.phrase))) {
    moods.push({ value: { energy: 0.1 }, hit: { index: -1, phrase: '' } });
  }
  if (moods.length) {
    const mood: Partial<Mood> = {};
    for (const axis of Object.keys(DEFAULT_MOOD) as (keyof Mood)[]) {
      const values = moods.map((m) => m.value[axis]).filter((v): v is number => v !== undefined);
      if (values.length) mood[axis] = Math.round((values.reduce((a, b) => a + b, 0) / values.length) * 100) / 100;
    }
    options.mood = mood;
    hits.push(...moods.filter((m) => m.hit.phrase).map((m) => m.hit));
  }

  const key = parseKey(scrubbed, hits);
  if (key.root !== undefined) options.root = key.root;
  if (key.scale) options.scale = key.scale;

  const minutes = parseLength(scrubbed, hits);
  if (minutes !== undefined) options.minutes = minutes;

  const instruments: InstrumentId[] = [];
  for (const f of scan(scrubbed, INSTRUMENT_RULES)) {
    if (!free(f.hit.index) || exclude.has(f.value)) continue;
    if (!instruments.includes(f.value)) instruments.push(f.value);
    hits.push(f.hit);
  }
  if (instruments.length) options.instruments = instruments;
  if (exclude.size) options.exclude = [...exclude];

  const ambience = scan(scrubbed, AMBIENCE_RULES).filter((f) => free(f.hit.index));
  if (ambience.length) {
    options.ambience = ambience[0].value;
    hits.push(ambience[0].hit);
  } else if (noAmbience) {
    options.ambience = 'none';
  }

  // Unique phrases in text order, leaving out ones inside a longer match ("night" in "night sounds").
  const inside = (a: Hit, b: Hit) =>
    a !== b &&
    a.index >= b.index &&
    a.index + a.phrase.length <= b.index + b.phrase.length &&
    a.phrase.length < b.phrase.length;
  const matched: string[] = [];
  for (const h of hits.sort((a, b) => a.index - b.index)) {
    const phrase = h.phrase.trim();
    if (!phrase || hits.some((other) => inside(h, other))) continue;
    if (!matched.some((m) => m.toLowerCase() === phrase.toLowerCase())) matched.push(phrase);
  }
  return { options, matched };
}

const MOOD_LABELS: [keyof Mood, number, string, string][] = [
  ['valence', 0.35, 'sad', 'happy'],
  ['energy', 0.35, 'chill', 'energetic'],
  ['brightness', 0.35, 'warm', 'bright'],
];

function formatMinutes(minutes: number): string {
  const total = Math.round(minutes * 60);
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
}

/** Short human summary of song options, e.g. "Lofi + Jazz hop · sad, chill · D minor · 3:00 · with flute · rain". */
export function describeOptions(options: Partial<SongOptions>): string {
  const parts: string[] = [];
  const styles = options.styles?.length ? normalizeStyles(options.styles) : [];
  if (styles.length) parts.push(styles.map((s) => GENRES[s.genre].name).join(' + '));
  if (options.mood) {
    const words: string[] = [];
    for (const [axis, threshold, low, high] of MOOD_LABELS) {
      const v = options.mood[axis];
      if (v === undefined) continue;
      if (v <= threshold) words.push(low);
      else if (v >= 1 - threshold) words.push(high);
    }
    if (words.length) parts.push(words.join(', '));
  }
  if (options.root !== undefined || options.scale) {
    const root = options.root !== undefined ? NOTE_NAMES[((Math.round(options.root) % 12) + 12) % 12] : '';
    const scale = options.scale ? SCALES[options.scale].label.toLowerCase() : '';
    parts.push([root, scale].filter(Boolean).join(' '));
  }
  if (options.bpm !== undefined) parts.push(`${Math.round(options.bpm)} BPM`);
  if (options.minutes !== undefined) parts.push(formatMinutes(options.minutes));
  if (options.instruments?.length) {
    parts.push(`with ${options.instruments.map((id) => INSTRUMENTS[id].name.toLowerCase()).join(', ')}`);
  }
  if (options.exclude?.length) {
    const noDrums = DRUM_KIT.every((id) => options.exclude!.includes(id));
    const rest = options.exclude.filter((id) => !noDrums || !DRUM_KIT.includes(id));
    const names = [...(noDrums ? ['drums'] : []), ...rest.map((id) => INSTRUMENTS[id].name.toLowerCase())];
    parts.push(`no ${names.join(', ')}`);
  }
  if (
    options.ambience &&
    options.ambience !== 'none' &&
    (AMBIENCE_TYPES as readonly string[]).includes(options.ambience)
  ) {
    parts.push(options.ambience);
  }
  return parts.join(' · ');
}

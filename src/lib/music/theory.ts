export const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'] as const;

export const SCALES = {
  minor: { label: 'Minor', intervals: [0, 2, 3, 5, 7, 8, 10] },
  major: { label: 'Major', intervals: [0, 2, 4, 5, 7, 9, 11] },
  dorian: { label: 'Dorian', intervals: [0, 2, 3, 5, 7, 9, 10] },
  mixolydian: { label: 'Mixolydian', intervals: [0, 2, 4, 5, 7, 9, 10] },
  lydian: { label: 'Lydian', intervals: [0, 2, 4, 6, 7, 9, 11] },
  phrygian: { label: 'Phrygian', intervals: [0, 1, 3, 5, 7, 8, 10] },
  harmonicMinor: { label: 'Harmonic minor', intervals: [0, 2, 3, 5, 7, 8, 11] },
  pentatonicMinor: { label: 'Minor pentatonic', intervals: [0, 3, 5, 7, 10] },
  pentatonicMajor: { label: 'Major pentatonic', intervals: [0, 2, 4, 7, 9] },
  blues: { label: 'Blues', intervals: [0, 3, 5, 6, 7, 10] },
} as const satisfies Record<string, { label: string; intervals: readonly number[] }>;

export type ScaleId = keyof typeof SCALES;
export const SCALE_IDS = Object.keys(SCALES) as ScaleId[];

export type ChordType = 'off' | 'triad' | 'seventh' | 'ninth';

export function midiToFreq(midi: number): number {
  return 440 * Math.pow(2, (midi - 69) / 12);
}

/** Scientific pitch notation, MIDI 60 = C4. */
export function noteName(midi: number, withOctave = true): string {
  const name = NOTE_NAMES[((midi % 12) + 12) % 12];
  return withOctave ? `${name}${Math.floor(midi / 12) - 1}` : name;
}

export function pitchClass(midi: number): number {
  return ((midi % 12) + 12) % 12;
}

export function isInScale(midi: number, root: number, scale: ScaleId): boolean {
  const pc = pitchClass(midi - root);
  return (SCALES[scale].intervals as readonly number[]).includes(pc);
}

/** All scale notes in [low, high] inclusive, ascending. */
export function scaleNotes(root: number, scale: ScaleId, low: number, high: number): number[] {
  const notes: number[] = [];
  for (let midi = low; midi <= high; midi++) {
    if (isInScale(midi, root, scale)) notes.push(midi);
  }
  return notes;
}

/** Move a note to the nearest pitch in the scale, preferring the lower neighbour on ties. */
export function snapToScale(midi: number, root: number, scale: ScaleId): number {
  for (let offset = 0; offset < 12; offset++) {
    if (isInScale(midi - offset, root, scale)) return midi - offset;
    if (isInScale(midi + offset, root, scale)) return midi + offset;
  }
  return midi;
}

/**
 * Scale-degree arithmetic: returns the note `steps` scale degrees away from `midi`.
 * `midi` is snapped into the scale first.
 */
export function transposeInScale(midi: number, steps: number, root: number, scale: ScaleId): number {
  const intervals = SCALES[scale].intervals as readonly number[];
  const snapped = snapToScale(midi, root, scale);
  const rel = snapped - root;
  const octave = Math.floor(rel / 12);
  const degree = intervals.indexOf(pitchClass(rel));
  const total = degree + steps;
  const len = intervals.length;
  const newOctave = octave + Math.floor(total / len);
  const newDegree = ((total % len) + len) % len;
  return root + newOctave * 12 + intervals[newDegree];
}

/** Diatonic chord (stacked thirds) built on `midi` within the key. */
export function buildChord(midi: number, type: ChordType, root: number, scale: ScaleId): number[] {
  if (type === 'off') return [midi];
  const intervals = SCALES[scale].intervals;
  // Pentatonic/blues scales don't stack thirds cleanly; borrow the parent heptatonic scale.
  const harmonyScale: ScaleId = intervals.length === 7 ? scale : scale === 'pentatonicMajor' ? 'major' : 'minor';
  const size = type === 'triad' ? 3 : type === 'seventh' ? 4 : 5;
  const base = snapToScale(midi, root, harmonyScale);
  const notes: number[] = [];
  for (let i = 0; i < size; i++) notes.push(transposeInScale(base, i * 2, root, harmonyScale));
  return notes;
}

/** Roman-numeral label for the diatonic chord on `midi`, e.g. "ii" or "V". */
export function romanNumeral(midi: number, root: number, scale: ScaleId): string {
  const numerals = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII'];
  const intervals = SCALES[scale].intervals as readonly number[];
  const degree = intervals.indexOf(pitchClass(snapToScale(midi, root, scale) - root));
  if (degree < 0 || intervals.length !== 7) return noteName(midi, false);
  const chord = buildChord(midi, 'triad', root, scale);
  const third = chord[1] - chord[0];
  const fifth = chord[2] - chord[0];
  const label = numerals[degree];
  if (third === 4) return fifth === 8 ? `${label}+` : label;
  return fifth === 6 ? `${label.toLowerCase()}°` : label.toLowerCase();
}

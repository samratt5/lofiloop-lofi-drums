import { describe, expect, it } from 'vitest';
import {
  buildChord,
  isInScale,
  midiToFreq,
  noteName,
  romanNumeral,
  scaleNotes,
  snapToScale,
  transposeInScale,
} from './theory';

describe('theory', () => {
  it('converts MIDI to frequency and names', () => {
    expect(midiToFreq(69)).toBeCloseTo(440);
    expect(midiToFreq(60)).toBeCloseTo(261.63, 1);
    expect(noteName(60)).toBe('C4');
    expect(noteName(61, false)).toBe('C#');
    expect(noteName(-1)).toBe('B-2');
  });

  it('knows which notes are in a scale', () => {
    // D dorian: D E F G A B C
    expect(isInScale(62, 2, 'dorian')).toBe(true);
    expect(isInScale(71, 2, 'dorian')).toBe(true);
    expect(isInScale(70, 2, 'dorian')).toBe(false);
    expect(scaleNotes(0, 'major', 60, 72)).toEqual([60, 62, 64, 65, 67, 69, 71, 72]);
  });

  it('snaps and transposes within the key', () => {
    expect(snapToScale(61, 0, 'major')).toBe(60);
    expect(snapToScale(66, 0, 'major')).toBe(65);
    expect(transposeInScale(60, 2, 0, 'major')).toBe(64);
    expect(transposeInScale(71, 1, 0, 'major')).toBe(72);
    expect(transposeInScale(60, -1, 0, 'major')).toBe(59);
  });

  it('builds diatonic chords', () => {
    expect(buildChord(60, 'off', 0, 'major')).toEqual([60]);
    expect(buildChord(60, 'triad', 0, 'major')).toEqual([60, 64, 67]);
    expect(buildChord(62, 'seventh', 0, 'major')).toEqual([62, 65, 69, 72]); // Dm7
    expect(buildChord(67, 'ninth', 0, 'major')).toEqual([67, 71, 74, 77, 81]); // G9
    // Pentatonic keys borrow the parent scale for harmony
    expect(buildChord(57, 'triad', 9, 'pentatonicMinor')).toEqual([57, 60, 64]);
  });

  it('labels chords with roman numerals', () => {
    expect(romanNumeral(60, 0, 'major')).toBe('I');
    expect(romanNumeral(62, 0, 'major')).toBe('ii');
    expect(romanNumeral(71, 0, 'major')).toBe('vii°');
  });
});

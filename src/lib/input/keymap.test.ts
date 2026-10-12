import { describe, expect, it } from 'vitest';
import {
  clampOctave,
  isEditableTarget,
  isPianoReserved,
  keyToNote,
  MAX_OCTAVE,
  MIN_OCTAVE,
  octaveShift,
  ownsArrowKeys,
  PIANO_KEYS,
  PIANO_SPAN,
} from './keymap';

describe('keymap', () => {
  it('maps the lower row from C of the base octave', () => {
    expect(keyToNote('KeyZ', 4)).toBe(60);
    expect(keyToNote('KeyS', 4)).toBe(61);
    expect(keyToNote('KeyM', 4)).toBe(71);
    expect(keyToNote('Comma', 4)).toBe(72);
    expect(keyToNote('Slash', 4)).toBe(76);
  });

  it('maps the upper row an octave higher', () => {
    expect(keyToNote('KeyQ', 4)).toBe(72);
    expect(keyToNote('Digit2', 4)).toBe(73);
    expect(keyToNote('KeyI', 4)).toBe(84);
    expect(keyToNote('BracketRight', 4)).toBe(91);
    expect(keyToNote('KeyQ', 3)).toBe(keyToNote('Comma', 3));
  });

  it('ignores non-piano keys', () => {
    for (const code of ['KeyA', 'KeyF', 'KeyK', 'Digit1', 'Digit4', 'Digit8', 'Minus', 'Space', 'ArrowLeft']) {
      expect(keyToNote(code, 4)).toBeNull();
    }
  });

  it('has unique codes, a chromatic lower row and correct black keys', () => {
    expect(new Set(PIANO_KEYS.map((k) => k.code)).size).toBe(PIANO_KEYS.length);
    const lower = PIANO_KEYS.filter((k) => k.row === 'lower').map((k) => k.semitone);
    expect(lower).toEqual(Array.from({ length: 17 }, (_, i) => i));
    expect(PIANO_KEYS.filter((k) => k.black).map((k) => k.label)).toEqual([
      'S',
      'D',
      'G',
      'H',
      'J',
      'L',
      ';',
      '2',
      '3',
      '5',
      '6',
      '7',
      '9',
      '0',
      '=',
    ]);
    expect(PIANO_SPAN).toBe(31);
  });

  it('keeps every octave within MIDI range', () => {
    expect(MIN_OCTAVE).toBe(0);
    expect(MAX_OCTAVE).toBe(7);
    expect(keyToNote('BracketRight', MAX_OCTAVE)).toBe(127);
    expect(keyToNote('KeyZ', MIN_OCTAVE)).toBe(12);
    expect(clampOctave(-3)).toBe(MIN_OCTAVE);
    expect(clampOctave(12)).toBe(MAX_OCTAVE);
    expect(clampOctave(4.4)).toBe(4);
    expect(keyToNote('BracketRight', 9)).toBeNull();
  });

  it('octave keys and reserved keys', () => {
    expect(octaveShift('ArrowLeft')).toBe(-1);
    expect(octaveShift('ArrowRight')).toBe(1);
    expect(octaveShift('KeyZ')).toBe(0);
    expect(isPianoReserved('KeyK')).toBe(true);
    expect(isPianoReserved('Digit1')).toBe(true);
    expect(isPianoReserved('Space')).toBe(false);
    expect(isPianoReserved('Escape')).toBe(false);
    expect(isPianoReserved('ArrowUp')).toBe(false);
    expect(isPianoReserved('Delete')).toBe(false);
  });

  it('detects editable targets', () => {
    expect(isEditableTarget(null)).toBe(false);
    expect(isEditableTarget({ tagName: 'INPUT', type: 'text' } as unknown as EventTarget)).toBe(true);
    expect(isEditableTarget({ tagName: 'INPUT', type: 'number' } as unknown as EventTarget)).toBe(true);
    expect(isEditableTarget({ tagName: 'INPUT', type: 'range' } as unknown as EventTarget)).toBe(false);
    expect(isEditableTarget({ tagName: 'INPUT', type: 'checkbox' } as unknown as EventTarget)).toBe(false);
    expect(isEditableTarget({ tagName: 'TEXTAREA' } as unknown as EventTarget)).toBe(true);
    expect(isEditableTarget({ tagName: 'SELECT' } as unknown as EventTarget)).toBe(true);
    expect(isEditableTarget({ tagName: 'DIV', isContentEditable: true } as unknown as EventTarget)).toBe(true);
    expect(isEditableTarget({ tagName: 'BUTTON' } as unknown as EventTarget)).toBe(false);
  });

  it('leaves arrows to focused widgets that use them', () => {
    const slider = { tagName: 'DIV', closest: (s: string) => (s.includes('[role="slider"]') ? {} : null) };
    const plain = { tagName: 'BUTTON', closest: () => null };
    expect(ownsArrowKeys(slider as unknown as EventTarget)).toBe(true);
    expect(ownsArrowKeys(plain as unknown as EventTarget)).toBe(false);
    expect(ownsArrowKeys(null)).toBe(false);
  });
});

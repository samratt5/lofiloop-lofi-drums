/**
 * Computer-keyboard piano ("musical typing"). Keys are matched by
 * `KeyboardEvent.code`, i.e. physical position, so the layout works the same
 * on QWERTY, AZERTY, QWERTZ, Dvorak…; `label` is the US-QWERTY legend.
 *
 * Lower row  Z S X D C V G B H N J M , L . ; /   → C..E   (base octave)
 * Upper row  Q 2 W 3 E R 5 T 6 Y 7 U I 9 O 0 P [ = ] → C..G (base octave + 1)
 *
 * ← / → shift the octave, Shift plays an accent.
 */

export type PianoRow = 'lower' | 'upper';

export interface PianoKey {
  /** `KeyboardEvent.code` */
  code: string;
  /** Legend for an on-screen keyboard (US layout) */
  label: string;
  /** Semitones above C of the base octave */
  semitone: number;
  row: PianoRow;
  /** Sharp/flat (drawn as a black key) */
  black: boolean;
}

const BLACK = new Set([1, 3, 6, 8, 10]);

function row(row: PianoRow, start: number, keys: [code: string, label: string][]): PianoKey[] {
  return keys.map(([code, label], i) => {
    const semitone = start + i;
    return { code, label, semitone, row, black: BLACK.has(semitone % 12) };
  });
}

/** Every piano key, lower row first, each row ascending in pitch. */
export const PIANO_KEYS: readonly PianoKey[] = [
  ...row('lower', 0, [
    ['KeyZ', 'Z'],
    ['KeyS', 'S'],
    ['KeyX', 'X'],
    ['KeyD', 'D'],
    ['KeyC', 'C'],
    ['KeyV', 'V'],
    ['KeyG', 'G'],
    ['KeyB', 'B'],
    ['KeyH', 'H'],
    ['KeyN', 'N'],
    ['KeyJ', 'J'],
    ['KeyM', 'M'],
    ['Comma', ','],
    ['KeyL', 'L'],
    ['Period', '.'],
    ['Semicolon', ';'],
    ['Slash', '/'],
  ]),
  ...row('upper', 12, [
    ['KeyQ', 'Q'],
    ['Digit2', '2'],
    ['KeyW', 'W'],
    ['Digit3', '3'],
    ['KeyE', 'E'],
    ['KeyR', 'R'],
    ['Digit5', '5'],
    ['KeyT', 'T'],
    ['Digit6', '6'],
    ['KeyY', 'Y'],
    ['Digit7', '7'],
    ['KeyU', 'U'],
    ['KeyI', 'I'],
    ['Digit9', '9'],
    ['KeyO', 'O'],
    ['Digit0', '0'],
    ['KeyP', 'P'],
    ['BracketLeft', '['],
    ['Equal', '='],
    ['BracketRight', ']'],
  ]),
];

const BY_CODE = new Map(PIANO_KEYS.map((k) => [k.code, k]));

/** Highest semitone the layout reaches above the base C (G, two octaves up). */
export const PIANO_SPAN = Math.max(...PIANO_KEYS.map((k) => k.semitone));

/** Octaves are scientific pitch notation: octave 4 starts at middle C (MIDI 60). */
export const MIN_OCTAVE = 0;
/** Highest base octave that keeps the whole layout within MIDI 127. */
export const MAX_OCTAVE = Math.floor((127 - PIANO_SPAN) / 12) - 1;
export const DEFAULT_OCTAVE = 3;

export const OCTAVE_DOWN_CODES: readonly string[] = ['ArrowLeft'];
export const OCTAVE_UP_CODES: readonly string[] = ['ArrowRight'];

/** Normal and Shift (accent) velocities. */
export const DEFAULT_VELOCITY = 0.8;
export const ACCENT_VELOCITY = 1;

export function clampOctave(octave: number): number {
  return Math.min(MAX_OCTAVE, Math.max(MIN_OCTAVE, Math.round(octave)));
}

export function pianoKey(code: string): PianoKey | undefined {
  return BY_CODE.get(code);
}

/** MIDI note for a physical key at a base octave, or null for non-piano keys / out of range. */
export function keyToNote(code: string, baseOctave: number): number | null {
  const key = BY_CODE.get(code);
  if (!key) return null;
  const note = (Math.round(baseOctave) + 1) * 12 + key.semitone;
  return note >= 0 && note <= 127 ? note : null;
}

/** -1 / +1 for the octave keys, 0 otherwise. */
export function octaveShift(code: string): -1 | 0 | 1 {
  if (OCTAVE_DOWN_CODES.includes(code)) return -1;
  if (OCTAVE_UP_CODES.includes(code)) return 1;
  return 0;
}

/**
 * Keys swallowed while piano mode is on even when they play nothing (A, F, K,
 * 1, 4, 8, -, ', …), so single-key studio shortcuts don't fire mid-performance.
 */
export function isPianoReserved(code: string): boolean {
  return (
    BY_CODE.has(code) ||
    /^(Key[A-Z]|Digit[0-9])$/.test(code) ||
    ['Minus', 'Quote', 'Backslash', 'Backquote', 'IntlBackslash'].includes(code)
  );
}

interface ElementLike {
  tagName?: string;
  type?: string;
  isContentEditable?: boolean;
  closest?: (selector: string) => unknown;
}

function asElement(target: EventTarget | null | undefined): ElementLike | null {
  if (!target || typeof target !== 'object' || !('tagName' in target)) return null;
  return target as ElementLike;
}

const NON_TEXT_INPUTS = ['range', 'checkbox', 'radio', 'button', 'submit', 'reset', 'color', 'file', 'image'];

/** Text fields, selects and contenteditable regions own the keyboard: never play notes there. */
export function isEditableTarget(target: EventTarget | null | undefined): boolean {
  const el = asElement(target);
  if (!el) return false;
  if (el.isContentEditable) return true;
  const tag = el.tagName?.toUpperCase();
  if (tag === 'TEXTAREA' || tag === 'SELECT') return true;
  if (tag === 'INPUT') return !NON_TEXT_INPUTS.includes((el.type ?? 'text').toLowerCase());
  return false;
}

const ARROW_OWNERS =
  'input,select,textarea,[contenteditable],[data-grid-nav],[role="slider"],[role="spinbutton"],[role="listbox"],' +
  '[role="menu"],[role="menubar"],[role="tablist"],[role="radiogroup"],[role="tree"],[role="grid"]';

/** Focused widgets that use ←/→ themselves (knobs, sliders, the step grid): don't steal them for octaves. */
export function ownsArrowKeys(target: EventTarget | null | undefined): boolean {
  const el = asElement(target);
  if (!el) return false;
  return Boolean(el.closest?.(ARROW_OWNERS));
}

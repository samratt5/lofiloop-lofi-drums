// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';
import { readPrefs, writePrefs } from './persistence';

describe('preferences', () => {
  beforeEach(() => localStorage.clear());

  it('merges stored preferences over defaults', () => {
    writePrefs({ theme: 'paper' });
    expect(readPrefs({ theme: 'midnight', metronome: false })).toEqual({ theme: 'paper', metronome: false });
  });

  it('falls back to defaults when the stored value is corrupt', () => {
    localStorage.setItem('lofiloop:v2:prefs', '{nope');
    expect(readPrefs({ theme: 'midnight' })).toEqual({ theme: 'midnight' });
  });
});

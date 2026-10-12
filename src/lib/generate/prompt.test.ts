import { describe, expect, it } from 'vitest';
import { describeOptions, parsePrompt } from './prompt';
import type { SongOptions } from './song';

const genres = (text: string) => parsePrompt(text).options.styles?.map((s) => s.genre);

describe('parsePrompt', () => {
  it.each([
    ['lofi beat', ['lofi']],
    ['lo-fi hip hop', ['lofi']],
    ['jazzy lofi', ['jazzhop', 'lofi']],
    ['90s hip hop', ['boombap']],
    ['boom bap', ['boombap']],
    ['chillhop', ['chillhop']],
    ['something chill', ['chillhop']],
    ['uk drill', ['trap']],
    ['trap with lofi keys', ['trap', 'lofi']],
    ['neo soul', ['rnb']],
    ['r&b slow jam', ['rnb']],
    ['RnB', ['rnb']],
    ['deep house', ['house']],
    ['dance track', ['house']],
    ['music for sleep', ['ambient']],
    ['meditation', ['ambient']],
    ['a piano piece', undefined],
  ] as [string, string[] | undefined][])('styles: %s', (text, expected) => {
    expect(genres(text)).toEqual(expected);
  });

  it('weights earlier styles more and keeps every style named', () => {
    const styles = parsePrompt('jazz, lofi, house and trap').options.styles!;
    expect(styles.map((s) => s.genre)).toEqual(['jazzhop', 'lofi', 'house', 'trap']);
    expect(styles[0].weight).toBeGreaterThan(styles[1].weight);
    expect(styles.reduce((n, s) => n + s.weight, 0)).toBeCloseTo(1, 2);
  });

  it.each([
    ['sad', { valence: 0.15 }],
    ['happy', { valence: 0.88 }],
    ['uplifting', { valence: 0.8 }],
    ['melancholy', { valence: 0.25 }],
    ['dark', { valence: 0.12, brightness: 0.25 }],
    ['energetic', { energy: 0.9 }],
    ['hype', { energy: 0.9 }],
    ['calm and relaxed', { energy: 0.22 }],
    ['warm', { brightness: 0.3 }],
    ['bright', { brightness: 0.88 }],
    ['dusty', { brightness: 0.15 }],
    ['nostalgic', { valence: 0.42, brightness: 0.25 }],
    ['rainy', { valence: 0.35 }],
    ['dreamy', { energy: 0.28 }],
    ['slow', { energy: 0.15 }],
    ['fast', { energy: 0.9 }],
    ['upbeat', { energy: 0.75, valence: 0.7 }],
  ] as [string, Record<string, number>][])('mood: %s', (text, expected) => {
    expect(parsePrompt(text).options.mood).toMatchObject(expected);
  });

  it('averages several mood words', () => {
    const mood = parsePrompt('sad but happy').options.mood!;
    expect(mood.valence).toBeCloseTo((0.15 + 0.88) / 2, 1);
  });

  it.each([
    ['90 bpm', { bpm: 90 }],
    ['at 140BPM', { bpm: 140 }],
    ['in D minor', { root: 2, scale: 'minor' }],
    ['F# major', { root: 6, scale: 'major' }],
    ['A dorian', { root: 9, scale: 'dorian' }],
    ['in Eb', { root: 3 }],
    ['in the key of Bb mixolydian', { root: 10, scale: 'mixolydian' }],
    ['E flat minor', { root: 3, scale: 'minor' }],
    ['Dm', { root: 2, scale: 'minor' }],
    ['C harmonic minor', { root: 0, scale: 'harmonicMinor' }],
    ['3 minutes', { minutes: 3 }],
    ['2 min', { minutes: 2 }],
    ['two minutes', { minutes: 2 }],
    ['2:30', { minutes: 2.5 }],
    ['90 seconds', { minutes: 1.5 }],
    ['short', { minutes: 1.5 }],
    ['long', { minutes: 4 }],
    ['20 minutes', { minutes: 6 }],
  ] as [string, Partial<SongOptions>][])('%s', (text, expected) => {
    expect(parsePrompt(text).options).toMatchObject(expected);
  });

  it('does not read articles or decades as keys and lengths', () => {
    const { options } = parsePrompt('a major vibe from the 90s hip hop era');
    expect(options.root).toBeUndefined();
    expect(options.minutes).toBeUndefined();
    expect(options.styles?.[0].genre).toBe('boombap');
  });

  it.each([
    ['piano', 'keys'],
    ['rhodes', 'keys'],
    ['wurli', 'wurli'],
    ['acoustic guitar', 'guitar'],
    ['flute', 'flute'],
    ['violins', 'strings'],
    ['strings', 'strings'],
    ['choir', 'vox'],
    ['vocal oohs', 'vox'],
    ['808s', '808'],
    ['music box', 'bell'],
    ['bells', 'bell'],
    ['pads', 'pad'],
    ['upright bass', 'upright'],
    ['double bass', 'upright'],
  ])('instrument: %s', (text, instrument) => {
    expect(parsePrompt(`with ${text}`).options.instruments).toEqual([instrument]);
  });

  it.each([
    ['rain', 'rain'],
    ['coffee shop', 'cafe'],
    ['café', 'cafe'],
    ['city streets', 'city'],
    ['crickets', 'night'],
    ['vinyl crackle', 'vinyl'],
  ])('ambience: %s', (text, ambience) => {
    expect(parsePrompt(text).options.ambience).toBe(ambience);
  });

  it('handles negations', () => {
    const { options, matched } = parsePrompt('trap, no vocals, without 808s, no drums, no rain');
    expect(options.exclude).toEqual(expect.arrayContaining(['vox', '808', 'kick', 'snare', 'hat']));
    expect(options.instruments).toBeUndefined();
    expect(options.ambience).toBe('none');
    expect(matched).toContain('no vocals');
  });

  it('parses a full description and lists the matched phrases in order', () => {
    const { options, matched } = parsePrompt('Sad jazzy lofi with rain and a flute, 3 minutes in D minor at 80 bpm');
    expect(options).toEqual({
      bpm: 80,
      styles: [
        { genre: 'jazzhop', weight: 0.588 },
        { genre: 'lofi', weight: 0.412 },
      ],
      mood: { valence: 0.15, energy: 0.35 },
      root: 2,
      scale: 'minor',
      minutes: 3,
      instruments: ['flute'],
      ambience: 'rain',
    });
    expect(matched).toEqual(['Sad', 'jazzy', 'lofi', 'rain', 'flute', '3 minutes', 'in D minor', '80 bpm']);
  });

  it('is deterministic and survives junk', () => {
    expect(parsePrompt('happy house in G')).toEqual(parsePrompt('happy house in G'));
    expect(parsePrompt('')).toEqual({ options: {}, matched: [] });
    expect(parsePrompt('🙂 ??? 12345').options.styles).toBeUndefined();
  });
});

describe('describeOptions', () => {
  it('summarises options', () => {
    expect(
      describeOptions({
        styles: [
          { genre: 'lofi', weight: 2 },
          { genre: 'jazzhop', weight: 1 },
        ],
        mood: { valence: 0.1, energy: 0.2, brightness: 0.5 },
        root: 2,
        scale: 'minor',
        minutes: 2.5,
        instruments: ['flute'],
        ambience: 'rain',
      }),
    ).toBe('Lofi + Jazz hop · sad, chill · D minor · 2:30 · with flute · rain');
    expect(describeOptions({})).toBe('');
    expect(describeOptions(parsePrompt('fast trap, 140 bpm, no drums').options)).toBe(
      'Trap · energetic · 140 BPM · no drums',
    );
  });
});

import { describe, expect, it } from 'vitest';
import { buildSongTimeline } from '@/lib/audio/sequence';
import { isInScale } from '@/lib/music/theory';
import { INSTRUMENT_LIST, INSTRUMENTS, type InstrumentId } from '@/lib/project/instruments';
import { parseProjectFile, serializeProject } from '@/lib/project/serialize';
import {
  MASTER_AUTOMATION_PARAMS,
  MAX_PATTERNS,
  MAX_SECTION_REPEATS,
  MAX_SECTIONS,
  MAX_STEP_OFFSET,
  MAX_STEPS,
  MAX_TRACKS,
  TRACK_AUTOMATION_PARAMS,
  type Pattern,
  type Project,
} from '@/lib/project/types';
import { createProject } from '@/lib/project/factory';
import { createDemoProject } from '@/lib/project/templates';
import { GENRE_IDS, GENRES, parseGroovePart, type GenreId } from './genres';
import { generateBeat, scaleFamily } from './generators';
import {
  SONG_MAX_TRACKS,
  blendedTempoRange,
  generateSong,
  inferRoles,
  normalizeStyles,
  regenerateSection,
  retimeGroove,
  type SongOptions,
} from './song';
import { SONG_STYLES, fitStructure, targetBars } from './structure';

const song = (genre: GenreId, extra: Partial<SongOptions> = {}) =>
  generateSong({ seed: 1, styles: [{ genre, weight: 1 }], ...extra });

function patternOf(p: Project, id: string | null): Pattern | undefined {
  return p.patterns.find((pat) => pat.id === id);
}

function expectValidSong(p: Project) {
  expect(p.tracks.length).toBeGreaterThan(0);
  expect(p.tracks.length).toBeLessThanOrEqual(MAX_TRACKS);
  expect(p.patterns.length).toBeLessThanOrEqual(MAX_PATTERNS);
  expect(p.arrangement.length).toBeGreaterThan(0);
  expect(p.arrangement.length).toBeLessThanOrEqual(MAX_SECTIONS);
  expect(p.playMode).toBe('song');
  const trackIds = new Set(p.tracks.map((t) => t.id));
  const patternIds = new Set(p.patterns.map((pat) => pat.id));
  expect(patternIds.has(p.activePatternId)).toBe(true);
  for (const s of p.arrangement) {
    expect(patternIds.has(s.patternId)).toBe(true);
    if (s.fillPatternId !== null) expect(patternIds.has(s.fillPatternId)).toBe(true);
    expect(Number.isInteger(s.repeats) && s.repeats >= 1 && s.repeats <= MAX_SECTION_REPEATS).toBe(true);
    for (const id of s.muted) expect(trackIds.has(id)).toBe(true);
    expect(Number.isInteger(s.transpose)).toBe(true);
    expect(s.name.length).toBeLessThanOrEqual(40);
  }
  for (const pattern of p.patterns) {
    expect(pattern.name.length).toBeLessThanOrEqual(24);
    for (const track of p.tracks) {
      const def = INSTRUMENTS[track.instrument];
      const steps = pattern.steps[track.id];
      expect(steps).toHaveLength(MAX_STEPS);
      steps.forEach((s, i) => {
        if (!s.on) return;
        expect(i, `${track.instrument} step ${i} past ${pattern.length}`).toBeLessThan(pattern.length);
        expect(s.vel).toBeGreaterThanOrEqual(0.05);
        expect(s.vel).toBeLessThanOrEqual(1);
        expect(Number.isInteger(s.len) && s.len >= 1 && s.len <= 16).toBe(true);
        expect(Number.isInteger(s.ratchet) && s.ratchet >= 1 && s.ratchet <= 4).toBe(true);
        expect(Math.abs(s.offset)).toBeLessThanOrEqual(MAX_STEP_OFFSET);
        if (def.melodic) {
          expect(isInScale(s.note, p.root, p.scale), `${track.instrument} ${s.note} in ${p.scale}`).toBe(true);
          expect(s.note).toBeGreaterThanOrEqual(def.noteRange[0]);
          expect(s.note).toBeLessThanOrEqual(def.noteRange[1]);
        } else {
          expect(s.note).toBe(def.defaultNote);
        }
      });
    }
  }
  const targets = new Set<string>();
  for (const lane of p.automation) {
    expect(targets.has(lane.target)).toBe(false);
    targets.add(lane.target);
    const parts = lane.target.split('.');
    if (parts[0] === 'master') {
      expect(parts).toHaveLength(2);
      expect(MASTER_AUTOMATION_PARAMS as readonly string[]).toContain(parts[1]);
    } else {
      expect(parts[0]).toBe('track');
      expect(trackIds.has(parts[1])).toBe(true);
      expect(TRACK_AUTOMATION_PARAMS as readonly string[]).toContain(parts[2]);
    }
    expect(lane.points.length).toBeGreaterThan(1);
    lane.points.forEach((pt, i) => {
      expect(pt.t).toBeGreaterThanOrEqual(0);
      expect(pt.v >= 0 && pt.v <= 1).toBe(true);
      if (i > 0) expect(pt.t).toBeGreaterThanOrEqual(lane.points[i - 1].t);
    });
  }
  expect(parseProjectFile(serializeProject(p))).toEqual(p);
}

/** Musical content without random ids and timestamps. */
function content(p: Project) {
  const patternIndex = new Map(p.patterns.map((pat, i) => [pat.id, i]));
  const trackIndex = new Map(p.tracks.map((t, i) => [t.id, i]));
  return {
    ...p,
    id: null,
    createdAt: null,
    updatedAt: null,
    activePatternId: patternIndex.get(p.activePatternId),
    tracks: p.tracks.map((t) => ({ ...t, id: null })),
    patterns: p.patterns.map((pat) => ({ ...pat, id: null, steps: p.tracks.map((t) => pat.steps[t.id]) })),
    arrangement: p.arrangement.map((s) => ({
      ...s,
      id: null,
      patternId: patternIndex.get(s.patternId),
      fillPatternId: s.fillPatternId && patternIndex.get(s.fillPatternId),
      muted: s.muted.map((id) => trackIndex.get(id)),
    })),
    automation: p.automation.map((l) => ({
      ...l,
      id: null,
      target: l.target.replace(/^track\.([^.]+)/, (_, id: string) => `track.${trackIndex.get(id)}`),
    })),
  };
}

/** Whether the track sounds anywhere in the song (some unmuted section plays a note on it). */
function isActive(p: Project, trackId: string): boolean {
  return p.arrangement.some((s) => {
    if (s.muted.includes(trackId)) return false;
    return [s.patternId, s.fillPatternId].some((id) => {
      const pat = patternOf(p, id);
      return pat?.steps[trackId].slice(0, pat.length).some((st) => st.on);
    });
  });
}

describe('generateSong: length', () => {
  it.each(GENRE_IDS)('%s hits 1, 2, 3 and 5 minutes', (genre) => {
    for (const minutes of [1, 2, 3, 5]) {
      for (const seed of [1, 2]) {
        const p = generateSong({ seed, styles: [{ genre, weight: 1 }], minutes });
        const timeline = buildSongTimeline(p);
        const bars = timeline.totalSteps / 16;
        const target = Math.round((minutes * p.bpm) / 16) * 4;
        expect(Math.abs(bars - target), `${genre} ${minutes}m: ${bars} bars vs ${target}`).toBeLessThanOrEqual(1);
        const barSeconds = 240 / p.bpm;
        expect(Math.abs(timeline.totalSeconds - minutes * 60)).toBeLessThanOrEqual(barSeconds + minutes * 60 * 0.05);
      }
    }
  });

  it('defaults to 2.5 minutes and clamps the length', () => {
    const p = song('lofi');
    expect(buildSongTimeline(p).totalSeconds / 60).toBeCloseTo(2.5, 0);
    const tiny = song('lofi', { minutes: 0.01 });
    expect(buildSongTimeline(tiny).totalSeconds).toBeLessThan(45);
    const huge = song('house', { minutes: 60 });
    expect(buildSongTimeline(huge).totalSeconds / 60).toBeLessThan(6.5);
    expectValidSong(huge);
  });

  it('stays within 16 patterns for a 3 minute song and generates fast', () => {
    for (const genre of GENRE_IDS) {
      expect(song(genre, { minutes: 3 }).patterns.length).toBeLessThanOrEqual(16);
    }
    const start = performance.now();
    song('trap', { minutes: 5, instruments: ['guitar', 'flute'] });
    expect(performance.now() - start).toBeLessThan(250);
  });

  it('fits structures to the target', () => {
    for (const genre of GENRE_IDS) {
      for (const template of SONG_STYLES[genre].structures) {
        for (const bars of [16, 24, 40, 64, 100, 160]) {
          const fitted = fitStructure(template, bars, { wide: SONG_STYLES[genre].halfTime });
          expect(fitted.reduce((n, s) => n + s.bars, 0)).toBe(bars);
          for (const s of fitted) expect(s.bars % 4).toBe(0);
        }
      }
    }
    expect(targetBars(2.5, 80)).toBe(52);
  });
});

describe('generateSong: validity and structure', () => {
  it.each(GENRE_IDS)('%s builds a valid song that round-trips', (genre) => {
    for (const seed of [1, 2, 3]) expectValidSong(song(genre, { seed }));
  });

  it.each(GENRE_IDS)('%s starts with an intro, ends with an outro and has hooks and fills', (genre) => {
    for (const seed of [1, 2, 3]) {
      const p = song(genre, { seed });
      const kinds = p.arrangement.map((s) => s.kind);
      expect(kinds[0]).toBe('intro');
      expect(kinds[kinds.length - 1]).toBe('outro');
      expect(kinds.some((k) => k === 'hook' || k === 'drop')).toBe(true);
      expect(p.arrangement.some((s) => s.fillPatternId !== null)).toBe(true);
      expect(p.meta).toEqual({ artist: '', coverSeed: seed, styles: [genre] });
      expect(p.name.split(' ')).toHaveLength(2);
      const active = p.arrangement.find((s) => s.patternId === p.activePatternId)!;
      expect(['verse', 'hook', 'drop']).toContain(active.kind);
    }
  });

  it.each(GENRE_IDS)('%s follows an energy curve', (genre) => {
    for (const seed of [1, 2, 3]) {
      const p = song(genre, { seed });
      const intro = p.arrangement[0];
      const hooks = p.arrangement.filter((s) => s.kind === 'hook' || s.kind === 'drop');
      for (const hook of hooks) expect(intro.muted.length).toBeGreaterThan(hook.muted.length);
      const drums = p.tracks.filter((t) => INSTRUMENTS[t.instrument].category === 'drums');
      for (const brk of p.arrangement.filter((s) => s.kind === 'break')) {
        for (const d of drums) expect(brk.muted).toContain(d.id);
      }
      const outro = p.arrangement[p.arrangement.length - 1];
      const kick = p.tracks.find((t) => t.instrument === 'kick');
      if (kick) expect(outro.muted).toContain(kick.id);
    }
  });

  it('writes fills that differ from their section pattern in the last bar only', () => {
    for (const genre of GENRE_IDS) {
      const p = song(genre, { seed: 4 });
      for (const s of p.arrangement.filter((x) => x.fillPatternId)) {
        const main = patternOf(p, s.patternId)!;
        const fill = patternOf(p, s.fillPatternId)!;
        expect(fill.length).toBe(main.length);
        const changed = new Set<number>();
        for (const t of p.tracks) {
          for (let i = 0; i < main.length; i++) {
            if (JSON.stringify(main.steps[t.id][i]) !== JSON.stringify(fill.steps[t.id][i])) changed.add(i);
          }
        }
        expect(changed.size).toBeGreaterThan(0);
        for (const i of changed) expect(i).toBeGreaterThanOrEqual(main.length - 16);
      }
    }
  });

  it('puts risers before hooks and crashes on hook downbeats in energetic styles', () => {
    const p = song('trap', { seed: 2 });
    const riser = p.tracks.find((t) => t.instrument === 'riser')!;
    const crash = p.tracks.find((t) => t.instrument === 'crash')!;
    let risers = 0;
    p.arrangement.forEach((s, i) => {
      const fill = patternOf(p, s.fillPatternId);
      const hits = fill ? fill.steps[riser.id].filter((st) => st.on) : [];
      if (hits.length) {
        risers++;
        expect(['hook', 'drop']).toContain(p.arrangement[i + 1]?.kind);
        expect(hits[0].len).toBe(16);
      }
      if (s.kind === 'hook') expect(patternOf(p, s.patternId)!.steps[crash.id][0].on).toBe(true);
    });
    expect(risers).toBeGreaterThan(0);
  });

  it('sets transitions: filtered/faded intro, faded or tape-stopped outro', () => {
    for (const genre of GENRE_IDS) {
      for (const seed of [1, 2, 3, 4]) {
        const p = song(genre, { seed });
        expect(['filter', 'fade']).toContain(p.arrangement[0].enter);
        expect(['fade', 'tapeStop']).toContain(p.arrangement[p.arrangement.length - 1].exit);
        if (p.automation.some((l) => l.target === 'master.filter')) {
          expect(p.arrangement.every((s) => s.enter !== 'filter' && s.exit !== 'filter')).toBe(true);
        }
      }
    }
  });

  it('only lifts the key for pop-leaning styles, never for trap', () => {
    const lifted = (genre: GenreId) =>
      [1, 2, 3, 4, 5, 6, 7, 8].some((seed) => song(genre, { seed }).arrangement.some((s) => s.transpose !== 0));
    expect(lifted('rnb') || lifted('chillhop')).toBe(true);
    for (const seed of [1, 2, 3, 4, 5, 6]) {
      const p = generateSong({
        seed,
        styles: [
          { genre: 'rnb', weight: 0.6 },
          { genre: 'trap', weight: 0.4 },
        ],
      });
      expect(p.arrangement.every((s) => s.transpose === 0)).toBe(true);
    }
    expect(lifted('lofi')).toBe(false);
  });

  it('uses different progressions for verse and hook', () => {
    let different = 0;
    for (const genre of GENRE_IDS) {
      const p = song(genre, { seed: 5 });
      const roles = inferRoles(p.tracks);
      const chords = p.tracks.find((t) => roles.get(t.id) === 'chords');
      const verse = p.arrangement.find((s) => s.kind === 'verse');
      const hook = p.arrangement.find((s) => s.kind === 'hook');
      if (!chords || !verse || !hook) continue;
      const notes = (s: typeof verse) =>
        patternOf(p, s.patternId)!
          .steps[chords.id].filter((st) => st.on)
          .map((st) => st.note)
          .join();
      if (notes(verse) !== notes(hook)) different++;
    }
    expect(different).toBeGreaterThanOrEqual(5);
  });

  it('reuses one hook pattern across hooks and varies it for verses', () => {
    const p = song('lofi', { seed: 3 });
    const hooks = p.arrangement.filter((s) => s.kind === 'hook');
    expect(hooks.length).toBeGreaterThan(1);
    expect(new Set(hooks.map((s) => s.patternId)).size).toBe(1);
    const verses = p.arrangement.filter((s) => s.kind === 'verse');
    expect(new Set(verses.map((s) => s.patternId)).size).toBe(verses.length);
  });

  it('gives jazzy styles a laid-back feel and trap/house a tight one', () => {
    const feelOf = (p: Project, instrument: InstrumentId) => p.tracks.find((t) => t.instrument === instrument)!;
    const lofi = song('lofi');
    expect(feelOf(lofi, 'hat').feel).toBeGreaterThanOrEqual(0.3);
    expect(feelOf(lofi, 'kick').feel).toBe(0);
    expect(feelOf(lofi, 'snare').feel).toBeGreaterThan(0);
    expect(feelOf(lofi, 'hat').humanize).toBeGreaterThanOrEqual(0.2);
    const offsets = lofi.patterns.flatMap((pat) => lofi.tracks.flatMap((t) => pat.steps[t.id].filter((s) => s.offset)));
    expect(offsets.length).toBeGreaterThan(0);
    for (const genre of ['trap', 'house'] as GenreId[]) {
      const p = song(genre);
      for (const t of p.tracks) {
        expect(Math.abs(t.feel)).toBeLessThanOrEqual(0.1);
        expect(t.humanize).toBeLessThanOrEqual(0.05);
      }
      const bass = p.tracks.find((t) => INSTRUMENTS[t.instrument].category === 'bass')!;
      expect(bass.duck).toBeGreaterThanOrEqual(0.3);
      expect(p.ambience.type).toBe('none');
    }
    const lofiBass = lofi.tracks.find((t) => t.instrument === 'bass')!;
    expect(lofiBass.duck).toBeGreaterThan(0);
    expect(lofiBass.duck).toBeLessThanOrEqual(0.2);
  });
});

describe('generateSong: options', () => {
  it('is deterministic and varies with the seed', () => {
    for (const genre of GENRE_IDS) {
      expect(content(song(genre, { seed: 9 }))).toEqual(content(song(genre, { seed: 9 })));
    }
    const variants = [1, 2, 3, 4, 5].map((seed) => song('lofi', { seed }));
    expect(new Set(variants.map((p) => `${p.root}:${p.scale}:${p.bpm}`)).size).toBeGreaterThan(2);
    const hooks = variants.map((p) => {
      const hook = patternOf(p, p.arrangement.find((s) => s.kind === 'hook')!.patternId)!;
      return JSON.stringify(p.tracks.map((t) => hook.steps[t.id].filter((s) => s.on).map((s) => s.note)));
    });
    expect(new Set(hooks).size).toBe(hooks.length);
  });

  it('respects explicit key, tempo, name and ambience', () => {
    const p = song('jazzhop', { root: 14, scale: 'mixolydian', bpm: 91, name: '  Blue Hour ', ambience: 'city' });
    expect(p.root).toBe(2);
    expect(p.scale).toBe('mixolydian');
    expect(p.bpm).toBe(91);
    expect(p.name).toBe('Blue Hour');
    expect(p.ambience.type).toBe('city');
    expectValidSong(p);
  });

  it('blends tempo and swing between styles', () => {
    for (const seed of [1, 2, 3, 4]) {
      const p = generateSong({
        seed,
        styles: [
          { genre: 'lofi', weight: 1 },
          { genre: 'house', weight: 1 },
        ],
      });
      expect(p.bpm).toBeGreaterThan(GENRES.lofi.bpm[1]);
      expect(p.bpm).toBeLessThan(GENRES.house.bpm[0]);
      expect(p.meta.styles.sort()).toEqual(['house', 'lofi']);
      expectValidSong(p);
    }
    const [lo, hi] = blendedTempoRange([
      { genre: 'trap', weight: 0.7 },
      { genre: 'lofi', weight: 0.3 },
    ]);
    const trapLofi = generateSong({
      seed: 3,
      styles: [
        { genre: 'trap', weight: 0.7 },
        { genre: 'lofi', weight: 0.3 },
      ],
    });
    expect(trapLofi.bpm).toBeGreaterThanOrEqual(lo);
    expect(trapLofi.bpm).toBeLessThanOrEqual(hi);
    expect(lo).toBeGreaterThan(120);
    expectValidSong(trapLofi);
  });

  it('normalises style weights', () => {
    expect(normalizeStyles([])).toEqual([{ genre: 'lofi', weight: 1 }]);
    expect(
      normalizeStyles([
        { genre: 'trap', weight: 1 },
        { genre: 'trap', weight: 1 },
        { genre: 'lofi', weight: 2 },
        { genre: 'house', weight: 0 },
        { genre: 'nope' as GenreId, weight: 3 },
      ]).map((s) => s.genre),
    ).toEqual(['trap', 'lofi']);
    const all = normalizeStyles(GENRE_IDS.map((genre, i) => ({ genre, weight: GENRE_IDS.length - i })));
    expect(all).toHaveLength(GENRE_IDS.length);
    expect(all.reduce((n, s) => n + s.weight, 0)).toBeCloseTo(1, 2);
  });

  it('maps valence to the scale family', () => {
    for (const genre of GENRE_IDS) {
      for (const seed of [1, 2, 3]) {
        expect(scaleFamily(song(genre, { seed, mood: { valence: 0.95 } }).scale), `${genre} happy`).toBe('major');
        const sad = song(genre, { seed, mood: { valence: 0.05 } });
        expect(['minor', 'phrygian', 'harmonicMinor']).toContain(sad.scale);
      }
    }
  });

  it('maps energy to tempo and brightness to the master tone', () => {
    const calm = song('lofi', { seed: 2, mood: { energy: 0 } });
    const hype = song('lofi', { seed: 2, mood: { energy: 1 } });
    expect(hype.bpm).toBeGreaterThan(calm.bpm);
    const dusty = song('lofi', { seed: 2, mood: { brightness: 0 } });
    const bright = song('lofi', { seed: 2, mood: { brightness: 1 } });
    expect(bright.fx.tone).toBeGreaterThan(dusty.fx.tone);
    expect(bright.fx.crackle).toBeLessThan(dusty.fx.crackle);
  });

  it('plays requested instruments and leaves out excluded ones', () => {
    const extras: InstrumentId[] = ['guitar', 'flute', 'strings', 'vox', '808', 'bell', 'pad', 'upright', 'wurli'];
    const fx: InstrumentId[] = ['riser', 'crash', 'tom', 'shaker'];
    for (const genre of GENRE_IDS) {
      for (const instrument of [...extras, ...fx]) {
        const p = song(genre, { seed: 2, instruments: [instrument] });
        const track = p.tracks.find((t) => t.instrument === instrument);
        expect(track, `${genre} + ${instrument}`).toBeDefined();
        expect(isActive(p, track!.id), `${genre} + ${instrument} plays`).toBe(true);
      }
    }
    const several = song('lofi', { seed: 4, instruments: ['guitar', 'flute', 'strings', 'vox'], exclude: ['bell'] });
    for (const id of ['guitar', 'flute', 'strings', 'vox'] as InstrumentId[]) {
      const track = several.tracks.find((t) => t.instrument === id)!;
      expect(isActive(several, track.id)).toBe(true);
    }
    expect(several.tracks.some((t) => t.instrument === 'bell')).toBe(false);
    expectValidSong(several);

    const noDrums = song('house', {
      exclude: ['kick', 'snare', 'clap', 'hat', 'openhat', 'rim', 'shaker', 'tom', 'crash'],
    });
    expect(noDrums.tracks.every((t) => INSTRUMENTS[t.instrument].category !== 'drums')).toBe(true);
    expectValidSong(noDrums);

    const sampler = song('lofi', { instruments: ['sampler'] });
    expect(sampler.tracks.some((t) => t.instrument === 'sampler')).toBe(false);
  });

  it('keeps the kit to ten tracks in display order', () => {
    const p = song('trap', { instruments: ['guitar', 'flute', 'strings', 'vox', 'tom'] });
    expect(p.tracks.length).toBeLessThanOrEqual(SONG_MAX_TRACKS);
    for (const id of ['guitar', 'flute', 'strings', 'vox', 'tom'] as InstrumentId[]) {
      expect(p.tracks.some((t) => t.instrument === id)).toBe(true);
    }
    const group = (id: InstrumentId) =>
      ({ drums: 0, bass: 1, keys: 2, synth: 2, band: 2, fx: 4, sampler: 5 })[INSTRUMENTS[id].category];
    const drumsFirst = p.tracks.map((t) => (INSTRUMENTS[t.instrument].category === 'drums' ? 0 : 1));
    expect([...drumsFirst].sort()).toEqual(drumsFirst);
    expect(group(p.tracks[p.tracks.length - 1].instrument)).toBeGreaterThanOrEqual(2);
  });

  it('assigns chord and melody roles that inferRoles reads back', () => {
    for (const genre of GENRE_IDS) {
      const p = song(genre, { instruments: ['flute'] });
      const roles = inferRoles(p.tracks);
      const values = [...roles.values()];
      expect(values).toContain('chords');
      expect(values).toContain('lead');
      const chords = p.tracks.find((t) => roles.get(t.id) === 'chords')!;
      expect(chords.chord).not.toBe('off');
    }
  });
});

describe('grooves', () => {
  it('has at least five grooves per genre (three for ambient)', () => {
    for (const genre of GENRE_IDS) {
      expect(GENRES[genre].grooves.length).toBeGreaterThanOrEqual(genre === 'ambient' ? 3 : 5);
    }
  });

  it('re-times grooves between straight and half time', () => {
    const groove = GENRES.lofi.grooves[0];
    const half = retimeGroove(groove, 2);
    expect(parseGroovePart(half.parts.snare!).length).toBe(2 * parseGroovePart(groove.parts.snare!).length);
    const folded = retimeGroove(GENRES.trap.grooves[0], 0.5);
    const snare = parseGroovePart(folded.parts.snare!);
    expect(snare.length).toBe(8);
    expect(snare[4]).not.toBeNull();
  });
});

describe('regenerateSection', () => {
  const base = () => song('lofi', { seed: 3 });

  it('changes only the target section and never mutates the input', () => {
    const p = base();
    const snapshot = JSON.parse(JSON.stringify(p));
    const verse = p.arrangement.find((s) => s.kind === 'verse')!;
    const users = p.arrangement.filter((s) => s.patternId === verse.patternId || s.fillPatternId === verse.patternId);
    expect(users).toHaveLength(1);
    const next = regenerateSection(p, verse.id, { seed: 42 });
    expect(JSON.parse(JSON.stringify(p))).toEqual(snapshot);
    expect(next).not.toBe(p);
    expect(next.patterns).toHaveLength(p.patterns.length);
    const touched = new Set([verse.patternId, verse.fillPatternId]);
    for (const pat of p.patterns) {
      const after = patternOf(next, pat.id)!;
      if (touched.has(pat.id)) expect(after.steps).not.toEqual(pat.steps);
      else expect(after).toEqual(pat);
    }
    expect(next.arrangement.filter((s) => s.id !== verse.id)).toEqual(p.arrangement.filter((s) => s.id !== verse.id));
    expect(next.tracks).toEqual(p.tracks);
    expectValidSong(next);
  });

  it('clones shared patterns so other sections are untouched', () => {
    const p = base();
    const hook = p.arrangement.find((s) => s.kind === 'hook')!;
    const others = p.arrangement.filter((s) => s.id !== hook.id && s.patternId === hook.patternId);
    expect(others.length).toBeGreaterThan(0);
    const next = regenerateSection(p, hook.id, { seed: 7 });
    const updated = next.arrangement.find((s) => s.id === hook.id)!;
    expect(updated.patternId).not.toBe(hook.patternId);
    expect(next.patterns.length).toBeGreaterThan(p.patterns.length);
    for (const pat of p.patterns) expect(patternOf(next, pat.id)).toEqual(pat);
    for (const s of others) expect(next.arrangement.find((x) => x.id === s.id)).toEqual(s);
    expectValidSong(next);
  });

  it('leaves locked sections (and unknown ids) alone', () => {
    const p = base();
    p.arrangement[1] = { ...p.arrangement[1], locked: true };
    expect(regenerateSection(p, p.arrangement[1].id, { seed: 1 })).toBe(p);
    expect(regenerateSection(p, 'nope', { seed: 1 })).toBe(p);
  });

  it('limits changes to the requested parts', () => {
    const p = base();
    const roles = inferRoles(p.tracks);
    const verse = p.arrangement.find((s) => s.kind === 'verse')!;
    const main = patternOf(p, verse.patternId)!;
    const check = (parts: 'drums' | 'harmony' | 'melody', changes: (role: string) => boolean) => {
      const next = regenerateSection(p, verse.id, { seed: 11, parts });
      const after = patternOf(next, verse.patternId)!;
      let changed = 0;
      for (const t of p.tracks) {
        const same = JSON.stringify(after.steps[t.id]) === JSON.stringify(main.steps[t.id]);
        if (!changes(roles.get(t.id)!)) expect(same, `${parts}: ${t.instrument} kept`).toBe(true);
        else if (!same) changed++;
      }
      expect(changed).toBeGreaterThan(0);
      expectValidSong(next);
    };
    check('drums', (r) => ['kick', 'snare', 'hat', 'openhat', 'perc', 'tom', 'crash', 'riser'].includes(r));
    check('harmony', (r) => ['chords', 'pad', 'bass'].includes(r));
    check('melody', (r) => ['lead', 'answer'].includes(r));
  });

  it('is deterministic for a seed and uses the given styles', () => {
    const p = base();
    const verse = p.arrangement.find((s) => s.kind === 'verse')!;
    const a = regenerateSection(p, verse.id, { seed: 5 });
    const b = regenerateSection(p, verse.id, { seed: 5 });
    const c = regenerateSection(p, verse.id, { seed: 6 });
    const stepsOf = (x: Project) => patternOf(x, verse.patternId)!.steps;
    expect(stepsOf(a)).toEqual(stepsOf(b));
    expect(stepsOf(a)).not.toEqual(stepsOf(c));
    const trap = regenerateSection(p, verse.id, { seed: 5, styles: [{ genre: 'trap', weight: 1 }] });
    expect(stepsOf(trap)).not.toEqual(stepsOf(a));
    expectValidSong(trap);
  });

  it('works on projects that were not generated as songs', () => {
    const demo = createDemoProject();
    const blank = createProject();
    for (const project of [demo, blank, generateBeat('trap', { seed: 2, length: 16 })]) {
      for (const parts of ['all', 'drums', 'harmony', 'melody'] as const) {
        const next = regenerateSection(project, project.arrangement[0].id, { seed: 4, parts });
        expect(next.patterns.length).toBeGreaterThanOrEqual(project.patterns.length);
        expect(parseProjectFile(serializeProject(next))).toEqual(next);
        for (const pat of next.patterns) {
          for (const t of next.tracks) {
            pat.steps[t.id].forEach((st, i) => st.on && expect(i).toBeLessThan(pat.length));
          }
        }
      }
    }
  });

  it('keeps within the pattern limit', () => {
    const p = base();
    const hook = p.arrangement.find((s) => s.kind === 'hook')!;
    const full = { ...p, patterns: [...p.patterns] };
    while (full.patterns.length < MAX_PATTERNS) {
      full.patterns.push({ ...p.patterns[0], id: `p-extra-${full.patterns.length}` });
    }
    expect(regenerateSection(full, hook.id, { seed: 3 })).toBe(full);
  });
});

describe('big blends', () => {
  it('blends every style at once', () => {
    const song = generateSong({ seed: 5, styles: GENRE_IDS.map((genre) => ({ genre, weight: 1 })), minutes: 2 });
    expect(song.meta.styles.length).toBeGreaterThan(3);
    expect(song.arrangement.length).toBeGreaterThan(3);
  });

  it('plays every requested instrument and keeps the drums and bass', () => {
    const instruments = INSTRUMENT_LIST.filter((i) => !i.sampler && i.category !== 'drums').map((i) => i.id);
    const song = generateSong({ seed: 9, styles: [{ genre: 'lofi', weight: 1 }], instruments, minutes: 1 });
    const used = new Set(song.tracks.map((t) => t.instrument));
    expect(song.tracks.length).toBeGreaterThan(SONG_MAX_TRACKS);
    expect(song.tracks.length).toBeLessThanOrEqual(MAX_TRACKS);
    for (const id of instruments) expect(used.has(id)).toBe(true);
    expect(used.has('kick')).toBe(true);
  });
});

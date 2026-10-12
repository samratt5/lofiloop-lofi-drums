import { describe, expect, it } from 'vitest';
import { createRng } from '@/lib/music/rng';
import { SCALE_IDS, SCALES, isInScale, pitchClass, type ScaleId } from '@/lib/music/theory';
import { createTrack } from '@/lib/project/factory';
import { INSTRUMENTS, INSTRUMENT_IDS, type InstrumentId } from '@/lib/project/instruments';
import { parseProjectFile, serializeProject } from '@/lib/project/serialize';
import {
  BPM_MAX,
  BPM_MIN,
  MAX_STEPS,
  MAX_TRACKS,
  SWING_MAX,
  SWING_MIN,
  type Project,
  type Step,
  type Track,
} from '@/lib/project/types';
import { GENRE_IDS, GENRE_LIST, GENRES, isGenreId, parseGroovePart, type GenreId } from './genres';
import {
  beatName,
  chordSpan,
  chordStepsWithRhythm,
  coverSeed,
  drumStepsFromGroove,
  generateBassSteps,
  generateBeat,
  generateChordSteps,
  generateDrumSteps,
  generateMelodySteps,
  generateProgression,
  generateTrackSteps,
  isProgressionUsable,
  regeneratePattern,
  type GenerateContext,
} from './generators';

const LENGTHS = [8, 12, 16, 24, 32, 48, 64];
const SPARSE: InstrumentId[] = ['crash', 'tom', 'openhat', 'rim', 'shaker'];

function ctx(seed: number, overrides: Partial<GenerateContext> = {}): GenerateContext {
  return { root: 9, scale: 'minor', length: 32, rng: createRng(seed), groove: 0, ...overrides };
}

function trackFor(instrument: InstrumentId): Track {
  return createTrack(instrument, { chord: instrument === 'keys' || instrument === 'pad' ? 'seventh' : 'off' });
}

function expectValidSteps(steps: Step[], length: number) {
  expect(steps).toHaveLength(MAX_STEPS);
  steps.forEach((s, i) => {
    if (i >= length) expect(s.on, `step ${i} beyond length ${length}`).toBe(false);
    expect(s.vel).toBeGreaterThanOrEqual(0.05);
    expect(s.vel).toBeLessThanOrEqual(1);
    expect(s.prob).toBeGreaterThanOrEqual(0);
    expect(s.prob).toBeLessThanOrEqual(1);
    expect(Number.isInteger(s.ratchet) && s.ratchet >= 1 && s.ratchet <= 4).toBe(true);
    expect(Number.isInteger(s.len) && s.len >= 1 && s.len <= 16).toBe(true);
    expect(Number.isInteger(s.note)).toBe(true);
  });
}

function expectMelodicNotes(steps: Step[], instrument: InstrumentId, root: number, scale: ScaleId) {
  const [lo, hi] = INSTRUMENTS[instrument].noteRange;
  for (const s of steps) {
    if (!s.on) continue;
    expect(isInScale(s.note, root, scale), `${s.note} in ${scale}`).toBe(true);
    expect(s.note).toBeGreaterThanOrEqual(lo);
    expect(s.note).toBeLessThanOrEqual(hi);
  }
}

const onIndices = (steps: Step[]) => steps.flatMap((s, i) => (s.on ? [i] : []));

/** Everything musical about a project, with random ids/timestamps replaced by indices. */
function musicalContent(p: Project) {
  const patternIndex = new Map(p.patterns.map((pat, i) => [pat.id, i]));
  return {
    name: p.name,
    bpm: p.bpm,
    swing: p.swing,
    root: p.root,
    scale: p.scale,
    fx: p.fx,
    tracks: p.tracks.map((t) => [t.instrument, t.volume, t.pan, t.reverb, t.delay, t.chord, t.params]),
    patterns: p.patterns.map((pat) => [pat.name, pat.length, p.tracks.map((t) => pat.steps[t.id])]),
    arrangement: p.arrangement.map((s) => [s.name, patternIndex.get(s.patternId), s.repeats]),
    active: patternIndex.get(p.activePatternId),
  };
}

describe('genres', () => {
  it('lists every genre', () => {
    expect(GENRE_LIST.map((g) => g.id)).toEqual(GENRE_IDS);
    expect(isGenreId('lofi')).toBe(true);
    expect(isGenreId('polka')).toBe(false);
  });

  it.each(GENRE_IDS)('%s has consistent data', (id) => {
    const genre = GENRES[id];
    expect(genre.id).toBe(id);
    expect(genre.kit.length).toBeGreaterThan(0);
    expect(genre.kit.length).toBeLessThanOrEqual(8);
    for (const inst of genre.kit) expect(INSTRUMENT_IDS).toContain(inst);
    for (const kit of genre.kits ?? []) {
      expect(kit.length).toBeGreaterThan(0);
      expect(kit.length).toBeLessThanOrEqual(8);
      for (const inst of kit) expect(INSTRUMENT_IDS).toContain(inst);
    }
    expect(genre.bpm[0]).toBeGreaterThanOrEqual(BPM_MIN);
    expect(genre.bpm[1]).toBeLessThanOrEqual(BPM_MAX);
    expect(genre.bpm[0]).toBeLessThanOrEqual(genre.bpm[1]);
    expect(genre.swing[0]).toBeGreaterThanOrEqual(SWING_MIN);
    expect(genre.swing[1]).toBeLessThanOrEqual(SWING_MAX);
    for (const scale of genre.scales) {
      expect(SCALE_IDS).toContain(scale);
      // Every scale the genre can pick has at least one progression without dim/aug chords.
      expect(genre.progressions.some((p) => isProgressionUsable(p, scale))).toBe(true);
    }
    expect(genre.grooves.length).toBeGreaterThan(0);
    for (const groove of genre.grooves) {
      for (const part of Object.values(groove.parts)) {
        expect([16, 32]).toContain(parseGroovePart(part!).length);
      }
    }
    for (const p of genre.progressions) for (const d of p.degrees) expect(d >= 1 && d <= 7).toBe(true);
    for (const r of genre.chordRhythms) for (const h of r.hits) expect(h >= 0 && h < r.span).toBe(true);
    for (const [inst, params] of Object.entries(genre.params)) {
      for (const [key, value] of Object.entries(params!)) {
        const def = INSTRUMENTS[inst as InstrumentId].params.find((p) => p.id === key);
        expect(def, `${inst}.${key}`).toBeDefined();
        expect(value).toBeGreaterThanOrEqual(def!.min);
        expect(value).toBeLessThanOrEqual(def!.max);
      }
    }
  });

  it('parses the groove notation', () => {
    const hits = parseGroovePart('Xx.o | g?*3');
    expect(hits).toHaveLength(8);
    expect(hits[2]).toBeNull();
    expect(hits[0]!.vel).toBeGreaterThan(hits[1]!.vel);
    expect(hits[5]!.maybe).toBe(true);
    expect(hits[7]!.ratchet).toBe(3);
  });
});

describe('generateProgression', () => {
  it.each(GENRE_IDS)('%s: sized to the pattern, in 48..64 and in key', (genre) => {
    for (const scale of [...GENRES[genre].scales, 'pentatonicMinor', 'blues'] as ScaleId[]) {
      for (const length of LENGTHS) {
        for (let seed = 1; seed <= 4; seed++) {
          const roots = generateProgression(genre, ctx(seed, { scale, length, root: seed * 5 }));
          const span = chordSpan(length, roots.length);
          expect([8, 16]).toContain(span);
          expect(roots).toHaveLength(Math.ceil(length / span));
          for (const r of roots) {
            expect(r).toBeGreaterThanOrEqual(48);
            expect(r).toBeLessThanOrEqual(64);
            expect(isInScale(r, seed * 5, scale)).toBe(true);
          }
        }
      }
    }
  });

  it('is deterministic and varies with the seed', () => {
    expect(generateProgression('lofi', ctx(5))).toEqual(generateProgression('lofi', ctx(5)));
    const variants = new Set([1, 2, 3, 4, 5, 6, 7, 8].map((s) => generateProgression('lofi', ctx(s)).join()));
    expect(variants.size).toBeGreaterThan(2);
  });

  it('prefers half-bar changes or shorter progressions over truncating', () => {
    for (let seed = 1; seed <= 20; seed++) {
      const roots = generateProgression('jazzhop', ctx(seed, { scale: 'major', root: 0 }));
      // ii–V–I style progressions: the loop should never be a lone chord in 2 bars.
      expect(new Set(roots.map(pitchClass)).size).toBeGreaterThan(1);
    }
  });
});

describe('track generators', () => {
  it.each(GENRE_IDS)('%s: every instrument yields valid, in-key steps at every length', (genre) => {
    for (const instrument of INSTRUMENT_IDS) {
      const track = trackFor(instrument);
      const def = INSTRUMENTS[instrument];
      for (const length of LENGTHS) {
        const scale = GENRES[genre].scales[length % GENRES[genre].scales.length];
        const base = { length, scale, root: length % 12 };
        const progression = generateProgression(genre, ctx(length, base));
        const steps = generateTrackSteps(genre, track, ctx(length + 1, base), progression);
        expectValidSteps(steps, length);
        if (def.melodic) expectMelodicNotes(steps, instrument, base.root, scale);
        if (!def.melodic) for (const s of steps) expect(s.note).toBe(def.defaultNote);
        // Core parts always play something from one bar up (sparse percussion may rest).
        if (length >= 16 && GENRES[genre].kit.includes(instrument) && !SPARSE.includes(instrument)) {
          expect(onIndices(steps).length, `${instrument} at ${length}`).toBeGreaterThan(0);
        }
      }
    }
  });

  it('is deterministic for a seed and varies across seeds', () => {
    for (const genre of GENRE_IDS) {
      for (const instrument of GENRES[genre].kit) {
        const track = trackFor(instrument);
        const progression = generateProgression(genre, ctx(1));
        const run = (seed: number) => generateTrackSteps(genre, track, ctx(seed), progression);
        expect(run(42)).toEqual(run(42));
        const variants = new Set([1, 2, 3, 4, 5, 6].map((s) => JSON.stringify(run(s))));
        expect(variants.size, `${genre} ${instrument}`).toBeGreaterThan(1);
      }
    }
  });

  it('writes authentic grooves', () => {
    const hitsOf = (genre: GenreId, instrument: InstrumentId, groove: number) =>
      onIndices(generateDrumSteps(genre, instrument, ctx(3, { length: 16, groove })));
    for (let groove = 0; groove < 3; groove++) {
      // Four on the floor and a clap on 2 & 4.
      expect(hitsOf('house', 'kick', groove)).toEqual(expect.arrayContaining([0, 4, 8, 12]));
      expect(hitsOf('house', 'clap', groove)).toEqual(expect.arrayContaining([4, 12]));
      // Half-time trap snare on beat 3.
      expect(hitsOf('trap', 'snare', groove)).toContain(8);
      expect(hitsOf('trap', 'snare', groove)).not.toContain(4);
      // Backbeat and a downbeat kick in lofi.
      expect(hitsOf('lofi', 'snare', groove)).toEqual(expect.arrayContaining([4, 12]));
      expect(hitsOf('lofi', 'kick', groove)).toContain(0);
    }
    const trapHats = [0, 1, 2].flatMap((g) => generateDrumSteps('trap', 'hat', ctx(g, { groove: g })));
    expect(trapHats.some((s) => s.on && s.ratchet > 1)).toBe(true);
    const crash = generateDrumSteps('lofi', 'crash', ctx(1));
    expect(onIndices(crash)).toEqual([0]);
  });

  it('chord parts strike each chord root and hold it', () => {
    const track = trackFor('keys');
    for (const genre of GENRE_IDS) {
      for (let seed = 1; seed <= 5; seed++) {
        const progression = generateProgression(genre, ctx(seed));
        const span = chordSpan(32, progression.length);
        const steps = generateChordSteps(genre, track, ctx(seed), progression);
        const on = steps.filter((s) => s.on);
        expect(on.length).toBeGreaterThanOrEqual(progression.length);
        const played = new Set(on.map((s) => pitchClass(s.note)));
        for (const root of progression) expect(played).toContain(pitchClass(root));
        // No gate runs past the end of the pattern.
        steps.forEach((s, i) => s.on && expect(i + s.len).toBeLessThanOrEqual(32));
        expect(span).toBeGreaterThan(0);
      }
    }
  });

  it('bass lines start on the first chord root in the bass register', () => {
    for (const genre of GENRE_IDS) {
      for (const instrument of ['bass', '808'] as InstrumentId[]) {
        for (let seed = 1; seed <= 5; seed++) {
          const progression = generateProgression(genre, ctx(seed));
          const steps = generateBassSteps(genre, trackFor(instrument), ctx(seed), progression);
          const first = steps.find((s) => s.on)!;
          expect(pitchClass(first.note)).toBe(pitchClass(progression[0]));
          expect(first.note).toBeLessThanOrEqual(48);
        }
      }
    }
  });

  it('bass locks to the given kick', () => {
    const kick = generateDrumSteps('boombap', 'kick', ctx(9));
    const progression = generateProgression('boombap', ctx(9));
    const bass = generateBassSteps('trap', trackFor('808'), ctx(9, { kick }), progression);
    for (const i of onIndices(kick)) expect(bass[i].on).toBe(true);
  });

  it('melodies use short notes on a motif and stay in range', () => {
    for (const genre of GENRE_IDS) {
      for (const instrument of ['bell', 'pluck', 'lead', 'keys'] as InstrumentId[]) {
        const track = createTrack(instrument);
        for (let seed = 1; seed <= 5; seed++) {
          const progression = generateProgression(genre, ctx(seed));
          const steps = generateMelodySteps(genre, track, ctx(seed), progression);
          const on = steps.filter((s) => s.on);
          expect(on.length).toBeGreaterThanOrEqual(3);
          for (const s of on) expect(s.len).toBeLessThanOrEqual(4);
          expectMelodicNotes(steps, instrument, 9, 'minor');
        }
      }
    }
  });

  it('works in every scale', () => {
    for (const scale of Object.keys(SCALES) as ScaleId[]) {
      const base = { scale, root: 4 };
      const progression = generateProgression('lofi', ctx(2, base));
      for (const instrument of ['keys', 'bass', 'bell'] as InstrumentId[]) {
        const steps = generateTrackSteps('lofi', trackFor(instrument), ctx(3, base), progression);
        expectMelodicNotes(steps, instrument, 4, scale);
      }
    }
  });
});

describe('generateBeat', () => {
  it.each(GENRE_IDS)('%s: builds a valid two-pattern project', (genre) => {
    const g = GENRES[genre];
    for (let seed = 1; seed <= 6; seed++) {
      const p = generateBeat(genre, { seed });
      expect(p.tracks.length).toBeLessThanOrEqual(MAX_TRACKS);
      expect(g.kits ?? [g.kit]).toContainEqual(p.tracks.map((t) => t.instrument));
      expect(p.bpm).toBeGreaterThanOrEqual(g.bpm[0]);
      expect(p.bpm).toBeLessThanOrEqual(g.bpm[1]);
      expect(p.swing).toBeGreaterThanOrEqual(g.swing[0]);
      expect(p.swing).toBeLessThanOrEqual(g.swing[1]);
      expect(g.scales).toContain(p.scale);
      expect(p.patterns.map((pat) => pat.name)).toEqual(['A', 'B']);
      const ids = p.patterns.map((pat) => pat.id);
      expect(p.arrangement.map((s) => [s.patternId, s.repeats])).toEqual([
        [ids[0], 2],
        [ids[1], 1],
        [ids[0], 1],
      ]);
      expect(ids).toContain(p.activePatternId);
      expect(p.name.split(' ')).toHaveLength(2);

      const chordTracks = p.tracks.filter((t) => t.chord !== 'off');
      expect(chordTracks).toHaveLength(1);
      expect(chordTracks[0].chord).toBe(g.chordType);

      for (const pat of p.patterns) {
        expect(pat.length).toBe(32);
        for (const t of p.tracks) {
          expectValidSteps(pat.steps[t.id], pat.length);
          if (INSTRUMENTS[t.instrument].melodic) expectMelodicNotes(pat.steps[t.id], t.instrument, p.root, p.scale);
        }
        // Closed and open hats never fight over a step.
        const hat = p.tracks.find((t) => t.instrument === 'hat');
        const open = p.tracks.find((t) => t.instrument === 'openhat');
        if (hat && open) {
          for (let i = 0; i < pat.length; i++) expect(pat.steps[hat.id][i].on && pat.steps[open.id][i].on).toBe(false);
        }
      }
      const active = p.patterns[0];
      const count = p.tracks.reduce((n, t) => n + onIndices(active.steps[t.id]).length, 0);
      expect(count).toBeGreaterThan(15);
    }
  });

  it.each(GENRE_IDS)('%s: round-trips through the project file format', (genre) => {
    for (const length of [16, 32, 64]) {
      const p = generateBeat(genre, { seed: 11 + length, length });
      expect(parseProjectFile(serializeProject(p))).toEqual(p);
    }
  });

  it('is deterministic for a seed and varies across seeds', () => {
    for (const genre of GENRE_IDS) {
      expect(musicalContent(generateBeat(genre, { seed: 99 }))).toEqual(
        musicalContent(generateBeat(genre, { seed: 99 })),
      );
      const a = musicalContent(generateBeat(genre, { seed: 1 }));
      const b = musicalContent(generateBeat(genre, { seed: 2 }));
      expect(a.patterns).not.toEqual(b.patterns);
    }
    expect(beatName(5, 'lofi')).toBe(beatName(5, 'lofi'));
  });

  it('respects explicit options', () => {
    const p = generateBeat('lofi', { seed: 3, root: 14, scale: 'dorian', bpm: 77, name: '  Night Drive ', length: 64 });
    expect(p.root).toBe(2);
    expect(p.scale).toBe('dorian');
    expect(p.bpm).toBe(77);
    expect(p.name).toBe('Night Drive');
    expect(p.patterns.every((pat) => pat.length === 64)).toBe(true);
    // Explicit options do not reshuffle the other random choices.
    expect(p.swing).toBe(generateBeat('lofi', { seed: 3 }).swing);
  });

  it('pattern B is a variation of A over the same chords', () => {
    for (let seed = 1; seed <= 6; seed++) {
      const p = generateBeat('lofi', { seed });
      const [a, b] = p.patterns;
      const chord = p.tracks.find((t) => t.chord !== 'off')!;
      expect(b.steps[chord.id]).toEqual(a.steps[chord.id]);
      expect(p.tracks.map((t) => b.steps[t.id])).not.toEqual(p.tracks.map((t) => a.steps[t.id]));
    }
  });
});

describe('regeneratePattern', () => {
  it('regenerates every track except the kept ones without touching the project', () => {
    const p = generateBeat('lofi', { seed: 4 });
    const before = JSON.parse(JSON.stringify(p));
    const keep = new Set([p.tracks[0].id, p.tracks[4].id]);
    const pattern = p.patterns[1];
    const result = regeneratePattern(p, pattern.id, 'boombap', { seed: 77, keep });
    expect(p).toEqual(before);
    expect(Object.keys(result).sort()).toEqual(
      p.tracks
        .filter((t) => !keep.has(t.id))
        .map((t) => t.id)
        .sort(),
    );
    for (const [trackId, steps] of Object.entries(result)) {
      const track = p.tracks.find((t) => t.id === trackId)!;
      expectValidSteps(steps, pattern.length);
      if (INSTRUMENTS[track.instrument].melodic) expectMelodicNotes(steps, track.instrument, p.root, p.scale);
    }
    expect(regeneratePattern(p, pattern.id, 'boombap', { seed: 77, keep })).toEqual(result);
    expect(regeneratePattern(p, pattern.id, 'boombap', { seed: 78, keep })).not.toEqual(result);
  });

  it('uses the pattern length and handles every track when nothing is kept', () => {
    const p = generateBeat('house', { seed: 8, length: 16 });
    const result = regeneratePattern(p, p.patterns[0].id, 'house', { seed: 1 });
    expect(Object.keys(result)).toHaveLength(p.tracks.length);
    for (const steps of Object.values(result)) expectValidSteps(steps, 16);
  });

  it('follows a kept chord part and a kept kick', () => {
    for (let seed = 1; seed <= 5; seed++) {
      const p = generateBeat('lofi', { seed });
      const pattern = p.patterns[0];
      const chord = p.tracks.find((t) => t.chord !== 'off')!;
      const kick = p.tracks.find((t) => t.instrument === 'kick')!;
      const bass = p.tracks.find((t) => t.instrument === 'bass')!;
      const result = regeneratePattern(p, pattern.id, 'lofi', { seed: seed + 100, keep: new Set([chord.id, kick.id]) });
      const firstChord = pattern.steps[chord.id].find((s) => s.on)!;
      const firstBass = result[bass.id].find((s) => s.on)!;
      expect(pitchClass(firstBass.note)).toBe(pitchClass(firstChord.note));
      expect(result[chord.id]).toBeUndefined();
      expect(result[kick.id]).toBeUndefined();
    }
  });

  it('returns nothing for an unknown pattern', () => {
    const p = generateBeat('trap', { seed: 1 });
    expect(regeneratePattern(p, 'nope', 'trap', { seed: 1 })).toEqual({});
  });
});

describe('building blocks', () => {
  it('drumStepsFromGroove can leave the fill out', () => {
    const genre = GENRES.lofi;
    for (let seed = 1; seed <= 8; seed++) {
      const steps = drumStepsFromGroove(genre.grooves[0], genre, 'snare', ctx(seed), { fill: false });
      const template = parseGroovePart(genre.grooves[0].parts.snare!);
      // No fill: the last beat only has groove hits (plus the odd random ghost).
      for (let i = 28; i < 32; i++)
        if (steps[i].on && steps[i].vel > 0.4) expect(template[i % template.length]).not.toBeNull();
    }
  });

  it('chordStepsWithRhythm uses the given rhythm', () => {
    const track = trackFor('keys');
    const progression = generateProgression('lofi', ctx(1, { length: 32 }));
    const steps = chordStepsWithRhythm(track, ctx(1), progression, { hits: [0, 8], push: 0, gate: 2 });
    const on = onIndices(steps);
    expect(on.every((i) => i % 8 === 0)).toBe(true);
    expect(steps.filter((s) => s.on).every((s) => s.len <= 2)).toBe(true);
  });

  it('generateBeat records its style and cover seed', () => {
    const p = generateBeat('house', { seed: 12345 });
    expect(p.meta.styles).toEqual(['house']);
    expect(p.meta.coverSeed).toBe(12345);
    expect(coverSeed(-7.5)).toBe(7);
    expect(coverSeed(Number.NaN)).toBe(0);
    expect(coverSeed(2 ** 31 + 3)).toBe(3);
  });
});

describe('genre data', () => {
  it('every groove plays every drum in its genre kit', () => {
    const gaps: string[] = [];
    for (const genre of GENRE_LIST) {
      const drums = genre.kit.filter((id) => INSTRUMENTS[id].category === 'drums');
      for (const groove of genre.grooves) {
        for (const id of drums) {
          const part = groove.parts[id];
          if (!part || !parseGroovePart(part).some(Boolean)) gaps.push(`${genre.id}/${groove.name}/${id}`);
        }
      }
    }
    expect(gaps).toEqual([]);
  });
});

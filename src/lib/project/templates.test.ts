import { describe, expect, it } from 'vitest';
import { buildSongTimeline } from '@/lib/audio/sequence';
import { GENRES } from '@/lib/generate/genres';
import { isInScale } from '@/lib/music/theory';
import { INSTRUMENTS } from './instruments';
import { parseProjectFile, serializeProject } from './serialize';
import { TEMPLATES, createDemoProject } from './templates';
import { MAX_STEPS, MAX_TRACKS, type Pattern, type Project } from './types';

const activeSteps = (p: Project, pattern: Pattern) =>
  p.tracks.reduce((n, t) => n + pattern.steps[t.id].filter((s) => s.on).length, 0);

/** Musical content without random ids and timestamps. */
function content(p: Project) {
  const patternIndex = (id: string | null) => p.patterns.findIndex((pat) => pat.id === id);
  const trackIndex = (id: string) => p.tracks.findIndex((t) => t.id === id);
  return {
    ...p,
    id: null,
    createdAt: null,
    updatedAt: null,
    activePatternId: patternIndex(p.activePatternId),
    arrangement: p.arrangement.map((s) => ({
      ...s,
      id: null,
      patternId: patternIndex(s.patternId),
      fillPatternId: patternIndex(s.fillPatternId),
      muted: s.muted.map(trackIndex),
    })),
    automation: p.automation.map((l) => ({
      ...l,
      id: null,
      target: l.target.replace(/^track\.([^.]+)/, (_, id: string) => `track.${trackIndex(id)}`),
    })),
    meta: { ...p.meta, coverSeed: null },
    tracks: p.tracks.map((t) => ({ ...t, id: null })),
    patterns: p.patterns.map((pat) => ({ ...pat, id: null, steps: p.tracks.map((t) => pat.steps[t.id]) })),
  };
}

function expectValidProject(p: Project) {
  expect(p.tracks.length).toBeGreaterThan(0);
  expect(p.tracks.length).toBeLessThanOrEqual(MAX_TRACKS);
  expect(new Set(p.tracks.map((t) => t.id)).size).toBe(p.tracks.length);
  const patternIds = p.patterns.map((pat) => pat.id);
  expect(patternIds).toContain(p.activePatternId);
  for (const s of p.arrangement) expect(patternIds).toContain(s.patternId);
  for (const pattern of p.patterns) {
    for (const track of p.tracks) {
      const steps = pattern.steps[track.id];
      expect(steps).toHaveLength(MAX_STEPS);
      steps.forEach((s, i) => {
        if (i >= pattern.length) expect(s.on).toBe(false);
        if (s.on && INSTRUMENTS[track.instrument].melodic) {
          expect(isInScale(s.note, p.root, p.scale)).toBe(true);
          const [lo, hi] = INSTRUMENTS[track.instrument].noteRange;
          expect(s.note >= lo && s.note <= hi).toBe(true);
        }
      });
    }
  }
}

describe('templates', () => {
  it('have unique ids and start with blank and demo', () => {
    const ids = TEMPLATES.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids.slice(0, 2)).toEqual(['blank', 'demo']);
    expect(TEMPLATES.filter((t) => t.genre && t.id !== 'demo').length).toBeGreaterThanOrEqual(3);
    for (const t of TEMPLATES) {
      expect(t.name.length).toBeGreaterThan(0);
      expect(t.description.length).toBeGreaterThan(0);
      if (t.genre) expect(GENRES[t.genre]).toBeDefined();
    }
  });

  it.each(TEMPLATES.map((t) => [t.id, t] as const))('%s creates a valid project that round-trips', (_, template) => {
    const project = template.create();
    expectValidProject(project);
    expect(parseProjectFile(serializeProject(project))).toEqual(project);
  });

  it('genre templates are stable (fixed seeds)', () => {
    for (const template of TEMPLATES.filter((t) => t.id !== 'blank' && t.id !== 'demo')) {
      expect(content(template.create())).toEqual(content(template.create()));
    }
  });

  it('each create() returns a fresh project', () => {
    for (const template of TEMPLATES) {
      const a = template.create();
      const b = template.create();
      expect(a).not.toBe(b);
      expect(a.id).not.toBe(b.id);
    }
  });

  it('includes full songs of about the advertised length', () => {
    const songs = TEMPLATES.filter((t) => t.kind === 'song');
    expect(songs.length).toBeGreaterThanOrEqual(6);
    expect(TEMPLATES.filter((t) => t.kind === 'loop').length).toBeGreaterThanOrEqual(3);
    for (const template of songs) {
      const p = template.create();
      expect(p.name).toBe(template.name);
      expect(p.playMode).toBe('song');
      expect(p.arrangement[0].kind).toBe('intro');
      expect(p.arrangement[p.arrangement.length - 1].kind).toBe('outro');
      expect(p.meta.styles[0]).toBe(template.genre);
      const minutes = buildSongTimeline(p).totalSeconds / 60;
      expect(Math.abs(minutes - template.minutes!)).toBeLessThan(0.2);
    }
  });

  it('blank is an empty starter kit', () => {
    const p = TEMPLATES.find((t) => t.id === 'blank')!.create();
    expect(p.name).toBe('Untitled beat');
    expect(p.tracks.map((t) => t.instrument)).toEqual(['kick', 'snare', 'hat', 'keys', 'bass']);
    expect(activeSteps(p, p.patterns[0])).toBe(0);
  });
});

describe('createDemoProject', () => {
  const demo = createDemoProject();
  const [a, b] = demo.patterns;

  it('is the hand-made "Midnight Tape" beat', () => {
    expect(demo.name).toBe('Midnight Tape');
    expect(demo.bpm).toBeGreaterThanOrEqual(78);
    expect(demo.bpm).toBeLessThanOrEqual(86);
    expect(demo.swing).toBeGreaterThanOrEqual(56);
    expect(demo.swing).toBeLessThanOrEqual(64);
    expect(demo.root).toBe(2);
    expect(['minor', 'dorian']).toContain(demo.scale);
    expect(demo.tracks.find((t) => t.instrument === 'keys')?.chord).toBe('seventh');
    expect(demo.fx.crackle).toBeCloseTo(0.35);
  });

  it('has a busy pattern A, a sparser breakdown B and an A A B A song', () => {
    expect(a.length).toBe(32);
    expect(activeSteps(demo, a)).toBeGreaterThanOrEqual(25);
    expect(activeSteps(demo, b)).toBeLessThan(activeSteps(demo, a));
    expect(demo.arrangement.map((s) => [s.patternId, s.repeats])).toEqual([
      [a.id, 2],
      [b.id, 1],
      [a.id, 1],
    ]);
    expect(demo.activePatternId).toBe(a.id);
  });

  it('uses ghost snares and accented hats', () => {
    const snare = demo.tracks.find((t) => t.instrument === 'snare')!;
    const hat = demo.tracks.find((t) => t.instrument === 'hat')!;
    const snareVels = a.steps[snare.id].filter((s) => s.on).map((s) => s.vel);
    expect(Math.min(...snareVels)).toBeLessThan(0.4);
    expect(Math.max(...snareVels)).toBeGreaterThan(0.85);
    const hatVels = new Set(a.steps[hat.id].filter((s) => s.on).map((s) => s.vel));
    expect(hatVels.size).toBeGreaterThan(2);
  });

  it('is deterministic apart from ids', () => {
    expect(content(createDemoProject())).toEqual(content(createDemoProject()));
  });
});

import { describe, expect, it } from 'vitest';
import { createProject, createTrack } from './factory';
import { ProjectParseError, parseProjectFile, serializeProject, toProjectFile } from './serialize';

function sample() {
  const project = createProject({ tracks: [createTrack('kick'), createTrack('keys', { chord: 'seventh' })] });
  const [kick, keys] = project.tracks;
  const steps = project.patterns[0].steps;
  Object.assign(steps[kick.id][0], { on: true, vel: 0.5, prob: 0.25, ratchet: 3 });
  Object.assign(steps[keys.id][4], { on: true, note: 67, len: 8 });
  Object.assign(steps[keys.id][40], { on: true, note: 70 }); // beyond the 16-step length
  return project;
}

describe('project files', () => {
  it('round-trips a project exactly', () => {
    const project = sample();
    expect(parseProjectFile(serializeProject(project))).toEqual(project);
  });

  it('only stores active steps', () => {
    const file = toProjectFile(sample());
    const hits = Object.values(file.project.patterns[0].hits).flat();
    expect(hits).toHaveLength(3);
  });

  it('rejects things that are not projects', () => {
    expect(() => parseProjectFile('not json')).toThrow(ProjectParseError);
    expect(() => parseProjectFile({ hello: 'world' })).toThrow(/Not a valid LofiLoop project/);
    expect(() => parseProjectFile({ format: 'lofiloop', version: 1, project: {} })).toThrow(ProjectParseError);
  });

  it('clamps, repairs and drops invalid data', () => {
    const file = toProjectFile(sample());
    const p = file.project;
    p.bpm = 9999;
    p.swing = 0;
    p.root = 15;
    p.scale = 'klingon';
    p.tracks[0].volume = 4;
    p.tracks[0].params = { tune: -50, bogus: 3 };
    p.tracks.push({ ...p.tracks[0], id: 'x', instrument: 'theremin' });
    p.tracks.push({ ...p.tracks[1] }); // duplicate id
    p.patterns[0].hits[p.tracks[0].id].push([99, 50, 60, 100, 1, 1], [5, 500, 60, -3, 12, 99]);
    p.arrangement = [{ id: 's1', name: 'Gone', patternId: 'missing' }];
    p.activePatternId = 'missing';

    const project = parseProjectFile(file);
    expect(project.bpm).toBe(220);
    expect(project.swing).toBe(50);
    expect(project.root).toBe(11);
    expect(project.scale).toBe('minor');
    expect(project.tracks).toHaveLength(3);
    expect(new Set(project.tracks.map((t) => t.id)).size).toBe(3);
    expect(project.tracks[0].volume).toBe(1);
    expect(project.tracks[0].params.tune).toBe(35);
    expect(project.tracks[0].params.bogus).toBeUndefined();
    const kickSteps = project.patterns[0].steps[project.tracks[0].id];
    expect(kickSteps).toHaveLength(128);
    expect(kickSteps[5]).toMatchObject({ on: true, vel: 1, prob: 0, ratchet: 4, len: 16 });
    expect(project.arrangement.map((s) => s.patternId)).toEqual([project.patterns[0].id]);
    expect(project.activePatternId).toBe(project.patterns[0].id);
  });
});

describe('version 2 migration', () => {
  const v2 = {
    format: 'lofiloop',
    version: 2,
    project: {
      id: 'prj_old',
      name: 'Old beat',
      bpm: 90,
      swing: 55,
      root: 2,
      scale: 'dorian',
      tracks: [{ id: 'k', name: 'Kick', instrument: 'kick', volume: 0.8, pan: 0, mute: false, solo: false }],
      patterns: [
        { id: 'a', name: 'A', length: 16, hits: { k: [[0, 90, 60, 100, 1, 1]] } },
        { id: 'b', name: 'B', length: 16, hits: { k: [] } },
      ],
      activePatternId: 'a',
      playMode: 'song',
      chain: ['a', 'a', 'b', 'a', 'ghost'],
    },
  };

  it('turns the pattern chain into sections with repeats', () => {
    const project = parseProjectFile(v2);
    expect(project.version).toBe(3);
    expect(project.arrangement.map((s) => [s.patternId, s.repeats, s.name])).toEqual([
      ['a', 2, 'A'],
      ['b', 1, 'B'],
      ['a', 1, 'A'],
    ]);
    expect(project.tracks[0]).toMatchObject({ duck: 0, feel: 0, humanize: 0, sample: null });
    expect(project.tracks[0].fx.cutoff).toBe(1);
    expect(project.patterns[0].steps.k[0]).toMatchObject({ on: true, vel: 0.9, offset: 0 });
    expect(project.automation).toEqual([]);
    expect(project.ambience.type).toBe('none');
  });

  it('round-trips the migrated project as version 3', () => {
    const project = parseProjectFile(v2);
    expect(parseProjectFile(serializeProject(project))).toEqual(project);
  });
});

describe('version 3 song data', () => {
  it('keeps sections, automation, micro-timing and track settings', () => {
    const project = sample();
    const [kick, keys] = project.tracks;
    const [a] = project.patterns;
    kick.fx.cutoff = 0.4;
    kick.duck = 0;
    keys.duck = 0.6;
    keys.feel = 0.3;
    project.patterns[0].steps[kick.id][0].offset = -0.25;
    project.arrangement = [
      {
        ...project.arrangement[0],
        repeats: 4,
        muted: [kick.id],
        transpose: 2,
        bpm: 100,
        enter: 'filter',
        exit: 'tapeStop',
      },
    ];
    project.automation = [
      {
        id: 'l1',
        target: `track.${keys.id}.cutoff`,
        points: [
          { t: 0, v: 0.2 },
          { t: 4, v: 1 },
        ],
      },
    ];
    project.loop = { start: 1, end: 3 };
    project.ambience = { type: 'rain', level: 0.5 };
    project.sidechain = kick.id;
    project.meta = { artist: 'Me', coverSeed: 42, styles: ['lofi'] };
    void a;
    expect(parseProjectFile(serializeProject(project))).toEqual(project);
  });

  it('drops automation for missing tracks and invalid targets', () => {
    const file = toProjectFile(sample());
    file.project.automation = [
      { id: 'a', target: 'track.nope.volume', points: [] },
      { id: 'b', target: 'master.nonsense', points: [] },
      {
        id: 'c',
        target: 'master.tone',
        points: [
          { t: 2, v: 5 },
          { t: -1, v: 0.5 },
        ],
      },
    ];
    const project = parseProjectFile(file);
    expect(project.automation).toEqual([
      {
        id: 'c',
        target: 'master.tone',
        points: [
          { t: 0, v: 0.5 },
          { t: 2, v: 1 },
        ],
      },
    ]);
  });
});

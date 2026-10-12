import { describe, expect, it } from 'vitest';
import { createRng } from '@/lib/music/rng';
import { createProject, createSection, createTrack } from '@/lib/project/factory';
import type { Project } from '@/lib/project/types';
import {
  automationValue,
  buildSongTimeline,
  collectEvents,
  eventsForStep,
  renderTimeline,
  secondsToStep,
  sectionSpans,
  sidechainSource,
  slotAtStep,
  stepDuration,
  stepToSeconds,
  swingOffset,
} from './sequence';

function setup(): Project {
  const tracks = [createTrack('kick'), createTrack('keys'), createTrack('808')];
  const project = createProject({ tracks, bpm: 120, swing: 50 });
  return project;
}

const rng = () => createRng(1);

describe('sequence timing', () => {
  it('computes 16th note duration and MPC-style swing', () => {
    expect(stepDuration(120)).toBeCloseTo(0.125);
    expect(swingOffset(0, 120, 66)).toBe(0);
    expect(swingOffset(1, 120, 50)).toBe(0);
    expect(swingOffset(1, 120, 75)).toBeCloseTo(0.0625);
  });
});

describe('eventsForStep', () => {
  it('emits drum hits on the drum note and applies swing to odd steps', () => {
    const project = setup();
    project.swing = 75;
    const [kick] = project.tracks;
    const pattern = project.patterns[0];
    pattern.steps[kick.id][1].on = true;
    const events = eventsForStep(project, pattern, 1, 10, { rng: rng() });
    expect(events).toHaveLength(1);
    expect(events[0].time).toBeCloseTo(10.0625);
    expect(events[0].notes).toEqual([60]);
  });

  it('expands chord tracks and scales gate length by step length', () => {
    const project = setup();
    const keys = project.tracks[1];
    keys.chord = 'triad';
    const step = project.patterns[0].steps[keys.id][0];
    Object.assign(step, { on: true, note: 60, len: 4 });
    const [event] = eventsForStep(project, project.patterns[0], 0, 0, { rng: rng() });
    expect(event.notes).toEqual([60, 63, 67]); // C minor triad in C minor
    expect(event.duration).toBeCloseTo(4 * 0.125 * 0.95);
  });

  it('splits ratchets into evenly spaced, decaying hits', () => {
    const project = setup();
    const kick = project.tracks[0];
    Object.assign(project.patterns[0].steps[kick.id][0], { on: true, ratchet: 4, vel: 1 });
    const events = eventsForStep(project, project.patterns[0], 0, 0, { rng: rng() });
    expect(events.map((e) => e.time)).toEqual([0, 0.03125, 0.0625, 0.09375]);
    expect(events[3].velocity).toBeLessThan(events[0].velocity);
  });

  it('honours probability, mute and solo', () => {
    const project = setup();
    const [kick, keys] = project.tracks;
    const steps = project.patterns[0].steps;
    steps[kick.id][0].on = true;
    steps[keys.id][0].on = true;
    steps[kick.id][0].prob = 0;
    expect(eventsForStep(project, project.patterns[0], 0, 0, { rng: rng() }).map((e) => e.trackId)).toEqual([keys.id]);

    steps[kick.id][0].prob = 1;
    keys.mute = true;
    expect(eventsForStep(project, project.patterns[0], 0, 0, { rng: rng() }).map((e) => e.trackId)).toEqual([kick.id]);

    keys.mute = false;
    keys.solo = true;
    expect(eventsForStep(project, project.patterns[0], 0, 0, { rng: rng() }).map((e) => e.trackId)).toEqual([keys.id]);
    expect(eventsForStep(project, project.patterns[0], 0, 0, { rng: rng(), includeMuted: true })).toHaveLength(2);
  });

  it('only plays the first note on monophonic tracks even with chord data', () => {
    const project = setup();
    const bass = project.tracks[2];
    bass.chord = 'triad'; // ignored: 808 isn't polyphonic
    Object.assign(project.patterns[0].steps[bass.id][0], { on: true, note: 36 });
    const [event] = eventsForStep(project, project.patterns[0], 0, 0, { rng: rng() });
    expect(event.notes).toEqual([36]);
  });
});

describe('song timeline', () => {
  function song() {
    const project = setup();
    const a = project.patterns[0];
    const b = { ...a, id: 'b', name: 'B', length: 32, steps: a.steps };
    const fill = { ...a, id: 'f', name: 'Fill', length: 16, steps: a.steps };
    project.patterns.push(b, fill);
    project.arrangement = [
      createSection(a.id, { name: 'Intro' }),
      createSection(b.id, { name: 'Verse', repeats: 2, fillPatternId: fill.id, bpm: 60, transpose: 2 }),
      createSection('missing'),
      createSection(a.id, { name: 'Outro', muted: [project.tracks[0].id] }),
    ];
    return project;
  }

  it('expands sections, repeats, fills and tempo overrides', () => {
    const timeline = buildSongTimeline(song());
    expect(timeline.slots.map((s) => [s.pattern.id, s.repeat, s.last, s.startStep, s.bpm])).toEqual([
      [expect.any(String), 0, true, 0, 120],
      ['b', 0, false, 16, 60],
      ['f', 1, true, 48, 60],
      [expect.any(String), 0, true, 64, 120],
    ]);
    // 16 steps at 120 + 48 steps at 60 + 16 steps at 120
    expect(timeline.totalSeconds).toBeCloseTo(2 + 12 + 2);
    expect(timeline.totalSteps).toBe(80);
    expect(timeline.slots[3].muted.size).toBe(1);
    expect(timeline.slots[1].transpose).toBe(2);
  });

  it('maps between song steps and seconds across tempo changes', () => {
    const timeline = buildSongTimeline(song());
    expect(stepToSeconds(timeline, 16)).toBeCloseTo(2);
    expect(stepToSeconds(timeline, 20)).toBeCloseTo(3);
    expect(secondsToStep(timeline, 3)).toBeCloseTo(20);
    expect(slotAtStep(timeline, 63)).toBe(2);
    expect(slotAtStep(timeline, 64)).toBe(3);
  });

  it('reports section spans in bars', () => {
    const spans = sectionSpans(song());
    expect(spans.map((s) => [s.section.name, s.startBar, s.bars])).toEqual([
      ['Intro', 0, 1],
      ['Verse', 1, 3],
      ['Outro', 4, 1],
    ]);
  });

  it('applies section mutes and transposition to events', () => {
    const project = song();
    const [kick, keys] = project.tracks;
    const a = project.patterns[0];
    a.steps[kick.id][0].on = true;
    Object.assign(a.steps[keys.id][0], { on: true, note: 60 });
    const timeline = buildSongTimeline(project);
    const events = collectEvents(project, timeline, { rng: rng() });
    const outroStart = timeline.slots[3].startTime;
    expect(events.filter((e) => e.time >= outroStart - 1e-9).map((e) => e.trackId)).toEqual([keys.id]);
    const verseKeys = events.find((e) => e.trackId === keys.id && e.position === 16);
    expect(verseKeys?.notes).toEqual([62]);
  });

  it('repeats the active pattern in pattern mode', () => {
    const project = setup();
    const kick = project.tracks[0];
    project.patterns[0].steps[kick.id][0].on = true;
    const timeline = renderTimeline(project, 'pattern', 3);
    expect(timeline.slots).toHaveLength(3);
    const events = collectEvents(project, timeline, { rng: rng() }, 0.5);
    expect(events.map((e) => e.time)).toEqual([0.5, 2.5, 4.5]);
    expect(events.map((e) => e.position)).toEqual([0, 16, 32]);
  });
});

describe('micro-timing', () => {
  it('applies step offsets and track feel', () => {
    const project = setup();
    const kick = project.tracks[0];
    kick.feel = 1;
    Object.assign(project.patterns[0].steps[kick.id][2], { on: true, offset: 0.2 });
    const [event] = eventsForStep(project, project.patterns[0], 2, 1, { rng: rng() });
    expect(event.time).toBeCloseTo(1 + 0.2 * 0.125 + 0.03);
    expect(event.position).toBeCloseTo(2 + 0.2 + 0.03 / 0.125);
  });

  it('humanizes deterministically for a seed', () => {
    const project = setup();
    const kick = project.tracks[0];
    kick.humanize = 1;
    project.patterns[0].steps[kick.id][0].on = true;
    const a = eventsForStep(project, project.patterns[0], 0, 1, { rng: createRng(5) })[0];
    const b = eventsForStep(project, project.patterns[0], 0, 1, { rng: createRng(5) })[0];
    expect(a).toEqual(b);
    expect(Math.abs(a.time - 1)).toBeLessThanOrEqual(0.012);
    expect(a.velocity).not.toBe(0.8);
  });

  it('never schedules before zero', () => {
    const project = setup();
    const kick = project.tracks[0];
    Object.assign(project.patterns[0].steps[kick.id][0], { on: true, offset: -0.5 });
    expect(eventsForStep(project, project.patterns[0], 0, 0, { rng: rng() })[0].time).toBe(0);
  });
});

describe('automation', () => {
  const lane = {
    id: 'l',
    target: 'master.tone' as const,
    points: [
      { t: 1, v: 0 },
      { t: 3, v: 1 },
    ],
  };
  it('interpolates linearly and holds at the ends', () => {
    expect(automationValue(lane, 0)).toBe(0);
    expect(automationValue(lane, 2)).toBeCloseTo(0.5);
    expect(automationValue(lane, 5)).toBe(1);
    expect(automationValue({ ...lane, points: [] }, 2)).toBeNull();
  });
});

describe('sidechain source', () => {
  it('picks the explicit source, else the first kick', () => {
    const project = setup();
    expect(sidechainSource(project)).toBe(project.tracks[0].id);
    project.sidechain = project.tracks[1].id;
    expect(sidechainSource(project)).toBe(project.tracks[1].id);
    project.sidechain = 'gone';
    expect(sidechainSource(project)).toBe(project.tracks[0].id);
  });
});

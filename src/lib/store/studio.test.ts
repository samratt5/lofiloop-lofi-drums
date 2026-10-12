import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createProject, createTrack } from '@/lib/project/factory';
import { MAX_PATTERNS, MAX_TRACKS } from '@/lib/project/types';
import { actions, getProject, selectActivePattern, useStudio } from './studio';

function fresh() {
  const project = createProject({
    tracks: [createTrack('kick'), createTrack('keys'), createTrack('bass')],
    root: 0,
    scale: 'minor',
  });
  actions.load(project);
  return project;
}

const active = () => selectActivePattern(useStudio.getState());

describe('studio store', () => {
  beforeEach(() => {
    fresh();
  });

  it('toggles steps with undo and redo', () => {
    const kick = getProject().tracks[0].id;
    actions.toggleStep(kick, 3);
    expect(active().steps[kick][3].on).toBe(true);
    actions.undo();
    expect(active().steps[kick][3].on).toBe(false);
    actions.redo();
    expect(active().steps[kick][3].on).toBe(true);
    expect(useStudio.getState().future).toHaveLength(0);
  });

  it('merges rapid edits with the same coalesce key into one undo step', () => {
    vi.useFakeTimers();
    vi.setSystemTime(1_000_000);
    actions.setBpm(90);
    vi.advanceTimersByTime(100);
    actions.setBpm(95);
    vi.advanceTimersByTime(100);
    actions.setBpm(100);
    expect(useStudio.getState().past).toHaveLength(1);
    vi.advanceTimersByTime(2000);
    actions.setBpm(110);
    expect(useStudio.getState().past).toHaveLength(2);
    actions.undo();
    expect(getProject().bpm).toBe(100);
    actions.undo();
    expect(getProject().bpm).toBe(84);
    vi.useRealTimers();
  });

  it('does not record history for pattern selection', () => {
    actions.addPattern();
    const before = useStudio.getState().past.length;
    actions.selectPattern(getProject().patterns[0].id);
    expect(useStudio.getState().past.length).toBe(before);
  });

  it('clamps project settings', () => {
    actions.setBpm(1000);
    actions.setSwing(10);
    actions.setVolume(3);
    const p = getProject();
    expect(p.bpm).toBe(220);
    expect(p.swing).toBe(50);
    expect(p.volume).toBe(1);
  });

  it('adds, duplicates, moves and removes tracks across every pattern', () => {
    actions.addPattern();
    const id = actions.addTrack('snare')!;
    for (const p of getProject().patterns) expect(p.steps[id]).toHaveLength(128);
    const copy = actions.duplicateTrack(id)!;
    expect(
      getProject()
        .tracks.map((t) => t.id)
        .slice(-2),
    ).toEqual([id, copy]);
    actions.moveTrack(4, 0);
    expect(getProject().tracks[0].id).toBe(copy);
    actions.removeTrack(id);
    for (const p of getProject().patterns) expect(p.steps[id]).toBeUndefined();
  });

  it('caps tracks and patterns', () => {
    for (let i = 0; i < 30; i++) actions.addTrack('hat');
    expect(getProject().tracks).toHaveLength(MAX_TRACKS);
    for (let i = 0; i < 40; i++) actions.addPattern();
    expect(getProject().patterns).toHaveLength(MAX_PATTERNS);
    const names = getProject().patterns.map((p) => p.name);
    expect(new Set(names).size).toBe(MAX_PATTERNS);
    expect(names.slice(0, 3)).toEqual(['A', 'B', 'C']);
    expect(names).toContain('Z');
    expect(names).toContain('A2');
  });

  it('duplicates patterns and keeps the arrangement valid on delete', () => {
    const kick = getProject().tracks[0].id;
    actions.toggleStep(kick, 0);
    const a = getProject().patterns[0].id;
    const b = actions.addPattern(a)!;
    expect(active().id).toBe(b);
    expect(active().steps[kick][0].on).toBe(true);
    actions.addSection({ patternId: b });
    expect(getProject().arrangement.map((s) => s.patternId)).toEqual([a, b]);
    actions.removePattern(b);
    expect(getProject().arrangement.map((s) => s.patternId)).toEqual([a]);
    expect(getProject().activePatternId).toBe(a);
  });

  it('extends a pattern by repeating its steps', () => {
    const kick = getProject().tracks[0].id;
    actions.toggleStep(kick, 4);
    actions.extendPattern(active().id, 32);
    expect(active().length).toBe(32);
    expect(active().steps[kick][20].on).toBe(true);
  });

  it('transposes melodic notes into the new key', () => {
    const keys = getProject().tracks[1].id;
    actions.setStep(keys, 0, { on: true, note: 63 }); // Eb in C minor
    actions.setKey(2, 'dorian'); // D dorian, +2 semitones
    expect(active().steps[keys][0].note).toBe(65); // F, in D dorian
    actions.setKey(0, 'major', false);
    expect(active().steps[keys][0].note).toBe(65);
  });

  it('keeps melodies in range when switching instruments', () => {
    const keys = getProject().tracks[1].id;
    actions.setStep(keys, 0, { on: true, note: 84 });
    actions.changeInstrument(keys, 'bass');
    const track = getProject().tracks[1];
    expect(track.instrument).toBe('bass');
    expect(track.name).toBe('Sub Bass');
    expect(track.chord).toBe('off');
    expect(active().steps[keys][0].note).toBe(48);
  });

  it('validates params and step edits', () => {
    const kick = getProject().tracks[0].id;
    actions.setParam(kick, 'tune', 10_000);
    actions.setParam(kick, 'nope', 1);
    expect(getProject().tracks[0].params.tune).toBe(90);
    expect(getProject().tracks[0].params.nope).toBeUndefined();
    actions.setStep(kick, 2, { vel: 5, prob: -1, ratchet: 9, len: 0 });
    expect(active().steps[kick][2]).toMatchObject({ vel: 1, prob: 0, ratchet: 4, len: 1 });
  });

  it('solos exclusively with the modifier', () => {
    const [a, b] = getProject().tracks.map((t) => t.id);
    actions.toggleSolo(a);
    actions.toggleSolo(b, true);
    expect(getProject().tracks.map((t) => t.solo)).toEqual([false, true, false]);
  });
});

describe('song editing', () => {
  beforeEach(() => {
    fresh();
  });

  it('adds, edits, duplicates, moves and removes sections', () => {
    const a = getProject().patterns[0].id;
    const b = actions.addPattern()!;
    const verse = actions.addSection({ patternId: b, kind: 'verse' })!;
    actions.updateSection(verse, { repeats: 40, transpose: 30, bpm: 1, fillPatternId: a, exit: 'drop' });
    const section = getProject().arrangement.find((s) => s.id === verse)!;
    expect(section).toMatchObject({
      name: 'Verse',
      repeats: 16,
      transpose: 12,
      bpm: 40,
      fillPatternId: a,
      exit: 'drop',
    });
    const copy = actions.duplicateSection(verse)!;
    expect(getProject().arrangement.map((s) => s.id)).toEqual([getProject().arrangement[0].id, verse, copy]);
    actions.moveSection(2, 0);
    expect(getProject().arrangement[0].id).toBe(copy);
    actions.removeSection(copy);
    expect(getProject().arrangement).toHaveLength(2);
  });

  it('toggles per-section mutes and cleans up when a track goes', () => {
    const section = getProject().arrangement[0].id;
    const kick = getProject().tracks[0].id;
    actions.toggleSectionMute(section, kick);
    expect(getProject().arrangement[0].muted).toEqual([kick]);
    actions.addLane(`track.${kick}.volume`);
    actions.setSidechain(kick);
    actions.removeTrack(kick);
    expect(getProject().arrangement[0].muted).toEqual([]);
    expect(getProject().automation).toEqual([]);
    expect(getProject().sidechain).toBeNull();
  });

  it('manages automation lanes', () => {
    const id = actions.addLane('master.tone', 0.7)!;
    expect(actions.addLane('master.tone')).toBeNull();
    actions.setLanePoints(id, [
      { t: 4, v: 2 },
      { t: -2, v: 0.1 },
    ]);
    expect(getProject().automation[0].points).toEqual([
      { t: 0, v: 0.1 },
      { t: 4, v: 1 },
    ]);
    actions.removeLane(id);
    expect(getProject().automation).toEqual([]);
  });

  it('clamps track effects, feel and humanize', () => {
    const kick = getProject().tracks[0].id;
    actions.setTrackFx(kick, { cutoff: -1, drive: 3 });
    actions.updateTrack(kick, { feel: -4, humanize: 9, duck: 0.5 });
    const track = getProject().tracks[0];
    expect(track.fx).toMatchObject({ cutoff: 0, drive: 1 });
    expect(track).toMatchObject({ feel: -1, humanize: 1, duck: 0.5 });
  });

  it('labels history and can travel several steps', () => {
    const kick = getProject().tracks[0].id;
    actions.toggleStep(kick, 0);
    actions.setBpm(100);
    actions.addPattern();
    expect(useStudio.getState().past.map((e) => e.label)).toEqual(['Toggle step', 'Change tempo', 'New pattern']);
    actions.travel(-3);
    expect(getProject().bpm).toBe(84);
    expect(useStudio.getState().future.map((e) => e.label)).toEqual(['Toggle step', 'Change tempo', 'New pattern']);
    actions.travel(2);
    expect(getProject().bpm).toBe(100);
    expect(getProject().patterns).toHaveLength(1);
  });

  it('records notes into a chosen pattern as one undo step per take', () => {
    const keys = getProject().tracks[1].id;
    const pattern = getProject().patterns[0].id;
    actions.recordNote(pattern, keys, 2, { note: 63, vel: 0.5, offset: 0.2 }, 'take1');
    actions.recordNote(pattern, keys, 6, { note: 65, vel: 0.6, offset: -0.9 }, 'take1');
    const steps = active().steps[keys];
    expect(steps[2]).toMatchObject({ on: true, note: 63, offset: 0.2 });
    expect(steps[6]).toMatchObject({ on: true, note: 65, offset: -0.5 });
    actions.undo();
    expect(active().steps[keys][2].on).toBe(false);
  });
});

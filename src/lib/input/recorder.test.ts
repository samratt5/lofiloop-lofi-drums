import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createProject, createTrack } from '@/lib/project/factory';
import { actions, getProject, useStudio } from '@/lib/store/studio';
import { ui, useUi } from '@/lib/store/ui';
import { fakeEngine as eng } from './testing/fakeEngine';
import { lengthInSteps, quantizeOffset, Recorder, type RecordNoteInput } from './recorder';

vi.mock('@/lib/audio/engine', async () => ({ engine: (await import('./testing/fakeEngine')).fakeEngine }));

let keys = '';
let kick = '';
let A = '';

const steps = (trackId = keys, patternIndex = 0) => getProject().patterns[patternIndex].steps[trackId];
const edit = (recipe: Parameters<ReturnType<typeof useStudio.getState>['update']>[0]) =>
  useStudio.getState().update(recipe, { history: false });

function note(overrides: Partial<RecordNoteInput> = {}): RecordNoteInput {
  return { key: 'k1', trackId: keys, note: 64, velocity: 0.7, time: 1000, ...overrides };
}

/** Recorder started while the transport plays; recording begins at `step + 1`. */
async function recordingFrom(step: number, options: Parameters<Recorder['start']>[0] = {}) {
  eng.isPlaying = true;
  eng.at(A, step);
  const rec = new Recorder();
  await rec.start({ quantize: 0, ...options });
  eng.at(A, step + 1);
  expect(rec.getState().status).toBe('recording');
  return rec;
}

beforeEach(() => {
  eng.reset();
  const project = createProject({ tracks: [createTrack('keys'), createTrack('kick'), createTrack('bass')], bpm: 120 });
  actions.load(project);
  keys = project.tracks[0].id;
  kick = project.tracks[1].id;
  A = project.patterns[0].id;
  ui.selectTrack(keys);
  useUi.setState({ metronome: false });
});

afterEach(() => {
  vi.useRealTimers();
});

describe('recorder math', () => {
  it('quantizes offsets', () => {
    expect(quantizeOffset(0.2, 0)).toBe(0.2);
    expect(quantizeOffset(0.2, 0.5)).toBe(0.1);
    expect(quantizeOffset(0.2, 1)).toBe(0);
    expect(Object.is(quantizeOffset(-0.2, 1), 0)).toBe(true);
    expect(quantizeOffset(-0.9, 0)).toBe(-0.5);
  });

  it('turns held durations into step lengths at any tempo', () => {
    expect(lengthInSteps(500, 120)).toBe(4);
    expect(lengthInSteps(500, 60)).toBe(2);
    expect(lengthInSteps(10, 120)).toBe(1);
    expect(lengthInSteps(60_000, 90)).toBe(16);
  });
});

describe('Recorder', () => {
  it('starts at the next step when the transport is already playing', async () => {
    eng.isPlaying = true;
    eng.at(A, 3);
    const rec = new Recorder();
    await rec.start({ quantize: 0 });
    expect(eng.play).not.toHaveBeenCalled();
    expect(rec.getState().status).toBe('countIn');

    eng.position = { patternId: A, step: 3, offset: 0.2 };
    rec.noteOn(note());
    expect(steps()[3].on).toBe(false);

    eng.at(A, 4);
    expect(rec.getState().status).toBe('recording');
    eng.position = { patternId: A, step: 4, offset: 0.2 };
    rec.noteOn(note());
    expect(steps()[4]).toMatchObject({ on: true, note: 64, vel: 0.7, offset: 0.2, len: 1, prob: 1, ratchet: 1 });
    expect(rec.getState().notes).toBe(1);
  });

  it.each([
    [0, 0.2],
    [0.5, 0.1],
    [1, 0],
  ])('quantize %s keeps offset %s', async (quantize, offset) => {
    const rec = await recordingFrom(3, { quantize });
    eng.position = { patternId: A, step: 5, offset: 0.2 };
    rec.noteOn(note());
    expect(steps()[5].offset).toBe(offset);
  });

  it('sets the length from the held duration at the project tempo', async () => {
    const rec = await recordingFrom(3);
    eng.position = { patternId: A, step: 4, offset: 0 };
    rec.noteOn(note({ key: 'a', time: 1000 }));
    rec.noteOff('a', 1500);
    expect(steps()[4].len).toBe(4);
    eng.position = { patternId: A, step: 8, offset: 0 };
    rec.noteOn(note({ key: 'b', note: 67, time: 2000 }));
    rec.noteOff('b', 2010);
    expect(steps()[8].len).toBe(1);
  });

  it('uses the section tempo and removes the section transpose in song mode', async () => {
    edit((d) => {
      d.playMode = 'song';
      d.arrangement[0].bpm = 60;
      d.arrangement[0].transpose = 2;
    });
    eng.isPlaying = true;
    const song = (step: number) => ({ mode: 'song' as const, songStep: step, sectionIndex: 0 });
    eng.at(A, 3, song(3));
    const rec = new Recorder();
    await rec.start({ quantize: 1 });
    eng.at(A, 4, song(4));
    eng.position = { patternId: A, step: 4, offset: 0.1 };
    rec.noteOn(note({ note: 62, time: 0 }));
    rec.noteOff('k1', 500);
    expect(steps()[4]).toMatchObject({ on: true, note: 60, len: 2, offset: 0 });
  });

  it('ignores notes outside the playing pattern', async () => {
    edit((d) => {
      d.patterns[0].length = 8;
    });
    const rec = await recordingFrom(3);
    eng.position = { patternId: A, step: 10, offset: 0 };
    rec.noteOn(note());
    eng.position = { patternId: 'missing', step: 2, offset: 0 };
    rec.noteOn(note());
    rec.noteOn(note({ trackId: 'deleted-track' }));
    expect(steps()[10].on).toBe(false);
    expect(rec.getState().notes).toBe(0);
  });

  it('counts in with the metronome and does not record the count-in', async () => {
    const rec = new Recorder();
    await rec.start({ countInBars: 1, quantize: 0 });
    expect(eng.play).toHaveBeenCalledOnce();
    expect(eng.setMetronome).toHaveBeenLastCalledWith(true);
    expect(rec.getState()).toMatchObject({ status: 'countIn', countIn: 16 });

    for (let s = 0; s < 16; s++) {
      eng.at(A, s);
      eng.position = { patternId: A, step: s, offset: 0.1 };
      rec.noteOn(note({ key: `c${s}` }));
    }
    expect(rec.getState()).toMatchObject({ status: 'countIn', countIn: 1 });
    expect(steps().some((s) => s.on)).toBe(false);

    eng.at(A, 0);
    expect(rec.getState().status).toBe('recording');
    expect(eng.setMetronome).toHaveBeenLastCalledWith(false);
    eng.position = { patternId: A, step: 0, offset: 0.1 };
    rec.noteOn(note());
    expect(steps()[0]).toMatchObject({ on: true, offset: 0.1 });
  });

  it('keeps a note played just before the first recorded downbeat', async () => {
    const rec = new Recorder();
    await rec.start({ countInBars: 1, quantize: 0 });
    for (let s = 0; s < 16; s++) eng.at(A, s);
    eng.position = { patternId: A, step: 0, offset: -0.2 };
    rec.noteOn(note());
    expect(rec.getState().status).toBe('recording');
    expect(steps()[0]).toMatchObject({ on: true, offset: -0.2 });
  });

  it('records immediately with no count-in', async () => {
    const rec = new Recorder();
    await rec.start({ countInBars: 0 });
    expect(rec.getState().status).toBe('recording');
    expect(eng.setMetronome).not.toHaveBeenCalled();
  });

  it('pre-rolls the count-in before the start bar in song mode', async () => {
    edit((d) => {
      d.playMode = 'song';
    });
    const rec = new Recorder();
    await rec.start({ countInBars: 1, fromBar: 4 });
    expect(eng.play).toHaveBeenCalledWith({ fromBar: 3 });
    expect(rec.getState().countIn).toBe(16);
  });

  it('replace clears the track step by step as the take passes, overdub only adds', async () => {
    const fill = () =>
      edit((d) => {
        for (let i = 0; i < 16; i++) {
          d.patterns[0].steps[keys][i].on = true;
          d.patterns[0].steps[kick][i].on = true;
        }
      });
    fill();
    const rec = await recordingFrom(3, { mode: 'replace' });
    const on = () =>
      steps()
        .slice(0, 16)
        .map((s) => (s.on ? 1 : 0))
        .join('');
    expect(on()).toBe('1111011111111111');
    eng.at(A, 6); // skipped frames still clear 5 and 6
    expect(on()).toBe('1111000111111111');
    eng.position = { patternId: A, step: 8, offset: -0.3 }; // early note, before the playhead gets there
    rec.noteOn(note());
    eng.at(A, 7);
    eng.at(A, 8);
    expect(on()).toBe('1111000011111111');
    eng.at(A, 15);
    eng.at(A, 1); // wrapped: first pass over 0 and 1
    expect(on()).toBe('0011000010000000');
    eng.position = { patternId: A, step: 5, offset: 0 };
    rec.noteOn(note({ key: 'k2' }));
    eng.at(A, 5);
    eng.at(A, 6); // 2 and 3 get their first pass; 4..6 were already passed and keep new notes
    expect(on()).toBe('0000010010000000');
    expect(steps(kick).every((s, i) => i >= 16 || s.on)).toBe(true);
    rec.stop();

    fill();
    const dub = await recordingFrom(3, { mode: 'overdub' });
    eng.at(A, 10);
    edit((d) => {
      d.patterns[0].steps[keys][11].on = false;
    });
    eng.position = { patternId: A, step: 11, offset: 0 };
    dub.noteOn(note());
    eng.at(A, 12);
    expect(
      steps()
        .slice(0, 16)
        .every((s) => s.on),
    ).toBe(true);
  });

  it('makes the whole take one undo step, even with long pauses', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(1_000_000);
    const before = useStudio.getState().past.length;
    const rec = await recordingFrom(3, { mode: 'replace' });
    const take = rec.getState().take;
    eng.position = { patternId: A, step: 5, offset: 0 };
    rec.noteOn(note({ key: 'a', time: 0 }));
    vi.setSystemTime(1_005_000);
    eng.at(A, 9);
    eng.position = { patternId: A, step: 9, offset: 0 };
    rec.noteOn(note({ key: 'b', note: 70, time: 5000 }));
    vi.setSystemTime(1_009_000);
    rec.noteOff('b', 6000);
    rec.noteOff('a', 7000);
    expect(rec.getState().take).toBe(take);
    expect(steps()[5].on && steps()[9].on).toBe(true);
    expect(useStudio.getState().past.length).toBe(before + 1);

    actions.undo();
    expect(steps().some((s) => s.on)).toBe(false);
    rec.stop();
    expect(rec.getState().take).toBeNull();
  });

  it('gives each take its own id', async () => {
    const rec = await recordingFrom(3);
    const first = rec.getState().take;
    rec.stop();
    eng.at(A, 7);
    await rec.start();
    expect(rec.getState().take).not.toBe(first);
    expect(rec.getState().take).toMatch(/^take_/);
  });

  it('stops when the transport stops and finishes held notes', async () => {
    const rec = await recordingFrom(3);
    eng.position = { patternId: A, step: 4, offset: 0 };
    vi.spyOn(performance, 'now').mockReturnValue(1000 + 250);
    rec.noteOn(note({ key: 'a', time: 1000 }));
    eng.stop();
    expect(rec.getState().status).toBe('idle');
    expect(steps()[4].len).toBe(2);
    eng.position = { patternId: A, step: 6, offset: 0 };
    rec.noteOn(note());
    expect(steps()[6].on).toBe(false);
  });

  it('stop({ stopTransport }) also stops playback and restores the metronome', async () => {
    const rec = new Recorder();
    await rec.start({ countInBars: 2 });
    rec.stop({ stopTransport: true });
    expect(eng.stop).toHaveBeenCalled();
    expect(eng.setMetronome).toHaveBeenLastCalledWith(false);
    expect(rec.getState().status).toBe('idle');
  });

  it('drum hits record velocity and timing but leave note and length alone', async () => {
    ui.selectTrack(kick);
    const rec = await recordingFrom(3);
    const before = steps(kick)[4];
    eng.position = { patternId: A, step: 4, offset: 0.1 };
    rec.noteOn(note({ trackId: kick, note: 90, velocity: 1 }));
    rec.noteOff('k1', 9000);
    expect(steps(kick)[4]).toMatchObject({ on: true, vel: 1, offset: 0.1, note: before.note, len: before.len });
  });

  it('arm/disarm only change state', () => {
    const rec = new Recorder();
    rec.arm({ quantize: 2, mode: 'replace', countInBars: 9 });
    expect(rec.getState()).toMatchObject({
      status: 'armed',
      options: { quantize: 1, mode: 'replace', countInBars: 4 },
    });
    rec.disarm();
    expect(rec.getState().status).toBe('idle');
    expect(eng.play).not.toHaveBeenCalled();
  });
});

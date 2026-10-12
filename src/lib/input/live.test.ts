import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { LiveNote } from '@/lib/audio/engine';
import { INSTRUMENTS } from '@/lib/project/instruments';
import { createProject, createTrack } from '@/lib/project/factory';
import { actions, getProject } from '@/lib/store/studio';
import { ui } from '@/lib/store/ui';
import { foldIntoRange, LiveInput } from './live';
import { fakeEngine as eng } from './testing/fakeEngine';
import { FakeAccess, FakePort } from './testing/fakeMidi';

vi.mock('@/lib/audio/engine', async () => ({ engine: (await import('./testing/fakeEngine')).fakeEngine }));

let keys = '';
let kick = '';
let bass = '';
let live: LiveInput;
let doc: EventTarget & { visibilityState: string; querySelector: (s: string) => unknown };

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

function key(type: 'keydown' | 'keyup', code: string, init: Record<string, unknown> = {}) {
  const { target, ...rest } = init;
  const e = new Event(type, { cancelable: true });
  Object.assign(e, {
    code,
    repeat: false,
    shiftKey: false,
    ctrlKey: false,
    metaKey: false,
    altKey: false,
    isComposing: false,
    ...rest,
  });
  if (target) Object.defineProperty(e, 'target', { value: target });
  window.dispatchEvent(e);
  return e;
}
const down = (code: string, init?: Record<string, unknown>) => key('keydown', code, init);
const up = (code: string, init?: Record<string, unknown>) => key('keyup', code, init);
const liveNotes = async (): Promise<(LiveNote | null)[]> =>
  Promise.all(eng.noteOn.mock.results.map((r) => r.value as Promise<LiveNote | null>));

beforeEach(() => {
  eng.reset();
  vi.stubGlobal('window', new EventTarget());
  doc = Object.assign(new EventTarget(), { visibilityState: 'visible', querySelector: vi.fn(() => null) });
  vi.stubGlobal('document', doc);
  const project = createProject({ tracks: [createTrack('keys'), createTrack('kick'), createTrack('bass')] });
  actions.load(project);
  [keys, kick, bass] = project.tracks.map((t) => t.id);
  ui.selectTrack(keys);
  live = new LiveInput();
});

afterEach(() => {
  live.dispose();
  vi.unstubAllGlobals();
});

describe('LiveInput keyboard piano', () => {
  it('plays the selected track and releases on key-up', async () => {
    live.enablePiano(true);
    const e = down('KeyZ');
    expect(e.defaultPrevented).toBe(true);
    expect(eng.noteOn).toHaveBeenCalledWith(getProject().tracks[0], 48, 0.8);
    expect(live.getState()).toMatchObject({ pianoOn: true, heldNotes: [48], heldKeys: ['KeyZ'] });
    await flush();
    const [note] = await liveNotes();
    expect(up('KeyZ').defaultPrevented).toBe(true);
    expect(eng.noteOff).toHaveBeenCalledWith(note);
    expect(live.getState()).toMatchObject({ heldNotes: [], heldKeys: [] });
  });

  it('plays accents with Shift and honours the velocity setting', () => {
    live.enablePiano(true);
    live.setVelocity(0.5);
    down('KeyQ', { shiftKey: true });
    down('KeyW');
    expect(eng.noteOn.mock.calls.map((c) => [c[1], c[2]])).toEqual([
      [60, 1],
      [62, 0.5],
    ]);
  });

  it('ignores auto-repeat but still swallows it', () => {
    live.enablePiano(true);
    down('KeyZ');
    const repeat = down('KeyZ', { repeat: true });
    expect(repeat.defaultPrevented).toBe(true);
    expect(eng.noteOn).toHaveBeenCalledOnce();
  });

  it('leaves text fields, modals, modifiers, Space, Escape and other keys alone', () => {
    live.enablePiano(true);
    const input = { tagName: 'INPUT', type: 'text' };
    expect(down('KeyZ', { target: input }).defaultPrevented).toBe(false);
    expect(down('KeyZ', { ctrlKey: true }).defaultPrevented).toBe(false);
    expect(down('KeyZ', { metaKey: true }).defaultPrevented).toBe(false);
    expect(down('KeyZ', { altKey: true }).defaultPrevented).toBe(false);
    for (const code of ['Space', 'Escape', 'ArrowUp', 'ArrowDown', 'Delete', 'Enter']) {
      expect(down(code).defaultPrevented).toBe(false);
    }
    doc.querySelector = () => ({});
    expect(down('KeyZ').defaultPrevented).toBe(false);
    expect(eng.noteOn).not.toHaveBeenCalled();
  });

  it('swallows unmapped letters and digits so single-key shortcuts stay quiet', () => {
    live.enablePiano(true);
    expect(down('KeyK').defaultPrevented).toBe(true);
    expect(down('Digit1').defaultPrevented).toBe(true);
    expect(eng.noteOn).not.toHaveBeenCalled();
  });

  it('does nothing while piano mode is off', () => {
    live.enablePiano(true);
    live.enablePiano(false);
    expect(down('KeyZ').defaultPrevented).toBe(false);
    expect(eng.noteOn).not.toHaveBeenCalled();
  });

  it('shifts octaves with the arrow keys unless a widget owns them', () => {
    live.enablePiano(true);
    expect(down('ArrowRight').defaultPrevented).toBe(true);
    expect(live.getState().octave).toBe(4);
    down('KeyZ');
    expect(eng.noteOn.mock.calls[0][1]).toBe(60);
    const knob = { tagName: 'DIV', closest: () => ({}) };
    expect(down('ArrowLeft', { target: knob }).defaultPrevented).toBe(false);
    expect(live.getState().octave).toBe(4);
    for (let i = 0; i < 10; i++) live.shiftOctave(-1);
    expect(live.getState().octave).toBe(0);
  });

  it('releases the note it started even if the octave changed while held', async () => {
    live.enablePiano(true);
    down('KeyZ');
    down('ArrowRight');
    up('KeyZ');
    expect(live.getState().heldNotes).toEqual([]);
  });

  it('never leaves a note stuck when the key-up beats the engine', async () => {
    let resolve!: (note: LiveNote) => void;
    eng.noteOn.mockImplementationOnce(() => new Promise((r) => (resolve = r)));
    live.enablePiano(true);
    down('KeyZ');
    up('KeyZ');
    expect(eng.noteOff).not.toHaveBeenCalled();
    const note = { id: 99, voices: [], release: 0.1 };
    resolve(note);
    await flush();
    expect(eng.noteOff).toHaveBeenCalledWith(note);
  });

  it('releases keyboard notes on blur, on ⌘ key-up and everything when the tab hides', async () => {
    live.enablePiano(true);
    down('KeyZ');
    down('KeyX');
    window.dispatchEvent(new Event('blur'));
    expect(live.getState().heldNotes).toEqual([]);

    down('KeyC');
    up('MetaLeft');
    expect(live.getState().heldNotes).toEqual([]);

    down('KeyV');
    live.pointerDown(72, 3);
    doc.visibilityState = 'hidden';
    doc.dispatchEvent(new Event('visibilitychange'));
    expect(live.getState().heldNotes).toEqual([]);
  });

  it('panics every held note, drums included', async () => {
    live.enablePiano(true);
    down('KeyZ');
    ui.selectTrack(kick);
    down('KeyX');
    await flush();
    live.panic();
    expect(eng.noteOff).toHaveBeenCalledTimes(2);
    expect(live.getState().heldNotes).toEqual([]);
  });
});

describe('LiveInput routing', () => {
  it('drum tracks play their one-shot from any key and ring out on release', async () => {
    ui.selectTrack(kick);
    live.enablePiano(true);
    down('KeyP', { shiftKey: true });
    const kickTrack = getProject().tracks[1];
    expect(eng.noteOn).toHaveBeenCalledWith(kickTrack, INSTRUMENTS.kick.defaultNote, 1);
    await flush();
    up('KeyP');
    expect(eng.noteOff).not.toHaveBeenCalled();
  });

  it('mono tracks retrigger: the new note chokes the old one', async () => {
    ui.selectTrack(bass);
    live.enablePiano(true);
    down('KeyZ');
    await flush();
    down('KeyX');
    await flush();
    const [first, second] = await liveNotes();
    expect(eng.noteOff).toHaveBeenCalledExactlyOnceWith(first);
    expect(live.getState().heldNotes).toEqual([48, 50]);
    up('KeyZ');
    expect(eng.noteOff).toHaveBeenCalledOnce();
    up('KeyX');
    expect(eng.noteOff).toHaveBeenLastCalledWith(second);
  });

  it('polyphonic tracks hold chords', async () => {
    live.enablePiano(true);
    down('KeyZ');
    down('KeyC');
    down('KeyB');
    await flush();
    expect(eng.noteOff).not.toHaveBeenCalled();
    expect(live.getState().heldNotes).toEqual([48, 52, 55]);
  });

  it('folds notes into the instrument range', () => {
    expect(foldIntoRange(72, [24, 55])).toBe(48);
    expect(foldIntoRange(12, [36, 84])).toBe(36);
    ui.selectTrack(bass);
    live.setOctave(6);
    live.enablePiano(true);
    down('KeyZ');
    expect(eng.noteOn.mock.calls[0][1]).toBe(48);
  });

  it('reads the selected track at note time and ignores notes with no track', () => {
    ui.selectTrack(null);
    live.enablePiano(true);
    expect(down('KeyZ').defaultPrevented).toBe(true);
    expect(eng.noteOn).not.toHaveBeenCalled();
    expect(live.press('x', 60)).toBe(false);
    ui.selectTrack(bass);
    down('KeyX');
    expect(eng.noteOn.mock.calls[0][0]).toMatchObject({ id: bass });
  });

  it('releases held notes of a deleted track', async () => {
    live.enablePiano(true);
    down('KeyZ');
    await flush();
    actions.removeTrack(keys);
    expect(eng.noteOff).toHaveBeenCalledOnce();
    expect(live.getState().heldNotes).toEqual([]);
  });

  it('on-screen keys release on pointer-up anywhere', () => {
    expect(live.pointerDown(60, 7)).toBe(true);
    expect(live.getState().heldNotes).toEqual([60]);
    window.dispatchEvent(Object.assign(new Event('pointerup'), { pointerId: 7 }));
    expect(live.getState().heldNotes).toEqual([]);
  });

  it('feeds note-ons and note-offs to the recorder', () => {
    const on = vi.spyOn(live.recorder, 'noteOn');
    const off = vi.spyOn(live.recorder, 'noteOff');
    live.enablePiano(true);
    down('KeyZ', { shiftKey: true });
    up('KeyZ');
    expect(on).toHaveBeenCalledWith(expect.objectContaining({ key: 'key:KeyZ', trackId: keys, note: 48, velocity: 1 }));
    expect(off).toHaveBeenCalledWith('key:KeyZ', expect.any(Number));
  });

  it('notifies subscribers and mirrors recorder state', () => {
    const listener = vi.fn();
    live.subscribe(listener);
    live.setOctave(5);
    expect(listener).toHaveBeenCalled();
    live.recorder.arm({ mode: 'replace' });
    expect(live.getState().recording).toMatchObject({ status: 'armed', options: { mode: 'replace' } });
  });
});

describe('LiveInput MIDI', () => {
  it('connects, plays MIDI notes with their velocity and follows hot-plugging', async () => {
    const access = new FakeAccess();
    const port = new FakePort('a', 'Keystep');
    access.ports.set('a', port);
    vi.stubGlobal('navigator', { requestMIDIAccess: vi.fn().mockResolvedValue(access) });
    expect(await live.enableMidi()).toBe(true);
    expect(live.getState()).toMatchObject({ midiEnabled: true, midiStatus: 'on', midiDevices: [{ name: 'Keystep' }] });

    port.send(0x90, 67, 127);
    expect(eng.noteOn).toHaveBeenCalledWith(expect.objectContaining({ id: keys }), 67, 1);
    expect(live.getState().heldNotes).toEqual([67]);
    await flush();
    port.send(0x80, 67, 0);
    expect(eng.noteOff).toHaveBeenCalledOnce();

    live.setMidiInput('a');
    port.send(0x90, 60, 64);
    access.unplug('a');
    expect(live.getState()).toMatchObject({ midiInput: 'all', midiDevices: [], heldNotes: [] });

    access.plug(new FakePort('b', 'Launchkey'));
    expect(live.getState().midiDevices.map((d) => d.name)).toEqual(['Launchkey']);
    live.disableMidi();
    expect(live.getState()).toMatchObject({ midiEnabled: false, midiStatus: 'off' });
  });

  it('reports a denied permission without throwing', async () => {
    const denied = Object.assign(new Error('no'), { name: 'NotAllowedError' });
    vi.stubGlobal('navigator', { requestMIDIAccess: vi.fn().mockRejectedValue(denied) });
    expect(await live.enableMidi()).toBe(false);
    expect(live.getState().midiStatus).toBe('error');
    expect(live.getState().midiError).toMatch(/blocked/);
  });

  it('releases MIDI notes when MIDI is turned off', async () => {
    const access = new FakeAccess();
    const port = new FakePort('a');
    access.ports.set('a', port);
    vi.stubGlobal('navigator', { requestMIDIAccess: vi.fn().mockResolvedValue(access) });
    await live.enableMidi();
    port.send(0x90, 60, 100);
    live.disableMidi();
    expect(live.getState().heldNotes).toEqual([]);
    expect(port.listeners.size).toBe(0);
  });
});

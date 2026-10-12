import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  MidiAccessError,
  MidiAccessHandle,
  MidiNoteTracker,
  midiSupported,
  parseMidiMessage,
  requestMidi,
  type MidiNoteEvent,
} from './midi';
import { FakeAccess, FakePort } from './testing/fakeMidi';

function tracker() {
  const events: MidiNoteEvent[] = [];
  const t = new MidiNoteTracker(
    'in',
    (e) => events.push(e),
    () => 42,
  );
  const summary = () => events.map((e) => `${e.type}:${e.note}`);
  return { t, events, summary };
}

describe('parseMidiMessage', () => {
  it('parses note on/off on every channel', () => {
    expect(parseMidiMessage([0x90, 60, 127])).toEqual({ kind: 'noteon', channel: 1, note: 60, velocity: 1 });
    expect(parseMidiMessage([0x9f, 61, 64])).toMatchObject({ kind: 'noteon', channel: 16, note: 61 });
    expect(parseMidiMessage([0x83, 62, 10])).toMatchObject({ kind: 'noteoff', channel: 4, note: 62 });
  });

  it('treats note-on with velocity 0 as note-off', () => {
    expect(parseMidiMessage([0x90, 60, 0])).toEqual({ kind: 'noteoff', channel: 1, note: 60, velocity: 0 });
  });

  it('parses control changes and ignores pitch bend, aftertouch, system and short messages', () => {
    expect(parseMidiMessage([0xb1, 64, 127])).toEqual({ kind: 'cc', channel: 2, controller: 64, value: 127 });
    expect(parseMidiMessage([0xe0, 0, 64]).kind).toBe('other');
    expect(parseMidiMessage([0xd0, 40]).kind).toBe('other');
    expect(parseMidiMessage([0xf8]).kind).toBe('other');
    expect(parseMidiMessage([0x40, 1, 2]).kind).toBe('other');
    expect(parseMidiMessage([0x90, 60]).kind).toBe('other');
    expect(parseMidiMessage([]).kind).toBe('other');
  });
});

describe('MidiNoteTracker', () => {
  it('emits note on/off with 0..1 velocity, channel, input and time', () => {
    const { t, events } = tracker();
    t.handle([0x90, 60, 127]);
    t.handle([0x90, 60, 0]);
    expect(events).toEqual([
      { type: 'noteon', note: 60, velocity: 1, channel: 1, input: 'in', time: 42 },
      { type: 'noteoff', note: 60, velocity: 0, channel: 1, input: 'in', time: 42 },
    ]);
  });

  it('ignores stray note-offs', () => {
    const { t, events } = tracker();
    t.handle([0x80, 60, 0]);
    expect(events).toHaveLength(0);
  });

  it('holds note-offs while the sustain pedal is down', () => {
    const { t, summary } = tracker();
    t.handle([0xb0, 64, 127]);
    t.handle([0x90, 60, 100]);
    t.handle([0x90, 64, 100]);
    t.handle([0x80, 60, 0]);
    t.handle([0x80, 64, 0]);
    expect(summary()).toEqual(['noteon:60', 'noteon:64']);
    t.handle([0xb0, 64, 0]);
    expect(summary()).toEqual(['noteon:60', 'noteon:64', 'noteoff:60', 'noteoff:64']);
  });

  it('keeps finger-held notes when the pedal lifts and re-strikes sustained notes cleanly', () => {
    const { t, summary } = tracker();
    t.handle([0xb0, 64, 127]);
    t.handle([0x90, 60, 100]);
    t.handle([0x80, 60, 0]);
    t.handle([0x90, 60, 90]);
    expect(summary()).toEqual(['noteon:60', 'noteoff:60', 'noteon:60']);
    t.handle([0xb0, 64, 0]);
    // Still held by a finger: the pedal lifting must not end it.
    expect(summary()).toHaveLength(3);
    t.handle([0x80, 60, 0]);
    expect(summary()).toEqual(['noteon:60', 'noteoff:60', 'noteon:60', 'noteoff:60']);
  });

  it('pedals are per channel', () => {
    const { t, summary } = tracker();
    t.handle([0xb1, 64, 127]);
    t.handle([0x90, 60, 100]);
    t.handle([0x80, 60, 0]);
    expect(summary()).toEqual(['noteon:60', 'noteoff:60']);
  });

  it('filters by channel', () => {
    const { t, events } = tracker();
    t.channel = 2;
    t.handle([0x90, 60, 100]);
    t.handle([0x91, 62, 100]);
    expect(events.map((e) => [e.note, e.channel])).toEqual([[62, 2]]);
  });

  it('handles all-notes-off and releaseAll', () => {
    const { t, summary } = tracker();
    t.handle([0xb0, 64, 127]);
    t.handle([0x90, 60, 100]);
    t.handle([0x80, 60, 0]);
    t.handle([0x90, 62, 100]);
    t.handle([0xb0, 123, 0]);
    expect(summary().slice(2).sort()).toEqual(['noteoff:60', 'noteoff:62']);
    t.handle([0x90, 65, 100]);
    t.releaseAll();
    expect(summary().at(-1)).toBe('noteoff:65');
  });
});

describe('MidiAccessHandle', () => {
  it('lists devices, hot-plugs and listens to all inputs by default', () => {
    const access = new FakeAccess();
    const a = new FakePort('a', 'Keystep');
    access.ports.set('a', a);
    const handle = new MidiAccessHandle(access);
    const notes: MidiNoteEvent[] = [];
    const devices: string[][] = [];
    handle.onNote((e) => notes.push(e));
    handle.onDevicesChange((list) => devices.push(list.map((d) => d.name)));
    expect(handle.devices).toEqual([{ id: 'a', name: 'Keystep', manufacturer: '' }]);

    const b = new FakePort('b', 'Launchkey');
    access.plug(b);
    expect(devices).toEqual([['Keystep', 'Launchkey']]);
    a.send(0x90, 60, 127);
    b.send(0x90, 61, 127);
    expect(notes.map((n) => [n.input, n.note])).toEqual([
      ['a', 60],
      ['b', 61],
    ]);
  });

  it('selects one input and releases notes of deselected or unplugged inputs', () => {
    const access = new FakeAccess();
    const a = new FakePort('a');
    const b = new FakePort('b');
    access.ports.set('a', a);
    access.ports.set('b', b);
    const handle = new MidiAccessHandle(access);
    const notes: string[] = [];
    handle.onNote((e) => notes.push(`${e.input}:${e.type}:${e.note}`));

    a.send(0x90, 60, 100);
    handle.select('b');
    expect(notes).toEqual(['a:noteon:60', 'a:noteoff:60']);
    a.send(0x90, 62, 100);
    expect(notes).toHaveLength(2);

    b.send(0x90, 64, 100);
    access.unplug('b');
    expect(notes.slice(2)).toEqual(['b:noteon:64', 'b:noteoff:64']);
    expect(handle.devices.map((d) => d.id)).toEqual(['a']);
  });

  it('applies the channel filter and disposes cleanly', () => {
    const access = new FakeAccess();
    const a = new FakePort('a');
    access.ports.set('a', a);
    const handle = new MidiAccessHandle(access);
    const notes: number[] = [];
    handle.onNote((e) => notes.push(e.note));
    handle.setChannel(3);
    a.send(0x90, 60, 100);
    a.send(0x92, 61, 100);
    expect(notes).toEqual([61]);
    handle.dispose();
    expect(a.listeners.size).toBe(0);
    expect(access.stateListeners.size).toBe(0);
  });
});

describe('requestMidi', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('reports unsupported browsers', async () => {
    vi.stubGlobal('navigator', {});
    expect(midiSupported()).toBe(false);
    await expect(requestMidi()).rejects.toMatchObject({ reason: 'unsupported' });
  });

  it('turns a permission denial into a MidiAccessError', async () => {
    const denied = Object.assign(new Error('nope'), { name: 'NotAllowedError' });
    vi.stubGlobal('navigator', { requestMIDIAccess: vi.fn().mockRejectedValue(denied) });
    const error = await requestMidi().catch((e: unknown) => e);
    expect(error).toBeInstanceOf(MidiAccessError);
    expect(error).toMatchObject({ reason: 'denied' });
  });

  it('resolves a handle when access is granted', async () => {
    const access = new FakeAccess();
    access.ports.set('a', new FakePort('a'));
    vi.stubGlobal('navigator', { requestMIDIAccess: vi.fn().mockResolvedValue(access) });
    const handle = await requestMidi();
    expect(handle.devices).toHaveLength(1);
    handle.dispose();
  });
});

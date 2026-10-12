import { describe, expect, it } from 'vitest';
import { buildChord } from '@/lib/music/theory';
import { createSection, createPattern, createProject, createTrack } from '@/lib/project/factory';
import type { Project, Step } from '@/lib/project/types';
import { exportMidi, midiBlob } from './midi';

interface SmfEvent {
  tick: number;
  status: number;
  /** For meta events */
  metaType?: number;
  data: number[];
}

interface SmfTrack {
  events: SmfEvent[];
}

interface Smf {
  format: number;
  ppq: number;
  tracks: SmfTrack[];
}

/** Tiny SMF reader, enough to inspect what the exporter writes. */
function parseSmf(bytes: Uint8Array): Smf {
  const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const id = (o: number) => String.fromCharCode(...bytes.subarray(o, o + 4));
  expect(id(0)).toBe('MThd');
  expect(v.getUint32(4)).toBe(6);
  const format = v.getUint16(8);
  const ntrks = v.getUint16(10);
  const ppq = v.getUint16(12);
  const tracks: SmfTrack[] = [];
  let o = 14;

  for (let t = 0; t < ntrks; t++) {
    expect(id(o)).toBe('MTrk');
    const end = o + 8 + v.getUint32(o + 4);
    o += 8;
    const events: SmfEvent[] = [];
    let tick = 0;
    const readVlq = () => {
      let value = 0;
      let b: number;
      do {
        b = bytes[o++];
        value = (value << 7) | (b & 0x7f);
      } while (b & 0x80);
      return value;
    };
    while (o < end) {
      tick += readVlq();
      const status = bytes[o++];
      if (status === 0xff) {
        const metaType = bytes[o++];
        const len = readVlq();
        events.push({ tick, status, metaType, data: Array.from(bytes.subarray(o, o + len)) });
        o += len;
      } else {
        const type = status & 0xf0;
        expect(type).toBeGreaterThanOrEqual(0x80); // no running status expected
        const len = type === 0xc0 || type === 0xd0 ? 1 : 2;
        events.push({ tick, status, data: Array.from(bytes.subarray(o, o + len)) });
        o += len;
      }
    }
    expect(o).toBe(end);
    tracks.push({ events });
  }
  expect(o).toBe(bytes.length);
  return { format, ppq, tracks };
}

const trackName = (track: SmfTrack) =>
  new TextDecoder().decode(new Uint8Array(track.events.find((e) => e.metaType === 0x03)?.data ?? []));
const noteOns = (track: SmfTrack) => track.events.filter((e) => (e.status & 0xf0) === 0x90);
const noteOffs = (track: SmfTrack) => track.events.filter((e) => (e.status & 0xf0) === 0x80);

function turnOn(project: Project, trackIndex: number, steps: number[], overrides: Partial<Step> = {}) {
  const track = project.tracks[trackIndex];
  for (const i of steps) Object.assign(project.patterns[0].steps[track.id][i], { on: true }, overrides);
}

function makeProject(): Project {
  const tracks = [
    createTrack('kick', { name: 'Kick' }),
    createTrack('keys', { name: 'Keys', chord: 'triad' }),
    createTrack('snare', { name: 'Snare' }),
    createTrack('bass', { name: 'Bass' }),
  ];
  const project = createProject({ name: 'Test Beat', bpm: 90, swing: 50, tracks });
  turnOn(project, 0, [0, 4, 8, 12], { vel: 1 });
  turnOn(project, 1, [0], { vel: 0.5 });
  turnOn(project, 2, [4, 12]);
  project.tracks[2].mute = true;
  return project;
}

describe('exportMidi', () => {
  it('writes a format 1 header with a conductor track and one track per sounding track', () => {
    const smf = parseSmf(exportMidi(makeProject()));
    expect(smf.format).toBe(1);
    expect(smf.ppq).toBe(480);
    // Conductor + kick + keys (snare is muted, bass has no steps).
    expect(smf.tracks).toHaveLength(3);
    expect(smf.tracks.map(trackName)).toEqual(['Test Beat', 'Kick', 'Keys']);
  });

  it('writes tempo, time signature and End of Track on the conductor track', () => {
    const [conductor] = parseSmf(exportMidi(makeProject())).tracks;
    const tempo = conductor.events.find((e) => e.metaType === 0x51);
    expect(tempo?.tick).toBe(0);
    const [a, b, c] = tempo!.data;
    expect((a << 16) | (b << 8) | c).toBe(Math.round(60_000_000 / 90));
    expect(conductor.events.find((e) => e.metaType === 0x58)?.data).toEqual([4, 2, 24, 8]);
    // C minor = 3 flats
    expect(conductor.events.find((e) => e.metaType === 0x59)?.data).toEqual([0xfd, 1]);
    const eot = conductor.events[conductor.events.length - 1];
    expect(eot.metaType).toBe(0x2f);
    expect(eot.tick).toBe(16 * 120); // one 16-step bar
    expect(conductor.events.some((e) => e.status !== 0xff)).toBe(false);
  });

  it('puts drums on channel 10 using the GM note', () => {
    const kick = parseSmf(exportMidi(makeProject())).tracks[1];
    const ons = noteOns(kick);
    expect(ons.map((e) => e.tick)).toEqual([0, 480, 960, 1440]);
    for (const e of ons) {
      expect(e.status).toBe(0x99);
      expect(e.data).toEqual([36, 127]);
    }
    const offs = noteOffs(kick);
    expect(offs).toHaveLength(4);
    expect(offs.map((e) => e.tick)).toEqual([60, 540, 1020, 1500]);
    expect(offs.every((e) => e.status === 0x89 && e.data[0] === 36)).toBe(true);
    expect(kick.events[kick.events.length - 1]).toMatchObject({ metaType: 0x2f, tick: 1920 });
  });

  it('expands chords into simultaneous notes on a melodic channel', () => {
    const project = makeProject();
    const keys = parseSmf(exportMidi(project)).tracks[2];
    const note = project.patterns[0].steps[project.tracks[1].id][0].note;
    const chord = buildChord(note, 'triad', project.root, project.scale);

    const ons = noteOns(keys);
    expect(ons).toHaveLength(3);
    expect(ons.every((e) => e.tick === 0 && e.status === 0x90)).toBe(true);
    expect(ons.map((e) => e.data[0]).sort((x, y) => x - y)).toEqual([...chord].sort((x, y) => x - y));
    expect(ons.every((e) => e.data[1] === 64)).toBe(true); // round(0.5 * 127)
    // Gate is 95% of a 16th.
    expect(noteOffs(keys).every((e) => e.tick === Math.round(120 * 0.95))).toBe(true);
    // Electric piano program change before the notes.
    expect(keys.events.find((e) => (e.status & 0xf0) === 0xc0)).toMatchObject({ tick: 0, status: 0xc0, data: [4] });
  });

  it('skips muted tracks and honours solo like playback', () => {
    const project = makeProject();
    let smf = parseSmf(exportMidi(project));
    const notes = smf.tracks.flatMap(noteOns);
    expect(notes.some((e) => e.data[0] === 38)).toBe(false);
    expect(smf.tracks.map(trackName)).not.toContain('Snare');

    project.tracks[1].solo = true;
    smf = parseSmf(exportMidi(project));
    expect(smf.tracks.map(trackName)).toEqual(['Test Beat', 'Keys']);
  });

  it('assigns melodic tracks to channels that skip the drum channel', () => {
    const tracks = Array.from({ length: 11 }, (_, i) => createTrack('pluck', { name: `P${i}` }));
    const project = createProject({ tracks });
    for (let i = 0; i < tracks.length; i++) turnOn(project, i, [0]);
    const smf = parseSmf(exportMidi(project));
    const channels = smf.tracks.slice(1).map((t) => noteOns(t)[0].status & 0x0f);
    expect(channels).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 10, 11]);
  });

  it('sorts note-offs before note-ons at the same tick and ends re-triggered notes', () => {
    const tracks = [createTrack('keys', { name: 'Keys', chord: 'triad' })];
    const project = createProject({ tracks, swing: 50 });
    turnOn(project, 0, [0, 4], { len: 8 });
    const keys = parseSmf(exportMidi(project)).tracks[1];
    const at480 = keys.events.filter((e) => e.tick === 480 && e.status !== 0xff);
    expect(at480.map((e) => e.status & 0xf0)).toEqual([0x80, 0x80, 0x80, 0x90, 0x90, 0x90]);
    // Every note-on is matched by exactly one note-off.
    expect(noteOns(keys)).toHaveLength(6);
    expect(noteOffs(keys)).toHaveLength(6);
  });

  it('chokes monophonic instruments', () => {
    const tracks = [createTrack('bass', { name: 'Bass' })];
    const project = createProject({ tracks, swing: 50 });
    const steps = project.patterns[0].steps[tracks[0].id];
    Object.assign(steps[0], { on: true, note: 36, len: 8 });
    Object.assign(steps[2], { on: true, note: 38, len: 2 });
    const bass = parseSmf(exportMidi(project)).tracks[1];
    const off36 = noteOffs(bass).find((e) => e.data[0] === 36);
    expect(off36?.tick).toBe(240);
  });

  it('applies swing, ratchets and repeats from the shared sequencer', () => {
    const tracks = [createTrack('hat', { name: 'Hat' })];
    const project = createProject({ tracks, bpm: 120, swing: 75 });
    turnOn(project, 0, [1]);
    turnOn(project, 0, [4], { ratchet: 4 });
    const hat = parseSmf(exportMidi(project, { repeats: 2 })).tracks[1];
    // 75% swing delays odd 16ths by half a step (60 ticks); ratchet 4 splits a step in four.
    const first = [180, 480, 510, 540, 570];
    expect(noteOns(hat).map((e) => e.tick)).toEqual([...first, ...first.map((t) => t + 1920)]);
    expect(hat.events[hat.events.length - 1]).toMatchObject({ metaType: 0x2f, tick: 2 * 1920 });
    // Ratcheted hits end where the next one starts instead of overlapping (1/32 = 60 ticks).
    expect(
      noteOffs(hat)
        .slice(0, 5)
        .map((e) => e.tick),
    ).toEqual([240, 510, 540, 570, 630]);
  });

  it('follows the song sections in song mode', () => {
    const tracks = [createTrack('kick', { name: 'Kick' })];
    const project = createProject({ tracks, swing: 50 });
    const b = createPattern('B', tracks, 0, 8);
    b.steps[tracks[0].id][0].on = true;
    project.patterns.push(b);
    project.arrangement = [createSection(project.patterns[0].id), createSection(b.id, { repeats: 2 })];
    turnOn(project, 0, [0]);
    const kick = parseSmf(exportMidi(project, { mode: 'song' })).tracks[1];
    expect(noteOns(kick).map((e) => e.tick)).toEqual([0, 1920, 1920 + 960]);
    expect(kick.events[kick.events.length - 1].tick).toBe(1920 + 960 * 2);
  });

  it('is deterministic for a given seed', () => {
    const project = makeProject();
    turnOn(project, 0, [1, 2, 3, 5, 6, 7, 9, 10, 11, 13, 14, 15], { prob: 0.5 });
    expect(exportMidi(project, { seed: 7 })).toEqual(exportMidi(project, { seed: 7 }));
    const counts = new Set(
      [1, 2, 3, 4, 5, 6, 7, 8].map((seed) => noteOns(parseSmf(exportMidi(project, { seed })).tracks[1]).length),
    );
    expect(counts.size).toBeGreaterThan(1);
  });
});

describe('midiBlob', () => {
  it('wraps bytes in an audio/midi Blob', async () => {
    const bytes = exportMidi(makeProject());
    const blob = midiBlob(bytes);
    expect(blob.type).toBe('audio/midi');
    expect(new Uint8Array(await blob.arrayBuffer())).toEqual(bytes);
  });
});

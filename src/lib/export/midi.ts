/**
 * Standard MIDI File (format 1) export. Events come from the same
 * renderSlots/collectEvents pipeline as playback, so swing, ratchets,
 * probability (seeded), chords and mute/solo all match what you hear.
 */
import {
  collectEvents,
  renderTimeline,
  slotAtStep,
  stepDuration,
  type NoteEvent,
  type SongTimeline,
} from '@/lib/audio/sequence';
import { createRng } from '@/lib/music/rng';
import type { ScaleId } from '@/lib/music/theory';
import { INSTRUMENTS, type InstrumentId } from '@/lib/project/instruments';
import type { Project } from '@/lib/project/types';

export const MIDI_PPQ = 480;
const DRUM_CHANNEL = 9;
/** Drum hits are exported as 1/32 notes. */
const DRUM_TICKS = MIDI_PPQ / 8;
/** Ticks per 16th step. */
const STEP_TICKS = MIDI_PPQ / 4;

export interface MidiExportOptions {
  /** Defaults to the project's play mode. */
  mode?: 'pattern' | 'song';
  repeats?: number;
  /** Seed for step probability rolls (default 1). */
  seed?: number;
}

/** General MIDI programs (0-based) so GM players pick a sensible sound. */
const GM_PROGRAMS: Partial<Record<InstrumentId, number>> = {
  '808': 38, // Synth Bass 1
  keys: 4, // Electric Piano 1
  pad: 89, // Pad 2 (warm)
  pluck: 45, // Pizzicato Strings
  bell: 10, // Music Box
  lead: 80, // Lead 1 (square)
  bass: 33, // Electric Bass (finger)
};

/** Key signature sharps(+)/flats(-) for each major key by pitch class. */
const MAJOR_SF = [0, -5, 2, -3, 4, -1, 6, 1, -4, 3, -2, 5];

/** Semitones from the scale root to its parent major key, and whether it reads as minor. */
const SCALE_KEY: Record<ScaleId, [offset: number, minor: boolean]> = {
  major: [0, false],
  pentatonicMajor: [0, false],
  lydian: [7, false],
  mixolydian: [5, false],
  minor: [3, true],
  harmonicMinor: [3, true],
  pentatonicMinor: [3, true],
  blues: [3, true],
  dorian: [10, true],
  phrygian: [8, true],
};

interface TimedEvent {
  tick: number;
  /** 0 = setup/meta, 1 = note off, 2 = note on: offs sort before ons at the same tick. */
  order: number;
  data: number[];
}

const textEncoder = new TextEncoder();

function vlq(value: number): number[] {
  let v = Math.max(0, Math.floor(value));
  const bytes = [v & 0x7f];
  while ((v >>= 7) > 0) bytes.unshift((v & 0x7f) | 0x80);
  return bytes;
}

function metaEvent(type: number, payload: ArrayLike<number>): number[] {
  return [0xff, type, ...vlq(payload.length), ...Array.from(payload)];
}

function trackName(name: string): number[] {
  return metaEvent(0x03, textEncoder.encode(name));
}

function clampInt(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, Math.round(value)));
}

/** Serialize events into an MTrk chunk, ending at `endTick` or the last event. */
function trackChunk(events: TimedEvent[], endTick: number): number[] {
  const sorted = [...events].sort((a, b) => a.tick - b.tick || a.order - b.order);
  const body: number[] = [];
  let last = 0;
  for (const event of sorted) {
    body.push(...vlq(event.tick - last), ...event.data);
    last = event.tick;
  }
  body.push(...vlq(Math.max(0, endTick - last)), 0xff, 0x2f, 0x00);
  return [...chunkHeader('MTrk', body.length), ...body];
}

function chunkHeader(id: string, length: number): number[] {
  return [
    ...Array.from(id, (c) => c.charCodeAt(0)),
    (length >>> 24) & 0xff,
    (length >>> 16) & 0xff,
    (length >>> 8) & 0xff,
    length & 0xff,
  ];
}

function tempoEvent(bpm: number): number[] {
  const usPerQuarter = Math.round(60_000_000 / bpm);
  return metaEvent(0x51, [(usPerQuarter >> 16) & 0xff, (usPerQuarter >> 8) & 0xff, usPerQuarter & 0xff]);
}

/** Name, time and key signature, plus a tempo change wherever a section changes tempo. */
function conductorTrack(project: Project, timeline: SongTimeline, endTick: number): number[] {
  const [offset, minor] = SCALE_KEY[project.scale] ?? [0, false];
  const sf = MAJOR_SF[(((project.root + offset) % 12) + 12) % 12];
  const events: TimedEvent[] = [
    { tick: 0, order: 0, data: trackName(project.name) },
    // 4/4, 24 MIDI clocks per metronome click, 8 32nds per quarter.
    { tick: 0, order: 0, data: metaEvent(0x58, [4, 2, 24, 8]) },
    { tick: 0, order: 0, data: metaEvent(0x59, [sf & 0xff, minor ? 1 : 0]) },
  ];
  let bpm = -1;
  for (const slot of timeline.slots) {
    if (slot.bpm === bpm) continue;
    bpm = slot.bpm;
    events.push({ tick: Math.round(slot.startStep * STEP_TICKS), order: 0, data: tempoEvent(bpm) });
  }
  if (bpm < 0) events.push({ tick: 0, order: 0, data: tempoEvent(project.bpm) });
  return trackChunk(events, endTick);
}

interface MidiNote {
  pitch: number;
  start: number;
  end: number;
  velocity: number;
}

function notesFor(events: NoteEvent[], lengthTicks: (event: NoteEvent) => number): MidiNote[] {
  const notes: MidiNote[] = [];
  for (const event of events) {
    const def = INSTRUMENTS[event.instrument];
    const start = Math.max(0, Math.round(event.position * STEP_TICKS));
    const length = def.melodic ? Math.max(1, lengthTicks(event)) : DRUM_TICKS;
    const velocity = clampInt(event.velocity * 127, 1, 127);
    const pitches = def.melodic ? event.notes : [def.gmNote ?? def.defaultNote];
    for (const pitch of new Set(pitches)) {
      notes.push({ pitch: clampInt(pitch, 0, 127), start, end: start + length, velocity });
    }
  }
  notes.sort((a, b) => a.start - b.start);

  // Mono voices choke their previous note; any voice re-triggering the same
  // pitch must end the old note first or the note-off would cut the new one.
  const mono = events.length > 0 && !!INSTRUMENTS[events[0].instrument].mono;
  const lastByPitch = new Map<number, MidiNote>();
  let previous: MidiNote | undefined;
  const kept: MidiNote[] = [];
  for (const note of notes) {
    const same = lastByPitch.get(note.pitch);
    if (same && same.end > note.start) {
      if (same.start === note.start) continue; // duplicate trigger
      same.end = note.start;
    }
    if (mono && previous && previous.end > note.start && previous.start < note.start) {
      previous.end = note.start;
    }
    lastByPitch.set(note.pitch, note);
    previous = note;
    kept.push(note);
  }
  return kept;
}

export function exportMidi(project: Project, options: MidiExportOptions = {}): Uint8Array<ArrayBuffer> {
  const mode = options.mode ?? project.playMode;
  const timeline = renderTimeline(project, mode, options.repeats ?? 1);
  const events = collectEvents(project, timeline, { rng: createRng(options.seed ?? 1) });
  // Gate lengths are in seconds; convert with the tempo of the section the note starts in.
  const lengthTicks = (event: NoteEvent) => {
    const slot = timeline.slots[slotAtStep(timeline, Math.floor(event.position))];
    return Math.round((event.duration / stepDuration(slot?.bpm ?? project.bpm)) * STEP_TICKS);
  };
  const songEnd = Math.round(timeline.totalSteps * STEP_TICKS);

  const byTrack = new Map<string, NoteEvent[]>();
  for (const event of events) {
    const list = byTrack.get(event.trackId);
    if (list) list.push(event);
    else byTrack.set(event.trackId, [event]);
  }

  const chunks: number[][] = [conductorTrack(project, timeline, songEnd)];
  let melodicIndex = 0;
  for (const track of project.tracks) {
    const trackEvents = byTrack.get(track.id);
    if (!trackEvents?.length) continue;
    const def = INSTRUMENTS[track.instrument];
    // Sound effects like risers have no MIDI equivalent.
    if (def.category === 'fx') continue;
    let channel = DRUM_CHANNEL;
    if (def.melodic) {
      // Channels 0-15 minus the drum channel, cycling when there are more than 15.
      const slot = melodicIndex++ % 15;
      channel = slot >= DRUM_CHANNEL ? slot + 1 : slot;
    }

    const timed: TimedEvent[] = [{ tick: 0, order: 0, data: trackName(track.name) }];
    const program = GM_PROGRAMS[track.instrument];
    if (def.melodic && program !== undefined) {
      timed.push({ tick: 0, order: 0, data: [0xc0 | channel, program] });
    }
    let end = songEnd;
    for (const note of notesFor(trackEvents, lengthTicks)) {
      timed.push({ tick: note.start, order: 2, data: [0x90 | channel, note.pitch, note.velocity] });
      timed.push({ tick: note.end, order: 1, data: [0x80 | channel, note.pitch, 0] });
      end = Math.max(end, note.end);
    }
    chunks.push(trackChunk(timed, end));
  }

  const header = [
    ...chunkHeader('MThd', 6),
    0x00,
    0x01, // format 1
    (chunks.length >> 8) & 0xff,
    chunks.length & 0xff,
    (MIDI_PPQ >> 8) & 0xff,
    MIDI_PPQ & 0xff,
  ];
  const size = header.length + chunks.reduce((sum, c) => sum + c.length, 0);
  const bytes = new Uint8Array(size);
  bytes.set(header, 0);
  let offset = header.length;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.length;
  }
  return bytes;
}

export function midiBlob(bytes: Uint8Array): Blob {
  return new Blob([bytes.slice()], { type: 'audio/midi' });
}

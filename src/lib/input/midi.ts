/**
 * Web MIDI input: device discovery with hot-plug, note on/off parsing,
 * sustain pedal and an optional channel filter. Only structural types are used
 * so the module is testable without a browser.
 */

export interface MidiDevice {
  id: string;
  name: string;
  manufacturer: string;
}

/** Which inputs are listened to: every connected input, or one by id. */
export type MidiInputSelection = 'all' | (string & {});

export interface MidiNoteEvent {
  type: 'noteon' | 'noteoff';
  note: number;
  /** 0..1 (note-offs report the release velocity, usually 0) */
  velocity: number;
  /** 1..16 */
  channel: number;
  /** Input id the message came from */
  input: string;
  /** `performance.now()` when the message arrived */
  time: number;
}

export type MidiErrorReason = 'unsupported' | 'insecure' | 'denied' | 'failed';

export class MidiAccessError extends Error {
  constructor(
    readonly reason: MidiErrorReason,
    message: string,
  ) {
    super(message);
    this.name = 'MidiAccessError';
  }
}

// --- parsing -----------------------------------------------------------------

export type MidiMessage =
  | { kind: 'noteon' | 'noteoff'; channel: number; note: number; velocity: number }
  | { kind: 'cc'; channel: number; controller: number; value: number }
  | { kind: 'other' };

export const CC_SUSTAIN = 64;
export const CC_ALL_SOUND_OFF = 120;
export const CC_ALL_NOTES_OFF = 123;

/**
 * Parse one complete channel message (Web MIDI delivers whole messages, so
 * there is no running status to resolve). Note-on with velocity 0 is a note-off.
 */
export function parseMidiMessage(data: ArrayLike<number>): MidiMessage {
  if (data.length < 1) return { kind: 'other' };
  const status = data[0];
  if (status < 0x80 || status >= 0xf0) return { kind: 'other' };
  const type = status & 0xf0;
  const channel = (status & 0x0f) + 1;
  const d1 = (data[1] ?? 0) & 0x7f;
  const d2 = (data[2] ?? 0) & 0x7f;
  if (type === 0x90 || type === 0x80) {
    if (data.length < 3) return { kind: 'other' };
    const on = type === 0x90 && d2 > 0;
    return { kind: on ? 'noteon' : 'noteoff', channel, note: d1, velocity: d2 / 127 };
  }
  if (type === 0xb0 && data.length >= 3) return { kind: 'cc', channel, controller: d1, value: d2 };
  // Pitch bend, aftertouch, program change: ignored.
  return { kind: 'other' };
}

/**
 * Turns parsed messages into note events: applies the channel filter, holds
 * note-offs while the sustain pedal (CC64 ≥ 64) is down, and handles
 * all-notes-off. One tracker per input keeps pedals and held notes separate.
 */
export class MidiNoteTracker {
  /** Keys (channel * 128 + note) currently held by a finger */
  private readonly down = new Set<number>();
  /** Keys released while the pedal was down, still sounding */
  private readonly sustained = new Set<number>();
  private readonly pedal = new Set<number>();

  constructor(
    private readonly input: string,
    private readonly emit: (event: MidiNoteEvent) => void,
    private readonly now: () => number = () => performance.now(),
  ) {}

  /** Channel 1..16 to listen to, or null for all (omni). */
  channel: number | null = null;

  handle(data: ArrayLike<number>): void {
    const msg = parseMidiMessage(data);
    if (msg.kind === 'other') return;
    if (this.channel !== null && msg.channel !== this.channel) return;
    if (msg.kind === 'cc') {
      if (msg.controller === CC_SUSTAIN) this.setPedal(msg.channel, msg.value >= 64);
      else if (msg.controller === CC_ALL_NOTES_OFF || msg.controller === CC_ALL_SOUND_OFF)
        this.releaseChannel(msg.channel);
      return;
    }
    const key = msg.channel * 128 + msg.note;
    if (msg.kind === 'noteon') {
      // Re-striking a held or sustained note: end the old one first.
      if (this.down.has(key) || this.sustained.has(key)) this.off(key, 0);
      this.down.add(key);
      this.sustained.delete(key);
      this.emitNote('noteon', key, msg.velocity);
      return;
    }
    if (!this.down.delete(key)) return;
    if (this.pedal.has(msg.channel)) this.sustained.add(key);
    else this.emitNote('noteoff', key, msg.velocity);
  }

  /** Release everything (device unplugged, input deselected). */
  releaseAll(): void {
    for (const key of [...this.down, ...this.sustained]) this.off(key, 0);
    this.pedal.clear();
  }

  private setPedal(channel: number, down: boolean) {
    if (down) {
      this.pedal.add(channel);
      return;
    }
    this.pedal.delete(channel);
    for (const key of [...this.sustained]) {
      if (Math.floor(key / 128) === channel) this.off(key, 0);
    }
  }

  private releaseChannel(channel: number) {
    for (const key of [...this.down, ...this.sustained]) {
      if (Math.floor(key / 128) === channel) this.off(key, 0);
    }
  }

  private off(key: number, velocity: number) {
    const wasDown = this.down.delete(key);
    const wasSustained = this.sustained.delete(key);
    if (wasDown || wasSustained) this.emitNote('noteoff', key, velocity);
  }

  private emitNote(type: MidiNoteEvent['type'], key: number, velocity: number) {
    this.emit({
      type,
      note: key % 128,
      velocity,
      channel: Math.floor(key / 128),
      input: this.input,
      time: this.now(),
    });
  }
}

// --- Web MIDI access -------------------------------------------------------

interface MidiPortLike {
  id: string;
  name?: string | null;
  manufacturer?: string | null;
  state?: string;
  type?: string;
  addEventListener(type: 'midimessage', listener: (e: { data: ArrayLike<number> | null }) => void): void;
  removeEventListener(type: 'midimessage', listener: (e: { data: ArrayLike<number> | null }) => void): void;
}

interface MidiAccessLike {
  inputs: { forEach(cb: (input: MidiPortLike) => void): void };
  addEventListener(type: 'statechange', listener: () => void): void;
  removeEventListener(type: 'statechange', listener: () => void): void;
}

interface NavigatorWithMidi {
  requestMIDIAccess?: (options?: { sysex?: boolean }) => Promise<MidiAccessLike>;
}

export function midiSupported(): boolean {
  return typeof navigator !== 'undefined' && typeof (navigator as NavigatorWithMidi).requestMIDIAccess === 'function';
}

/** A live connection to the browser's MIDI inputs. Call `dispose()` when done. */
export class MidiAccessHandle {
  private readonly listeners = new Set<(event: MidiNoteEvent) => void>();
  private readonly deviceListeners = new Set<(devices: MidiDevice[]) => void>();
  /** Inputs we are listening to, with their tracker and message handler */
  private readonly attached = new Map<
    string,
    { port: MidiPortLike; tracker: MidiNoteTracker; onMessage: (e: { data: ArrayLike<number> | null }) => void }
  >();
  private list: MidiDevice[] = [];
  private selection: MidiInputSelection = 'all';
  private channelFilter: number | null = null;
  private disposed = false;

  constructor(private readonly access: MidiAccessLike) {
    access.addEventListener('statechange', this.refresh);
    this.refresh();
  }

  /** Connected input devices. */
  get devices(): MidiDevice[] {
    return this.list;
  }

  get selected(): MidiInputSelection {
    return this.selection;
  }

  get channel(): number | null {
    return this.channelFilter;
  }

  /** Listen to one input by id, or 'all'. */
  select(selection: MidiInputSelection): void {
    this.selection = selection;
    this.refresh();
  }

  /** Only accept one channel (1..16), or null for all channels. */
  setChannel(channel: number | null): void {
    this.channelFilter = channel === null ? null : Math.min(16, Math.max(1, Math.round(channel)));
    for (const { tracker } of this.attached.values()) {
      tracker.releaseAll();
      tracker.channel = this.channelFilter;
    }
  }

  onNote(listener: (event: MidiNoteEvent) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** Called with the new device list whenever a device is plugged in or removed. */
  onDevicesChange(listener: (devices: MidiDevice[]) => void): () => void {
    this.deviceListeners.add(listener);
    return () => this.deviceListeners.delete(listener);
  }

  /** Emit note-offs for anything held (pedal included). */
  releaseAll(): void {
    for (const { tracker } of this.attached.values()) tracker.releaseAll();
  }

  dispose(): void {
    if (this.disposed) return;
    this.releaseAll();
    this.disposed = true;
    this.access.removeEventListener('statechange', this.refresh);
    for (const id of [...this.attached.keys()]) this.detach(id);
    this.listeners.clear();
    this.deviceListeners.clear();
  }

  private readonly refresh = () => {
    if (this.disposed) return;
    const ports: MidiPortLike[] = [];
    this.access.inputs.forEach((port) => {
      if (port.state !== 'disconnected') ports.push(port);
    });
    const wanted = new Set(
      ports.filter((p) => this.selection === 'all' || p.id === this.selection).map((port) => port.id),
    );
    for (const id of [...this.attached.keys()]) if (!wanted.has(id)) this.detach(id);
    for (const port of ports) if (wanted.has(port.id) && !this.attached.has(port.id)) this.attach(port);

    const next = ports.map((p) => ({ id: p.id, name: p.name || 'MIDI input', manufacturer: p.manufacturer || '' }));
    const changed =
      next.length !== this.list.length || next.some((d, i) => d.id !== this.list[i].id || d.name !== this.list[i].name);
    this.list = next;
    if (changed) for (const l of this.deviceListeners) l(next);
  };

  private attach(port: MidiPortLike) {
    const tracker = new MidiNoteTracker(port.id, (event) => {
      for (const l of this.listeners) l(event);
    });
    tracker.channel = this.channelFilter;
    const onMessage = (e: { data: ArrayLike<number> | null }) => {
      if (e.data) tracker.handle(e.data);
    };
    port.addEventListener('midimessage', onMessage);
    this.attached.set(port.id, { port, tracker, onMessage });
  }

  private detach(id: string) {
    const entry = this.attached.get(id);
    if (!entry) return;
    // Unplugged or deselected mid-note: don't leave anything hanging.
    entry.tracker.releaseAll();
    entry.port.removeEventListener('midimessage', entry.onMessage);
    this.attached.delete(id);
  }
}

/**
 * Ask for MIDI access. Rejects with a `MidiAccessError` whose `reason` says why
 * (unsupported browser, insecure context, permission denied, other failure).
 */
export async function requestMidi(): Promise<MidiAccessHandle> {
  if (!midiSupported()) {
    throw new MidiAccessError('unsupported', 'This browser does not support Web MIDI. Try Chrome, Edge or Firefox.');
  }
  if (typeof window !== 'undefined' && window.isSecureContext === false) {
    throw new MidiAccessError('insecure', 'MIDI needs a secure (https) connection.');
  }
  try {
    const access = await (navigator as NavigatorWithMidi).requestMIDIAccess!({ sysex: false });
    return new MidiAccessHandle(access);
  } catch (error) {
    const name = (error as { name?: unknown } | null)?.name;
    if (name === 'NotAllowedError' || name === 'SecurityError') {
      throw new MidiAccessError('denied', 'MIDI access was blocked. Allow MIDI devices in the site settings.');
    }
    throw new MidiAccessError('failed', 'Could not connect to MIDI devices.');
  }
}

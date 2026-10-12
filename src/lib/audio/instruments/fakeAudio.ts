/**
 * Minimal Web Audio stand-in for unit tests. It is as strict as Chromium about
 * values (non-finite numbers, zero exponential targets and overlapping value
 * curves throw) and records every source so tests can inspect a voice.
 */

type Event = { type: string; time: number; end?: number; value?: number };

function assertFinite(name: string, ...values: number[]) {
  for (const v of values) if (!Number.isFinite(v)) throw new TypeError(`${name}: non-finite value ${v}`);
}

export class FakeParam {
  private current: number;
  automationRate: 'a-rate' | 'k-rate' = 'a-rate';
  readonly events: Event[] = [];
  readonly inputs: unknown[] = [];

  constructor(value = 0) {
    this.current = value;
  }

  get value() {
    return this.current;
  }

  set value(v: number) {
    assertFinite('AudioParam.value', v);
    this.current = v;
  }

  private add(event: Event) {
    const clash = this.events.find(
      (e) =>
        (e.type === 'curve' && e.end !== undefined && event.time > e.time && event.time < e.end) ||
        (event.type === 'curve' && event.end !== undefined && e.time > event.time && e.time < event.end),
    );
    if (clash) throw new Error('NotSupportedError: automation overlaps a value curve');
    this.events.push(event);
    return this;
  }

  setValueAtTime(value: number, time: number) {
    assertFinite('setValueAtTime', value, time);
    return this.add({ type: 'set', time, value });
  }

  linearRampToValueAtTime(value: number, time: number) {
    assertFinite('linearRampToValueAtTime', value, time);
    return this.add({ type: 'linear', time, value });
  }

  exponentialRampToValueAtTime(value: number, time: number) {
    assertFinite('exponentialRampToValueAtTime', value, time);
    if (value === 0) throw new RangeError('exponentialRampToValueAtTime: value must not be 0');
    return this.add({ type: 'exp', time, value });
  }

  setTargetAtTime(value: number, time: number, timeConstant: number) {
    assertFinite('setTargetAtTime', value, time, timeConstant);
    if (timeConstant < 0) throw new RangeError('setTargetAtTime: negative time constant');
    return this.add({ type: 'target', time, value });
  }

  setValueCurveAtTime(curve: Float32Array, time: number, duration: number) {
    assertFinite('setValueCurveAtTime', time, duration, ...curve);
    if (!(duration > 0) || curve.length < 2) throw new RangeError('setValueCurveAtTime: bad curve');
    return this.add({ type: 'curve', time, end: time + duration });
  }

  cancelScheduledValues(time: number) {
    assertFinite('cancelScheduledValues', time);
    for (let i = this.events.length - 1; i >= 0; i--) if (this.events[i].time >= time) this.events.splice(i, 1);
    return this;
  }

  /** Every number this param was given. */
  numbers(): number[] {
    return [this.current, ...this.events.flatMap((e) => [e.time, e.value ?? 0, e.end ?? 0])];
  }
}

export class FakeNode {
  readonly connections: unknown[] = [];
  channelCount = 2;

  connect<T>(target: T): T {
    if (target instanceof FakeParam) target.inputs.push(this);
    this.connections.push(target);
    return target;
  }

  disconnect() {
    this.connections.length = 0;
  }
}

export class FakeSource extends FakeNode {
  startTime: number | null = null;
  stopTime: number | null = null;
  offset: number | undefined;
  onended: (() => void) | null = null;

  start(time = 0, offset?: number) {
    assertFinite('start', time);
    if (time < 0) throw new RangeError('start: negative time');
    if (this.startTime !== null) throw new Error('InvalidStateError: start called twice');
    this.startTime = time;
    this.offset = offset;
  }

  stop(time = 0) {
    assertFinite('stop', time);
    if (time < 0) throw new RangeError('stop: negative time');
    this.stopTime = time;
  }
}

export class FakeBuffer {
  readonly channels: Float32Array[];

  constructor(
    public readonly numberOfChannels: number,
    public readonly length: number,
    public readonly sampleRate: number,
  ) {
    this.channels = Array.from({ length: numberOfChannels }, () => new Float32Array(length));
  }

  get duration() {
    return this.length / this.sampleRate;
  }

  getChannelData(ch: number) {
    return this.channels[ch];
  }

  copyToChannel(data: Float32Array, ch: number) {
    this.channels[ch].set(data.subarray(0, this.length));
  }
}

export class FakeContext {
  readonly sources: FakeSource[] = [];
  readonly params: FakeParam[] = [];
  readonly destination = new FakeNode();
  currentTime = 0;
  buffers = 0;

  constructor(public readonly sampleRate = 48000) {}

  private param(value = 0) {
    const p = new FakeParam(value);
    this.params.push(p);
    return p;
  }

  createGain() {
    return Object.assign(new FakeNode(), { gain: this.param(1) });
  }

  createBiquadFilter() {
    return Object.assign(new FakeNode(), {
      type: 'lowpass',
      frequency: this.param(350),
      Q: this.param(1),
      gain: this.param(0),
      detune: this.param(0),
    });
  }

  createWaveShaper() {
    return Object.assign(new FakeNode(), { curve: null as Float32Array | null, oversample: 'none' });
  }

  createStereoPanner() {
    return Object.assign(new FakeNode(), { pan: this.param(0) });
  }

  createOscillator() {
    const node = Object.assign(new FakeSource(), {
      type: 'sine',
      frequency: this.param(440),
      detune: this.param(0),
    });
    this.sources.push(node);
    return node;
  }

  createBufferSource() {
    const node = Object.assign(new FakeSource(), {
      buffer: null as FakeBuffer | null,
      loop: false,
      playbackRate: this.param(1),
      detune: this.param(0),
    });
    this.sources.push(node);
    return node;
  }

  createBuffer(channels: number, length: number, rate: number) {
    if (!(length > 0) || !Number.isInteger(length)) throw new RangeError(`createBuffer: bad length ${length}`);
    this.buffers++;
    return new FakeBuffer(channels, length, rate);
  }
}

/** Treat the fake as the real thing for code under test. */
export function asContext(ctx: FakeContext): BaseAudioContext {
  return ctx as unknown as BaseAudioContext;
}

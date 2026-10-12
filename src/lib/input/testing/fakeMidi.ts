/** Test doubles for the Web MIDI API. */
type MessageListener = (e: { data: ArrayLike<number> | null }) => void;

export class FakePort {
  state = 'connected';
  readonly listeners = new Set<MessageListener>();
  constructor(
    readonly id: string,
    readonly name = id,
  ) {}
  addEventListener(_type: 'midimessage', l: MessageListener) {
    this.listeners.add(l);
  }
  removeEventListener(_type: 'midimessage', l: MessageListener) {
    this.listeners.delete(l);
  }
  send(...data: number[]) {
    for (const l of this.listeners) l({ data: Uint8Array.from(data) });
  }
}

export class FakeAccess {
  readonly ports = new Map<string, FakePort>();
  readonly stateListeners = new Set<() => void>();
  inputs = { forEach: (cb: (p: FakePort) => void) => this.ports.forEach((p) => cb(p)) };
  addEventListener(_type: 'statechange', l: () => void) {
    this.stateListeners.add(l);
  }
  removeEventListener(_type: 'statechange', l: () => void) {
    this.stateListeners.delete(l);
  }
  plug(port: FakePort) {
    this.ports.set(port.id, port);
    this.stateListeners.forEach((l) => l());
  }
  unplug(id: string) {
    this.ports.get(id)!.state = 'disconnected';
    this.stateListeners.forEach((l) => l());
  }
}

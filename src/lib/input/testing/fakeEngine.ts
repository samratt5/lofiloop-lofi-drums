/** Test double for `@/lib/audio/engine` (used with vi.mock in the input tests). */
import { vi } from 'vitest';
import type { LiveNote, Playhead, RecordPosition } from '@/lib/audio/engine';

export const IDLE_HEAD: Playhead = {
  playing: false,
  mode: 'pattern',
  patternId: null,
  step: -1,
  songStep: -1,
  sectionIndex: -1,
};

function create() {
  let head: Playhead = IDLE_HEAD;
  let liveId = 0;
  const listeners = new Set<() => void>();
  const fake = {
    isPlaying: false,
    position: null as RecordPosition | null,
    locate: vi.fn((): RecordPosition | null => fake.position),
    noteOn: vi.fn<(track: unknown, note: number, velocity?: number) => Promise<LiveNote | null>>(async () => ({
      id: ++liveId,
      voices: [],
      release: 0.1,
    })),
    noteOff: vi.fn<(note: LiveNote | null) => void>(),
    play: vi.fn<(options?: { fromBar?: number }) => Promise<void>>(async () => {
      fake.isPlaying = true;
    }),
    stop: vi.fn(() => {
      fake.isPlaying = false;
      fake.emit(IDLE_HEAD);
    }),
    setMetronome: vi.fn<(on: boolean) => void>(),
    subscribe: (listener: () => void) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    getPlayhead: (): Playhead => head,
    /** Test helper: move the (heard) playhead. */
    emit(next: Playhead) {
      head = next;
      for (const l of [...listeners]) l();
    },
    /** Test helper: pattern-mode playhead at a step. */
    at(patternId: string, step: number, extra: Partial<Playhead> = {}) {
      fake.emit({ playing: true, mode: 'pattern', patternId, step, songStep: -1, sectionIndex: -1, ...extra });
    },
    reset() {
      head = IDLE_HEAD;
      listeners.clear();
      fake.isPlaying = false;
      fake.position = null;
      for (const fn of [fake.locate, fake.noteOn, fake.noteOff, fake.play, fake.stop, fake.setMetronome]) {
        fn.mockClear();
      }
    },
  };
  return fake;
}

export const fakeEngine = create();
export type FakeEngine = typeof fakeEngine;

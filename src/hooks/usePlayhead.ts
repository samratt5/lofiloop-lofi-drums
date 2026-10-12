'use client';

import { useSyncExternalStore } from 'react';
import { engine, type Playhead } from '@/lib/audio/engine';

export function usePlayhead(): Playhead {
  return useSyncExternalStore(engine.subscribe, engine.getPlayhead, engine.getServerPlayhead);
}

export function useIsPlaying(): boolean {
  return useSyncExternalStore(
    engine.subscribe,
    () => engine.getPlayhead().playing,
    () => false,
  );
}

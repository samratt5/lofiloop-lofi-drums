/**
 * Listening sessions: play whole songs back to back (the library's "Play all",
 * the endless radio and the Discover gallery) without touching the project
 * open in the editor. The engine plays an override project while a session runs.
 */
import { create } from 'zustand';
import { engine } from '@/lib/audio/engine';
import type { Project } from '@/lib/project/types';
import { hydrateSamples } from '@/lib/storage/hydrate';
import { stopCompare } from '@/lib/compare';

export interface ListenItem {
  key: string;
  title: string;
  artist: string;
  seed: number;
  styles: string[];
  load: () => Promise<Project | null>;
}

export interface ListenSource {
  /** Shown in the player, e.g. "Your library" or "Radio · Rainy jazz" */
  label: string;
  kind: 'library' | 'radio' | 'discover';
  /** The item at a position, or null when the queue has ended. Radio never ends. */
  item: (index: number) => Promise<ListenItem | null> | ListenItem | null;
  /** Number of items when known (for "3 of 12") */
  size?: number;
}

interface ListenState {
  source: ListenSource | null;
  index: number;
  item: ListenItem | null;
  project: Project | null;
  status: 'idle' | 'loading' | 'playing' | 'paused';
}

export const useListen = create<ListenState>()(() => ({
  source: null,
  index: 0,
  item: null,
  project: null,
  status: 'idle',
}));

let token = 0;
let current: Project | null = null;
let pausedBar = 0;

function prepare(project: Project): Project {
  return { ...project, playMode: 'song', loop: null };
}

async function playIndex(index: number, attempt = 0): Promise<void> {
  const source = useListen.getState().source;
  if (!source) return;
  const run = ++token;
  engine.stop();
  useListen.setState({ status: 'loading', index });
  const item = await source.item(index);
  if (run !== token) return;
  if (!item) {
    stopListening();
    return;
  }
  const loaded = await item.load().catch(() => null);
  if (run !== token) return;
  if (!loaded) {
    // Skip broken entries, but don't spin forever on a queue of them.
    if (attempt < 5) void playIndex(index + 1, attempt + 1);
    else stopListening();
    return;
  }
  await hydrateSamples(loaded);
  if (run !== token) return;
  current = prepare(loaded);
  engine.setOverride(() => current);
  useListen.setState({ item, project: current, status: 'playing' });
  pausedBar = 0;
  await engine.play({
    fromBar: 0,
    stopAtEnd: true,
    onEnd: () => {
      if (run === token) void playIndex(index + 1);
    },
  });
}

/** Starts a session from the first (or a given) item. */
export function startListening(source: ListenSource, index = 0): void {
  stopCompare();
  useListen.setState({ source, index, item: null, project: null, status: 'loading' });
  void playIndex(index);
}

export function nextTrack(): void {
  const { source, index } = useListen.getState();
  if (source) void playIndex(index + 1);
}

export function previousTrack(): void {
  const { source, index } = useListen.getState();
  if (!source) return;
  // Like most players: restart the song unless it only just began.
  const bar = engine.getPlayhead().songStep / 16;
  void playIndex(bar > 2 || index === 0 ? index : index - 1);
}

export function toggleListening(): void {
  const { status, source } = useListen.getState();
  if (!source) return;
  if (status === 'playing') {
    pausedBar = Math.floor(engine.getPlayhead().songStep / 16);
    token++;
    engine.stop();
    useListen.setState({ status: 'paused' });
  } else if (status === 'paused' && current) {
    const run = ++token;
    const { index } = useListen.getState();
    useListen.setState({ status: 'playing' });
    void engine.play({
      fromBar: pausedBar,
      stopAtEnd: true,
      onEnd: () => {
        if (run === token) void playIndex(index + 1);
      },
    });
  }
}

/** Ends the session and hands the engine back to the editor. */
export function stopListening(): void {
  token++;
  current = null;
  engine.stop();
  engine.setOverride(null);
  useListen.setState({ source: null, index: 0, item: null, project: null, status: 'idle' });
}

export function isListening(): boolean {
  return useListen.getState().source !== null;
}

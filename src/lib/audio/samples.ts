/**
 * Decoded sample buffers keyed by sample id. AudioBuffers are not tied to a
 * context, so one decode serves live playback and offline exports alike.
 */
type Listener = () => void;

const buffers = new Map<string, AudioBuffer>();
const listeners = new Set<Listener>();
let version = 0;

export const sampleBank = {
  get(id: string): AudioBuffer | undefined {
    return buffers.get(id);
  },
  has(id: string): boolean {
    return buffers.has(id);
  },
  set(id: string, buffer: AudioBuffer): void {
    buffers.set(id, buffer);
    version += 1;
    for (const l of listeners) l();
  },
  delete(id: string): void {
    buffers.delete(id);
    version += 1;
    for (const l of listeners) l();
  },
  subscribe(listener: Listener): () => void {
    listeners.add(listener);
    return () => listeners.delete(listener);
  },
  /** Bumps whenever a sample is added or removed (for useSyncExternalStore). */
  get version(): number {
    return version;
  },
};

/** Decode an audio file (WAV, MP3, OGG, FLAC, M4A…) without needing a live context. */
export async function decodeAudio(data: ArrayBuffer): Promise<AudioBuffer> {
  const ctx = new OfflineAudioContext(2, 1, 44100);
  return ctx.decodeAudioData(data.slice(0));
}

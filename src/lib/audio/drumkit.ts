/**
 * Built-in sampled drum kit.
 *
 * A bundle of procedurally generated one-shots (see `public/drums` and
 * `tools/gen_drums.py`) is fetched and decoded in the background at boot. Each
 * drum track draws one variant from its instrument's pool, so a song keeps a
 * consistent kick/snare/hat while the next song gets a different kit. Until (or
 * unless) the kit loads, the voices fall back to pure synthesis — the app never
 * waits on it, so a slow phone connection can't stall the studio.
 *
 * AudioBuffers are not tied to a context, so a single bank serves live playback
 * and offline exports alike.
 */
const bank = new Map<string, AudioBuffer[]>();
const listeners = new Set<() => void>();
let version = 0;
let pending: Promise<void> | null = null;

/** One decode context is enough for the whole bank (decoding is context-free). */
let decodeCtx: OfflineAudioContext | null = null;

function decode(data: ArrayBuffer): Promise<AudioBuffer> {
  decodeCtx ??= new OfflineAudioContext(2, 1, 44100);
  // decodeAudioData detaches its input, so hand it a copy.
  return decodeCtx.decodeAudioData(data.slice(0));
}

/** Decoded variants for a drum instrument, or undefined when none are loaded. */
export function drumVariants(instrument: string): readonly AudioBuffer[] | undefined {
  const variants = bank.get(instrument);
  return variants && variants.length ? variants : undefined;
}

export function drumKitLoaded(): boolean {
  return bank.size > 0;
}

export function drumKitVersion(): number {
  return version;
}

export function subscribeDrumKit(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

async function fetchDecode(base: string, file: string): Promise<AudioBuffer | null> {
  try {
    const res = await fetch(`${base}/${file}`, { cache: 'force-cache' });
    if (!res.ok) return null;
    return await decode(await res.arrayBuffer());
  } catch {
    return null;
  }
}

/**
 * Fetch and decode the whole kit. Safe to call repeatedly — the work happens
 * once. Never rejects: a missing kit just means the synthesised voices carry on.
 */
export function loadDrumKit(base = '/drums'): Promise<void> {
  pending ??= (async () => {
    try {
      const res = await fetch(`${base}/manifest.json`, { cache: 'force-cache' });
      if (!res.ok) return;
      const manifest = (await res.json()) as Record<string, string[]>;
      await Promise.all(
        Object.entries(manifest).map(async ([instrument, files]) => {
          if (!Array.isArray(files) || !files.length) return;
          const decoded = await Promise.all(files.map((file) => fetchDecode(base, file)));
          const buffers = decoded.filter((buffer): buffer is AudioBuffer => buffer !== null);
          if (buffers.length) {
            bank.set(instrument, buffers);
            version += 1;
          }
        }),
      );
      for (const listener of listeners) listener();
    } catch {
      // Samples are an enhancement; the synthesised voices remain as fallback.
    }
  })();
  return pending;
}

/**
 * Mastering takes a couple of seconds for a full song, so it runs in a worker
 * to keep the page responsive. Falls back to the main thread where workers
 * aren't available.
 */
import type { MasterOptions, MasterResult } from './mastering';
import type { PcmAudio } from './wav';

export async function masterAsync(audio: PcmAudio, options: MasterOptions): Promise<MasterResult> {
  if (typeof Worker !== 'undefined') {
    try {
      return await new Promise<MasterResult>((resolve, reject) => {
        const worker = new Worker(new URL('./master.worker.ts', import.meta.url), { type: 'module' });
        worker.onmessage = (event: MessageEvent<{ result?: MasterResult; error?: string }>) => {
          worker.terminate();
          if (event.data.result) resolve(event.data.result);
          else reject(new Error(event.data.error ?? 'Mastering failed'));
        };
        worker.onerror = (event) => {
          worker.terminate();
          reject(new Error(event.message || 'Mastering worker failed'));
        };
        // Copies (not transfers) the input so the caller's audio stays usable.
        worker.postMessage({ audio, options });
      });
    } catch {
      // Fall through to the main thread.
    }
  }
  const { masterToTarget } = await import('./mastering');
  return masterToTarget(audio, options);
}

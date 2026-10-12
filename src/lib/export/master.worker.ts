/// <reference lib="webworker" />
import { masterToTarget, type MasterOptions } from './mastering';
import type { PcmAudio } from './wav';

self.onmessage = (event: MessageEvent<{ audio: PcmAudio; options: MasterOptions }>) => {
  try {
    const result = masterToTarget(event.data.audio, event.data.options);
    const transfer = result.audio.channels.map((ch) => ch.buffer as ArrayBuffer);
    (self as unknown as DedicatedWorkerGlobalScope).postMessage({ result }, transfer);
  } catch (error) {
    (self as unknown as DedicatedWorkerGlobalScope).postMessage({ error: String(error) });
  }
};

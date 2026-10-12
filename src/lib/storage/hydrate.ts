import { decodeAudio, sampleBank } from '@/lib/audio/samples';
import type { Project } from '@/lib/project/types';
import { loadSampleData, referencedSampleIds } from './library';

const loadingSamples = new Set<string>();

/** Decodes any uploaded samples the project uses that aren't in memory yet. */
export async function hydrateSamples(project: Project): Promise<void> {
  const missing = referencedSampleIds(project).filter((id) => !sampleBank.has(id) && !loadingSamples.has(id));
  await Promise.all(
    missing.map(async (id) => {
      loadingSamples.add(id);
      try {
        const data = await loadSampleData(id);
        if (data) sampleBank.set(id, await decodeAudio(data));
      } catch {
        // A missing or undecodable sample just stays silent.
      } finally {
        loadingSamples.delete(id);
      }
    }),
  );
}

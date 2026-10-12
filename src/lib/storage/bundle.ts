/**
 * Portable `.lofiloop.json` bundles: the normal project file, optionally with the
 * project's samples embedded as base64 so it opens on another device.
 */
import { ProjectParseError, parseProjectFile, toProjectFile } from '@/lib/project/serialize';
import type { Project } from '@/lib/project/types';
import { base64ToBytes, bytesToBase64 } from './encoding';
import { loadSampleData, listSamples, storeSample } from './samples';

export const BUNDLE_MIME = 'application/json';

export interface BundledSample {
  id: string;
  name: string;
  type: string;
  /** base64 of the raw file bytes */
  data: string;
  duration?: number;
}

/** Sample ids referenced by the project's tracks, in track order. */
export function referencedSampleIds(project: Project): string[] {
  return [...new Set(project.tracks.flatMap((t) => (t.sample ? [t.sample.id] : [])))];
}

/** Build the bundle file. Samples missing from storage are skipped. */
export async function exportBundle(project: Project, { includeSamples }: { includeSamples: boolean }): Promise<Blob> {
  const file: Record<string, unknown> = toProjectFile(project);
  if (includeSamples) {
    const ids = referencedSampleIds(project);
    const metas = new Map((await listSamples()).map((m) => [m.id, m]));
    const samples: BundledSample[] = [];
    for (const id of ids) {
      const meta = metas.get(id);
      const data = meta ? await loadSampleData(id) : null;
      if (!meta || !data) continue;
      samples.push({
        id,
        name: meta.name,
        type: meta.type,
        data: bytesToBase64(data),
        ...(meta.duration !== undefined ? { duration: meta.duration } : {}),
      });
    }
    if (samples.length) file.samples = samples;
  }
  return new Blob([JSON.stringify(file)], { type: BUNDLE_MIME });
}

function decodeSamples(raw: unknown): (Omit<BundledSample, 'data'> & { bytes: ArrayBuffer })[] {
  if (raw === undefined) return [];
  if (!Array.isArray(raw)) throw new ProjectParseError('The bundle\'s "samples" list is malformed.');
  return raw.map((entry, i) => {
    const s = entry as Partial<BundledSample> | null;
    if (!s || typeof s.id !== 'string' || !s.id || typeof s.data !== 'string') {
      throw new ProjectParseError(`Embedded sample #${i + 1} is malformed.`);
    }
    let bytes: ArrayBuffer;
    try {
      bytes = base64ToBytes(s.data);
    } catch {
      throw new ProjectParseError(`Embedded sample "${s.name ?? s.id}" is corrupt.`);
    }
    return {
      id: s.id,
      name: typeof s.name === 'string' ? s.name : 'Sample',
      type: typeof s.type === 'string' ? s.type : 'application/octet-stream',
      duration: typeof s.duration === 'number' ? s.duration : undefined,
      bytes,
    };
  });
}

/**
 * Parse a bundle or plain project file. Embedded samples are stored (identical
 * content is reused) and track sample ids are remapped to the stored ids.
 * The project itself is returned, not saved. Throws ProjectParseError for bad input.
 */
export async function importBundle(text: string): Promise<{ project: Project; samplesImported: number }> {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    throw new ProjectParseError('The file is not valid JSON.');
  }
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    throw new ProjectParseError('Not a LofiLoop project file.');
  }
  const { samples: rawSamples, ...file } = data as Record<string, unknown>;
  // Validate everything before writing anything.
  const project = parseProjectFile(file);
  const samples = decodeSamples(rawSamples);

  const idMap = new Map<string, string>();
  let samplesImported = 0;
  for (const s of samples) {
    const { meta, created } = await storeSample({
      id: s.id,
      name: s.name,
      type: s.type,
      data: s.bytes,
      duration: s.duration,
    });
    idMap.set(s.id, meta.id);
    if (created) samplesImported++;
  }

  const tracks = project.tracks.map((t) => {
    const id = t.sample && idMap.get(t.sample.id);
    return id && t.sample && id !== t.sample.id ? { ...t, sample: { ...t.sample, id } } : t;
  });
  return { project: { ...project, tracks }, samplesImported };
}

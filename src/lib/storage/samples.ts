/** Uploaded audio files, stored as raw encoded bytes and deduplicated by content hash. */
import { createId } from '@/lib/utils/id';
import { transact } from './connection';
import type { SampleRecord } from './db';
import { hashBytes } from './encoding';
import { stamp } from './records';
import { StorageError, type SampleMeta } from './types';

/** Largest accepted sample file. */
export const MAX_SAMPLE_BYTES = 50 * 1024 * 1024;

export interface SampleInput {
  name: string;
  type: string;
  data: ArrayBuffer;
  duration?: number;
}

function toMeta(r: SampleRecord): SampleMeta {
  const meta: SampleMeta = { id: r.id, name: r.name, type: r.type, size: r.size, createdAt: r.createdAt };
  if (r.duration !== undefined) meta.duration = r.duration;
  return meta;
}

/** Store a sample (or its already-stored identical twin). `id` is honoured only for new content. */
export async function storeSample(
  input: SampleInput & { id?: string },
): Promise<{ meta: SampleMeta; created: boolean }> {
  if (input.data.byteLength > MAX_SAMPLE_BYTES) {
    throw new StorageError(
      `"${input.name}" is larger than ${MAX_SAMPLE_BYTES / 1024 / 1024} MB. Trim or compress it first.`,
      'too-large',
    );
  }
  // Hash before the transaction: awaiting WebCrypto inside it would let it auto-commit.
  const hash = await hashBytes(input.data);
  return transact(['samples', 'sampleData'], 'readwrite', 'save the sample', async (tx) => {
    const [existing] = await tx.getAllByIndex('samples', 'hash', hash);
    if (existing) return { meta: toMeta(existing), created: false };
    let id = input.id && input.id.length <= 64 ? input.id : createId('smp');
    if (await tx.get('samples', id)) id = createId('smp');
    const record: SampleRecord = {
      id,
      name: input.name.trim().slice(0, 120) || 'Sample',
      type: input.type || 'application/octet-stream',
      size: input.data.byteLength,
      createdAt: stamp(),
      hash,
      ...(typeof input.duration === 'number' && Number.isFinite(input.duration) ? { duration: input.duration } : {}),
    };
    await tx.put('samples', record);
    await tx.put('sampleData', { id, data: input.data });
    return { meta: toMeta(record), created: true };
  });
}

/** Store an uploaded audio file. Identical content returns the existing sample. Max 50 MB. */
export async function saveSample(input: SampleInput): Promise<SampleMeta> {
  return (await storeSample(input)).meta;
}

/** All samples, newest first. */
export async function listSamples(): Promise<SampleMeta[]> {
  const records = await transact(['samples'], 'readonly', 'read your samples', (tx) => tx.getAll('samples'));
  return records.map(toMeta).sort((a, b) => b.createdAt - a.createdAt);
}

export async function loadSampleData(id: string): Promise<ArrayBuffer | null> {
  const record = await transact(['sampleData'], 'readonly', 'load the sample', (tx) => tx.get('sampleData', id));
  return record?.data ?? null;
}

export async function deleteSample(id: string): Promise<void> {
  await transact(['samples', 'sampleData'], 'readwrite', 'delete the sample', async (tx) => {
    await tx.delete('samples', id);
    await tx.delete('sampleData', id);
  });
}

/** Number of stored samples and their total size in bytes. */
export async function sampleUsage(): Promise<{ count: number; bytes: number }> {
  const records = await transact(['samples'], 'readonly', 'read your samples', (tx) => tx.getAll('samples'));
  return { count: records.length, bytes: records.reduce((sum, r) => sum + r.size, 0) };
}

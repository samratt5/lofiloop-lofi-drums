/** Version snapshots: frozen copies of a project the user can restore later. */
import { parseProjectFile, serializeProject } from '@/lib/project/serialize';
import type { Project } from '@/lib/project/types';
import { createId } from '@/lib/utils/id';
import { transact } from './connection';
import type { SnapshotRecord } from './db';
import { songSeconds, stamp } from './records';
import type { SnapshotMeta } from './types';

/** Snapshots kept per project; automatic ones are dropped first. */
export const MAX_SNAPSHOTS = 50;

function toMeta(r: SnapshotRecord): SnapshotMeta {
  return {
    id: r.id,
    projectId: r.projectId,
    name: r.name,
    auto: r.auto,
    createdAt: r.createdAt,
    bpm: r.bpm,
    seconds: r.seconds,
  };
}

const newestFirst = (a: SnapshotMeta, b: SnapshotMeta) => b.createdAt - a.createdAt;

/** Snapshots of a project, newest first. */
export async function listSnapshots(projectId: string): Promise<SnapshotMeta[]> {
  const records = await transact(['snapshots'], 'readonly', 'read the version history', (tx) =>
    tx.getAllByIndex('snapshots', 'projectId', projectId),
  );
  return records.map(toMeta).sort(newestFirst);
}

/**
 * Store a snapshot of `project`. A blank name (or `auto: true`) marks it automatic.
 * Keeps at most MAX_SNAPSHOTS per project, removing the oldest automatic ones first.
 */
export async function saveSnapshot(
  project: Project,
  name = '',
  { auto = !name.trim() }: { auto?: boolean } = {},
): Promise<SnapshotMeta> {
  const createdAt = stamp();
  const record: SnapshotRecord = {
    id: createId('snap'),
    projectId: project.id,
    name: name.trim().slice(0, 80) || 'Auto-save',
    auto,
    createdAt,
    bpm: project.bpm,
    seconds: songSeconds(project),
    json: serializeProject(project),
  };
  await transact(['snapshots'], 'readwrite', 'save a version', async (tx) => {
    const existing = (await tx.getAllByIndex('snapshots', 'projectId', project.id)).map(toMeta);
    const excess = existing.length + 1 - MAX_SNAPSHOTS;
    if (excess > 0) {
      const oldestFirst = [...existing].sort((a, b) => a.createdAt - b.createdAt);
      const victims = [...oldestFirst.filter((s) => s.auto), ...oldestFirst.filter((s) => !s.auto)].slice(0, excess);
      await Promise.all(victims.map((s) => tx.delete('snapshots', s.id)));
    }
    await tx.put('snapshots', record);
  });
  return toMeta(record);
}

/** The project exactly as it was when the snapshot was taken (same project id), or null. */
export async function loadSnapshot(id: string): Promise<Project | null> {
  const record = await transact(['snapshots'], 'readonly', 'load the version', (tx) => tx.get('snapshots', id));
  if (!record) return null;
  try {
    return parseProjectFile(record.json);
  } catch {
    return null;
  }
}

/** Rename a snapshot; a named snapshot is no longer automatic. */
export async function renameSnapshot(id: string, name: string): Promise<void> {
  await transact(['snapshots'], 'readwrite', 'rename the version', async (tx) => {
    const record = await tx.get('snapshots', id);
    if (!record) return;
    const trimmed = name.trim().slice(0, 80);
    await tx.put('snapshots', { ...record, name: trimmed || record.name, auto: trimmed ? false : record.auto });
  });
}

export async function deleteSnapshot(id: string): Promise<void> {
  await transact(['snapshots'], 'readwrite', 'delete the version', (tx) => tx.delete('snapshots', id));
}

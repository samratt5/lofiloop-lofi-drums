/** Project library: compact project JSON plus a meta record per project. */
import { parseProjectFile } from '@/lib/project/serialize';
import type { Project } from '@/lib/project/types';
import { createId } from '@/lib/utils/id';
import { CURRENT_KEY, transact } from './connection';
import type { Tx } from './db';
import { projectRecords, stamp } from './records';
import type { ProjectMeta } from './types';

function parseOrNull(json: string | undefined): Project | null {
  if (!json) return null;
  try {
    return parseProjectFile(json);
  } catch {
    return null;
  }
}

/** All projects, most recently updated first. */
export function listProjects(): Promise<ProjectMeta[]> {
  return transact(['meta'], 'readonly', 'read the library', async (tx) =>
    (await tx.getAll('meta')).sort((a, b) => b.updatedAt - a.updatedAt),
  );
}

/** A stored project, or null when missing or unreadable. */
export async function loadProject(id: string): Promise<Project | null> {
  const record = await transact(['projects'], 'readonly', 'load the beat', (tx) => tx.get('projects', id));
  return parseOrNull(record?.json);
}

/** The project that was open last time, if it still exists. */
export async function loadCurrentProject(): Promise<Project | null> {
  const record = await transact(['projects', 'kv'], 'readonly', 'load the beat', async (tx) => {
    const current = await tx.get('kv', CURRENT_KEY);
    return current ? tx.get('projects', current.value) : undefined;
  });
  return parseOrNull(record?.json);
}

/** Persist a project (and by default make it the one reopened next visit). Throws StorageError when full. */
export async function saveProject(project: Project, { makeCurrent = true }: { makeCurrent?: boolean } = {}) {
  const { record, meta } = projectRecords(project);
  await transact(['projects', 'meta', 'kv'], 'readwrite', 'save the beat', async (tx) => {
    await tx.put('projects', record);
    await tx.put('meta', meta);
    if (makeCurrent) await tx.put('kv', { key: CURRENT_KEY, value: project.id });
  });
}

export async function setCurrentProject(id: string): Promise<void> {
  await transact(['kv'], 'readwrite', 'remember the open beat', (tx) => tx.put('kv', { key: CURRENT_KEY, value: id }));
}

/** Remove the snapshots of a project inside an existing transaction. */
export async function deleteSnapshotsOf(tx: Tx, projectId: string): Promise<void> {
  const snapshots = await tx.getAllByIndex('snapshots', 'projectId', projectId);
  await Promise.all(snapshots.map((s) => tx.delete('snapshots', s.id)));
}

/** Delete a project and all of its snapshots. Samples are shared and kept. */
export async function deleteProject(id: string): Promise<void> {
  await transact(['projects', 'meta', 'snapshots', 'kv'], 'readwrite', 'delete the beat', async (tx) => {
    await tx.delete('projects', id);
    await tx.delete('meta', id);
    await deleteSnapshotsOf(tx, id);
    const current = await tx.get('kv', CURRENT_KEY);
    if (current?.value === id) await tx.delete('kv', CURRENT_KEY);
  });
}

/** Copy a project under a new id (not made current). Returns null if the source is missing. */
export async function duplicateProject(id: string, newName?: string): Promise<Project | null> {
  const source = await loadProject(id);
  if (!source) return null;
  const now = stamp();
  const copy: Project = {
    ...source,
    id: createId('prj'),
    name: (newName?.trim() || `${source.name} (copy)`).slice(0, 120),
    createdAt: now,
    updatedAt: now,
  };
  await saveProject(copy, { makeCurrent: false });
  return copy;
}

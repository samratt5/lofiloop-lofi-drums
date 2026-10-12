/** Opens the storage backend once, runs the one-time localStorage migration, and maps errors. */
import { parseProjectFile } from '@/lib/project/serialize';
import type { Project } from '@/lib/project/types';
import { createIndexedDbBackend, createMemoryBackend, type Backend, type StoreName, type Tx, type TxMode } from './db';
import { projectRecords } from './records';
import { StorageError, toStorageError } from './types';

/** Legacy localStorage keys (see src/lib/store/persistence.ts). Prefs are left alone. */
export const LEGACY_PREFIX = 'lofiloop:v2';
const LEGACY_INDEX = `${LEGACY_PREFIX}:index`;
const LEGACY_CURRENT = `${LEGACY_PREFIX}:current`;
const LEGACY_PROJECT = `${LEGACY_PREFIX}:project:`;

export const CURRENT_KEY = 'current';

let backend: Backend | null = null;
let opening: Promise<Backend> | null = null;
let initializing: Promise<{ migrated: number }> | null = null;

function idbFactory(): IDBFactory | null {
  try {
    return typeof indexedDB !== 'undefined' && indexedDB ? indexedDB : null;
  } catch {
    return null;
  }
}

function localStore(): Storage | null {
  try {
    return typeof localStorage !== 'undefined' && localStorage ? localStorage : null;
  } catch {
    return null;
  }
}

async function openBackend(): Promise<Backend> {
  const factory = idbFactory();
  if (factory) {
    try {
      return await createIndexedDbBackend(factory);
    } catch (error) {
      // A blocked upgrade is actionable by the user; anything else means IndexedDB is unusable here.
      if (error instanceof StorageError && error.reason === 'blocked') throw error;
    }
  }
  return createMemoryBackend();
}

function getBackend(): Promise<Backend> {
  if (backend) return Promise.resolve(backend);
  opening ??= openBackend().then(
    (b) => {
      backend = b;
      return b;
    },
    (error) => {
      opening = null;
      throw error;
    },
  );
  return opening;
}

/**
 * Copy `lofiloop:v2:*` projects into the backend. When the backend is durable the
 * legacy keys are removed afterwards; unreadable projects are left in place.
 * A stored project is only overwritten by a legacy copy that is newer.
 */
async function migrateLegacy(target: Backend): Promise<number> {
  const store = localStore();
  if (!store) return 0;
  const keys: string[] = [];
  for (let i = 0; i < store.length; i++) {
    const key = store.key(i);
    if (key?.startsWith(LEGACY_PROJECT)) keys.push(key);
  }
  const legacyCurrent = store.getItem(LEGACY_CURRENT);
  if (!keys.length && legacyCurrent === null && store.getItem(LEGACY_INDEX) === null) return 0;

  const parsed: { key: string; project: Project }[] = [];
  for (const key of keys) {
    try {
      parsed.push({ key, project: parseProjectFile(store.getItem(key) ?? '') });
    } catch {
      // Corrupt entry: keep it rather than destroy data we cannot read.
    }
  }

  const migrated = await target.run(['projects', 'meta', 'kv'], 'readwrite', async (tx) => {
    let count = 0;
    for (const { project } of parsed) {
      const existing = await tx.get('meta', project.id);
      if (existing && existing.updatedAt >= project.updatedAt) continue;
      const { record, meta } = projectRecords(project);
      await tx.put('projects', record);
      await tx.put('meta', meta);
      count++;
    }
    if (legacyCurrent && !(await tx.get('kv', CURRENT_KEY)) && (await tx.get('meta', legacyCurrent))) {
      await tx.put('kv', { key: CURRENT_KEY, value: legacyCurrent });
    }
    return count;
  });

  if (target.kind === 'indexeddb') {
    try {
      for (const { key } of parsed) store.removeItem(key);
      store.removeItem(LEGACY_INDEX);
      store.removeItem(LEGACY_CURRENT);
    } catch {
      // Removal is best-effort; the next run skips projects that are already stored.
    }
  }
  return migrated;
}

/**
 * Open the database and migrate projects from localStorage once. Safe to call
 * repeatedly (later calls share the first result). Falls back to an in-memory
 * store when IndexedDB is unavailable; rejects with StorageError('blocked') only
 * if another tab prevents a schema upgrade.
 */
export function initStorage(): Promise<{ migrated: number }> {
  initializing ??= (async () => {
    const b = await getBackend();
    try {
      return { migrated: await migrateLegacy(b) };
    } catch {
      // Migration failure must not prevent the app from starting; legacy keys stay put for next time.
      return { migrated: 0 };
    }
  })().catch((error) => {
    initializing = null;
    throw toStorageError(error, 'open the library');
  });
  return initializing;
}

/** Which backend is active. 'memory' means nothing survives a reload. */
export function storageAvailable(): 'indexeddb' | 'memory' {
  return backend?.kind ?? (idbFactory() ? 'indexeddb' : 'memory');
}

/** Close the connection and forget state (tests, or before deleting the database). */
export function closeStorage(): void {
  backend?.close();
  backend = null;
  opening = null;
  initializing = null;
}

/** Run one transaction, initializing storage first. Errors become StorageError with `action` in the message. */
export async function transact<T>(
  stores: StoreName[],
  mode: TxMode,
  action: string,
  body: (tx: Tx) => Promise<T>,
): Promise<T> {
  try {
    await initStorage();
    return await backend!.run(stores, mode, body);
  } catch (error) {
    throw toStorageError(error, action);
  }
}

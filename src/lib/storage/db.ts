/**
 * Tiny typed IndexedDB wrapper: promisified requests, one transaction per call,
 * versioned upgrades, and an in-memory backend with the same interface for
 * browsers where IndexedDB is missing or refuses to open.
 */
import { StorageError, type ProjectMeta, type SampleMeta, type SnapshotMeta } from './types';

export const DB_NAME = 'lofiloop';
export const DB_VERSION = 1;
/** How long an upgrade may wait for other tabs to close their connection. */
const BLOCKED_TIMEOUT_MS = 8000;

export interface ProjectRecord {
  id: string;
  /** Compact serialized project file */
  json: string;
}

export interface SnapshotRecord extends SnapshotMeta {
  json: string;
}

export interface SampleRecord extends SampleMeta {
  /** Content hash, used to dedupe identical uploads */
  hash: string;
}

export interface SampleDataRecord {
  id: string;
  data: ArrayBuffer;
}

export interface KvRecord {
  key: string;
  value: string;
}

export interface StoreMap {
  projects: ProjectRecord;
  meta: ProjectMeta;
  snapshots: SnapshotRecord;
  samples: SampleRecord;
  sampleData: SampleDataRecord;
  kv: KvRecord;
}

export type StoreName = keyof StoreMap;

interface IndexMap {
  snapshots: 'projectId';
  samples: 'hash';
}

type IndexedStore = keyof IndexMap;

const KEY_PATHS: { [S in StoreName]: string } = {
  projects: 'id',
  meta: 'id',
  snapshots: 'id',
  samples: 'id',
  sampleData: 'id',
  kv: 'key',
};

const INDEXES: { [S in IndexedStore]: IndexMap[S][] } = {
  snapshots: ['projectId'],
  samples: ['hash'],
};

/** Upgrade steps; entry `n` migrates a database from version n to n + 1. */
const UPGRADES: ((db: IDBDatabase, tx: IDBTransaction) => void)[] = [
  (db) => {
    for (const name of Object.keys(KEY_PATHS) as StoreName[]) {
      const store = db.createObjectStore(name, { keyPath: KEY_PATHS[name] });
      for (const index of (INDEXES as Partial<Record<StoreName, string[]>>)[name] ?? []) {
        store.createIndex(index, index, { unique: false });
      }
    }
  },
];

/** Operations available inside one transaction. Only await these (never unrelated promises). */
export interface Tx {
  get<S extends StoreName>(store: S, key: string): Promise<StoreMap[S] | undefined>;
  getAll<S extends StoreName>(store: S): Promise<StoreMap[S][]>;
  getAllByIndex<S extends IndexedStore>(store: S, index: IndexMap[S], value: string): Promise<StoreMap[S][]>;
  put<S extends StoreName>(store: S, value: StoreMap[S]): Promise<void>;
  delete(store: StoreName, key: string): Promise<void>;
}

export type TxMode = 'readonly' | 'readwrite';

export interface Backend {
  readonly kind: 'indexeddb' | 'memory';
  /** Run `body` in one transaction over `stores`; resolves once the transaction has committed. */
  run<T>(stores: StoreName[], mode: TxMode, body: (tx: Tx) => Promise<T>): Promise<T>;
  close(): void;
}

// ---------------------------------------------------------------------------
// IndexedDB

function request<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new DOMException('IndexedDB request failed', 'UnknownError'));
  });
}

/** Turns a synchronous throw (e.g. DataCloneError) into a rejected promise. */
function attempt<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return fn();
  } catch (error) {
    return Promise.reject(error);
  }
}

function txApi(tx: IDBTransaction): Tx {
  return {
    get: (store, key) => attempt(() => request(tx.objectStore(store).get(key))),
    getAll: (store) => attempt(() => request(tx.objectStore(store).getAll())),
    getAllByIndex: (store, index, value) => attempt(() => request(tx.objectStore(store).index(index).getAll(value))),
    put: (store, value) => attempt(() => request(tx.objectStore(store).put(value)).then(() => undefined)),
    delete: (store, key) => attempt(() => request(tx.objectStore(store).delete(key))),
  };
}

function runTransaction<T>(db: IDBDatabase, stores: StoreName[], mode: TxMode, body: (tx: Tx) => Promise<T>) {
  // May throw synchronously (InvalidStateError when the connection is closing).
  const tx = db.transaction(stores, mode);
  return new Promise<T>((resolve, reject) => {
    let value: T;
    let bodyDone = false;
    let txDone = false;
    let bodyError: unknown;
    const finish = () => {
      if (bodyDone && txDone) resolve(value);
    };
    tx.oncomplete = () => {
      txDone = true;
      finish();
    };
    tx.onabort = () => reject(bodyError ?? tx.error ?? new DOMException('Transaction aborted', 'AbortError'));
    attempt(() => body(txApi(tx))).then(
      (result) => {
        value = result;
        bodyDone = true;
        finish();
      },
      (error) => {
        bodyError = error;
        try {
          tx.abort();
        } catch {
          // Already finished or aborting: report the body's error directly.
          reject(error);
        }
      },
    );
  });
}

function isClosedConnectionError(error: unknown): boolean {
  return error instanceof DOMException && error.name === 'InvalidStateError';
}

/** Open (and create/upgrade) the database. Rejects with StorageError('blocked') if other tabs hold it too long. */
export function openDatabase(factory: IDBFactory, name = DB_NAME): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    let settled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const req = factory.open(name, DB_VERSION);
    req.onupgradeneeded = (event) => {
      const tx = req.transaction!;
      for (let v = event.oldVersion; v < DB_VERSION; v++) UPGRADES[v](req.result, tx);
    };
    req.onblocked = () => {
      timer ??= setTimeout(() => {
        settled = true;
        reject(
          new StorageError(
            'LofiLoop is open in another tab with an older version. Close the other tabs and reload.',
            'blocked',
          ),
        );
      }, BLOCKED_TIMEOUT_MS);
    };
    req.onsuccess = () => {
      clearTimeout(timer);
      if (settled) {
        req.result.close();
        return;
      }
      settled = true;
      resolve(req.result);
    };
    req.onerror = () => {
      clearTimeout(timer);
      settled = true;
      reject(req.error ?? new DOMException('Could not open IndexedDB', 'UnknownError'));
    };
  });
}

/**
 * IndexedDB backend. The connection is reopened transparently when another
 * tab upgrades the schema or the user clears site data while the app is open.
 */
export async function createIndexedDbBackend(factory: IDBFactory, name = DB_NAME): Promise<Backend> {
  let current: Promise<IDBDatabase> | null = null;

  const attach = (db: IDBDatabase) => {
    const drop = () => {
      db.close();
      current = null;
    };
    // Another tab wants to upgrade or delete the database: step aside.
    db.onversionchange = drop;
    // Closed by the browser (e.g. site data cleared): reopen on next use.
    db.onclose = () => {
      current = null;
    };
    return db;
  };

  const connect = () => {
    current ??= openDatabase(factory, name).then(attach, (error) => {
      current = null;
      throw error;
    });
    return current;
  };

  await connect();

  return {
    kind: 'indexeddb',
    async run(stores, mode, body) {
      for (let attemptNo = 0; ; attemptNo++) {
        const db = await connect();
        try {
          return await runTransaction(db, stores, mode, body);
        } catch (error) {
          // db.transaction() threw because the connection went away: reconnect once.
          if (attemptNo === 0 && isClosedConnectionError(error)) {
            current = null;
            continue;
          }
          throw error;
        }
      }
    },
    close() {
      void current?.then((db) => db.close()).catch(() => undefined);
      current = null;
    },
  };
}

// ---------------------------------------------------------------------------
// Memory

/** Non-durable fallback with the same semantics (values are structured-cloned in and out). */
export function createMemoryBackend(): Backend {
  const stores = new Map<StoreName, Map<string, unknown>>();
  const table = (name: StoreName) => {
    let map = stores.get(name);
    if (!map) stores.set(name, (map = new Map()));
    return map;
  };
  const clone = <T>(value: T): T => structuredClone(value);
  const tx: Tx = {
    get: async (store, key) => clone(table(store).get(key)) as never,
    getAll: async (store) => [...table(store).values()].map(clone) as never,
    getAllByIndex: async (store, index, value) =>
      [...table(store).values()].filter((r) => (r as Record<string, unknown>)[index] === value).map(clone) as never,
    put: async (store, value) => {
      const key = (value as unknown as Record<string, string>)[KEY_PATHS[store]];
      table(store).set(key, clone(value));
    },
    delete: async (store, key) => {
      table(store).delete(key);
    },
  };
  return {
    kind: 'memory',
    run: (_stores, _mode, body) => attempt(() => body(tx)),
    close: () => undefined,
  };
}

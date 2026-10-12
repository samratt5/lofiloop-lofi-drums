import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createTrack } from '@/lib/project/factory';
import { ProjectParseError, serializeProject } from '@/lib/project/serialize';
import { createDemoProject } from '@/lib/project/templates';
import type { Project, SampleRef } from '@/lib/project/types';
import { DB_NAME } from './db';
import {
  MAX_SAMPLE_BYTES,
  MAX_SNAPSHOTS,
  StorageError,
  closeStorage,
  deleteProject,
  deleteSample,
  deleteSnapshot,
  duplicateProject,
  exportBundle,
  importBundle,
  initStorage,
  listProjects,
  listSamples,
  listSnapshots,
  loadCurrentProject,
  loadProject,
  loadSampleData,
  loadSnapshot,
  renameSnapshot,
  sampleUsage,
  saveProject,
  saveSample,
  saveSnapshot,
  setCurrentProject,
  storageAvailable,
} from './library';
import { storeSample } from './samples';
import { isQuotaError, toStorageError } from './types';

function project(id: string, name: string, updatedAt: number): Project {
  return { ...createDemoProject(), id, name, updatedAt };
}

function bytes(...values: number[]): ArrayBuffer {
  return new Uint8Array(values).buffer;
}

function sampleRef(id: string): SampleRef {
  return { id, name: 'Chop', root: 60, mode: 'chop', slices: [0, 0.5], start: 0, end: 1 };
}

/** Demo project plus a sampler track that points at `sampleId`. */
function projectWithSample(sampleId: string): Project {
  const base = project('prj_s', 'Sampled', 5);
  const sampler = { ...createTrack('sampler'), id: 't_smp', sample: sampleRef(sampleId) };
  return {
    ...base,
    tracks: [...base.tracks, sampler],
    patterns: base.patterns.map((p) => ({ ...p, steps: { ...p.steps, [sampler.id]: p.steps[base.tracks[0].id] } })),
  };
}

/** Minimal Storage implementation for the migration tests. */
function memoryStorage(initial: Record<string, string> = {}): Storage {
  const map = new Map(Object.entries(initial));
  return {
    get length() {
      return map.size;
    },
    key: (i) => [...map.keys()][i] ?? null,
    getItem: (k) => map.get(k) ?? null,
    setItem: (k, v) => void map.set(k, String(v)),
    removeItem: (k) => void map.delete(k),
    clear: () => map.clear(),
  };
}

const V2_FILE = JSON.stringify({
  format: 'lofiloop',
  version: 2,
  project: {
    id: 'prj_old',
    name: 'Old beat',
    bpm: 84,
    swing: 58,
    root: 2,
    scale: 'minor',
    tracks: [{ id: 't1', name: 'Kick', instrument: 'kick', volume: 0.8, pan: 0, mute: false, solo: false }],
    patterns: [
      {
        id: 'pA',
        name: 'A',
        length: 16,
        hits: {
          t1: [
            [0, 90],
            [8, 80],
          ],
        },
      },
      { id: 'pB', name: 'B', length: 16, hits: { t1: [[4, 70]] } },
    ],
    chain: ['pA', 'pA', 'pB'],
    createdAt: 1000,
    updatedAt: 2000,
  },
});

beforeEach(() => {
  closeStorage();
  vi.stubGlobal('indexedDB', new IDBFactory());
});

afterEach(() => {
  closeStorage();
  vi.unstubAllGlobals();
});

describe('projects', () => {
  it('saves, lists newest first, loads and deletes', async () => {
    const a = project('prj_a', 'Alpha', 1);
    const b = project('prj_b', 'Beta', 2);
    await saveProject(a);
    await saveProject(b);
    const list = await listProjects();
    expect(list.map((m) => m.name)).toEqual(['Beta', 'Alpha']);
    expect(list[0]).toMatchObject({
      id: 'prj_b',
      bpm: a.bpm,
      key: 'D minor',
      tracks: a.tracks.length,
      patterns: a.patterns.length,
      sections: a.arrangement.length,
      styles: b.meta.styles,
      coverSeed: b.meta.coverSeed,
    });
    expect(list[0].seconds).toBeGreaterThan(0);
    expect(await loadProject('prj_a')).toEqual(a);
    expect(await loadProject('missing')).toBeNull();

    await deleteProject('prj_a');
    expect((await listProjects()).map((m) => m.id)).toEqual(['prj_b']);
    expect(await loadProject('prj_a')).toBeNull();
    expect(storageAvailable()).toBe('indexeddb');
  });

  it('tracks the current project', async () => {
    await saveProject(project('prj_a', 'Alpha', 1));
    await saveProject(project('prj_b', 'Beta', 2), { makeCurrent: false });
    expect((await loadCurrentProject())?.id).toBe('prj_a');
    await setCurrentProject('prj_b');
    expect((await loadCurrentProject())?.id).toBe('prj_b');
    await deleteProject('prj_b');
    expect(await loadCurrentProject()).toBeNull();
  });

  it('duplicates under a new id without changing the current project', async () => {
    await saveProject(project('prj_a', 'Alpha', 1));
    const copy = await duplicateProject('prj_a');
    expect(copy?.id).not.toBe('prj_a');
    expect(copy?.name).toBe('Alpha (copy)');
    expect((await duplicateProject('prj_a', 'Remix'))?.name).toBe('Remix');
    expect(await duplicateProject('nope')).toBeNull();
    expect((await loadProject(copy!.id))?.patterns).toEqual((await loadProject('prj_a'))?.patterns);
    expect(await listProjects()).toHaveLength(3);
    expect((await loadCurrentProject())?.id).toBe('prj_a');
  });

  it('maps quota errors to a friendly StorageError', async () => {
    await initStorage();
    vi.spyOn(IDBObjectStore.prototype, 'put').mockImplementation(() => {
      throw new DOMException('The quota has been exceeded.', 'QuotaExceededError');
    });
    const error = await saveProject(project('prj_a', 'Alpha', 1)).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(StorageError);
    expect((error as StorageError).reason).toBe('quota');
    expect((error as StorageError).message).toMatch(/storage is full/i);
    vi.restoreAllMocks();
    // The failed transaction was rolled back as a whole.
    expect(await listProjects()).toEqual([]);
    expect(isQuotaError({ name: 'NS_ERROR_DOM_QUOTA_REACHED' })).toBe(true);
    expect(toStorageError(new Error('x'), 'save the beat').message).toBe('Could not save the beat in browser storage.');
  });

  it('keeps working after the database is deleted underneath it', async () => {
    await saveProject(project('prj_a', 'Alpha', 1));
    await new Promise<void>((resolve, reject) => {
      const req = indexedDB.deleteDatabase(DB_NAME);
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
    });
    expect(await listProjects()).toEqual([]);
    await saveProject(project('prj_b', 'Beta', 2));
    expect((await listProjects()).map((m) => m.id)).toEqual(['prj_b']);
  });
});

describe('migration from localStorage', () => {
  it('moves v2 projects into IndexedDB once and keeps prefs', async () => {
    const newer = project('prj_new', 'Newer', 3000);
    const legacy = memoryStorage({
      'lofiloop:v2:index': '[]',
      'lofiloop:v2:current': 'prj_old',
      'lofiloop:v2:project:prj_old': V2_FILE,
      'lofiloop:v2:project:prj_new': serializeProject(newer),
      'lofiloop:v2:project:broken': '{"nope":true}',
      'lofiloop:v2:prefs': '{"theme":"paper"}',
    });
    vi.stubGlobal('localStorage', legacy);

    expect(await initStorage()).toEqual({ migrated: 2 });
    expect((await listProjects()).map((m) => m.id)).toEqual(['prj_new', 'prj_old']);
    const old = await loadCurrentProject();
    expect(old?.id).toBe('prj_old');
    expect(old?.arrangement.map((s) => [s.patternId, s.repeats])).toEqual([
      ['pA', 2],
      ['pB', 1],
    ]);
    expect(await loadProject('prj_new')).toEqual(newer);

    // Legacy project keys are gone; prefs and unreadable entries stay.
    expect(legacy.getItem('lofiloop:v2:project:prj_old')).toBeNull();
    expect(legacy.getItem('lofiloop:v2:index')).toBeNull();
    expect(legacy.getItem('lofiloop:v2:current')).toBeNull();
    expect(legacy.getItem('lofiloop:v2:prefs')).toBe('{"theme":"paper"}');
    expect(legacy.getItem('lofiloop:v2:project:broken')).toBe('{"nope":true}');

    // Idempotent: repeated and fresh initialisations migrate nothing new.
    expect(await initStorage()).toEqual({ migrated: 2 });
    closeStorage();
    expect(await initStorage()).toEqual({ migrated: 0 });
    expect(await listProjects()).toHaveLength(2);
  });

  it('never overwrites a newer stored copy', async () => {
    const stored = project('prj_old', 'Edited since', 9000);
    await saveProject(stored);
    closeStorage();
    vi.stubGlobal('localStorage', memoryStorage({ 'lofiloop:v2:project:prj_old': V2_FILE }));
    expect(await initStorage()).toEqual({ migrated: 0 });
    expect((await loadProject('prj_old'))?.name).toBe('Edited since');
  });
});

describe('snapshots', () => {
  it('restores old state, lists newest first and renames', async () => {
    const v1 = project('prj_a', 'Alpha', 1);
    await saveProject(v1);
    const first = await saveSnapshot(v1, 'First idea');
    const v2 = { ...v1, bpm: 95, name: 'Alpha 2', updatedAt: 2 };
    await saveProject(v2);
    const auto = await saveSnapshot(v2, '');
    expect(first).toMatchObject({ projectId: 'prj_a', name: 'First idea', auto: false, bpm: v1.bpm });
    expect(auto).toMatchObject({ name: 'Auto-save', auto: true, bpm: 95 });

    expect((await listSnapshots('prj_a')).map((s) => s.id)).toEqual([auto.id, first.id]);
    expect(await loadSnapshot(first.id)).toEqual(v1);
    expect((await loadProject('prj_a'))?.bpm).toBe(95);

    await renameSnapshot(auto.id, 'Faster');
    expect((await listSnapshots('prj_a'))[0]).toMatchObject({ name: 'Faster', auto: false });
    await deleteSnapshot(first.id);
    expect((await listSnapshots('prj_a')).map((s) => s.id)).toEqual([auto.id]);
    expect(await loadSnapshot('nope')).toBeNull();
  });

  it(`keeps at most ${MAX_SNAPSHOTS}, dropping the oldest automatic ones first`, async () => {
    const p = project('prj_a', 'Alpha', 1);
    const named = await saveSnapshot(p, 'Keeper');
    const autos = [];
    for (let i = 0; i < MAX_SNAPSHOTS + 4; i++) autos.push(await saveSnapshot(p));
    const list = await listSnapshots('prj_a');
    expect(list).toHaveLength(MAX_SNAPSHOTS);
    const ids = new Set(list.map((s) => s.id));
    expect(ids.has(named.id)).toBe(true);
    expect(autos.slice(0, 5).some((s) => ids.has(s.id))).toBe(false);
    expect(ids.has(autos[autos.length - 1].id)).toBe(true);

    // With only named snapshots left, the oldest named one goes.
    const q = project('prj_q', 'Q', 1);
    const names = [];
    for (let i = 0; i <= MAX_SNAPSHOTS; i++) names.push(await saveSnapshot(q, `v${i}`));
    const qIds = (await listSnapshots('prj_q')).map((s) => s.id);
    expect(qIds).toHaveLength(MAX_SNAPSHOTS);
    expect(qIds).not.toContain(names[0].id);
  });

  it('are deleted with their project', async () => {
    const a = project('prj_a', 'Alpha', 1);
    const b = project('prj_b', 'Beta', 2);
    await saveProject(a);
    await saveProject(b);
    await saveSnapshot(a, 'one');
    await saveSnapshot(a, 'two');
    const keep = await saveSnapshot(b, 'other');
    await deleteProject('prj_a');
    expect(await listSnapshots('prj_a')).toEqual([]);
    expect((await listSnapshots('prj_b')).map((s) => s.id)).toEqual([keep.id]);
  });
});

describe('samples', () => {
  it('round-trips bytes, dedupes identical content and deletes', async () => {
    const meta = await saveSample({ name: 'dusty.wav', type: 'audio/wav', data: bytes(1, 2, 3, 250), duration: 1.5 });
    expect(meta).toMatchObject({ name: 'dusty.wav', type: 'audio/wav', size: 4, duration: 1.5 });
    expect(new Uint8Array((await loadSampleData(meta.id))!)).toEqual(new Uint8Array([1, 2, 3, 250]));

    const again = await saveSample({ name: 'copy.wav', type: 'audio/wav', data: bytes(1, 2, 3, 250) });
    expect(again.id).toBe(meta.id);
    const other = await saveSample({ name: 'other.mp3', type: 'audio/mpeg', data: bytes(9, 9) });
    expect(other.id).not.toBe(meta.id);
    expect((await listSamples()).map((s) => s.id)).toEqual([other.id, meta.id]);
    expect(await sampleUsage()).toEqual({ count: 2, bytes: 6 });

    await deleteSample(meta.id);
    expect(await loadSampleData(meta.id)).toBeNull();
    expect(await sampleUsage()).toEqual({ count: 1, bytes: 2 });
  });

  it('rejects files over the size limit', async () => {
    const error = await saveSample({
      name: 'huge.wav',
      type: 'audio/wav',
      data: new ArrayBuffer(MAX_SAMPLE_BYTES + 1),
    }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(StorageError);
    expect((error as StorageError).reason).toBe('too-large');
    expect(await listSamples()).toEqual([]);
  });
});

describe('bundles', () => {
  it('exports samples and restores them on a fresh database', async () => {
    const stored = await saveSample({ name: 'rhodes.wav', type: 'audio/wav', data: bytes(7, 8, 9), duration: 2 });
    const p = projectWithSample(stored.id);
    const blob = await exportBundle(p, { includeSamples: true });
    const text = await blob.text();
    expect(JSON.parse(text).samples).toEqual([
      { id: stored.id, name: 'rhodes.wav', type: 'audio/wav', data: 'BwgJ', duration: 2 },
    ]);
    expect(JSON.parse(await (await exportBundle(p, { includeSamples: false })).text()).samples).toBeUndefined();

    // Another device: a sample with the same id but different content already exists.
    closeStorage();
    vi.stubGlobal('indexedDB', new IDBFactory());
    await storeSample({ id: stored.id, name: 'unrelated.wav', type: 'audio/wav', data: bytes(1) });

    const { project: imported, samplesImported } = await importBundle(text);
    expect(samplesImported).toBe(1);
    const ref = imported.tracks.find((t) => t.sample)!.sample!;
    expect(ref.id).not.toBe(stored.id);
    expect(new Uint8Array((await loadSampleData(ref.id))!)).toEqual(new Uint8Array([7, 8, 9]));
    expect((await listSamples()).find((s) => s.id === ref.id)).toMatchObject({ name: 'rhodes.wav', duration: 2 });

    // Importing again reuses the stored content.
    expect((await importBundle(text)).samplesImported).toBe(0);
    expect((await sampleUsage()).count).toBe(2);
  });

  it('remaps sample ids to identical content that is already stored', async () => {
    const original = await saveSample({ name: 'loop.wav', type: 'audio/wav', data: bytes(4, 5, 6) });
    const text = await (await exportBundle(projectWithSample(original.id), { includeSamples: true })).text();
    const moved = text.replaceAll(original.id, 'smp_elsewhere');
    const { project: imported, samplesImported } = await importBundle(moved);
    expect(samplesImported).toBe(0);
    expect(imported.tracks.find((t) => t.sample)?.sample?.id).toBe(original.id);
  });

  it('accepts plain project files and rejects corrupt input clearly', async () => {
    const p = project('prj_a', 'Alpha', 1);
    expect(await importBundle(serializeProject(p))).toEqual({ project: p, samplesImported: 0 });
    await expect(importBundle('{oops')).rejects.toThrow(ProjectParseError);
    await expect(importBundle('{oops')).rejects.toThrow('not valid JSON');
    await expect(importBundle('{"format":"other"}')).rejects.toThrow(/Not a valid LofiLoop project/);
    const bad = JSON.stringify({ ...JSON.parse(serializeProject(p)), samples: [{ id: 'x', data: '***' }] });
    await expect(importBundle(bad)).rejects.toThrow(/corrupt/);
    expect(await listSamples()).toEqual([]);
  });
});

describe('memory fallback', () => {
  it('works without IndexedDB and leaves localStorage intact', async () => {
    vi.stubGlobal('indexedDB', undefined);
    const legacy = memoryStorage({ 'lofiloop:v2:project:prj_old': V2_FILE, 'lofiloop:v2:current': 'prj_old' });
    vi.stubGlobal('localStorage', legacy);

    expect(await initStorage()).toEqual({ migrated: 1 });
    expect(storageAvailable()).toBe('memory');
    expect((await loadCurrentProject())?.name).toBe('Old beat');
    expect(legacy.getItem('lofiloop:v2:project:prj_old')).toBe(V2_FILE);

    const p = project('prj_a', 'Alpha', 1);
    await saveProject(p);
    expect(await loadProject('prj_a')).toEqual(p);
    const snap = await saveSnapshot(p, 'mem');
    expect(await loadSnapshot(snap.id)).toEqual(p);
    const sample = await saveSample({ name: 's', type: 'audio/wav', data: bytes(1, 2) });
    expect(new Uint8Array((await loadSampleData(sample.id))!)).toEqual(new Uint8Array([1, 2]));
  });
});

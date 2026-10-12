/**
 * Durable, async storage for LofiLoop (IndexedDB with an in-memory fallback):
 * projects, version snapshots, uploaded samples and portable bundles.
 * UI preferences stay in localStorage (see src/lib/store/persistence.ts).
 */
export { closeStorage, initStorage, storageAvailable } from './connection';
export {
  deleteProject,
  duplicateProject,
  listProjects,
  loadCurrentProject,
  loadProject,
  saveProject,
  setCurrentProject,
} from './projects';
export { MAX_SNAPSHOTS, deleteSnapshot, listSnapshots, loadSnapshot, renameSnapshot, saveSnapshot } from './snapshots';
export {
  MAX_SAMPLE_BYTES,
  deleteSample,
  listSamples,
  loadSampleData,
  sampleUsage,
  saveSample,
  type SampleInput,
} from './samples';
export { exportBundle, importBundle, referencedSampleIds, type BundledSample } from './bundle';
export { estimateStorage, requestPersistentStorage } from './quota';
export { projectMeta } from './records';
export { StorageError, type ProjectMeta, type SampleMeta, type SnapshotMeta, type StorageErrorReason } from './types';

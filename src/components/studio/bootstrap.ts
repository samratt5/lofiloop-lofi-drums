/**
 * Client-only initialisation: opens the library (IndexedDB), restores the last
 * project, wires the audio engine to the store, keeps uploaded samples decoded
 * and autosaves changes.
 */
import { engine } from '@/lib/audio/engine';
import { loadDrumKit } from '@/lib/audio/drumkit';
import { createDemoProject } from '@/lib/project/templates';
import { parseProjectFile, serializeProject } from '@/lib/project/serialize';
import type { Project } from '@/lib/project/types';
import {
  initStorage,
  loadCurrentProject,
  requestPersistentStorage,
  saveProject,
  saveSnapshot,
  storageAvailable,
  StorageError,
} from '@/lib/storage/library';
import { hydrateSamples } from '@/lib/storage/hydrate';
import { registerServiceWorker } from '@/lib/pwa';
import { getProject, useStudio } from '@/lib/store/studio';
import { ui, useUi } from '@/lib/store/ui';

const AUTOSAVE_MS = 600;
let saveTimer: ReturnType<typeof setTimeout> | null = null;
let lastSaveError = 0;
let askedPersistence = false;
/** Saves run one after another so an older write can never land after a newer one. */
let queue: Promise<unknown> = Promise.resolve();
let inFlight = 0;

/**
 * IndexedDB writes are async, so one started as the tab closes can be cut off.
 * On the way out, the project is also written synchronously here and picked up
 * on the next start if the real save didn't make it.
 */
const BACKUP_KEY = 'lofiloop:v3:unsaved';

function writeBackup() {
  try {
    localStorage.setItem(BACKUP_KEY, serializeProject(getProject()));
  } catch {
    // Storage full or blocked: the async save is all we have.
  }
}

function clearBackup() {
  try {
    localStorage.removeItem(BACKUP_KEY);
  } catch {
    // Nothing to clear.
  }
}

function readBackup(): Project | null {
  try {
    const raw = localStorage.getItem(BACKUP_KEY);
    return raw ? parseProjectFile(raw) : null;
  } catch {
    clearBackup();
    return null;
  }
}

/**
 * Saves the current project. The project is captured synchronously, so callers
 * can replace it straight after calling this.
 */
export function saveNow(showToast = false): Promise<boolean> {
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = null;
  const project = getProject();
  inFlight += 1;
  const run = queue.then(async () => {
    try {
      await saveProject(project);
      if (getProject() === project) clearBackup();
      if (getProject().id === project.id) useUi.setState({ saveStatus: 'saved', savedAt: Date.now() });
      if (showToast) ui.toast('Saved to your library', 'success');
      if (!askedPersistence) {
        askedPersistence = true;
        void requestPersistentStorage();
      }
      return true;
    } catch (error) {
      useUi.setState({ saveStatus: 'error' });
      const now = Date.now();
      if (showToast || now - lastSaveError > 30000) {
        lastSaveError = now;
        ui.toast(error instanceof StorageError ? error.message : 'Could not save your beat.', 'error');
      }
      return false;
    } finally {
      inFlight -= 1;
    }
  });
  queue = run;
  return run;
}

function scheduleSave() {
  useUi.setState({ saveStatus: 'saving' });
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => void saveNow(), AUTOSAVE_MS);
}

let started: Promise<void> | null = null;

/** Resolves once the saved project is loaded. Safe to call more than once. */
export function bootstrap(): Promise<void> {
  if (typeof window === 'undefined') return Promise.resolve();
  started ??= start();
  return started;
}

async function start(): Promise<void> {
  engine.attach(getProject);
  engine.setMetronome(useUi.getState().metronome);

  // Load the sampled drum kit in the background. The drum voices fall back to
  // synthesis until it is ready, so a slow connection never stalls the studio.
  void loadDrumKit();

  let project: Project | null = null;
  try {
    const { migrated } = await initStorage();
    project = await loadCurrentProject();
    if (migrated > 0) ui.toast(`Moved ${migrated} beat${migrated === 1 ? '' : 's'} to the new library`, 'info');
  } catch (error) {
    ui.toast(error instanceof StorageError ? error.message : 'Could not open your library.', 'error');
  }
  if (storageAvailable() === 'memory') {
    ui.toast('This browser is blocking storage, so changes won’t be kept after you close the tab.', 'error');
  }

  // A save cut off by closing the tab last time wins over what's stored, if it's newer.
  const backup = readBackup();
  if (backup && backup.updatedAt >= (project?.updatedAt ?? 0)) project = backup;
  const recovered = backup !== null && project === backup;

  project ??= createDemoProject();
  useStudio.getState().load(project);
  useUi.setState({
    selectedTrackId: project.tracks[0]?.id ?? null,
    saveStatus: 'saved',
    savedAt: project.updatedAt,
  });
  void hydrateSamples(project);
  if (recovered) void saveNow();
  else clearBackup();

  useStudio.subscribe((state, prev) => {
    if (state.project === prev.project) return;
    engine.sync(state.project);
    if (state.project.tracks !== prev.project.tracks) void hydrateSamples(state.project);
    // A new project replaced the old one: persist immediately so the library is up to date.
    if (state.project.id !== prev.project.id) void saveNow();
    else scheduleSave();
  });

  // Keep an automatic version every ten minutes of editing.
  let snapshotted = project;
  setInterval(() => {
    const now = getProject();
    if (now === snapshotted || now.id !== snapshotted.id) {
      snapshotted = now;
      return;
    }
    snapshotted = now;
    void saveSnapshot(now, '', { auto: true }).catch(() => undefined);
  }, 10 * 60_000);

  const flush = () => {
    if (!saveTimer && inFlight === 0) return;
    writeBackup();
    if (saveTimer) void saveNow();
  };
  window.addEventListener('pagehide', flush);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') flush();
  });

  void registerServiceWorker({
    onUpdateReady: (apply) => ui.toast('A new version of LofiLoop is ready', 'info', { label: 'Reload', run: apply }),
  });
}

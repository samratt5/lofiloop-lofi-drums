/**
 * UI preferences, kept in localStorage so they apply before anything async runs.
 * Projects, snapshots and samples live in IndexedDB (see src/lib/storage).
 */
const PREFS_KEY = 'lofiloop:v2:prefs';

function storage(): Storage | null {
  try {
    return typeof window !== 'undefined' ? window.localStorage : null;
  } catch {
    return null;
  }
}

export function readPrefs<T extends object>(fallback: T): T {
  try {
    const raw = storage()?.getItem(PREFS_KEY);
    const prefs = raw ? (JSON.parse(raw) as Partial<T>) : {};
    return { ...fallback, ...(prefs && typeof prefs === 'object' ? prefs : {}) };
  } catch {
    return fallback;
  }
}

export function writePrefs(prefs: object): void {
  try {
    storage()?.setItem(PREFS_KEY, JSON.stringify(prefs));
  } catch {
    // Preferences are best-effort.
  }
}

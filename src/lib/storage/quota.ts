/** Storage quota and persistence (StorageManager), when the browser exposes it. */

function manager(): StorageManager | null {
  return typeof navigator !== 'undefined' && navigator.storage ? navigator.storage : null;
}

/** Bytes used and available for this origin, or null when unknown. */
export async function estimateStorage(): Promise<{ usage: number; quota: number } | null> {
  const storage = manager();
  if (!storage?.estimate) return null;
  try {
    const { usage, quota } = await storage.estimate();
    return { usage: usage ?? 0, quota: quota ?? 0 };
  } catch {
    return null;
  }
}

/** Ask the browser not to evict our data under storage pressure. Resolves true if granted. */
export async function requestPersistentStorage(): Promise<boolean> {
  const storage = manager();
  if (!storage?.persist) return false;
  try {
    if (storage.persisted && (await storage.persisted())) return true;
    return await storage.persist();
  } catch {
    return false;
  }
}

/** Short, URL-safe, collision-resistant id for projects, tracks and patterns. */
export function createId(prefix = ''): string {
  const bytes = new Uint8Array(8);
  globalThis.crypto.getRandomValues(bytes);
  let id = '';
  for (const b of bytes) id += (b % 36).toString(36);
  return prefix ? `${prefix}_${id}` : id;
}

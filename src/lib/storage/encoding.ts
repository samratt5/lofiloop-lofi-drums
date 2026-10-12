/** Hashing and base64 helpers for binary sample data. */

const hex = (bytes: Uint8Array) => Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');

/** Two 32-bit FNV-1a lanes with different seeds; used only when crypto.subtle is missing (insecure contexts). */
function fnv64(bytes: Uint8Array): string {
  let a = 0x811c9dc5;
  let b = 0x01000193 ^ 0x5bd1e995;
  for (const byte of bytes) {
    a = Math.imul(a ^ byte, 0x01000193);
    b = Math.imul(b ^ byte, 0x01000193) ^ (b >>> 15);
  }
  return (a >>> 0).toString(16).padStart(8, '0') + (b >>> 0).toString(16).padStart(8, '0');
}

/** Content hash of `data`: "sha256:<hex>" (or "fnv64:<hex>:<size>" without WebCrypto). */
export async function hashBytes(data: ArrayBuffer): Promise<string> {
  const subtle = globalThis.crypto?.subtle;
  if (subtle) return `sha256:${hex(new Uint8Array(await subtle.digest('SHA-256', data)))}`;
  return `fnv64:${fnv64(new Uint8Array(data))}:${data.byteLength}`;
}

const CHUNK = 0x8000;

export function bytesToBase64(data: ArrayBuffer): string {
  const bytes = new Uint8Array(data);
  let binary = '';
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(binary);
}

/** Decode base64 to bytes. Throws on malformed input. */
export function base64ToBytes(text: string): ArrayBuffer {
  const binary = atob(text.replace(/\s+/g, ''));
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes.buffer;
}

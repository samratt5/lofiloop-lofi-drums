/** Share links: the compact project file, deflated and base64url-encoded into the URL hash. */
import { parseProjectFile, toProjectFile } from './serialize';
import type { Project } from './types';

export const SHARE_PARAM = 'beat';

function toBase64Url(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromBase64Url(text: string): Uint8Array {
  const base64 = text.replace(/-/g, '+').replace(/_/g, '/');
  const padded = base64 + '='.repeat((4 - (base64.length % 4)) % 4);
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

async function transform(bytes: Uint8Array, stream: CompressionStream | DecompressionStream): Promise<Uint8Array> {
  const response = new Response(new Blob([bytes as Uint8Array<ArrayBuffer>]).stream().pipeThrough(stream));
  return new Uint8Array(await response.arrayBuffer());
}

export async function encodeShareData(project: Project): Promise<string> {
  const file = toProjectFile(project);
  // Share links always open as a new copy, so identity and timestamps are dropped (undefined isn't serialised).
  const compact = { ...file, project: { ...file.project, id: undefined, createdAt: undefined, updatedAt: undefined } };
  const json = new TextEncoder().encode(JSON.stringify(compact));
  const compressed = await transform(json, new CompressionStream('deflate-raw'));
  return toBase64Url(compressed);
}

export async function decodeShareData(data: string): Promise<Project> {
  const compressed = fromBase64Url(data.trim());
  const json = new TextDecoder().decode(await transform(compressed, new DecompressionStream('deflate-raw')));
  return parseProjectFile(json);
}

export async function createShareUrl(project: Project, base: string): Promise<string> {
  const url = new URL(base);
  url.hash = `${SHARE_PARAM}=${await encodeShareData(project)}`;
  url.search = '';
  return url.toString();
}

/** Returns the encoded payload if the hash holds a shared beat. */
export function readShareHash(hash: string): string | null {
  const params = new URLSearchParams(hash.replace(/^#/, ''));
  return params.get(SHARE_PARAM);
}

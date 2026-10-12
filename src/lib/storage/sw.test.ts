/** Loads public/sw.js into a mocked ServiceWorkerGlobalScope and checks its routing decisions. */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const ORIGIN = 'https://lofi.test';
const SOURCE = readFileSync(resolve(process.cwd(), 'public/sw.js'), 'utf8');

interface FakeRequest {
  url: string;
  method: string;
  mode: string;
  headers: Headers;
}

type Key = string | FakeRequest;

const urlOf = (key: Key) => new URL(typeof key === 'string' ? key : key.url, ORIGIN);
const cacheKey = (key: Key, ignoreSearch = false) => {
  const url = urlOf(key);
  return ignoreSearch ? url.origin + url.pathname : url.href;
};

class MockCache {
  entries = new Map<string, Response>();
  async match(key: Key, opts?: { ignoreSearch?: boolean }) {
    for (const [stored, response] of this.entries) {
      if (cacheKey(stored, opts?.ignoreSearch) === cacheKey(key, opts?.ignoreSearch)) return response.clone();
    }
    return undefined;
  }
  async put(key: Key, response: Response) {
    this.entries.set(cacheKey(key), response);
  }
  async keys() {
    return [...this.entries.keys()];
  }
  async delete(key: Key) {
    return this.entries.delete(cacheKey(key));
  }
}

class MockCacheStorage {
  stores = new Map<string, MockCache>();
  async open(name: string) {
    if (!this.stores.has(name)) this.stores.set(name, new MockCache());
    return this.stores.get(name)!;
  }
  async keys() {
    return [...this.stores.keys()];
  }
  async delete(name: string) {
    return this.stores.delete(name);
  }
  async match(key: Key, opts?: { ignoreSearch?: boolean }) {
    for (const cache of this.stores.values()) {
      const hit = await cache.match(key, opts);
      if (hit) return hit;
    }
    return undefined;
  }
  async body(name: string, url: string) {
    return (await this.stores.get(name)?.match(url))?.text();
  }
}

/** A same-origin network response ('basic', like a real SW fetch). */
function basic(body: string, init: ResponseInit = {}) {
  const response = new Response(body, { status: 200, ...init });
  Object.defineProperty(response, 'type', { value: 'basic' });
  return response;
}

function request(path: string, init: Partial<Omit<FakeRequest, 'headers'>> & { headers?: HeadersInit } = {}) {
  return {
    url: new URL(path, ORIGIN).href,
    method: init.method ?? 'GET',
    mode: init.mode ?? 'cors',
    headers: new Headers(init.headers),
  };
}

type Listener = (event: Record<string, unknown>) => void;

function loadWorker() {
  const listeners = new Map<string, Listener>();
  const caches = new MockCacheStorage();
  const network = vi.fn<(input: Key, init?: RequestInit) => Promise<Response>>();
  const self = {
    location: new URL(ORIGIN),
    addEventListener: (type: string, fn: Listener) => listeners.set(type, fn),
    skipWaiting: vi.fn(async () => undefined),
    clients: { claim: vi.fn(async () => undefined) },
    registration: { navigationPreload: { enable: vi.fn(async () => undefined) } },
  };
  new Function('self', 'caches', 'fetch', SOURCE)(self, caches, network);

  /** Dispatch a lifecycle event and wait for everything it extended. */
  async function extendable(type: string, extra: Record<string, unknown> = {}) {
    const waits: Promise<unknown>[] = [];
    listeners.get(type)!({ ...extra, waitUntil: (p: Promise<unknown>) => waits.push(p) });
    for (let i = 0; i < waits.length; i++) await waits[i];
  }

  /** Dispatch a fetch event; `response` is undefined when the worker did not call respondWith. */
  async function dispatchFetch(req: FakeRequest) {
    const waits: Promise<unknown>[] = [];
    let responded: Promise<Response> | undefined;
    listeners.get('fetch')!({
      request: req,
      respondWith: (p: Promise<Response>) => (responded = Promise.resolve(p)),
      waitUntil: (p: Promise<unknown>) => waits.push(p),
    });
    const response = responded ? await responded : undefined;
    for (let i = 0; i < waits.length; i++) await waits[i];
    return response;
  }

  return { self, caches, network, extendable, dispatchFetch };
}

let sw: ReturnType<typeof loadWorker>;

beforeEach(() => {
  sw = loadWorker();
});

describe('service worker', () => {
  it('precaches the shell on install, tolerating missing files', async () => {
    sw.network.mockImplementation(async (input) =>
      String(input) === '/icon.svg' ? new Response('', { status: 404 }) : basic(`body of ${String(input)}`),
    );
    await sw.extendable('install');
    const [name] = await sw.caches.keys();
    expect(name).toMatch(/^lofiloop-precache-/);
    expect(await sw.caches.body(name, '/')).toBe('body of /');
    expect(await sw.caches.body(name, '/manifest.webmanifest')).toBe('body of /manifest.webmanifest');
    expect(await sw.caches.body(name, '/icon.svg')).toBeUndefined();
    expect(sw.network).toHaveBeenCalledWith('/', expect.objectContaining({ cache: 'reload' }));
  });

  it('serves hashed static assets cache-first', async () => {
    sw.network.mockResolvedValue(basic('console.log(1)'));
    const asset = request('/_next/static/chunks/app-123.js');
    expect(await (await sw.dispatchFetch(asset))!.text()).toBe('console.log(1)');
    sw.network.mockRejectedValue(new TypeError('offline'));
    expect(await (await sw.dispatchFetch(asset))!.text()).toBe('console.log(1)');
    expect(sw.network).toHaveBeenCalledTimes(1);
  });

  it('loads pages network-first and falls back to the cache offline', async () => {
    sw.network.mockResolvedValue(basic('<html>fresh</html>', { headers: { 'Cache-Control': 'no-store' } }));
    const page = request('/', { mode: 'navigate' });
    expect(await (await sw.dispatchFetch(page))!.text()).toBe('<html>fresh</html>');

    sw.network.mockResolvedValue(basic('<html>newer</html>'));
    expect(await (await sw.dispatchFetch(page))!.text()).toBe('<html>newer</html>');

    sw.network.mockRejectedValue(new TypeError('offline'));
    expect(await (await sw.dispatchFetch(page))!.text()).toBe('<html>newer</html>');
    // Unvisited URLs (e.g. share links) get the app shell.
    const shared = await sw.dispatchFetch(request('/?s=abc', { mode: 'navigate' }));
    expect(await shared!.text()).toBe('<html>newer</html>');
  });

  it('shows an offline page when nothing is cached', async () => {
    sw.network.mockRejectedValue(new TypeError('offline'));
    const response = await sw.dispatchFetch(request('/', { mode: 'navigate' }));
    expect(response!.status).toBe(503);
    expect(await response!.text()).toMatch(/offline/i);
  });

  it('revalidates other same-origin GETs in the background', async () => {
    sw.network.mockResolvedValue(basic('v1'));
    const file = request('/apple-icon');
    expect(await (await sw.dispatchFetch(file))!.text()).toBe('v1');
    sw.network.mockResolvedValue(basic('v2'));
    expect(await (await sw.dispatchFetch(file))!.text()).toBe('v1');
    expect(await (await sw.dispatchFetch(file))!.text()).toBe('v2');
  });

  it('leaves non-GET, cross-origin, range and worker-script requests alone', async () => {
    sw.network.mockResolvedValue(basic('x'));
    expect(await sw.dispatchFetch(request('/api/save', { method: 'POST' }))).toBeUndefined();
    expect(await sw.dispatchFetch(request('https://cdn.example.com/lib.js'))).toBeUndefined();
    expect(await sw.dispatchFetch(request('https://evil.test/', { mode: 'navigate' }))).toBeUndefined();
    expect(await sw.dispatchFetch(request('/audio.mp3', { headers: { Range: 'bytes=0-' } }))).toBeUndefined();
    expect(await sw.dispatchFetch(request('/sw.js'))).toBeUndefined();
    expect(sw.network).not.toHaveBeenCalled();
    expect(await sw.caches.keys()).toEqual([]);
  });

  it('does not store no-store responses outside navigations', async () => {
    sw.network.mockResolvedValue(basic('secret', { headers: { 'Cache-Control': 'no-store' } }));
    await sw.dispatchFetch(request('/data.json'));
    expect(await sw.caches.match('/data.json')).toBeUndefined();
  });

  it('removes old caches on activate and supports SKIP_WAITING', async () => {
    await sw.caches.open('lofiloop-static-v0');
    await sw.caches.open('someone-else');
    sw.network.mockResolvedValue(basic('ok'));
    await sw.extendable('install');
    await sw.extendable('activate');
    expect(await sw.caches.keys()).toEqual(['someone-else', expect.stringMatching(/^lofiloop-precache-/)]);
    expect(sw.self.clients.claim).toHaveBeenCalled();
    expect(sw.self.registration.navigationPreload.enable).toHaveBeenCalled();

    await sw.extendable('message', { data: { type: 'OTHER' } });
    expect(sw.self.skipWaiting).not.toHaveBeenCalled();
    await sw.extendable('message', { data: { type: 'SKIP_WAITING' } });
    expect(sw.self.skipWaiting).toHaveBeenCalled();
  });
});

/** Tests for src/lib/pwa.ts with a mocked navigator.serviceWorker and window. */
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  canInstall,
  isStandalone,
  listenForInstallPrompt,
  onInstallAvailabilityChange,
  promptInstall,
  registerServiceWorker,
} from '@/lib/pwa';

class Emitter extends EventTarget {}

function setup({ waiting = false, controlled = true } = {}) {
  const container = new Emitter() as Emitter & Record<string, unknown>;
  const waitingWorker = { postMessage: vi.fn(), scriptURL: 'https://x/sw.js' };
  const registration = Object.assign(new Emitter(), {
    waiting: waiting ? waitingWorker : null,
    installing: null,
    update: vi.fn(async () => undefined),
    unregister: vi.fn(async () => true),
    active: { scriptURL: 'https://x/sw.js' },
  });
  Object.assign(container, {
    controller: controlled ? {} : null,
    register: vi.fn(async () => registration),
    getRegistrations: vi.fn(async () => [registration]),
  });
  const reload = vi.fn();
  const win = Object.assign(new Emitter(), { location: { reload }, matchMedia: () => ({ matches: false }) });
  vi.stubGlobal('window', win);
  vi.stubGlobal('navigator', { serviceWorker: container });
  vi.stubGlobal('document', Object.assign(new Emitter(), { visibilityState: 'visible' }));
  return { container, registration, waitingWorker, reload, win };
}

afterEach(() => vi.unstubAllGlobals());

describe('registerServiceWorker', () => {
  it('offers a waiting update and reloads once after it takes control', async () => {
    const { container, waitingWorker, reload } = setup({ waiting: true });
    const onUpdateReady = vi.fn();
    await registerServiceWorker({ enabled: true, onUpdateReady });
    expect(container.register).toHaveBeenCalledWith('/sw.js', { scope: '/', updateViaCache: 'none' });
    expect(onUpdateReady).toHaveBeenCalledTimes(1);

    const apply = onUpdateReady.mock.calls[0][0] as () => void;
    apply();
    expect(waitingWorker.postMessage).toHaveBeenCalledWith({ type: 'SKIP_WAITING' });
    container.dispatchEvent(new Event('controllerchange'));
    container.dispatchEvent(new Event('controllerchange'));
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it('does not prompt on the first install', async () => {
    setup({ waiting: true, controlled: false });
    const onUpdateReady = vi.fn();
    await registerServiceWorker({ enabled: true, onUpdateReady });
    expect(onUpdateReady).not.toHaveBeenCalled();
  });

  it('unregisters leftover workers when disabled (development)', async () => {
    const { container, registration } = setup();
    await registerServiceWorker({ enabled: false });
    expect(container.register).not.toHaveBeenCalled();
    expect(registration.unregister).toHaveBeenCalled();
  });
});

describe('install prompt', () => {
  it('captures beforeinstallprompt and prompts once', async () => {
    const { win } = setup();
    listenForInstallPrompt();
    const changes: boolean[] = [];
    const off = onInstallAvailabilityChange((available) => changes.push(available));
    expect(canInstall()).toBe(false);
    expect(await promptInstall()).toBe('unavailable');

    const event = Object.assign(new Event('beforeinstallprompt', { cancelable: true }), {
      prompt: vi.fn(async () => undefined),
      userChoice: Promise.resolve({ outcome: 'accepted' as const, platform: 'web' }),
    });
    win.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true);
    expect(canInstall()).toBe(true);
    expect(await promptInstall()).toBe('accepted');
    expect(event.prompt).toHaveBeenCalled();
    expect(canInstall()).toBe(false);
    expect(changes).toEqual([true, false]);
    off();
    expect(isStandalone()).toBe(false);
  });
});

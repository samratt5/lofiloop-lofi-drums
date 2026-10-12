/**
 * Progressive web app helpers: service worker registration with update
 * prompts, and the install prompt (`beforeinstallprompt`).
 */

export const SERVICE_WORKER_URL = '/sw.js';

/** Chromium's install prompt event (not in the DOM typings). */
interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>;
  readonly userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform: string }>;
}

export interface RegisterOptions {
  /** Called when a new version is installed and waiting; `apply` activates it and reloads the page once. */
  onUpdateReady?: (apply: () => void) => void;
  /** Defaults to production builds only; in development any registered worker is removed instead. */
  enabled?: boolean;
}

const isBrowser = () => typeof window !== 'undefined' && typeof navigator !== 'undefined';

/**
 * Register `/sw.js`. No-op outside production or without service worker support.
 * Never throws: registration failures are logged.
 */
export async function registerServiceWorker({
  onUpdateReady,
  enabled = process.env.NODE_ENV === 'production',
}: RegisterOptions = {}): Promise<void> {
  if (!isBrowser() || !('serviceWorker' in navigator)) return;
  const container = navigator.serviceWorker;
  try {
    if (!enabled) {
      // A worker left over from a production run would serve stale dev bundles.
      const registrations = await container.getRegistrations();
      await Promise.all(
        registrations
          .filter((r) => (r.active ?? r.waiting ?? r.installing)?.scriptURL.endsWith(SERVICE_WORKER_URL))
          .map((r) => r.unregister()),
      );
      return;
    }

    const registration = await container.register(SERVICE_WORKER_URL, { scope: '/', updateViaCache: 'none' });
    let notified: ServiceWorker | null = null;
    const notify = (worker: ServiceWorker) => {
      // Only an update needs a prompt: the first install takes control on its own.
      if (!container.controller || notified === worker) return;
      notified = worker;
      onUpdateReady?.(() => applyUpdate(worker));
    };

    if (registration.waiting) notify(registration.waiting);
    registration.addEventListener('updatefound', () => {
      const worker = registration.installing;
      if (!worker) return;
      worker.addEventListener('statechange', () => {
        if (worker.state === 'installed') notify(worker);
      });
    });

    // Look for new deploys when the tab comes back into view (at most every 30 minutes).
    let lastCheck = Date.now();
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState !== 'visible' || Date.now() - lastCheck < 30 * 60 * 1000) return;
      lastCheck = Date.now();
      registration.update().catch(() => undefined);
    });
  } catch (error) {
    console.warn('Service worker registration failed', error);
  }
}

let reloading = false;

/** Activate a waiting worker and reload once it controls the page. */
function applyUpdate(worker: ServiceWorker): void {
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (reloading) return;
    reloading = true;
    window.location.reload();
  });
  worker.postMessage({ type: 'SKIP_WAITING' });
}

// ---------------------------------------------------------------------------
// Install prompt

let deferredPrompt: BeforeInstallPromptEvent | null = null;
let listening = false;
const installListeners = new Set<(available: boolean) => void>();

function setPrompt(event: BeforeInstallPromptEvent | null): void {
  deferredPrompt = event;
  for (const listener of installListeners) listener(event !== null);
}

/**
 * Start capturing `beforeinstallprompt`. Runs automatically when this module
 * loads in a browser; import it early so the event is not missed.
 */
export function listenForInstallPrompt(): void {
  if (listening || !isBrowser()) return;
  listening = true;
  window.addEventListener('beforeinstallprompt', (event) => {
    event.preventDefault();
    setPrompt(event as BeforeInstallPromptEvent);
  });
  window.addEventListener('appinstalled', () => setPrompt(null));
}

listenForInstallPrompt();

/** True when the browser has offered to install the app and the prompt is still unused. */
export function canInstall(): boolean {
  return deferredPrompt !== null;
}

/** Subscribe to install availability changes (useSyncExternalStore-friendly). Returns an unsubscribe. */
export function onInstallAvailabilityChange(listener: (available: boolean) => void): () => void {
  installListeners.add(listener);
  return () => {
    installListeners.delete(listener);
  };
}

/** Show the browser's install dialog. The prompt can be used once. */
export async function promptInstall(): Promise<'accepted' | 'dismissed' | 'unavailable'> {
  const event = deferredPrompt;
  if (!event) return 'unavailable';
  setPrompt(null);
  try {
    await event.prompt();
    return (await event.userChoice).outcome;
  } catch {
    return 'dismissed';
  }
}

/** Running as an installed app (standalone window), including iOS home-screen apps. */
export function isStandalone(): boolean {
  if (!isBrowser()) return false;
  const media = typeof window.matchMedia === 'function' ? window.matchMedia('(display-mode: standalone)') : null;
  return Boolean(media?.matches) || (navigator as Navigator & { standalone?: boolean }).standalone === true;
}

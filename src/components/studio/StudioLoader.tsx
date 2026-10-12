'use client';

import dynamic from 'next/dynamic';
import { Logo } from './Logo';

function Splash() {
  return (
    <div className="bg-bg text-fg flex h-dvh flex-col items-center justify-center gap-4" role="status">
      <Logo className="size-12 animate-pulse" />
      <p className="text-fg-muted text-sm">Warming up the tape deck…</p>
    </div>
  );
}

/**
 * The studio relies on Web Audio and IndexedDB, so it only renders in the
 * browser, and only once the last project has been read back from the library.
 */
export const StudioLoader = dynamic(
  async () => {
    const [{ bootstrap }, studio] = await Promise.all([import('./bootstrap'), import('./Studio')]);
    await bootstrap();
    return studio;
  },
  { ssr: false, loading: Splash },
);

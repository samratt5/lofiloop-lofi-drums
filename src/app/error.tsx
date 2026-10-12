'use client';

import { useEffect } from 'react';
import { RotateCcw } from 'lucide-react';

export default function Error({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <main className="bg-bg text-fg flex h-dvh flex-col items-center justify-center gap-4 px-6 text-center">
      <h1 className="text-xl font-semibold">Something went off-beat</h1>
      <p className="text-fg-muted max-w-md text-sm">
        LofiLoop hit an unexpected error. Your beats are saved in this browser, so reloading is safe.
      </p>
      <div className="flex gap-2">
        <button
          type="button"
          onClick={reset}
          className="bg-accent text-accent-fg inline-flex h-9 items-center gap-2 rounded-lg px-4 text-sm font-semibold"
        >
          <RotateCcw className="size-4" /> Try again
        </button>
        <button
          type="button"
          onClick={() => window.location.reload()}
          className="bg-surface-3 h-9 rounded-lg px-4 text-sm font-medium"
        >
          Reload
        </button>
      </div>
      {error.digest && <p className="text-fg-subtle font-mono text-xs">Error ID: {error.digest}</p>}
    </main>
  );
}

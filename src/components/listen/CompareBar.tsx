'use client';

import { useEffect } from 'react';
import { ArrowLeftRight, X } from 'lucide-react';
import { setCompareSide, stopCompare, toggleCompareSide, useCompare } from '@/lib/compare';
import { IconButton } from '@/components/ui/Button';
import { cn } from '@/lib/utils/cn';

function Side({ id, label, active }: { id: 'A' | 'B'; label: string; active: boolean }) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={() => setCompareSide(id)}
      className={cn(
        'flex h-8 min-w-0 items-center gap-2 rounded-lg px-3 text-sm transition-colors',
        active ? 'bg-accent text-accent-fg font-semibold' : 'text-fg-muted hover:bg-surface-3',
      )}
    >
      <span className="font-mono font-bold">{id}</span>
      <span className="truncate">{label}</span>
    </button>
  );
}

/** Shown while A/B comparing the open beat against a saved version. Tab flips sides. */
export function CompareBar() {
  const other = useCompare((s) => s.other);
  const name = useCompare((s) => s.otherName);
  const side = useCompare((s) => s.side);

  useEffect(() => {
    if (!other) return;
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (target?.closest('input, textarea, select, [contenteditable="true"]')) return;
      if (e.key === 'Tab' && !e.metaKey && !e.ctrlKey && !e.altKey) {
        e.preventDefault();
        toggleCompareSide();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [other]);

  if (!other) return null;

  return (
    <div
      role="region"
      aria-label="A/B compare"
      className="border-line bg-surface flex shrink-0 items-center gap-2 border-t px-3 py-1.5"
    >
      <ArrowLeftRight className="text-fg-subtle size-4 shrink-0" />
      <div className="bg-surface-2 flex min-w-0 items-center gap-1 rounded-xl p-1">
        <Side id="A" label="Now" active={side === 'A'} />
        <Side id="B" label={name} active={side === 'B'} />
      </div>
      <span className="text-fg-subtle hidden text-xs sm:inline">Press Tab to flip. Edits always apply to A.</span>
      <IconButton label="Stop comparing" size="sm" className="ml-auto" onClick={stopCompare} tip="top">
        <X />
      </IconButton>
    </div>
  );
}

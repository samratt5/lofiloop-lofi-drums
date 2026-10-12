'use client';

import { useCallback, useState } from 'react';
import { History } from 'lucide-react';
import { actions, useStudio } from '@/lib/store/studio';
import { IconButton } from '@/components/ui/Button';
import { Popover } from '@/components/ui/Popover';
import { formatRelativeTime } from '@/lib/utils/format';
import { cn } from '@/lib/utils/cn';

/** Every labelled edit, oldest first; click one to jump the project back (or forward) to it. */
export function HistoryMenu() {
  const [anchor, setAnchor] = useState<{ x: number; y: number } | null>(null);
  const past = useStudio((s) => s.past);
  const future = useStudio((s) => s.future);
  const close = useCallback(() => setAnchor(null), []);

  return (
    <>
      <IconButton
        label="Edit history"
        aria-haspopup="dialog"
        aria-expanded={Boolean(anchor)}
        disabled={!past.length && !future.length}
        onClick={(e) => {
          const r = e.currentTarget.getBoundingClientRect();
          setAnchor(anchor ? null : { x: r.left + r.width / 2 - 60, y: r.bottom });
        }}
      >
        <History />
      </IconButton>
      {anchor && (
        <Popover anchor={anchor} onClose={close} label="Edit history" className="w-72 p-1.5">
          <p className="text-fg-subtle px-2 pt-1 pb-2 text-[10px] font-semibold tracking-widest uppercase">
            History · {past.length} step{past.length === 1 ? '' : 's'}
          </p>
          <ol className="flex max-h-80 flex-col overflow-y-auto">
            <li>
              <button
                type="button"
                onClick={() => actions.travel(-past.length)}
                disabled={!past.length}
                className="text-fg-muted hover:bg-surface-3 w-full rounded-md px-2 py-1.5 text-left text-xs disabled:opacity-40"
              >
                Opened beat
              </button>
            </li>
            {past.map((entry, i) => (
              <li key={`p${i}`}>
                <button
                  type="button"
                  onClick={() => actions.travel(i + 1 - past.length)}
                  className={cn(
                    'hover:bg-surface-3 flex w-full items-center justify-between gap-2 rounded-md px-2 py-1.5 text-left text-xs',
                    i === past.length - 1 ? 'bg-accent-soft text-accent font-semibold' : 'text-fg',
                  )}
                  aria-current={i === past.length - 1 ? 'step' : undefined}
                >
                  <span className="truncate">{entry.label}</span>
                  <span className="text-fg-subtle shrink-0 text-[10px]">{formatRelativeTime(entry.at)}</span>
                </button>
              </li>
            ))}
            {future.map((entry, i) => (
              <li key={`f${i}`}>
                <button
                  type="button"
                  onClick={() => actions.travel(i + 1)}
                  className="text-fg-subtle hover:bg-surface-3 flex w-full items-center justify-between gap-2 rounded-md px-2 py-1.5 text-left text-xs italic"
                >
                  <span className="truncate">{entry.label}</span>
                  <span className="shrink-0 text-[10px]">undone</span>
                </button>
              </li>
            ))}
          </ol>
        </Popover>
      )}
    </>
  );
}

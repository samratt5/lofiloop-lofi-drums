'use client';

import { useCallback, useState } from 'react';
import { NOTE_NAMES, SCALES, SCALE_IDS } from '@/lib/music/theory';
import { actions, useStudio } from '@/lib/store/studio';
import { Popover } from '@/components/ui/Popover';
import { cn } from '@/lib/utils/cn';

export function KeyControl() {
  const root = useStudio((s) => s.project.root);
  const scale = useStudio((s) => s.project.scale);
  const [anchor, setAnchor] = useState<{ x: number; y: number } | null>(null);
  const [transpose, setTranspose] = useState(true);
  const close = useCallback(() => setAnchor(null), []);

  return (
    <>
      <button
        type="button"
        aria-haspopup="dialog"
        aria-expanded={Boolean(anchor)}
        onClick={(e) => {
          const r = e.currentTarget.getBoundingClientRect();
          setAnchor(anchor ? null : { x: r.left + r.width / 2, y: r.bottom });
        }}
        className="bg-surface-2 hover:bg-surface-3 flex h-9 flex-col items-start justify-center rounded-lg px-2.5"
      >
        <span className="text-fg-subtle text-[9px] leading-none font-semibold tracking-widest uppercase">Key</span>
        <span className="text-sm leading-tight font-semibold whitespace-nowrap">
          {NOTE_NAMES[root]} <span className="text-fg-muted font-normal">{SCALES[scale].label.toLowerCase()}</span>
        </span>
      </button>
      {anchor && (
        <Popover anchor={anchor} onClose={close} label="Key and scale" className="w-72">
          <p className="text-fg-subtle mb-2 text-[10px] font-semibold tracking-widest uppercase">Root</p>
          <div className="grid grid-cols-6 gap-1">
            {NOTE_NAMES.map((name, i) => (
              <button
                key={name}
                type="button"
                aria-pressed={i === root}
                onClick={() => actions.setKey(i, scale, transpose)}
                className={cn(
                  'h-8 rounded-md font-mono text-xs font-semibold transition-colors',
                  i === root ? 'bg-accent text-accent-fg' : 'bg-surface-3 hover:bg-line-strong',
                  name.includes('#') && i !== root && 'text-fg-muted',
                )}
              >
                {name}
              </button>
            ))}
          </div>
          <p className="text-fg-subtle mt-3 mb-2 text-[10px] font-semibold tracking-widest uppercase">Scale</p>
          <div className="grid grid-cols-2 gap-1">
            {SCALE_IDS.map((id) => (
              <button
                key={id}
                type="button"
                aria-pressed={id === scale}
                onClick={() => actions.setKey(root, id, transpose)}
                className={cn(
                  'h-8 rounded-md px-2 text-left text-xs font-medium transition-colors',
                  id === scale ? 'bg-accent-soft text-accent' : 'hover:bg-surface-3',
                )}
              >
                {SCALES[id].label}
              </button>
            ))}
          </div>
          <label className="text-fg-muted mt-3 flex items-center gap-2 text-xs">
            <input
              type="checkbox"
              checked={transpose}
              onChange={(e) => setTranspose(e.target.checked)}
              className="size-3.5 accent-[var(--accent)]"
            />
            Move existing notes to the new key
          </label>
        </Popover>
      )}
    </>
  );
}

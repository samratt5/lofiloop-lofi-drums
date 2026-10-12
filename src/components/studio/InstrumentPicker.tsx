'use client';

import {
  CATEGORY_LABELS,
  INSTRUMENT_LIST,
  type InstrumentCategory,
  type InstrumentId,
} from '@/lib/project/instruments';
import { cn } from '@/lib/utils/cn';

export function InstrumentBadge({
  id,
  className,
  onClick,
}: {
  id: InstrumentId;
  className?: string;
  onClick?: () => void;
}) {
  const def = INSTRUMENT_LIST.find((i) => i.id === id)!;
  const Tag = onClick ? 'button' : 'span';
  return (
    <Tag
      {...(onClick
        ? { type: 'button' as const, onClick, 'aria-label': `Preview ${def.name}`, title: `Preview ${def.name}` }
        : {})}
      className={cn(
        'inline-flex h-6 min-w-9 shrink-0 items-center justify-center rounded-md px-1 font-mono text-[10px] font-bold tracking-wide text-black/80 transition-transform',
        onClick && 'hover:scale-105 active:scale-95',
        className,
      )}
      style={{ background: def.color }}
    >
      {def.short}
    </Tag>
  );
}

const ORDER: InstrumentCategory[] = ['drums', 'bass', 'keys', 'band', 'synth', 'fx', 'sampler'];

export function InstrumentPicker({
  value,
  onSelect,
  disabled,
}: {
  value?: InstrumentId;
  onSelect: (id: InstrumentId) => void;
  disabled?: boolean;
}) {
  return (
    <div className="-mr-2 flex max-h-[min(64vh,520px)] flex-col gap-3 overflow-y-auto overscroll-contain pr-2">
      {ORDER.map((category) => (
        <section key={category}>
          <h3 className="text-fg-subtle mb-1.5 text-[10px] font-semibold tracking-widest uppercase">
            {CATEGORY_LABELS[category]}
          </h3>
          <div className="grid grid-cols-2 gap-1">
            {INSTRUMENT_LIST.filter((i) => i.category === category).map((inst) => (
              <button
                key={inst.id}
                type="button"
                disabled={disabled}
                aria-pressed={inst.id === value}
                onClick={() => onSelect(inst.id)}
                className={cn(
                  'flex h-9 items-center gap-2 rounded-lg px-1.5 text-left text-[13px] transition-colors disabled:opacity-40',
                  inst.id === value ? 'bg-accent-soft text-fg ring-accent/50 ring-1' : 'hover:bg-surface-3',
                )}
              >
                <InstrumentBadge id={inst.id} />
                <span className="truncate">{inst.name}</span>
              </button>
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}

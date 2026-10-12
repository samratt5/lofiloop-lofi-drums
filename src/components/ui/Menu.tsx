'use client';

import { useCallback, useState, type ReactNode } from 'react';
import { Popover } from './Popover';
import { cn } from '@/lib/utils/cn';

export interface MenuItem {
  label: string;
  icon?: ReactNode;
  onSelect: () => void;
  disabled?: boolean;
  danger?: boolean;
  hint?: string;
}

export interface MenuProps {
  label: string;
  items: (MenuItem | 'separator')[];
  trigger: (props: {
    onClick: (e: React.MouseEvent<HTMLElement>) => void;
    'aria-haspopup': 'menu';
    'aria-expanded': boolean;
  }) => ReactNode;
  align?: 'start' | 'center' | 'end';
}

export function Menu({ label, items, trigger, align = 'center' }: MenuProps) {
  const [anchor, setAnchor] = useState<{ x: number; y: number } | null>(null);
  const close = useCallback(() => setAnchor(null), []);
  return (
    <>
      {trigger({
        'aria-haspopup': 'menu',
        'aria-expanded': Boolean(anchor),
        onClick: (e) => {
          const r = e.currentTarget.getBoundingClientRect();
          const x = align === 'start' ? r.left + 90 : align === 'end' ? r.right - 90 : r.left + r.width / 2;
          setAnchor(anchor ? null : { x, y: r.bottom });
        },
      })}
      {anchor && (
        <Popover anchor={anchor} onClose={close} label={label} className="w-52 p-1">
          <div role="menu" aria-label={label} className="flex flex-col">
            {items.map((item, i) =>
              item === 'separator' ? (
                <div key={`sep-${i}`} role="separator" className="bg-line my-1 h-px" />
              ) : (
                <button
                  key={item.label}
                  type="button"
                  role="menuitem"
                  disabled={item.disabled}
                  onClick={() => {
                    close();
                    item.onSelect();
                  }}
                  className={cn(
                    '[&_svg]:text-fg-subtle flex h-8 items-center gap-2.5 rounded-md px-2 text-left text-[13px] transition-colors disabled:opacity-40 [&_svg]:size-4',
                    item.danger ? 'text-danger hover:bg-danger/10 [&_svg]:text-danger' : 'hover:bg-surface-3',
                  )}
                >
                  {item.icon}
                  <span className="flex-1">{item.label}</span>
                  {item.hint && <span className="text-fg-subtle font-mono text-[10px]">{item.hint}</span>}
                </button>
              ),
            )}
          </div>
        </Popover>
      )}
    </>
  );
}

'use client';

import { useCallback, useState } from 'react';
import { Check, Settings2 } from 'lucide-react';
import { THEMES } from '@/lib/themes';
import { ui, useUi } from '@/lib/store/ui';
import { IconButton } from '@/components/ui/Button';
import { Popover } from '@/components/ui/Popover';
import { Switch } from '@/components/ui/Switch';
import { cn } from '@/lib/utils/cn';

export function SettingsMenu() {
  const [anchor, setAnchor] = useState<{ x: number; y: number } | null>(null);
  const theme = useUi((s) => s.theme);
  const audition = useUi((s) => s.audition);
  const close = useCallback(() => setAnchor(null), []);

  return (
    <>
      <IconButton
        label="Settings"
        aria-haspopup="dialog"
        aria-expanded={Boolean(anchor)}
        onClick={(e) => {
          const r = e.currentTarget.getBoundingClientRect();
          setAnchor(anchor ? null : { x: r.left + r.width / 2 - 100, y: r.bottom });
        }}
      >
        <Settings2 />
      </IconButton>
      {anchor && (
        <Popover anchor={anchor} onClose={close} label="Settings" className="w-72">
          <p className="text-fg-subtle mb-2 text-[10px] font-semibold tracking-widest uppercase">Theme</p>
          <div className="grid grid-cols-5 gap-1.5">
            {THEMES.map((t) => (
              <button
                key={t.id}
                type="button"
                onClick={() => ui.setTheme(t.id)}
                aria-pressed={t.id === theme}
                title={t.name}
                className={cn(
                  'group hover:bg-surface-3 flex flex-col items-center gap-1 rounded-lg p-1.5 text-[10px] font-medium transition-colors',
                  t.id === theme ? 'text-fg' : 'text-fg-muted',
                )}
              >
                <span
                  className={cn(
                    'ring-offset-surface-2 relative flex size-8 items-center justify-center rounded-full ring-2 ring-offset-2',
                    t.id === theme ? 'ring-accent' : 'ring-transparent',
                  )}
                  style={{ background: `linear-gradient(135deg, ${t.swatch[0]} 50%, ${t.swatch[1]} 50%)` }}
                >
                  {t.id === theme && <Check className="size-3.5 text-white mix-blend-difference" />}
                </span>
                {t.name}
              </button>
            ))}
          </div>
          <div className="border-line mt-3 border-t pt-2">
            <Switch
              checked={audition}
              onChange={(v) => ui.set({ audition: v })}
              label="Audition steps"
              description="Hear a sound when you turn a step on"
            />
          </div>
        </Popover>
      )}
    </>
  );
}

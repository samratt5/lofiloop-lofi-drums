'use client';

import { useSyncExternalStore } from 'react';
import { SHORTCUTS } from '@/hooks/useHotkeys';
import { ui, useUi } from '@/lib/store/ui';
import { Dialog } from '@/components/ui/Dialog';

const TIPS = [
  ['Click and drag across pads', 'Paint or erase several steps'],
  ['Right-click, long-press or ⌥/Ctrl-click a pad', 'Velocity, chance, repeats, note and length'],
  ['Drag a knob up or down', 'Hold Shift for fine control; scroll works too'],
  ['Double-click a knob', 'Reset it to the default'],
  ['Click an instrument badge', 'Preview the sound'],
  ['Double-click a pattern tab', 'Duplicate the pattern'],
];

const isMac = () => /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);

export function ShortcutsDialog() {
  const open = useUi((s) => s.dialog === 'shortcuts');
  const mac = useSyncExternalStore(
    () => () => undefined,
    isMac,
    () => false,
  );
  const groups = [...new Set(SHORTCUTS.map((s) => s.group))];

  return (
    <Dialog open={open} onClose={ui.closeDialog} title="Shortcuts and tips" size="lg">
      <div className="grid gap-6 sm:grid-cols-2">
        {groups.map((group) => (
          <section key={group}>
            <h3 className="text-fg-subtle mb-2 text-[10px] font-semibold tracking-widest uppercase">{group}</h3>
            <dl className="flex flex-col gap-1.5">
              {SHORTCUTS.filter((s) => s.group === group).map((s) => (
                <div key={s.action} className="flex items-center justify-between gap-4 text-sm">
                  <dt className="text-fg-muted">{s.action}</dt>
                  <dd className="flex gap-1">
                    {s.keys.map((k) => (
                      <kbd
                        key={k}
                        className="border-line-strong bg-surface-2 min-w-6 rounded-md border px-1.5 py-0.5 text-center font-mono text-[11px]"
                      >
                        {k === 'Mod' ? (mac ? '⌘' : 'Ctrl') : k}
                      </kbd>
                    ))}
                  </dd>
                </div>
              ))}
            </dl>
          </section>
        ))}
        <section className="sm:col-span-2">
          <h3 className="text-fg-subtle mb-2 text-[10px] font-semibold tracking-widest uppercase">Mouse and touch</h3>
          <dl className="grid gap-1.5 sm:grid-cols-2">
            {TIPS.map(([how, what]) => (
              <div key={how} className="bg-surface-2 rounded-lg px-3 py-2 text-sm">
                <dt className="font-medium">{how}</dt>
                <dd className="text-fg-muted text-xs">{what}</dd>
              </div>
            ))}
          </dl>
        </section>
      </div>
    </Dialog>
  );
}

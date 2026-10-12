'use client';

import { X } from 'lucide-react';
import { ui, useUi, type SidebarTab } from '@/lib/store/ui';
import { IconButton } from '@/components/ui/Button';
import { cn } from '@/lib/utils/cn';
import { CreatePanel } from './CreatePanel';
import { FxPanel } from './FxPanel';
import { MixerPanel } from './MixerPanel';

const TABS: { id: SidebarTab; label: string }[] = [
  { id: 'create', label: 'Create' },
  { id: 'fx', label: 'Tape & FX' },
  { id: 'mixer', label: 'Mixer' },
];

export function Sidebar() {
  const docked = useUi((s) => s.sidebarOpen);
  const drawer = useUi((s) => s.drawerOpen);
  const tab = useUi((s) => s.sidebarTab);

  return (
    <>
      {drawer && (
        <div
          aria-hidden
          className="animate-fade-in fixed inset-0 z-30 bg-black/40 lg:hidden"
          onClick={() => ui.set({ drawerOpen: false })}
        />
      )}
      <aside
        aria-label="Side panel"
        data-tour="sidebar"
        className={cn(
          'border-line bg-surface z-40 flex w-[min(340px,92vw)] shrink-0 flex-col border-l',
          'fixed inset-y-0 right-0 shadow-2xl transition-transform duration-200 lg:static lg:translate-x-0 lg:shadow-none',
          drawer ? 'translate-x-0' : 'translate-x-full',
          !docked && 'lg:hidden',
        )}
      >
        <div className="border-line flex h-12 shrink-0 items-center gap-1 border-b px-2">
          <div role="tablist" aria-label="Side panel" className="flex flex-1 items-center gap-0.5">
            {TABS.map((t) => (
              <button
                key={t.id}
                type="button"
                role="tab"
                aria-selected={tab === t.id}
                onClick={() => ui.set({ sidebarTab: t.id })}
                className={cn(
                  'h-8 rounded-lg px-3 text-[13px] font-medium transition-colors',
                  tab === t.id ? 'bg-surface-3 text-fg' : 'text-fg-muted hover:text-fg',
                )}
              >
                {t.label}
              </button>
            ))}
          </div>
          <IconButton
            label="Close panel"
            tip="none"
            onClick={() => ui.set({ drawerOpen: false })}
            className="lg:hidden"
          >
            <X />
          </IconButton>
        </div>
        <div role="tabpanel" className="min-h-0 flex-1 overflow-y-auto">
          {tab === 'create' && <CreatePanel />}
          {tab === 'fx' && <FxPanel />}
          {tab === 'mixer' && <MixerPanel />}
        </div>
      </aside>
    </>
  );
}

'use client';

import { CheckCircle2, Info, TriangleAlert, X } from 'lucide-react';
import { ui, useUi } from '@/lib/store/ui';
import { cn } from '@/lib/utils/cn';

const icons = { info: Info, success: CheckCircle2, error: TriangleAlert };

export function Toaster() {
  const toasts = useUi((s) => s.toasts);
  return (
    <div
      aria-live="polite"
      className="pointer-events-none fixed inset-x-0 bottom-10 z-[80] flex flex-col items-center gap-2 px-4"
    >
      {toasts.map((t) => {
        const Icon = icons[t.tone];
        return (
          <div
            key={t.id}
            role={t.tone === 'error' ? 'alert' : 'status'}
            className="animate-slide-up border-line-strong bg-surface-2 pointer-events-auto flex max-w-md items-center gap-3 rounded-xl border py-2.5 pr-2 pl-3.5 text-sm shadow-xl shadow-black/30"
          >
            <Icon
              aria-hidden
              className={cn(
                'size-4 shrink-0',
                t.tone === 'success' && 'text-success',
                t.tone === 'error' && 'text-danger',
                t.tone === 'info' && 'text-accent',
              )}
            />
            <span className="min-w-0 flex-1">{t.message}</span>
            {t.action && (
              <button
                type="button"
                onClick={() => {
                  t.action?.run();
                  ui.dismissToast(t.id);
                }}
                className="text-accent hover:bg-accent-soft rounded-md px-2 py-1 text-xs font-semibold"
              >
                {t.action.label}
              </button>
            )}
            <button
              type="button"
              aria-label="Dismiss"
              onClick={() => ui.dismissToast(t.id)}
              className="text-fg-subtle hover:bg-surface-3 hover:text-fg rounded-md p-1"
            >
              <X className="size-3.5" />
            </button>
          </div>
        );
      })}
    </div>
  );
}

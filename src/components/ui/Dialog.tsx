'use client';

import { useEffect, useRef, type ReactNode } from 'react';
import { X } from 'lucide-react';
import { cn } from '@/lib/utils/cn';
import { IconButton } from './Button';

export interface DialogProps {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  size?: 'sm' | 'md' | 'lg';
  /** Prevent closing (e.g. while an export is running) */
  locked?: boolean;
}

const widths = { sm: 'max-w-md', md: 'max-w-xl', lg: 'max-w-3xl' };

/** Modal built on the native <dialog> element: focus trapping, Esc and top-layer for free. */
export function Dialog({ open, onClose, title, description, children, footer, size = 'md', locked }: DialogProps) {
  const ref = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);

  return (
    <dialog
      ref={ref}
      aria-labelledby="dialog-title"
      onCancel={(e) => {
        e.preventDefault();
        if (!locked) onClose();
      }}
      onClick={(e) => {
        if (e.target === ref.current && !locked) onClose();
      }}
      className={cn(
        'text-fg open:animate-pop-in m-auto w-[calc(100%-2rem)] overflow-visible bg-transparent p-0 backdrop:bg-black/55 backdrop:backdrop-blur-[2px]',
        widths[size],
      )}
    >
      {open && (
        <div className="border-line-strong bg-surface flex max-h-[min(88dvh,760px)] flex-col rounded-2xl border shadow-2xl shadow-black/40">
          <header className="border-line flex items-start gap-4 border-b px-5 pt-4 pb-3.5">
            <div className="min-w-0 flex-1">
              <h2 id="dialog-title" className="text-base font-semibold tracking-tight">
                {title}
              </h2>
              {description && <p className="text-fg-muted mt-0.5 text-sm">{description}</p>}
            </div>
            <IconButton label="Close" tip="none" onClick={onClose} disabled={locked} className="-mr-1.5">
              <X />
            </IconButton>
          </header>
          <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">{children}</div>
          {footer && (
            <footer className="border-line flex items-center justify-end gap-2 border-t px-5 py-3">{footer}</footer>
          )}
        </div>
      )}
    </dialog>
  );
}

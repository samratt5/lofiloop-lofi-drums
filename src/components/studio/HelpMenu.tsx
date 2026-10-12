'use client';

import { useCallback, useState } from 'react';
import { Compass, HelpCircle, Keyboard } from 'lucide-react';
import { ui } from '@/lib/store/ui';
import { Button, IconButton } from '@/components/ui/Button';
import { Popover } from '@/components/ui/Popover';
import { startTour } from './Tour';

export function HelpMenu() {
  const [anchor, setAnchor] = useState<{ x: number; y: number } | null>(null);
  const close = useCallback(() => setAnchor(null), []);
  const run = (fn: () => void) => () => {
    close();
    fn();
  };
  return (
    <>
      <IconButton
        label="Help"
        aria-haspopup="menu"
        aria-expanded={Boolean(anchor)}
        onClick={(e) => {
          const r = e.currentTarget.getBoundingClientRect();
          setAnchor(anchor ? null : { x: r.left - 140, y: r.bottom });
        }}
      >
        <HelpCircle />
      </IconButton>
      {anchor && (
        <Popover anchor={anchor} onClose={close} label="Help" className="flex w-56 flex-col gap-0.5 p-1.5">
          <Button variant="ghost" className="justify-start" icon={<Compass />} onClick={run(startTour)}>
            Take the tour
          </Button>
          <Button
            variant="ghost"
            className="justify-start"
            icon={<Keyboard />}
            onClick={run(() => ui.openDialog('shortcuts'))}
          >
            Keyboard shortcuts
          </Button>
        </Popover>
      )}
    </>
  );
}

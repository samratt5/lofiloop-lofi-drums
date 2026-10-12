'use client';

import { useCallback, useState } from 'react';
import {
  Bookmark,
  Compass,
  Download,
  FolderOpen,
  Gauge,
  MoreHorizontal,
  Plus,
  Redo2,
  Share2,
  Undo2,
} from 'lucide-react';
import { SWING_MAX, SWING_MIN } from '@/lib/project/types';
import { actions, useStudio } from '@/lib/store/studio';
import { ui } from '@/lib/store/ui';
import { Button, IconButton } from '@/components/ui/Button';
import { DragNumber } from '@/components/ui/DragNumber';
import { Popover } from '@/components/ui/Popover';
import { HelpMenu } from './HelpMenu';
import { HistoryMenu } from './HistoryMenu';
import { startTour } from './Tour';
import { KeyControl } from './KeyControl';
import { Logo } from './Logo';
import { ProjectName } from './ProjectName';
import { SettingsMenu } from './SettingsMenu';
import { TempoControl } from './TempoControl';
import { Transport } from './Transport';
import { Visualizer } from './Visualizer';

function History() {
  const canUndo = useStudio((s) => s.past.length > 0);
  const canRedo = useStudio((s) => s.future.length > 0);
  return (
    <div className="flex items-center">
      <IconButton label="Undo (Ctrl/⌘ Z)" disabled={!canUndo} onClick={actions.undo}>
        <Undo2 />
      </IconButton>
      <IconButton label="Redo (Ctrl/⌘ Shift Z)" disabled={!canRedo} onClick={actions.redo}>
        <Redo2 />
      </IconButton>
      <HistoryMenu />
    </div>
  );
}

function SwingControl() {
  const swing = useStudio((s) => s.project.swing);
  return (
    <DragNumber
      label="Swing"
      value={swing}
      min={SWING_MIN}
      max={SWING_MAX}
      step={1}
      defaultValue={50}
      format={(v) => `${Math.round(v)}%`}
      onChange={actions.setSwing}
    />
  );
}

const NAV = [
  { id: 'new', label: 'New beat', icon: Plus, run: () => ui.openDialog('new') },
  {
    id: 'library',
    label: 'Library (Ctrl/⌘ O)',
    short: 'Library',
    icon: FolderOpen,
    run: () => ui.openDialog('library'),
  },
  { id: 'discover', label: 'Discover & radio', icon: Compass, run: () => ui.openDialog('discover') },
  {
    id: 'versions',
    label: 'Versions & A/B compare',
    short: 'Versions',
    icon: Bookmark,
    run: () => ui.openDialog('versions'),
  },
  { id: 'share', label: 'Share link', icon: Share2, run: () => ui.openDialog('share') },
  {
    id: 'perform',
    label: 'Performance mode',
    short: 'Perform',
    icon: Gauge,
    run: () => ui.set({ performance: true }),
  },
] as const;

function MobileMenu() {
  const [anchor, setAnchor] = useState<{ x: number; y: number } | null>(null);
  const close = useCallback(() => setAnchor(null), []);
  const run = (fn: () => void) => () => {
    close();
    fn();
  };
  return (
    <>
      <IconButton
        label="More"
        size="md"
        tip="none"
        onClick={(e) => {
          const r = e.currentTarget.getBoundingClientRect();
          setAnchor(anchor ? null : { x: r.left - 80, y: r.bottom });
        }}
      >
        <MoreHorizontal />
      </IconButton>
      {anchor && (
        <Popover anchor={anchor} onClose={close} label="Menu" className="flex w-56 flex-col gap-0.5 p-1.5">
          <div className="flex gap-2 p-1.5">
            <SwingControl />
            <KeyControl />
          </div>
          {NAV.map(({ id, label, icon: Icon, run: action, ...rest }) => (
            <Button key={id} variant="ghost" className="justify-start" icon={<Icon />} onClick={run(action)}>
              {'short' in rest ? rest.short : label}
            </Button>
          ))}
          <Button variant="ghost" className="justify-start" icon={<Compass />} onClick={run(startTour)}>
            Take the tour
          </Button>
          <Button
            variant="ghost"
            className="justify-start"
            icon={<Download />}
            onClick={run(() => ui.openDialog('export'))}
          >
            Export
          </Button>
          <Button variant="ghost" className="justify-start" icon={<Undo2 />} onClick={actions.undo}>
            Undo
          </Button>
          <Button variant="ghost" className="justify-start" icon={<Redo2 />} onClick={actions.redo}>
            Redo
          </Button>
        </Popover>
      )}
    </>
  );
}

export function TopBar() {
  return (
    <header className="border-line bg-surface relative z-20 flex h-14 shrink-0 items-center gap-2 border-b px-2 sm:gap-3 sm:px-3">
      <div className="flex min-w-0 items-center gap-2 lg:w-[260px] lg:shrink-0">
        <Logo className="size-8 shrink-0" />
        <div className="min-w-0 flex-1">
          <ProjectName />
        </div>
      </div>

      <div className="flex flex-1 items-center justify-center gap-2 sm:justify-start lg:justify-center">
        <Transport />
        <TempoControl />
        <div className="hidden items-center gap-2 md:flex">
          <SwingControl />
          <KeyControl />
        </div>
        <Visualizer className="ml-1 hidden xl:block" />
      </div>

      <div className="hidden items-center gap-1 md:flex">
        <History />
        <span className="bg-line mx-1 h-5 w-px" />
        {NAV.map(({ id, label, icon: Icon, run }) => (
          <IconButton key={id} label={label} onClick={run} data-tour={id}>
            <Icon />
          </IconButton>
        ))}
        <SettingsMenu />
        <HelpMenu />
        <Button
          variant="primary"
          size="sm"
          className="ml-1"
          data-tour="export"
          icon={<Download />}
          onClick={() => ui.openDialog('export')}
        >
          Export
        </Button>
      </div>
      <div className="md:hidden">
        <MobileMenu />
      </div>
    </header>
  );
}

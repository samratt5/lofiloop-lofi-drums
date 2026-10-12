'use client';

import {
  ClipboardPaste,
  Copy,
  CopyPlus,
  Eraser,
  MoreHorizontal,
  PanelRight,
  PanelRightClose,
  Plus,
  Repeat2,
  Trash2,
} from 'lucide-react';
import { MAX_PATTERNS, PATTERN_LENGTHS } from '@/lib/project/types';
import { actions, selectActivePattern, useStudio } from '@/lib/store/studio';
import { ui, useUi, type MainView } from '@/lib/store/ui';
import { setMainView } from '@/lib/transport';
import { usePlayhead } from '@/hooks/usePlayhead';
import { IconButton } from '@/components/ui/Button';
import { Menu } from '@/components/ui/Menu';
import { Segmented } from '@/components/ui/Segmented';
import { Select } from '@/components/ui/Select';
import { cn } from '@/lib/utils/cn';
import { SongChain } from './SongChain';

function PatternTabs() {
  const patterns = useStudio((s) => s.project.patterns);
  const activeId = useStudio((s) => s.project.activePatternId);
  const playhead = usePlayhead();
  return (
    <div role="tablist" aria-label="Patterns" className="flex items-center gap-1">
      {patterns.map((p, i) => {
        const active = p.id === activeId;
        const playing = playhead.playing && playhead.patternId === p.id;
        return (
          <button
            key={p.id}
            type="button"
            role="tab"
            aria-selected={active}
            title={`Pattern ${p.name} (${i + 1})`}
            onClick={() => actions.selectPattern(p.id)}
            onDoubleClick={() => actions.addPattern(p.id)}
            className={cn(
              'relative flex h-8 min-w-8 items-center justify-center rounded-lg px-2 font-mono text-sm font-semibold transition-colors',
              active ? 'bg-accent text-accent-fg' : 'bg-surface-2 text-fg-muted hover:bg-surface-3 hover:text-fg',
            )}
          >
            {p.name}
            {playing && (
              <span
                aria-hidden
                className={cn(
                  'ring-surface absolute -top-0.5 -right-0.5 size-2 rounded-full ring-2',
                  active ? 'bg-fg' : 'bg-accent',
                )}
              />
            )}
          </button>
        );
      })}
      {patterns.length < MAX_PATTERNS && (
        <IconButton label="New empty pattern" onClick={() => actions.addPattern()}>
          <Plus />
        </IconButton>
      )}
    </div>
  );
}

function PatternMenu() {
  const pattern = useStudio(selectActivePattern);
  const count = useStudio((s) => s.project.patterns.length);
  const clipboard = useUi((s) => s.patternClipboard);
  const canDouble = pattern.length * 2 <= 64;
  return (
    <Menu
      label={`Pattern ${pattern.name} actions`}
      trigger={(props) => (
        <IconButton label="Pattern actions" {...props}>
          <MoreHorizontal />
        </IconButton>
      )}
      items={[
        {
          label: 'Duplicate pattern',
          icon: <CopyPlus />,
          disabled: count >= MAX_PATTERNS,
          onSelect: () => actions.addPattern(pattern.id),
        },
        {
          label: `Double length (${pattern.length} → ${pattern.length * 2})`,
          icon: <Repeat2 />,
          disabled: !canDouble,
          onSelect: () => actions.extendPattern(pattern.id, pattern.length * 2),
        },
        'separator',
        {
          label: 'Copy steps',
          icon: <Copy />,
          hint: '⌘C',
          onSelect: () => {
            useUi.setState({ patternClipboard: structuredClone(pattern.steps) });
            ui.toast(`Copied pattern ${pattern.name}`);
          },
        },
        {
          label: 'Paste steps',
          icon: <ClipboardPaste />,
          hint: '⌘V',
          disabled: !clipboard,
          onSelect: () => clipboard && actions.pastePattern(pattern.id, clipboard),
        },
        {
          label: 'Clear pattern',
          icon: <Eraser />,
          onSelect: () => {
            actions.clearPattern(pattern.id);
            ui.toast(`Cleared pattern ${pattern.name}`, 'info', { label: 'Undo', run: actions.undo });
          },
        },
        'separator',
        {
          label: 'Delete pattern',
          icon: <Trash2 />,
          danger: true,
          disabled: count <= 1,
          onSelect: () => {
            actions.removePattern(pattern.id);
            ui.toast(`Deleted pattern ${pattern.name}`, 'info', { label: 'Undo', run: actions.undo });
          },
        },
      ]}
    />
  );
}

export function PatternBar() {
  const mode = useStudio((s) => s.project.playMode);
  const pattern = useStudio(selectActivePattern);
  const sidebarOpen = useUi((s) => s.sidebarOpen);
  const view = useUi((s) => s.mainView);

  return (
    <div className="border-line bg-surface/60 shrink-0 border-b">
      <div className="scrollbar-none flex h-12 items-center gap-2 overflow-x-auto px-2 sm:px-3">
        <Segmented
          data-tour="views"
          label="View"
          value={view}
          onChange={(v: MainView) => setMainView(v)}
          options={[
            { value: 'pattern', label: 'Patterns', title: 'Edit the steps of a pattern' },
            { value: 'song', label: 'Arrangement', title: 'Arrange sections into a full song' },
          ]}
        />
        <span className="bg-line h-5 w-px shrink-0" />
        {view === 'pattern' && <PatternTabs />}
        {view === 'pattern' && (
          <div className="ml-auto flex shrink-0 items-center gap-1">
            <label className="sr-only" htmlFor="pattern-length">
              Pattern length
            </label>
            <Select
              id="pattern-length"
              value={pattern.length}
              onChange={(e) => actions.setPatternLength(pattern.id, Number(e.target.value))}
              title="Pattern length in steps"
            >
              {PATTERN_LENGTHS.map((len) => (
                <option key={len} value={len}>
                  {len} steps{len % 16 === 0 ? ` · ${len / 16} bar${len > 16 ? 's' : ''}` : ''}
                </option>
              ))}
              {!(PATTERN_LENGTHS as readonly number[]).includes(pattern.length) && (
                <option value={pattern.length}>{pattern.length} steps</option>
              )}
            </Select>
            <PatternMenu />
          </div>
        )}
        <IconButton
          label={sidebarOpen ? 'Hide side panel' : 'Show side panel'}
          onClick={() => ui.set({ sidebarOpen: !sidebarOpen })}
          className={cn('hidden lg:inline-flex', view === 'song' && 'ml-auto')}
        >
          {sidebarOpen ? <PanelRightClose /> : <PanelRight />}
        </IconButton>
      </div>
      {view === 'pattern' && mode === 'song' && <SongChain />}
    </div>
  );
}

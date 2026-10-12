'use client';

import { useEffect, useState } from 'react';
import { AudioLines, Check, CircleAlert, Keyboard, Loader2, SlidersHorizontal, Sparkles } from 'lucide-react';
import { NOTE_NAMES, SCALES } from '@/lib/music/theory';
import { useStudio } from '@/lib/store/studio';
import { ui, useUi } from '@/lib/store/ui';
import { formatRelativeTime } from '@/lib/utils/format';

function SaveIndicator() {
  const status = useUi((s) => s.saveStatus);
  const savedAt = useUi((s) => s.savedAt);
  const [, tick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => tick((n) => n + 1), 30000);
    return () => clearInterval(id);
  }, []);
  if (status === 'saving') {
    return (
      <span className="flex items-center gap-1.5">
        <Loader2 className="size-3 animate-spin" /> Saving…
      </span>
    );
  }
  if (status === 'error') {
    return (
      <span className="text-danger flex items-center gap-1.5">
        <CircleAlert className="size-3" /> Not saved
      </span>
    );
  }
  return (
    <span className="flex items-center gap-1.5" title="Your beat is saved in this browser automatically">
      <Check className="text-success size-3" /> Saved{savedAt ? ` ${formatRelativeTime(savedAt)}` : ''}
    </span>
  );
}

export function StatusBar() {
  const tracks = useStudio((s) => s.project.tracks.length);
  const patterns = useStudio((s) => s.project.patterns.length);
  const root = useStudio((s) => s.project.root);
  const scale = useStudio((s) => s.project.scale);

  return (
    <footer className="border-line bg-surface text-fg-subtle flex h-8 shrink-0 items-center gap-4 border-t px-3 text-[11px]">
      <SaveIndicator />
      <span className="hidden sm:inline">
        {tracks} tracks · {patterns} pattern{patterns > 1 ? 's' : ''} · {NOTE_NAMES[root]}{' '}
        {SCALES[scale].label.toLowerCase()}
      </span>
      <div className="ml-auto flex items-center gap-1 lg:hidden">
        <button
          type="button"
          onClick={() => ui.openPanel('create')}
          className="hover:bg-surface-3 hover:text-fg flex h-6 items-center gap-1 rounded-md px-2"
        >
          <Sparkles className="size-3" /> Create
        </button>
        <button
          type="button"
          onClick={() => ui.openPanel('fx')}
          className="hover:bg-surface-3 hover:text-fg flex h-6 items-center gap-1 rounded-md px-2"
        >
          <AudioLines className="size-3" /> FX
        </button>
        <button
          type="button"
          onClick={() => ui.openPanel('mixer')}
          className="hover:bg-surface-3 hover:text-fg flex h-6 items-center gap-1 rounded-md px-2"
        >
          <SlidersHorizontal className="size-3" /> Mixer
        </button>
      </div>
      <button
        type="button"
        onClick={() => ui.openDialog('shortcuts')}
        className="hover:bg-surface-3 hover:text-fg ml-auto hidden items-center gap-1.5 rounded-md px-1.5 py-0.5 lg:flex"
      >
        <Keyboard className="size-3" /> Press <kbd className="border-line-strong rounded border px-1 font-mono">?</kbd>{' '}
        for shortcuts
      </button>
    </footer>
  );
}

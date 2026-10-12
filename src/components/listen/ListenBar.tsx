'use client';

import { useMemo } from 'react';
import { ExternalLink, Loader2, Pause, Play, Radio, SkipBack, SkipForward, X } from 'lucide-react';
import { buildSongTimeline } from '@/lib/audio/sequence';
import { createId } from '@/lib/utils/id';
import { nextTrack, previousTrack, stopListening, toggleListening, useListen } from '@/lib/listen';
import { actions } from '@/lib/store/studio';
import { ui } from '@/lib/store/ui';
import { usePlayhead } from '@/hooks/usePlayhead';
import { IconButton } from '@/components/ui/Button';
import { Cover } from '@/components/common/Cover';
import { formatDuration } from '@/lib/utils/format';
import { saveNow } from '@/components/studio/bootstrap';

function Progress({ totalSteps, totalSeconds }: { totalSteps: number; totalSeconds: number }) {
  const playhead = usePlayhead();
  const status = useListen((s) => s.status);
  const fraction = totalSteps > 0 && status !== 'loading' ? Math.min(1, playhead.songStep / totalSteps) : 0;
  return (
    <div className="order-last flex min-w-0 basis-full items-center gap-2 sm:order-none sm:flex-1 sm:basis-auto">
      <span className="text-fg-subtle w-9 text-right font-mono text-[10px] tabular-nums">
        {formatDuration(fraction * totalSeconds)}
      </span>
      <div
        className="bg-surface-3 relative h-1 flex-1 overflow-hidden rounded-full"
        role="progressbar"
        aria-label="Song position"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(fraction * 100)}
      >
        <div className="bg-accent absolute inset-y-0 left-0" style={{ width: `${fraction * 100}%` }} />
      </div>
      <span className="text-fg-subtle w-9 font-mono text-[10px] tabular-nums">{formatDuration(totalSeconds)}</span>
    </div>
  );
}

/** Mini player shown while a listening session (library, radio, Discover) runs. */
export function ListenBar() {
  const source = useListen((s) => s.source);
  const item = useListen((s) => s.item);
  const project = useListen((s) => s.project);
  const status = useListen((s) => s.status);
  const index = useListen((s) => s.index);

  const timeline = useMemo(() => (project ? buildSongTimeline(project) : null), [project]);
  if (!source) return null;

  const openInStudio = () => {
    if (!project) return;
    const fromLibrary = source.kind === 'library';
    stopListening();
    void saveNow();
    const now = Date.now();
    // Library songs open as themselves; generated ones become a new beat in the library.
    const opened = fromLibrary ? project : { ...project, id: createId('prj'), createdAt: now, updatedAt: now };
    actions.load({ ...opened, playMode: 'song' });
    ui.selectTrack(opened.tracks[0]?.id ?? null);
    ui.toast(`Opened “${opened.name}” in the studio`, 'success');
  };

  return (
    <div
      role="region"
      aria-label="Now playing"
      className="border-line bg-surface/95 flex shrink-0 flex-wrap items-center gap-x-3 gap-y-1 border-t px-3 py-2 backdrop-blur"
    >
      <div className="flex min-w-0 flex-1 items-center gap-2.5 sm:w-64 sm:flex-none">
        {item ? (
          <Cover seed={item.seed} title={item.title} styles={item.styles} size={40} />
        ) : (
          <span className="bg-surface-3 flex size-10 items-center justify-center rounded-lg">
            <Radio className="text-fg-subtle size-4" />
          </span>
        )}
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold">{status === 'loading' ? 'Loading…' : (item?.title ?? '')}</p>
          <p className="text-fg-muted truncate text-xs">
            {source.label}
            {source.size ? ` · ${Math.min(index + 1, source.size)} of ${source.size}` : ''}
          </p>
        </div>
      </div>
      <div className="flex items-center">
        <IconButton label="Previous" size="sm" onClick={previousTrack} tip="top">
          <SkipBack />
        </IconButton>
        <IconButton
          label={status === 'playing' ? 'Pause' : 'Play'}
          variant="primary"
          onClick={toggleListening}
          disabled={status === 'loading'}
          tip="top"
        >
          {status === 'loading' ? (
            <Loader2 className="animate-spin" />
          ) : status === 'playing' ? (
            <Pause className="fill-current" />
          ) : (
            <Play className="translate-x-px fill-current" />
          )}
        </IconButton>
        <IconButton label="Next" size="sm" onClick={nextTrack} tip="top">
          <SkipForward />
        </IconButton>
      </div>
      {timeline && <Progress totalSteps={timeline.totalSteps} totalSeconds={timeline.totalSeconds} />}
      <div className="flex items-center gap-0.5 sm:ml-auto">
        <IconButton label="Open in the studio" size="sm" onClick={openInStudio} disabled={!project} tip="top">
          <ExternalLink />
        </IconButton>
        <IconButton label="Stop listening" size="sm" onClick={stopListening} tip="top">
          <X />
        </IconButton>
      </div>
    </div>
  );
}

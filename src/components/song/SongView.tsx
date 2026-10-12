'use client';

import { useEffect, useMemo, useRef } from 'react';
import { Crosshair, Dices, Maximize2, Repeat, ZoomIn, ZoomOut } from 'lucide-react';
import { regenerateSection } from '@/lib/generate/song';
import { randomSeed } from '@/lib/music/rng';
import { saveSnapshot } from '@/lib/storage/library';
import { ui } from '@/lib/store/ui';
import { buildSongTimeline, sectionSpans } from '@/lib/audio/sequence';
import { actions, getProject, useStudio } from '@/lib/store/studio';
import { useUi } from '@/lib/store/ui';
import { usePlayhead } from '@/hooks/usePlayhead';
import { IconButton } from '@/components/ui/Button';
import { formatDuration } from '@/lib/utils/format';
import { AutomationLanes } from './AutomationLanes';
import { MuteMatrix } from './MuteMatrix';
import { SectionLane } from './SectionLane';
import { SongRuler } from './SongRuler';
import { TRACK_HEADER_WIDTH, ZOOM_MAX, ZOOM_MIN } from './sectionStyle';

function Playline({ zoom, scroller }: { zoom: number; scroller: React.RefObject<HTMLDivElement | null> }) {
  const playhead = usePlayhead();
  const cursor = useUi((s) => s.songCursor);
  const follow = useUi((s) => s.followPlayhead);
  const bar = playhead.playing && playhead.mode === 'song' ? playhead.songStep / 16 : cursor;
  const x = TRACK_HEADER_WIDTH + bar * zoom;

  useEffect(() => {
    const el = scroller.current;
    if (!el || !follow || !playhead.playing) return;
    const visible = x - el.scrollLeft;
    if (visible < TRACK_HEADER_WIDTH + 40 || visible > el.clientWidth - 80) {
      el.scrollTo({ left: Math.max(0, x - TRACK_HEADER_WIDTH - 80), behavior: 'smooth' });
    }
  }, [x, follow, playhead.playing, scroller]);

  return (
    <div
      aria-hidden
      className={
        playhead.playing
          ? 'bg-accent pointer-events-none absolute inset-y-0 z-20 w-px'
          : 'bg-fg/40 pointer-events-none absolute inset-y-0 z-20 w-px'
      }
      style={{ left: x }}
    />
  );
}

/** New patterns for every unlocked section: a fresh take on the song that keeps what you locked. */
async function regenerateUnlocked() {
  const before = getProject();
  const unlocked = before.arrangement.filter((s) => !s.locked);
  if (!unlocked.length) {
    ui.toast('Every section is locked. Unlock one to regenerate it.', 'info');
    return;
  }
  await saveSnapshot(before, '', { auto: true }).catch(() => undefined);
  let next = before;
  // Sections that shared patterns (every hook, say) get the same new patterns, so repeats stay repeats.
  const groups = new Map<string, string[]>();
  for (const section of unlocked) {
    const key = `${section.patternId}|${section.fillPatternId ?? ''}`;
    groups.set(key, [...(groups.get(key) ?? []), section.id]);
  }
  for (const [first, ...rest] of groups.values()) {
    next = regenerateSection(next, first, { seed: randomSeed(), parts: 'all' });
    const fresh = next.arrangement.find((s) => s.id === first);
    if (!fresh || !rest.length) continue;
    next = {
      ...next,
      arrangement: next.arrangement.map((s) =>
        rest.includes(s.id) ? { ...s, patternId: fresh.patternId, fillPatternId: fresh.fillPatternId } : s,
      ),
    };
  }
  // Drop patterns this left unused (ones that were already unused are the user's to keep).
  const used = (p: typeof next) => new Set(p.arrangement.flatMap((s) => [s.patternId, s.fillPatternId ?? '']));
  const usedBefore = used(before);
  const usedAfter = used(next);
  const patterns = next.patterns.filter((p) => usedAfter.has(p.id) || !usedBefore.has(p.id));
  if (patterns.length && patterns.length !== next.patterns.length) {
    next = {
      ...next,
      patterns,
      activePatternId: patterns.some((p) => p.id === next.activePatternId) ? next.activePatternId : patterns[0].id,
    };
  }
  actions.replace(next, 'Regenerate unlocked sections');
  ui.toast(`Rewrote ${unlocked.length} section${unlocked.length === 1 ? '' : 's'}`, 'success', {
    label: 'Undo',
    run: actions.undo,
  });
}

export function SongView() {
  const project = useStudio((s) => s.project);
  const zoom = useUi((s) => s.songZoom);
  const follow = useUi((s) => s.followPlayhead);
  const playhead = usePlayhead();
  const scroller = useRef<HTMLDivElement>(null);

  const { spans, bars, seconds } = useMemo(() => {
    const timeline = buildSongTimeline(project);
    return { spans: sectionSpans(project), bars: timeline.totalSteps / 16, seconds: timeline.totalSeconds };
  }, [project]);

  const setZoom = (next: number) =>
    useUi.setState({ songZoom: Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, Math.round(next))) });
  const fit = () => {
    const width = (scroller.current?.clientWidth ?? 800) - TRACK_HEADER_WIDTH - 64;
    setZoom(width / Math.max(1, bars + 2));
  };

  // Ctrl/⌘ + wheel zooms the timeline.
  useEffect(() => {
    const el = scroller.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey && !e.metaKey) return;
      e.preventDefault();
      const current = useUi.getState().songZoom;
      useUi.setState({
        songZoom: Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, Math.round(current * (e.deltaY < 0 ? 1.12 : 0.89)))),
      });
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, []);

  const playingIndex = playhead.playing && playhead.mode === 'song' ? playhead.sectionIndex : -1;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="border-line flex h-10 shrink-0 items-center gap-1 border-b px-2 sm:px-3">
        <span className="text-fg-muted mr-2 text-xs">
          <span className="text-fg font-mono font-semibold">{formatDuration(seconds)}</span> · {Math.round(bars)} bars ·{' '}
          {project.arrangement.length} sections
        </span>
        <IconButton label="Zoom out" size="sm" onClick={() => setZoom(zoom / 1.3)} disabled={zoom <= ZOOM_MIN}>
          <ZoomOut />
        </IconButton>
        <IconButton label="Zoom in" size="sm" onClick={() => setZoom(zoom * 1.3)} disabled={zoom >= ZOOM_MAX}>
          <ZoomIn />
        </IconButton>
        <IconButton label="Fit song to width" size="sm" onClick={fit}>
          <Maximize2 />
        </IconButton>
        <IconButton
          label={project.loop ? 'Clear loop region' : 'Loop a range: drag on the bar ruler'}
          size="sm"
          active={Boolean(project.loop)}
          onClick={() => project.loop && actions.setLoop(null)}
        >
          <Repeat />
        </IconButton>
        <IconButton label="Regenerate every unlocked section" size="sm" onClick={() => void regenerateUnlocked()}>
          <Dices />
        </IconButton>
        <IconButton
          label={follow ? 'Following the playhead' : 'Follow the playhead'}
          size="sm"
          active={follow}
          onClick={() => useUi.setState({ followPlayhead: !follow })}
        >
          <Crosshair />
        </IconButton>
      </div>
      <div ref={scroller} className="relative min-h-0 flex-1 overflow-auto overscroll-contain">
        <div className="relative min-w-fit">
          <div className="bg-surface/95 sticky top-0 z-30 flex">
            <div
              className="bg-surface/95 border-line text-fg-subtle sticky left-0 z-10 flex shrink-0 items-center border-r border-b px-2 text-[10px] font-semibold tracking-widest uppercase"
              style={{ width: TRACK_HEADER_WIDTH }}
            >
              Bars
            </div>
            <SongRuler bars={bars} zoom={zoom} />
          </div>
          <div className="flex">
            <div
              className="bg-surface border-line text-fg-subtle sticky left-0 z-10 flex shrink-0 items-center border-r border-b px-2 text-[10px] font-semibold tracking-widest uppercase"
              style={{ width: TRACK_HEADER_WIDTH }}
            >
              Sections
            </div>
            <SectionLane
              spans={spans}
              patterns={project.patterns}
              zoom={zoom}
              playingIndex={playingIndex}
              totalBars={bars}
            />
          </div>
          <MuteMatrix tracks={project.tracks} spans={spans} patterns={project.patterns} zoom={zoom} totalBars={bars} />
          <AutomationLanes lanes={project.automation} tracks={project.tracks} zoom={zoom} totalBars={bars} />
          <Playline zoom={zoom} scroller={scroller} />
        </div>
      </div>
    </div>
  );
}

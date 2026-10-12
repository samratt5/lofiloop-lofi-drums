'use client';

import { memo, useCallback, useRef, useState, type CSSProperties, type KeyboardEvent, type PointerEvent } from 'react';
import { Plus } from 'lucide-react';
import { engine } from '@/lib/audio/engine';
import { noteName } from '@/lib/music/theory';
import { CHOP_BASE_NOTE } from '@/lib/audio/instruments/sampler';
import { INSTRUMENTS, type InstrumentId } from '@/lib/project/instruments';
import { MAX_TRACKS, type Step, type Track } from '@/lib/project/types';
import { actions, getProject, selectActivePattern, useStudio } from '@/lib/store/studio';
import { ui, useUi } from '@/lib/store/ui';
import { usePlayhead } from '@/hooks/usePlayhead';
import { Popover } from '@/components/ui/Popover';
import { cn } from '@/lib/utils/cn';
import { InstrumentPicker } from './InstrumentPicker';
import { StepEditor } from './StepEditor';
import { TrackHeader } from './TrackHeader';

const GAP = 3;

/** Highlights the playing column with a generated stylesheet instead of re-rendering every pad. */
function PlayheadStyle({ patternId, scope }: { patternId: string; scope: string }) {
  const playhead = usePlayhead();
  if (!playhead.playing || playhead.patternId !== patternId || playhead.step < 0) return null;
  const col = playhead.step;
  return (
    <style>{`
      .${scope} .step[data-col="${col}"]::after { opacity: .28; }
      .${scope} .step[data-col="${col}"][data-on="true"] { filter: brightness(1.35) saturate(1.1); transform: scale(1.06); }
      .${scope} .ruler-cell[data-col="${col}"] { color: var(--accent-fg); background: var(--accent); }
    `}</style>
  );
}

interface StepPadProps {
  step: Step;
  index: number;
  row: number;
  color: string;
  melodic: boolean;
  showNote: boolean;
  /** Chopped sampler: label notes with their slice number */
  chop: boolean;
  dim: boolean;
  focused: boolean;
  trackName: string;
  barStart: boolean;
}

const StepPad = memo(function StepPad({
  step,
  index,
  row,
  color,
  melodic,
  showNote,
  chop,
  dim,
  focused,
  trackName,
  barStart,
}: StepPadProps) {
  const beatOdd = Math.floor(index / 4) % 2 === 1;
  return (
    <button
      type="button"
      data-cell=""
      data-row={row}
      data-col={index}
      data-on={step.on}
      data-beat={beatOdd ? 'odd' : 'even'}
      data-dim={dim}
      data-tail={step.on && melodic && step.len > 1 ? '' : undefined}
      tabIndex={focused ? 0 : -1}
      aria-pressed={step.on}
      aria-label={`${trackName} step ${index + 1}${step.on && melodic ? `, ${noteName(step.note)}` : ''}`}
      className={cn('step h-full min-w-0 touch-manipulation', barStart && 'ml-[3px]')}
      style={{ '--c': color, '--v': 0.35 + step.vel * 0.65 } as CSSProperties}
    >
      {step.on && (
        <>
          {melodic && step.len > 1 && (
            <span
              aria-hidden
              className="pointer-events-none absolute top-1/2 left-1/2 z-[1] h-1.5 -translate-y-1/2 rounded-full opacity-70"
              style={{ width: `calc(${step.len - 1} * (100% + ${GAP}px))`, background: color }}
            />
          )}
          {showNote && (
            <span className="pointer-events-none absolute inset-x-0 top-1 text-center font-mono text-[9px] leading-none font-bold text-black/70">
              {chop ? step.note - CHOP_BASE_NOTE + 1 : noteName(step.note, false)}
            </span>
          )}
          {step.ratchet > 1 && (
            <span aria-hidden className="pointer-events-none absolute inset-x-0 bottom-1 flex justify-center gap-[2px]">
              {Array.from({ length: step.ratchet }, (_, i) => (
                <span key={i} className="size-[3px] rounded-full bg-black/60" />
              ))}
            </span>
          )}
          {step.prob < 1 && (
            <span
              aria-hidden
              className="pointer-events-none absolute top-0.5 right-0.5 size-1.5 rounded-full border border-black/60"
              style={{ background: `conic-gradient(rgb(0 0 0 / .6) ${step.prob * 360}deg, transparent 0)` }}
            />
          )}
        </>
      )}
    </button>
  );
});

interface TrackRowProps {
  track: Track;
  steps: Step[];
  length: number;
  row: number;
  count: number;
  selected: boolean;
  dim: boolean;
  focusCol: number | null;
  template: string;
}

const TrackRow = memo(function TrackRow({
  track,
  steps,
  length,
  row,
  count,
  selected,
  dim,
  focusCol,
  template,
}: TrackRowProps) {
  const def = INSTRUMENTS[track.instrument];
  const pads = [];
  for (let i = 0; i < length; i++) {
    pads.push(
      <StepPad
        key={i}
        step={steps[i]}
        index={i}
        row={row}
        color={def.color}
        melodic={def.melodic}
        showNote={def.melodic}
        chop={track.sample?.mode === 'chop'}
        dim={dim}
        focused={focusCol === i}
        trackName={track.name}
        barStart={i > 0 && i % 16 === 0}
      />,
    );
  }
  return (
    <div
      role="row"
      data-track-row={track.id}
      className={cn('grid h-11 py-[3px] sm:h-12', selected && 'bg-surface-2/60')}
      style={{ gridTemplateColumns: template, columnGap: GAP }}
    >
      <TrackHeader track={track} index={row} count={count} selected={selected} />
      {pads}
    </div>
  );
});

function Ruler({ length, template, patternName }: { length: number; template: string; patternName: string }) {
  const cells = [];
  for (let i = 0; i < length; i++) {
    const beat = i % 4 === 0;
    const bar = i % 16 === 0;
    cells.push(
      <div
        key={i}
        data-col={i}
        className={cn(
          'ruler-cell flex h-5 items-center justify-center rounded font-mono text-[10px] tabular-nums transition-colors',
          bar ? 'text-fg-muted font-bold' : beat ? 'text-fg-subtle' : 'text-transparent',
          i > 0 && bar && 'ml-[3px]',
        )}
      >
        {bar ? `${i / 16 + 1}` : beat ? `${Math.floor(i / 16) + 1}.${(i % 16) / 4 + 1}` : '·'}
      </div>,
    );
  }
  return (
    <div
      role="row"
      className="border-line bg-surface/95 sticky top-0 z-20 grid border-b py-1.5 backdrop-blur"
      style={{ gridTemplateColumns: template, columnGap: GAP }}
    >
      <div className="bg-surface/95 text-fg-subtle sticky left-0 z-10 flex items-center gap-2 pl-2 text-[10px] font-semibold tracking-widest uppercase">
        Pattern <span className="bg-surface-3 text-fg rounded px-1.5 py-0.5 font-mono">{patternName}</span>
      </div>
      {cells}
    </div>
  );
}

function AddTrack({ disabled }: { disabled: boolean }) {
  const [anchor, setAnchor] = useState<{ x: number; y: number } | null>(null);
  const close = useCallback(() => setAnchor(null), []);
  const add = (id: InstrumentId) => {
    const created = actions.addTrack(id);
    if (created) ui.selectTrack(created);
    close();
  };
  return (
    <div className="sticky left-0 w-fit px-2 py-3">
      <button
        type="button"
        disabled={disabled}
        onClick={(e) => {
          const r = e.currentTarget.getBoundingClientRect();
          setAnchor(anchor ? null : { x: r.left + 180, y: r.bottom });
        }}
        className="border-line-strong text-fg-muted hover:border-accent hover:text-accent flex h-9 items-center gap-2 rounded-lg border border-dashed px-3 text-sm transition-colors disabled:opacity-40"
        title={disabled ? `Up to ${MAX_TRACKS} tracks` : 'Add a track'}
      >
        <Plus className="size-4" /> Add track
      </button>
      {anchor && (
        <Popover anchor={anchor} onClose={close} label="Choose an instrument" className="w-[340px]">
          <InstrumentPicker onSelect={add} />
        </Popover>
      )}
    </div>
  );
}

export function Sequencer() {
  const tracks = useStudio((s) => s.project.tracks);
  const pattern = useStudio(selectActivePattern);
  const selectedTrackId = useUi((s) => s.selectedTrackId);
  const stepEditor = useUi((s) => s.stepEditor);
  const scrollRef = useRef<HTMLDivElement>(null);
  const paint = useRef<{ trackId: string; row: number; on: boolean; visited: Set<number> } | null>(null);
  const touch = useRef<{ x: number; y: number; row: number; col: number; timer: ReturnType<typeof setTimeout> } | null>(
    null,
  );
  const [focus, setFocus] = useState<{ row: number; col: number }>({ row: 0, col: 0 });

  const anySolo = tracks.some((t) => t.solo);
  const len = pattern.length;
  const focusRow = Math.min(focus.row, tracks.length - 1);
  const focusCol = Math.min(focus.col, len - 1);
  const scope = `seq-${pattern.id}`;
  const template = `var(--hw) repeat(${len}, minmax(var(--cw), 1fr))`;

  const cellAt = (x: number, y: number) => {
    const el = document.elementFromPoint(x, y)?.closest<HTMLElement>('[data-cell]');
    if (!el || !scrollRef.current?.contains(el)) return null;
    return { row: Number(el.dataset.row), col: Number(el.dataset.col), el };
  };

  const audition = (track: Track, step: Step) => {
    if (!useUi.getState().audition || engine.isPlaying) return;
    void engine.preview(track, step.note, step.vel);
  };

  const openEditor = (row: number, col: number, el: HTMLElement) => {
    const track = getProject().tracks[row];
    if (!track) return;
    const r = el.getBoundingClientRect();
    ui.selectTrack(track.id);
    useUi.setState({ stepEditor: { trackId: track.id, index: col, anchor: { x: r.left + r.width / 2, y: r.bottom } } });
  };

  const toggleAt = (row: number, col: number) => {
    const project = getProject();
    const track = project.tracks[row];
    if (!track) return null;
    const step = selectActivePattern({ project }).steps[track.id]?.[col];
    if (!step) return null;
    const on = !step.on;
    actions.setStepsOn(track.id, [col], on);
    if (on) audition(track, step);
    ui.selectTrack(track.id);
    setFocus({ row, col });
    return { track, on };
  };

  const onPointerDown = (e: PointerEvent<HTMLDivElement>) => {
    const target = (e.target as HTMLElement).closest<HTMLElement>('[data-cell]');
    if (!target) return;
    const row = Number(target.dataset.row);
    const col = Number(target.dataset.col);
    if (e.pointerType === 'touch') {
      const timer = setTimeout(() => {
        touch.current = null;
        openEditor(row, col, target);
      }, 480);
      touch.current = { x: e.clientX, y: e.clientY, row, col, timer };
      return;
    }
    if (e.button !== 0) return;
    e.preventDefault();
    if (e.altKey || e.ctrlKey || e.metaKey) {
      openEditor(row, col, target);
      return;
    }
    const result = toggleAt(row, col);
    if (result) paint.current = { trackId: result.track.id, row, on: result.on, visited: new Set([col]) };
  };

  const onPointerMove = (e: PointerEvent<HTMLDivElement>) => {
    if (touch.current) {
      if (Math.hypot(e.clientX - touch.current.x, e.clientY - touch.current.y) > 8) {
        clearTimeout(touch.current.timer);
        touch.current = null;
      }
      return;
    }
    const p = paint.current;
    if (!p) return;
    const cell = cellAt(e.clientX, e.clientY);
    if (!cell || cell.row !== p.row || p.visited.has(cell.col)) return;
    p.visited.add(cell.col);
    actions.setStepsOn(p.trackId, [cell.col], p.on);
  };

  const onPointerUp = () => {
    if (touch.current) {
      clearTimeout(touch.current.timer);
      toggleAt(touch.current.row, touch.current.col);
      touch.current = null;
    }
    paint.current = null;
  };

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const target = e.target as HTMLElement;
    if (!target.dataset || target.dataset.cell === undefined) return;
    const row = Number(target.dataset.row);
    const col = Number(target.dataset.col);
    const moves: Record<string, [number, number]> = {
      ArrowLeft: [0, -1],
      ArrowRight: [0, 1],
      ArrowUp: [-1, 0],
      ArrowDown: [1, 0],
    };
    if (e.key in moves) {
      e.preventDefault();
      const [dr, dc] = moves[e.key];
      const next = {
        row: Math.max(0, Math.min(tracks.length - 1, row + dr)),
        col: Math.max(0, Math.min(len - 1, col + dc * (e.shiftKey ? 4 : 1))),
      };
      setFocus(next);
      ui.selectTrack(tracks[next.row].id);
      scrollRef.current?.querySelector<HTMLElement>(`[data-row="${next.row}"][data-col="${next.col}"]`)?.focus();
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (e.shiftKey) openEditor(row, col, target);
      else toggleAt(row, col);
    }
  };

  const editorTrack = stepEditor ? tracks.find((t) => t.id === stepEditor.trackId) : undefined;

  return (
    <div
      ref={scrollRef}
      data-tour="grid"
      className={cn(
        'relative min-h-0 flex-1 overflow-auto overscroll-contain [--cw:26px] [--hw:132px] sm:[--cw:30px] sm:[--hw:236px]',
        scope,
      )}
    >
      <PlayheadStyle patternId={pattern.id} scope={scope} />
      <div
        role="grid"
        aria-label={`Pattern ${pattern.name} steps`}
        aria-rowcount={tracks.length}
        aria-colcount={len}
        data-grid-nav=""
        className="min-w-fit pb-2 select-none"
        style={{ minWidth: `calc(var(--hw) + ${len} * (var(--cw) + ${GAP}px))` }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={() => {
          if (touch.current) clearTimeout(touch.current.timer);
          touch.current = null;
          paint.current = null;
        }}
        onContextMenu={(e) => {
          const target = (e.target as HTMLElement).closest<HTMLElement>('[data-cell]');
          if (!target) return;
          e.preventDefault();
          openEditor(Number(target.dataset.row), Number(target.dataset.col), target);
        }}
        onKeyDown={onKeyDown}
      >
        <Ruler length={len} template={template} patternName={pattern.name} />
        <div className="pr-2">
          {tracks.map((track, row) => (
            <TrackRow
              key={track.id}
              track={track}
              steps={pattern.steps[track.id]}
              length={len}
              row={row}
              count={tracks.length}
              selected={track.id === selectedTrackId}
              dim={track.mute || (anySolo && !track.solo)}
              focusCol={focusRow === row ? focusCol : null}
              template={template}
            />
          ))}
        </div>
        {tracks.length === 0 && (
          <p className="text-fg-muted sticky left-0 px-4 py-8 text-sm">
            No tracks yet. Add an instrument to start sequencing.
          </p>
        )}
        <AddTrack disabled={tracks.length >= MAX_TRACKS} />
      </div>
      {stepEditor && editorTrack && <StepEditor target={stepEditor} track={editorTrack} />}
    </div>
  );
}

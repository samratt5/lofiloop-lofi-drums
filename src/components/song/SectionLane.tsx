'use client';

import { useRef, useState, type PointerEvent } from 'react';
import { ArrowDownRight, ArrowUpRight, Lock, Plus } from 'lucide-react';
import type { sectionSpans } from '@/lib/audio/sequence';
import { MAX_SECTIONS, type Pattern } from '@/lib/project/types';
import { actions } from '@/lib/store/studio';
import { useUi } from '@/lib/store/ui';
import { setMainView } from '@/lib/transport';
import { cn } from '@/lib/utils/cn';
import { SECTION_COLORS } from './sectionStyle';

type Span = ReturnType<typeof sectionSpans>[number];

interface SectionLaneProps {
  spans: Span[];
  patterns: Pattern[];
  zoom: number;
  playingIndex: number;
  totalBars: number;
}

interface DragState {
  mode: 'move' | 'resize';
  index: number;
  x: number;
  dx: number;
  moved: boolean;
}

export function SectionLane({ spans, patterns, zoom, playingIndex, totalBars }: SectionLaneProps) {
  const selected = useUi((s) => s.selectedSectionId);
  const [drag, setDrag] = useState<DragState | null>(null);
  const dragRef = useRef<DragState | null>(null);
  const byId = new Map(patterns.map((p) => [p.id, p]));

  const update = (next: DragState | null) => {
    dragRef.current = next;
    setDrag(next);
  };

  const targetIndex = (d: DragState) => {
    const span = spans[d.index];
    const center = (span.startBar + span.bars / 2) * zoom + d.dx;
    let index = 0;
    spans.forEach((s, i) => {
      if (i !== d.index && (s.startBar + s.bars / 2) * zoom < center) index += 1;
    });
    return index;
  };

  const resizedRepeats = (d: DragState) => {
    const span = spans[d.index];
    const main = byId.get(span.section.patternId);
    const barsPerRepeat = main ? main.length / 16 : 1;
    const wanted = span.bars + d.dx / zoom;
    return Math.max(1, Math.min(16, Math.round(wanted / barsPerRepeat)));
  };

  const onPointerDown = (e: PointerEvent<HTMLElement>, index: number, mode: DragState['mode']) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    e.currentTarget.setPointerCapture(e.pointerId);
    useUi.setState({ selectedSectionId: spans[index].section.id });
    update({ mode, index, x: e.clientX, dx: 0, moved: false });
  };

  const onPointerMove = (e: PointerEvent<HTMLElement>) => {
    const d = dragRef.current;
    if (!d) return;
    const dx = e.clientX - d.x;
    update({ ...d, dx, moved: d.moved || Math.abs(dx) > 4 });
  };

  const onPointerUp = () => {
    const d = dragRef.current;
    update(null);
    if (!d || !d.moved) return;
    if (d.mode === 'move') {
      const to = targetIndex(d);
      if (to !== d.index) actions.moveSection(d.index, to);
    } else {
      const repeats = resizedRepeats(d);
      if (repeats !== spans[d.index].section.repeats) actions.updateSection(spans[d.index].section.id, { repeats });
    }
  };

  return (
    <div className="border-line relative h-[68px] border-b" style={{ width: (totalBars + 6) * zoom }}>
      {spans.map((span, index) => {
        const { section } = span;
        const pattern = byId.get(section.patternId);
        const color = SECTION_COLORS[section.kind];
        const isDragging = drag?.index === index && drag.moved;
        const width =
          isDragging && drag.mode === 'resize'
            ? Math.max(zoom, span.bars * zoom + drag.dx)
            : Math.max(8, span.bars * zoom);
        const offset = isDragging && drag.mode === 'move' ? drag.dx : 0;
        const active = section.id === selected;
        return (
          <div
            key={section.id}
            role="button"
            tabIndex={0}
            aria-label={`${section.name}, ${span.bars} bars`}
            aria-pressed={active}
            onPointerDown={(e) => onPointerDown(e, index, 'move')}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerCancel={() => update(null)}
            onDoubleClick={() => {
              actions.selectPattern(section.patternId);
              setMainView('pattern');
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') useUi.setState({ selectedSectionId: section.id });
              if ((e.key === 'Delete' || e.key === 'Backspace') && spans.length > 1) {
                e.preventDefault();
                e.stopPropagation();
                actions.removeSection(section.id);
              }
            }}
            title={`${section.name} · pattern ${pattern?.name ?? '?'} × ${section.repeats}. Drag to move, drag the right edge to change repeats, double-click to edit the pattern.`}
            className={cn(
              'group absolute top-2 bottom-2 cursor-grab touch-none overflow-hidden rounded-lg border px-2 py-1.5 text-left transition-[box-shadow,opacity] select-none active:cursor-grabbing',
              active ? 'ring-fg z-10 ring-2' : 'hover:brightness-110',
              isDragging && 'z-20 opacity-90 shadow-xl',
              playingIndex === index && 'shadow-[0_0_0_2px_var(--accent)]',
            )}
            style={{
              left: span.startBar * zoom + offset,
              width,
              background: `color-mix(in oklab, ${color} 30%, var(--surface-2))`,
              borderColor: `color-mix(in oklab, ${color} 70%, transparent)`,
            }}
          >
            <span className="absolute inset-y-0 left-0 w-1" style={{ background: color }} aria-hidden />
            <div className="flex items-center gap-1">
              <span className="text-fg truncate text-xs font-semibold">{section.name}</span>
              {section.locked && <Lock className="text-fg-muted size-3 shrink-0" aria-label="Locked" />}
            </div>
            <div className="text-fg-muted mt-0.5 flex items-center gap-1 text-[10px]">
              <span className="truncate font-mono">
                {pattern?.name ?? '?'}×{section.repeats}
                {section.fillPatternId ? '+fill' : ''}
              </span>
              {section.transpose !== 0 && (
                <span className="rounded bg-black/15 px-1 font-mono">
                  {section.transpose > 0 ? '+' : ''}
                  {section.transpose}
                </span>
              )}
              {section.bpm !== null && <span className="rounded bg-black/15 px-1 font-mono">{section.bpm}</span>}
              {section.enter !== 'none' && (
                <ArrowUpRight className="size-3 shrink-0" aria-label={`Enter: ${section.enter}`} />
              )}
              {section.exit !== 'none' && (
                <ArrowDownRight className="size-3 shrink-0" aria-label={`Exit: ${section.exit}`} />
              )}
            </div>
            <span
              role="separator"
              aria-label={`Resize ${section.name}`}
              onPointerDown={(e) => onPointerDown(e, index, 'resize')}
              onPointerMove={onPointerMove}
              onPointerUp={onPointerUp}
              className="absolute inset-y-0 right-0 w-2 cursor-ew-resize bg-black/0 group-hover:bg-black/15"
            />
          </div>
        );
      })}
      {spans.length < MAX_SECTIONS && (
        <button
          type="button"
          onClick={() => {
            const id = actions.addSection({ kind: 'verse' });
            if (id) useUi.setState({ selectedSectionId: id });
          }}
          className="border-line-strong text-fg-subtle hover:border-accent hover:text-accent absolute top-2 bottom-2 flex w-12 items-center justify-center rounded-lg border border-dashed"
          style={{ left: totalBars * zoom + 6 }}
          aria-label="Add section"
          title="Add a section at the end"
        >
          <Plus className="size-4" />
        </button>
      )}
    </div>
  );
}

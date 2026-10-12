'use client';

import { useRef, type PointerEvent } from 'react';
import { Trash2 } from 'lucide-react';
import {
  MASTER_AUTOMATION_PARAMS,
  TRACK_AUTOMATION_PARAMS,
  type AutomationLane,
  type AutomationPoint,
  type AutomationTarget,
  type Track,
} from '@/lib/project/types';
import { actions } from '@/lib/store/studio';
import { IconButton } from '@/components/ui/Button';
import { Select } from '@/components/ui/Select';
import { TRACK_HEADER_WIDTH } from './sectionStyle';

const LANE_HEIGHT = 56;
const PAD = 6;

const MASTER_LABELS: Record<(typeof MASTER_AUTOMATION_PARAMS)[number], string> = {
  volume: 'Volume',
  tone: 'Tape tone',
  filter: 'DJ filter',
  reverbMix: 'Reverb',
  delayMix: 'Echo',
  wow: 'Wow',
};

const TRACK_LABELS: Record<(typeof TRACK_AUTOMATION_PARAMS)[number], string> = {
  volume: 'Volume',
  pan: 'Pan',
  cutoff: 'Filter',
  reverb: 'Reverb send',
  delay: 'Echo send',
};

export function targetLabel(target: AutomationTarget, tracks: Track[]): string {
  const parts = target.split('.');
  if (parts[0] === 'master') return `Master · ${MASTER_LABELS[parts[1] as keyof typeof MASTER_LABELS] ?? parts[1]}`;
  const track = tracks.find((t) => t.id === parts[1]);
  return `${track?.name ?? 'Track'} · ${TRACK_LABELS[parts[2] as keyof typeof TRACK_LABELS] ?? parts[2]}`;
}

/** Sensible starting value for a new lane (the current setting). */
function initialValue(target: AutomationTarget, tracks: Track[]): number {
  const parts = target.split('.');
  if (parts[0] === 'master') return parts[1] === 'filter' || parts[1] === 'tone' ? 1 : 0.6;
  const track = tracks.find((t) => t.id === parts[1]);
  if (!track) return 0.5;
  switch (parts[2]) {
    case 'volume':
      return track.volume;
    case 'pan':
      return (track.pan + 1) / 2;
    case 'cutoff':
      return track.fx.cutoff;
    case 'reverb':
      return track.reverb;
    case 'delay':
      return track.delay;
    default:
      return 0.5;
  }
}

function LaneEditor({ lane, zoom, bars }: { lane: AutomationLane; zoom: number; bars: number }) {
  const drag = useRef<{ index: number; points: AutomationPoint[] } | null>(null);
  const width = Math.max(1, bars) * zoom;
  const toX = (t: number) => t * zoom;
  const toY = (v: number) => PAD + (1 - v) * (LANE_HEIGHT - PAD * 2);

  const locate = (e: PointerEvent<SVGSVGElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const t = Math.max(0, Math.min(bars, Math.round(((e.clientX - rect.left) / zoom) * 4) / 4));
    const v = Math.max(0, Math.min(1, 1 - (e.clientY - rect.top - PAD) / (LANE_HEIGHT - PAD * 2)));
    return { t, v: Math.round(v * 100) / 100 };
  };

  const commit = (points: AutomationPoint[]) => actions.setLanePoints(lane.id, points);

  const onPointerDown = (e: PointerEvent<SVGSVGElement>) => {
    if (e.button !== 0) return;
    const target = e.target as SVGElement;
    const index = target.dataset.point !== undefined ? Number(target.dataset.point) : -1;
    if (index >= 0 && (e.altKey || e.metaKey || e.ctrlKey)) {
      if (lane.points.length > 1) commit(lane.points.filter((_, i) => i !== index));
      return;
    }
    e.currentTarget.setPointerCapture(e.pointerId);
    if (index >= 0) {
      drag.current = { index, points: lane.points.map((p) => ({ ...p })) };
      return;
    }
    const point = locate(e);
    const points = [...lane.points.map((p) => ({ ...p })), point].sort((a, b) => a.t - b.t);
    drag.current = { index: points.indexOf(point), points };
    commit(points);
  };

  const onPointerMove = (e: PointerEvent<SVGSVGElement>) => {
    const d = drag.current;
    if (!d) return;
    const { t, v } = locate(e);
    const prev = d.points[d.index - 1];
    const next = d.points[d.index + 1];
    const clampedT = Math.max(prev ? prev.t : 0, Math.min(next ? next.t : bars, t));
    d.points[d.index] = { t: clampedT, v };
    commit(d.points.map((p) => ({ ...p })));
  };

  const sorted = [...lane.points].sort((a, b) => a.t - b.t);
  const path =
    sorted.length > 0
      ? [
          `M 0 ${toY(sorted[0].v)}`,
          ...sorted.map((p) => `L ${toX(p.t)} ${toY(p.v)}`),
          `L ${width} ${toY(sorted[sorted.length - 1].v)}`,
        ].join(' ')
      : '';

  return (
    <svg
      width={width}
      height={LANE_HEIGHT}
      className="bg-surface-2/40 block cursor-crosshair touch-none"
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={() => (drag.current = null)}
      onPointerCancel={() => (drag.current = null)}
      onContextMenu={(e) => {
        e.preventDefault();
        const index = Number((e.target as SVGElement).dataset.point ?? -1);
        if (index >= 0 && lane.points.length > 1) commit(sorted.filter((_, i) => i !== index));
      }}
      role="img"
      aria-label="Automation curve. Click to add points, drag to move, right-click to delete."
    >
      <path d={`${path} L ${width} ${LANE_HEIGHT} L 0 ${LANE_HEIGHT} Z`} className="fill-accent/15" />
      <path d={path} fill="none" className="stroke-accent" strokeWidth={2} />
      {sorted.map((p, i) => (
        <circle
          key={i}
          data-point={i}
          cx={toX(p.t)}
          cy={toY(p.v)}
          r={5}
          className="fill-surface stroke-accent cursor-grab"
          strokeWidth={2}
        >
          <title>{`Bar ${(p.t + 1).toFixed(2)} · ${Math.round(p.v * 100)}%`}</title>
        </circle>
      ))}
    </svg>
  );
}

interface AutomationLanesProps {
  lanes: AutomationLane[];
  tracks: Track[];
  zoom: number;
  totalBars: number;
}

export function AutomationLanes({ lanes, tracks, zoom, totalBars }: AutomationLanesProps) {
  const used = new Set(lanes.map((l) => l.target));
  return (
    <div className="border-line border-t pt-1 pb-6">
      {lanes.map((lane) => (
        <div key={lane.id} className="border-line/60 flex items-stretch border-b">
          <div
            className="bg-surface border-line sticky left-0 z-10 flex shrink-0 items-center gap-1 border-r pr-1 pl-2"
            style={{ width: TRACK_HEADER_WIDTH }}
          >
            <span className="text-fg-muted min-w-0 flex-1 truncate text-xs" title={targetLabel(lane.target, tracks)}>
              {targetLabel(lane.target, tracks)}
            </span>
            <IconButton label="Remove automation" size="xs" tip="none" onClick={() => actions.removeLane(lane.id)}>
              <Trash2 />
            </IconButton>
          </div>
          <LaneEditor lane={lane} zoom={zoom} bars={totalBars} />
        </div>
      ))}
      <div className="bg-surface sticky left-0 flex w-fit items-center gap-2 px-2 pt-2">
        <label className="sr-only" htmlFor="add-automation">
          Add automation
        </label>
        <Select
          id="add-automation"
          value=""
          onChange={(e) => {
            const target = e.target.value as AutomationTarget;
            if (target) actions.addLane(target, initialValue(target, tracks));
          }}
        >
          <option value="">+ Automate…</option>
          <optgroup label="Master">
            {MASTER_AUTOMATION_PARAMS.map((p) => (
              <option key={p} value={`master.${p}`} disabled={used.has(`master.${p}`)}>
                {MASTER_LABELS[p]}
              </option>
            ))}
          </optgroup>
          {tracks.map((t) => (
            <optgroup key={t.id} label={t.name}>
              {TRACK_AUTOMATION_PARAMS.map((p) => {
                const target = `track.${t.id}.${p}` as AutomationTarget;
                return (
                  <option key={p} value={target} disabled={used.has(target)}>
                    {t.name} · {TRACK_LABELS[p]}
                  </option>
                );
              })}
            </optgroup>
          ))}
        </Select>
        <span className="text-fg-subtle text-[11px]">Click to add points, drag to shape, right-click to delete.</span>
      </div>
    </div>
  );
}

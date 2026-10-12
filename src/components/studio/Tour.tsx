'use client';

import { useEffect, useLayoutEffect, useState } from 'react';
import { create } from 'zustand';
import { ArrowLeft, ArrowRight, X } from 'lucide-react';
import { ui, useUi } from '@/lib/store/ui';
import { setMainView } from '@/lib/transport';
import { Button, IconButton } from '@/components/ui/Button';

interface TourStep {
  /** `data-tour` anchor; none centres the card */
  target?: string;
  title: string;
  body: string;
  /** Get the UI into the right state before showing the step */
  prepare?: () => void;
}

const STEPS: TourStep[] = [
  {
    title: 'Welcome to LofiLoop',
    body: 'Make full lofi songs right in your browser: generate a track, shape its sound and arrange it from intro to outro. This takes about a minute.',
  },
  {
    target: 'play',
    title: 'Play and stop',
    body: 'Press here or hit Space. Everything keeps playing while you edit, so change things and listen straight away.',
  },
  {
    target: 'sidebar',
    title: 'Generate music',
    body: 'Create writes whole songs for you. Pick styles, a length and a mood, or describe it in words like “rainy late-night jazz, 2 minutes”.',
    prepare: () => ui.set({ sidebarTab: 'create', sidebarOpen: true }),
  },
  {
    target: 'views',
    title: 'Patterns and the arrangement',
    body: 'Patterns are short loops. The arrangement strings them into sections (intro, verse, hook) with transitions, key changes and automation.',
    prepare: () => setMainView('pattern'),
  },
  {
    target: 'grid',
    title: 'The step grid',
    body: 'Click a cell to add a note and drag to paint. Right-click (or long-press) a note to set its pitch, velocity, timing and length.',
  },
  {
    target: 'inspector',
    title: 'Shape each sound',
    body: 'The selected track’s sound lives here: tone, effects, ducking and groove. Turn on piano mode to play and record it from your keyboard.',
  },
  {
    target: 'discover',
    title: 'Discover and radio',
    body: 'Browse ready-made songs, or start an endless radio of fresh tracks in the styles you like.',
  },
  {
    target: 'versions',
    title: 'Versions',
    body: 'Save versions as you go and A/B them against what you have now. Your work also saves automatically, even offline.',
  },
  {
    target: 'export',
    title: 'Export',
    body: 'Download a mastered WAV or MP3, stems, MIDI, cover art or a music video.',
  },
];

interface TourState {
  index: number | null;
}

const useTour = create<TourState>()(() => ({ index: null }));

export function startTour(): void {
  useTour.setState({ index: 0 });
}

function finish() {
  useTour.setState({ index: null });
  ui.set({ tourSeen: true });
}

function visible(el: Element) {
  const r = el.getBoundingClientRect();
  return r.width > 0 && r.height > 0;
}

/** Visible steps only: some anchors don't exist on small screens. */
function findTarget(step: TourStep): DOMRect | null {
  if (!step.target) return null;
  const el = Array.from(document.querySelectorAll(`[data-tour="${step.target}"]`)).find(visible);
  return el ? el.getBoundingClientRect() : null;
}

function go(delta: number) {
  const current = useTour.getState().index ?? 0;
  const next = current + delta;
  if (next >= STEPS.length) finish();
  else if (next >= 0) useTour.setState({ index: next });
}

const PAD = 6;
const CARD_W = 320;

/** Spotlight tour; shown once on the first visit, and from Help any time. */
export function Tour() {
  const index = useTour((s) => s.index);
  const seen = useUi((s) => s.tourSeen);
  const [rect, setRect] = useState<DOMRect | null>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });

  // First visit: offer the tour once the studio has settled.
  useEffect(() => {
    if (seen) return;
    const id = setTimeout(() => {
      if (!useUi.getState().dialog) startTour();
    }, 900);
    return () => clearTimeout(id);
  }, [seen]);

  const step = index === null ? null : STEPS[index];

  useLayoutEffect(() => {
    if (!step) return;
    step.prepare?.();
    let frame = 0;
    const measure = () => {
      setRect(findTarget(step));
      setSize({ w: window.innerWidth, h: window.innerHeight });
    };
    // Wait a frame so `prepare` has rendered.
    frame = requestAnimationFrame(measure);
    window.addEventListener('resize', measure);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener('resize', measure);
    };
  }, [step]);

  useEffect(() => {
    if (index === null) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') finish();
      else if (e.key === 'ArrowRight' || e.key === 'Enter') go(1);
      else if (e.key === 'ArrowLeft') go(-1);
      else return;
      e.preventDefault();
      e.stopImmediatePropagation();
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [index]);

  if (index === null || !step) return null;

  const hole = rect
    ? {
        x: Math.max(0, rect.left - PAD),
        y: Math.max(0, rect.top - PAD),
        w: Math.min(size.w, rect.width + PAD * 2),
        h: Math.min(size.h, rect.height + PAD * 2),
      }
    : null;

  // Place the card beside the spotlight where it fits, else centre it.
  let cardStyle: React.CSSProperties = { left: '50%', top: '50%', transform: 'translate(-50%, -50%)' };
  if (hole && size.w > 0) {
    const width = Math.min(CARD_W, size.w - 32);
    const left = Math.min(Math.max(16, hole.x + hole.w / 2 - width / 2), size.w - width - 16);
    const below = hole.y + hole.h + 12;
    if (hole.h < size.h * 0.55 && below + 190 < size.h) cardStyle = { left, top: below, width };
    else if (hole.y - 200 > 0) cardStyle = { left, top: hole.y - 12, width, transform: 'translateY(-100%)' };
    else if (hole.x > width + 32) cardStyle = { left: hole.x - width - 16, top: Math.max(16, hole.y + 16), width };
    else cardStyle = { left, top: Math.max(16, size.h / 2 - 90), width };
  }

  return (
    <div className="fixed inset-0 z-[80]" role="dialog" aria-modal="true" aria-labelledby="tour-title">
      <svg className="absolute inset-0 size-full" aria-hidden onClick={finish}>
        <defs>
          <mask id="tour-mask">
            <rect width="100%" height="100%" fill="white" />
            {hole && <rect x={hole.x} y={hole.y} width={hole.w} height={hole.h} rx={12} fill="black" />}
          </mask>
        </defs>
        <rect width="100%" height="100%" fill="rgb(0 0 0 / 0.55)" mask="url(#tour-mask)" />
        {hole && (
          <rect
            x={hole.x}
            y={hole.y}
            width={hole.w}
            height={hole.h}
            rx={12}
            fill="none"
            stroke="var(--accent)"
            strokeWidth={2}
          />
        )}
      </svg>
      <div
        className="border-line-strong bg-surface animate-fade-in absolute w-80 max-w-[calc(100vw-32px)] rounded-2xl border p-4 shadow-2xl"
        style={cardStyle}
      >
        <div className="mb-1 flex items-start justify-between gap-2">
          <h2 id="tour-title" className="text-base font-semibold">
            {step.title}
          </h2>
          <IconButton label="Close the tour" tip="none" size="xs" onClick={finish}>
            <X />
          </IconButton>
        </div>
        <p className="text-fg-muted text-sm leading-relaxed">{step.body}</p>
        <div className="mt-4 flex items-center gap-2">
          <span className="text-fg-subtle font-mono text-xs">
            {index + 1} / {STEPS.length}
          </span>
          <div className="ml-auto flex gap-1.5">
            {index > 0 && (
              <Button size="sm" variant="ghost" icon={<ArrowLeft />} onClick={() => go(-1)}>
                Back
              </Button>
            )}
            {index === 0 && (
              <Button size="sm" variant="ghost" onClick={finish}>
                Skip
              </Button>
            )}
            <Button size="sm" variant="primary" onClick={() => go(1)}>
              {index === STEPS.length - 1 ? 'Start making music' : 'Next'}
              {index < STEPS.length - 1 && <ArrowRight />}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

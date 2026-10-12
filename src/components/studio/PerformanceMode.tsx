'use client';

import { useEffect, useState, useSyncExternalStore } from 'react';
import { AudioWaveform, Disc3, Droplets, Repeat2, Square, Play, X } from 'lucide-react';
import { engine } from '@/lib/audio/engine';
import { sectionSpans } from '@/lib/audio/sequence';
import { INSTRUMENTS } from '@/lib/project/instruments';
import { actions, useStudio } from '@/lib/store/studio';
import { ui, useUi } from '@/lib/store/ui';
import { usePlayhead } from '@/hooks/usePlayhead';
import { setPlayMode, togglePlayback } from '@/lib/transport';
import { SECTION_COLORS } from '@/components/song/sectionStyle';
import { cn } from '@/lib/utils/cn';
import { Visualizer } from './Visualizer';

type Hold = 'filter' | 'wash' | 'stutter';

function launch(bar: number) {
  setPlayMode('song');
  engine.queueSeek(bar);
}

function HoldPad({
  label,
  hint,
  icon,
  onDown,
  onUp,
}: {
  label: string;
  hint: string;
  icon: React.ReactNode;
  onDown: () => void;
  onUp: () => void;
}) {
  const [held, setHeld] = useState(false);
  const release = () => {
    if (!held) return;
    setHeld(false);
    onUp();
  };
  return (
    <button
      type="button"
      onPointerDown={(e) => {
        e.currentTarget.setPointerCapture(e.pointerId);
        setHeld(true);
        onDown();
      }}
      onPointerUp={release}
      onPointerCancel={release}
      onLostPointerCapture={release}
      className={cn(
        'flex h-24 touch-none flex-col items-center justify-center gap-1 rounded-2xl border text-sm font-semibold transition-colors select-none [&_svg]:size-6',
        held ? 'border-accent bg-accent text-accent-fg' : 'border-line-strong bg-surface-2 hover:bg-surface-3',
      )}
    >
      {icon}
      {label}
      <span className={cn('text-[10px] font-normal', held ? 'text-accent-fg/80' : 'text-fg-subtle')}>{hint}</span>
    </button>
  );
}

function SongStrip({ spans }: { spans: ReturnType<typeof sectionSpans> }) {
  const playhead = usePlayhead();
  const total = spans.reduce((sum, s) => sum + s.bars, 0) || 1;
  const bar = playhead.playing && playhead.mode === 'song' ? playhead.songStep / 16 : 0;
  return (
    <div className="mt-4">
      <div className="relative flex h-3 gap-0.5 overflow-hidden rounded-full" aria-hidden>
        {spans.map((span) => (
          <span
            key={span.section.id}
            className="h-full opacity-70"
            style={{ flex: span.bars, background: SECTION_COLORS[span.section.kind] }}
          />
        ))}
        <span
          className="bg-fg absolute inset-y-0 w-1 rounded-full shadow-[0_0_8px_var(--fg)]"
          style={{ left: `${(bar / total) * 100}%` }}
        />
      </div>
      <Visualizer className="mt-4 h-28 w-full" />
    </div>
  );
}

/** Full-screen live view: launch sections on the bar, toggle tracks and play momentary effects. */
export function PerformanceMode() {
  const open = useUi((s) => s.performance);
  const project = useStudio((s) => s.project);
  const playhead = usePlayhead();
  const queued = useSyncExternalStore(
    engine.subscribe,
    () => engine.queuedSeek,
    () => null,
  );

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') useUi.setState({ performance: false });
      const n = Number(e.key);
      if (n >= 1 && n <= 9 && !e.metaKey && !e.ctrlKey) {
        const span = sectionSpans(project)[n - 1];
        if (span) {
          e.preventDefault();
          e.stopImmediatePropagation();
          launch(span.startBar);
        }
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [open, project]);

  if (!open) return null;
  const spans = sectionSpans(project);
  const anySolo = project.tracks.some((t) => t.solo);

  const holdOn = (kind: Hold) => {
    if (kind === 'stutter') engine.stutter(2);
    else engine.liveEffect(kind, true);
  };
  const holdOff = (kind: Hold) => {
    if (kind === 'stutter') engine.stutter(null);
    else engine.liveEffect(kind, false);
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Performance mode"
      className="bg-bg/97 animate-fade-in fixed inset-0 z-[70] flex flex-col backdrop-blur-sm"
    >
      <header className="border-line flex h-16 shrink-0 items-center gap-3 border-b px-4">
        <button
          type="button"
          onClick={() => void togglePlayback()}
          aria-label={playhead.playing ? 'Stop' : 'Play'}
          className={cn(
            'flex size-11 items-center justify-center rounded-full [&_svg]:size-5',
            playhead.playing ? 'bg-fg text-bg' : 'bg-accent text-accent-fg',
          )}
        >
          {playhead.playing ? <Square className="fill-current" /> : <Play className="translate-x-px fill-current" />}
        </button>
        <div className="min-w-0">
          <p className="truncate text-base font-semibold">{project.name}</p>
          <p className="text-fg-muted text-xs">Sections launch on the next bar · keys 1–9 · hold the effect pads</p>
        </div>
        <button
          type="button"
          onClick={() => useUi.setState({ performance: false })}
          className="text-fg-muted hover:bg-surface-3 hover:text-fg ml-auto flex h-9 items-center gap-2 rounded-lg px-3 text-sm"
        >
          <X className="size-4" /> Exit
        </button>
      </header>
      <div className="grid min-h-0 flex-1 gap-6 overflow-y-auto p-4 lg:grid-cols-[1fr_320px]">
        <section aria-label="Sections">
          <h2 className="text-fg-subtle mb-2 text-[10px] font-semibold tracking-widest uppercase">Sections</h2>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-4">
            {spans.map((span, i) => {
              const playing = playhead.playing && playhead.mode === 'song' && playhead.sectionIndex === i;
              const isQueued = queued !== null && Math.round(span.startBar) === queued;
              const color = SECTION_COLORS[span.section.kind];
              return (
                <button
                  key={span.section.id}
                  type="button"
                  onClick={() => launch(span.startBar)}
                  className={cn(
                    'relative flex h-24 flex-col items-start justify-end rounded-2xl border-2 p-3 text-left transition-transform active:scale-[0.98]',
                    playing ? 'border-fg' : isQueued ? 'border-accent animate-pulse' : 'border-transparent',
                  )}
                  style={{ background: `color-mix(in oklab, ${color} ${playing ? 55 : 28}%, var(--surface-2))` }}
                >
                  <span className="text-fg-muted absolute top-2 left-3 font-mono text-[10px]">{i + 1}</span>
                  <span className="text-base font-semibold">{span.section.name}</span>
                  <span className="text-fg-muted text-xs">{span.bars} bars</span>
                </button>
              );
            })}
          </div>
          <SongStrip spans={spans} />
          <h2 className="text-fg-subtle mt-6 mb-2 text-[10px] font-semibold tracking-widest uppercase">Tracks</h2>
          <div className="grid grid-cols-3 gap-2 sm:grid-cols-4 xl:grid-cols-6">
            {project.tracks.map((t) => {
              const audible = !t.mute && (!anySolo || t.solo);
              const color = INSTRUMENTS[t.instrument].color;
              return (
                <button
                  key={t.id}
                  type="button"
                  aria-pressed={audible}
                  onClick={() => actions.toggleMute(t.id)}
                  className="border-line flex h-16 flex-col items-start justify-end rounded-xl border p-2 text-left text-sm font-medium transition-colors"
                  style={{
                    background: audible ? `color-mix(in oklab, ${color} 35%, var(--surface-2))` : 'var(--surface)',
                  }}
                >
                  <span className={cn('truncate', !audible && 'text-fg-subtle line-through')}>{t.name}</span>
                </button>
              );
            })}
          </div>
        </section>
        <section aria-label="Effects">
          <h2 className="text-fg-subtle mb-2 text-[10px] font-semibold tracking-widest uppercase">Hold for effects</h2>
          <div className="grid grid-cols-2 gap-2">
            <HoldPad
              label="Filter"
              hint="muffle the mix"
              icon={<AudioWaveform />}
              onDown={() => holdOn('filter')}
              onUp={() => holdOff('filter')}
            />
            <HoldPad
              label="Wash"
              hint="drown in reverb"
              icon={<Droplets />}
              onDown={() => holdOn('wash')}
              onUp={() => holdOff('wash')}
            />
            <HoldPad
              label="Stutter"
              hint="repeat an 8th"
              icon={<Repeat2 />}
              onDown={() => holdOn('stutter')}
              onUp={() => holdOff('stutter')}
            />
            <HoldPad
              label="Tape stop"
              hint="tap to brake"
              icon={<Disc3 />}
              onDown={() => engine.liveEffect('tapeStop', true)}
              onUp={() => undefined}
            />
          </div>
          <button
            type="button"
            onClick={() => ui.openDialog('export')}
            className="border-line text-fg-muted hover:bg-surface-3 mt-6 w-full rounded-xl border px-3 py-2 text-sm"
          >
            Happy with it? Export the song
          </button>
        </section>
      </div>
    </div>
  );
}

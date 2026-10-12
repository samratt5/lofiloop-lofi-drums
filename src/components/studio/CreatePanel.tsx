'use client';

import { useState } from 'react';
import {
  ArrowLeft,
  ArrowRight,
  Dices,
  Eraser,
  FlipHorizontal2,
  Lock,
  LockOpen,
  Repeat2,
  Shuffle,
  Sparkles,
  Wand2,
  Waves,
} from 'lucide-react';
import { GENRE_LIST, GENRES, type GenreId } from '@/lib/generate/genres';
import { generateBeat, generateProgression, generateTrackSteps, regeneratePattern } from '@/lib/generate/generators';
import {
  applyEuclid,
  clearSteps,
  humanize,
  mutate,
  repeatSection,
  reverseSteps,
  shiftSteps,
} from '@/lib/generate/transforms';
import { createRng, randomSeed } from '@/lib/music/rng';
import { scaleNotes } from '@/lib/music/theory';
import { INSTRUMENTS } from '@/lib/project/instruments';
import { rootNoteFor } from '@/lib/project/factory';
import type { Step } from '@/lib/project/types';
import { loadProject } from '@/lib/storage/library';
import { actions, getProject, selectActivePattern, useStudio } from '@/lib/store/studio';
import { ui, useUi } from '@/lib/store/ui';
import { Button } from '@/components/ui/Button';
import { Fader } from '@/components/ui/Fader';
import { cn } from '@/lib/utils/cn';
import { saveNow } from './bootstrap';
import { InstrumentBadge } from './InstrumentPicker';
import { SongGenerator } from './SongGenerator';

function Section({ title, hint, children }: { title: string; hint?: string; children: React.ReactNode }) {
  return (
    <section className="border-line bg-surface-2/50 rounded-xl border p-3">
      <header className="mb-2.5">
        <h3 className="text-sm font-semibold">{title}</h3>
        {hint && <p className="text-fg-subtle text-xs">{hint}</p>}
      </header>
      {children}
    </section>
  );
}

export function CreatePanel() {
  const [genre, setGenre] = useState<GenreId>('lofi');
  const [locked, setLocked] = useState<Set<string>>(new Set());
  const [hits, setHits] = useState(5);
  const [rotate, setRotate] = useState(0);
  const tracks = useStudio((s) => s.project.tracks);
  const pattern = useStudio(selectActivePattern);
  const selectedId = useUi((s) => s.selectedTrackId);
  const track = tracks.find((t) => t.id === selectedId);
  const g = GENRES[genre];

  const newBeat = () => {
    const previous = getProject();
    void saveNow();
    const project = generateBeat(genre, { seed: randomSeed() });
    actions.load(project);
    ui.selectTrack(project.tracks[0]?.id ?? null);
    ui.toast(`New ${g.name.toLowerCase()} beat: “${project.name}”`, 'success', {
      label: 'Go back',
      run: () => {
        void loadProject(previous.id).then((restored) => restored && actions.load(restored));
      },
    });
  };

  const fillPattern = () => {
    const result = regeneratePattern(getProject(), pattern.id, genre, { seed: randomSeed(), keep: locked });
    actions.setManySteps(result, pattern.id);
    ui.toast(`Generated pattern ${pattern.name}`, 'success', { label: 'Undo', run: actions.undo });
  };

  const transform = (fn: (steps: Step[], length: number) => Step[]) => {
    if (!track) return;
    const steps = selectActivePattern(useStudio.getState()).steps[track.id];
    actions.setTrackSteps(track.id, fn(steps, pattern.length));
  };

  const rerollTrack = () => {
    if (!track) return;
    const project = getProject();
    const rng = createRng(randomSeed());
    const ctx = { root: project.root, scale: project.scale, length: pattern.length, rng };
    const progression = generateProgression(genre, ctx);
    actions.setTrackSteps(track.id, generateTrackSteps(genre, track, ctx, progression));
  };

  const toggleLock = (id: string) =>
    setLocked((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const def = track ? INSTRUMENTS[track.instrument] : null;
  const notePool = () => {
    if (!track || !def?.melodic) return undefined;
    const { root, scale } = getProject();
    return scaleNotes(root, scale, def.noteRange[0], def.noteRange[1]);
  };

  return (
    <div className="flex flex-col gap-3 p-3">
      <SongGenerator />
      <Section title="Loops" hint={g.description}>
        <div className="flex flex-wrap gap-1">
          {GENRE_LIST.map((item) => (
            <button
              key={item.id}
              type="button"
              aria-pressed={item.id === genre}
              onClick={() => setGenre(item.id)}
              title={`${item.name}: ${item.bpm[0]}–${item.bpm[1]} BPM`}
              className={cn(
                'h-8 rounded-lg px-2.5 text-xs font-medium transition-colors',
                item.id === genre ? 'bg-accent text-accent-fg' : 'bg-surface-3 text-fg-muted hover:text-fg',
              )}
            >
              {item.name}
            </button>
          ))}
        </div>
        <div className="mt-3 grid grid-cols-2 gap-2">
          <Button size="sm" icon={<Sparkles />} onClick={newBeat}>
            New loop
          </Button>
          <Button
            size="sm"
            icon={<Dices />}
            onClick={fillPattern}
            title={`Regenerate pattern ${pattern.name} with the current tracks`}
          >
            Fill pattern {pattern.name}
          </Button>
        </div>
        <p className="text-fg-subtle mt-2 text-[11px]">
          New loop opens a fresh one-pattern beat (your current one stays in the library). Fill only rewrites unlocked
          tracks.
        </p>
        <ul className="mt-2 flex flex-wrap gap-1" aria-label="Keep tracks when filling">
          {tracks.map((t) => {
            const isLocked = locked.has(t.id);
            return (
              <li key={t.id}>
                <button
                  type="button"
                  aria-pressed={isLocked}
                  onClick={() => toggleLock(t.id)}
                  title={isLocked ? `${t.name} is kept when filling` : `Keep ${t.name} when filling`}
                  className={cn(
                    'flex h-6 items-center gap-1 rounded-md border px-1.5 text-[11px] transition-colors',
                    isLocked
                      ? 'border-accent/60 bg-accent-soft text-accent'
                      : 'border-line text-fg-muted hover:text-fg',
                  )}
                >
                  {isLocked ? <Lock className="size-3" /> : <LockOpen className="size-3" />}
                  {t.name}
                </button>
              </li>
            );
          })}
        </ul>
      </Section>

      <Section title="Track tools" hint={track ? undefined : 'Select a track to transform its steps.'}>
        {track && def && (
          <>
            <div className="mb-3 flex items-center gap-2">
              <InstrumentBadge id={track.instrument} />
              <span className="truncate text-sm font-medium">{track.name}</span>
              <span className="text-fg-subtle ml-auto text-[11px]">pattern {pattern.name}</span>
            </div>
            <div className="grid grid-cols-2 gap-1.5">
              <Button size="sm" icon={<Wand2 />} onClick={rerollTrack}>
                Re-roll part
              </Button>
              <Button
                size="sm"
                icon={<Shuffle />}
                onClick={() => transform((s, l) => mutate(s, l, 0.35, createRng(randomSeed()), notePool()))}
              >
                Mutate
              </Button>
              <Button
                size="sm"
                icon={<Waves />}
                onClick={() => transform((s, l) => humanize(s, l, 0.5, createRng(randomSeed())))}
              >
                Humanize
              </Button>
              <Button size="sm" icon={<FlipHorizontal2 />} onClick={() => transform(reverseSteps)}>
                Reverse
              </Button>
              <Button size="sm" icon={<ArrowLeft />} onClick={() => transform((s, l) => shiftSteps(s, l, -1))}>
                Nudge left
              </Button>
              <Button size="sm" icon={<ArrowRight />} onClick={() => transform((s, l) => shiftSteps(s, l, 1))}>
                Nudge right
              </Button>
              <Button
                size="sm"
                icon={<Repeat2 />}
                disabled={pattern.length < 8}
                onClick={() => transform((s, l) => repeatSection(s, l, Math.max(4, Math.floor(l / 2))))}
                title="Copy the first half over the second half"
              >
                Repeat half
              </Button>
              <Button size="sm" variant="danger" icon={<Eraser />} onClick={() => transform(clearSteps)}>
                Clear
              </Button>
            </div>

            <div className="bg-surface-3/40 mt-4 rounded-lg p-2.5">
              <div className="mb-2 flex items-center justify-between">
                <span className="text-xs font-semibold">Euclidean rhythm</span>
                <span className="text-fg-muted font-mono text-[11px]">
                  {Math.min(hits, pattern.length)} hits · rotate {rotate}
                </span>
              </div>
              <Fader
                label="Hits"
                value={Math.min(hits, pattern.length)}
                min={0}
                max={pattern.length}
                step={1}
                onChange={setHits}
              />
              <Fader label="Rotation" value={rotate} min={0} max={pattern.length - 1} step={1} onChange={setRotate} />
              <Button
                size="sm"
                className="mt-2 w-full"
                onClick={() => {
                  const note = rootNoteFor(track.instrument, getProject().root);
                  transform((s, l) => applyEuclid(s, l, Math.min(hits, l), rotate % l, note));
                }}
              >
                Apply to {track.name}
              </Button>
            </div>
          </>
        )}
      </Section>
    </div>
  );
}

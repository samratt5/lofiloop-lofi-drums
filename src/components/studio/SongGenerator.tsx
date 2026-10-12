'use client';

import { useMemo, useState } from 'react';
import { create } from 'zustand';
import { ChevronDown, Music4, Sparkles, X } from 'lucide-react';
import { GENRE_LIST, GENRES, type GenreId } from '@/lib/generate/genres';
import { parsePrompt, describeOptions } from '@/lib/generate/prompt';
import {
  DEFAULT_MOOD,
  generateSong,
  SONG_MINUTES,
  type Mood,
  type SongOptions,
  type StyleWeight,
} from '@/lib/generate/song';
import { AMBIENCE_LABELS } from '@/lib/audio/ambience';
import { randomSeed } from '@/lib/music/rng';
import { INSTRUMENT_LIST, type InstrumentId } from '@/lib/project/instruments';
import { AMBIENCE_TYPES, MAX_TRACKS, type AmbienceType } from '@/lib/project/types';
import { loadProject } from '@/lib/storage/library';
import { actions, getProject } from '@/lib/store/studio';
import { ui } from '@/lib/store/ui';
import { setMainView } from '@/lib/transport';
import { Button } from '@/components/ui/Button';
import { Fader } from '@/components/ui/Fader';
import { Select } from '@/components/ui/Select';
import { cn } from '@/lib/utils/cn';
import { formatDuration } from '@/lib/utils/format';
import { saveNow } from './bootstrap';
import { InstrumentBadge } from './InstrumentPicker';

interface Draft {
  prompt: string;
  styles: StyleWeight[];
  minutes: number;
  mood: Mood;
  instruments: InstrumentId[];
  ambience: AmbienceType | 'auto';
}

/** The generator's settings survive switching panels (not persisted). */
export const useSongDraft = create<Draft>()(() => ({
  prompt: '',
  styles: [{ genre: 'lofi', weight: 1 }],
  minutes: SONG_MINUTES.default,
  mood: { ...DEFAULT_MOOD },
  instruments: [],
  ambience: 'auto',
}));

const set = (patch: Partial<Draft>) => useSongDraft.setState(patch);

/** Everything the generator can write a part for (the sampler needs your own sound first). */
const FEATURED = INSTRUMENT_LIST.filter((i) => !i.sampler);

/** Panel settings, with anything the prompt names taking priority. */
export function songOptions(draft: Draft, seed = randomSeed()): SongOptions {
  const parsed = draft.prompt.trim() ? parsePrompt(draft.prompt).options : {};
  const options: SongOptions = {
    seed,
    styles: draft.styles,
    minutes: draft.minutes,
    mood: draft.mood,
    instruments: draft.instruments,
    ...(draft.ambience !== 'auto' ? { ambience: draft.ambience } : {}),
    ...parsed,
  };
  if (parsed.mood) options.mood = { ...draft.mood, ...parsed.mood };
  if (parsed.instruments) options.instruments = [...new Set([...draft.instruments, ...parsed.instruments])];
  return options;
}

/** Generates a whole song as a new beat (the open one stays in the library). */
export function createSong(options: SongOptions): void {
  const previous = getProject();
  void saveNow();
  let project;
  try {
    project = generateSong(options);
  } catch (error) {
    console.error(error);
    ui.toast('Could not write that song. Try other settings.', 'error');
    return;
  }
  actions.load(project);
  ui.selectTrack(project.tracks[0]?.id ?? null);
  setMainView('song');
  ui.toast(`New song: “${project.name}”`, 'success', {
    label: 'Go back',
    run: () => void loadProject(previous.id).then((restored) => restored && actions.load(restored)),
  });
}

function MoodSlider({
  label,
  left,
  right,
  value,
  onChange,
}: {
  label: string;
  left: string;
  right: string;
  value: number;
  onChange: (v: number) => void;
}) {
  return (
    <div className="flex flex-col gap-1">
      <div className="text-fg-subtle flex justify-between text-[10px] font-medium">
        <span>{left}</span>
        <span>{right}</span>
      </div>
      <Fader label={label} value={value} min={0} max={1} defaultValue={0.5} onChange={onChange} />
    </div>
  );
}

export function SongGenerator() {
  const draft = useSongDraft();
  const [more, setMore] = useState(false);
  const parsed = useMemo(() => (draft.prompt.trim() ? parsePrompt(draft.prompt) : null), [draft.prompt]);
  const summary = useMemo(() => describeOptions(songOptions(draft, 1)), [draft]);

  const toggleStyle = (genre: GenreId) => {
    const has = draft.styles.some((s) => s.genre === genre);
    if (has) {
      if (draft.styles.length > 1) set({ styles: draft.styles.filter((s) => s.genre !== genre) });
    } else {
      set({ styles: [...draft.styles, { genre, weight: 1 }] });
    }
  };

  const setWeight = (genre: GenreId, weight: number) =>
    set({ styles: draft.styles.map((s) => (s.genre === genre ? { ...s, weight } : s)) });

  const toggleInstrument = (id: InstrumentId) =>
    set({
      instruments: draft.instruments.includes(id)
        ? draft.instruments.filter((i) => i !== id)
        : [...draft.instruments, id],
    });

  const total = draft.styles.reduce((sum, s) => sum + s.weight, 0) || 1;

  return (
    <section className="border-accent/40 bg-accent-soft/40 rounded-xl border p-3" aria-label="Song generator">
      <header className="mb-2 flex items-center gap-2">
        <Music4 className="text-accent size-4" />
        <h3 className="text-sm font-semibold">Write a song</h3>
        <span className="text-fg-subtle ml-auto text-[11px]">intro to outro</span>
      </header>

      <label className="sr-only" htmlFor="song-prompt">
        Describe your song
      </label>
      <textarea
        id="song-prompt"
        value={draft.prompt}
        onChange={(e) => set({ prompt: e.target.value })}
        onKeyDown={(e) => {
          e.stopPropagation();
          if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) createSong(songOptions(useSongDraft.getState()));
        }}
        rows={2}
        maxLength={300}
        placeholder="Describe it, e.g. “rainy late-night jazz with guitar, 3 minutes”"
        className="border-line bg-surface-2 focus:border-line-strong placeholder:text-fg-subtle w-full resize-none rounded-lg border p-2 text-sm outline-none"
      />
      {parsed && parsed.matched.length > 0 && (
        <ul className="mt-1 flex flex-wrap items-center gap-1" aria-label="Understood">
          <li className="text-fg-subtle text-[10px]">Heard:</li>
          {parsed.matched.map((m) => (
            <li key={m} className="bg-surface-3 text-fg-muted rounded px-1.5 py-0.5 text-[10px]">
              {m}
            </li>
          ))}
        </ul>
      )}

      <div className="mt-3 mb-1 flex items-baseline gap-2">
        <p className="text-fg-subtle text-[10px] font-semibold tracking-widest uppercase">
          Styles <span className="font-normal normal-case">· pick as many as you like to blend</span>
        </p>
        <button
          type="button"
          onClick={() =>
            set({
              styles:
                draft.styles.length === GENRE_LIST.length
                  ? [draft.styles[0]]
                  : GENRE_LIST.map((g) => draft.styles.find((s) => s.genre === g.id) ?? { genre: g.id, weight: 1 }),
            })
          }
          className="text-fg-muted hover:text-fg ml-auto text-[11px]"
        >
          {draft.styles.length === GENRE_LIST.length ? 'Just one' : 'All'}
        </button>
      </div>
      <div className="flex flex-wrap gap-1">
        {GENRE_LIST.map((item) => {
          const on = draft.styles.some((s) => s.genre === item.id);
          return (
            <button
              key={item.id}
              type="button"
              aria-pressed={on}
              onClick={() => toggleStyle(item.id)}
              title={item.description}
              className={cn(
                'h-7 rounded-lg px-2 text-xs font-medium transition-colors',
                on ? 'bg-accent text-accent-fg' : 'bg-surface-3 text-fg-muted hover:text-fg',
              )}
            >
              {item.name}
            </button>
          );
        })}
      </div>
      {draft.styles.length > 1 && (
        <div className="mt-2 flex flex-col gap-1.5">
          {draft.styles.map((s) => (
            <div key={s.genre} className="flex items-center gap-2">
              <span className="w-20 truncate text-xs">{GENRES[s.genre].name}</span>
              <div className="flex-1">
                <Fader
                  label={`${GENRES[s.genre].name} amount`}
                  value={s.weight}
                  min={0.1}
                  max={1}
                  defaultValue={1}
                  onChange={(v) => setWeight(s.genre, v)}
                />
              </div>
              <span className="text-fg-subtle w-8 text-right font-mono text-[10px]">
                {Math.round((s.weight / total) * 100)}%
              </span>
            </div>
          ))}
        </div>
      )}

      <div className="mt-3 flex flex-col gap-1">
        <div className="flex items-baseline justify-between">
          <span className="text-fg-subtle text-[10px] font-semibold tracking-widest uppercase">Length</span>
          <span className="font-mono text-xs font-semibold">{formatDuration(draft.minutes * 60)}</span>
        </div>
        <Fader
          label="Length in minutes"
          value={draft.minutes}
          min={SONG_MINUTES.min}
          max={SONG_MINUTES.max}
          step={0.25}
          defaultValue={SONG_MINUTES.default}
          format={(v) => formatDuration(v * 60)}
          onChange={(v) => set({ minutes: v })}
        />
      </div>

      <div className="mt-3 grid grid-cols-1 gap-2">
        <MoodSlider
          label="Mood: sad to happy"
          left="Sad"
          right="Happy"
          value={draft.mood.valence}
          onChange={(v) => set({ mood: { ...draft.mood, valence: v } })}
        />
        <MoodSlider
          label="Energy: chill to hype"
          left="Chill"
          right="Hype"
          value={draft.mood.energy}
          onChange={(v) => set({ mood: { ...draft.mood, energy: v } })}
        />
        <MoodSlider
          label="Colour: dusty to bright"
          left="Dusty"
          right="Bright"
          value={draft.mood.brightness}
          onChange={(v) => set({ mood: { ...draft.mood, brightness: v } })}
        />
      </div>

      <button
        type="button"
        aria-expanded={more}
        onClick={() => setMore(!more)}
        className="text-fg-muted hover:text-fg mt-3 flex items-center gap-1 text-xs"
      >
        <ChevronDown className={cn('size-3.5 transition-transform', more && 'rotate-180')} />
        Instruments and atmosphere
        {draft.instruments.length > 0 && <span className="text-accent">· {draft.instruments.length}</span>}
      </button>
      {more && (
        <div className="mt-2 flex flex-col gap-2">
          <div className="flex items-baseline gap-2">
            <p className="text-fg-subtle text-[11px]">
              Make sure these play (as many as you like; songs grow to fit, up to {MAX_TRACKS} tracks):
            </p>
            {draft.instruments.length > 0 && (
              <button
                type="button"
                onClick={() => set({ instruments: [] })}
                className="text-fg-muted hover:text-fg ml-auto shrink-0 text-[11px]"
              >
                Clear
              </button>
            )}
          </div>
          <div className="flex flex-wrap gap-1">
            {FEATURED.map((inst) => {
              const on = draft.instruments.includes(inst.id);
              return (
                <button
                  key={inst.id}
                  type="button"
                  aria-pressed={on}
                  onClick={() => toggleInstrument(inst.id)}
                  className={cn(
                    'flex h-7 items-center gap-1.5 rounded-lg border pr-2 pl-1 text-[11px] transition-colors',
                    on ? 'border-accent bg-accent-soft text-fg' : 'border-line text-fg-muted hover:text-fg',
                  )}
                >
                  <InstrumentBadge id={inst.id} className="h-5 min-w-7 text-[8px]" />
                  {inst.name}
                  {on && <X className="size-3" />}
                </button>
              );
            })}
          </div>
          <label className="flex items-center gap-2 text-xs">
            <span className="text-fg-muted">Atmosphere</span>
            <Select
              value={draft.ambience}
              onChange={(e) => set({ ambience: e.target.value as Draft['ambience'] })}
              wrapperClassName="flex-1"
            >
              <option value="auto">Match the style</option>
              {AMBIENCE_TYPES.map((t) => (
                <option key={t} value={t}>
                  {AMBIENCE_LABELS[t]}
                </option>
              ))}
            </Select>
          </label>
        </div>
      )}

      <Button
        variant="primary"
        icon={<Sparkles />}
        className="mt-3 w-full"
        onClick={() => createSong(songOptions(useSongDraft.getState()))}
      >
        Generate song
      </Button>
      <p className="text-fg-subtle mt-1.5 text-[11px]" aria-live="polite">
        {summary}
        {parsed && parsed.matched.length > 0 && ' (your description wins over the controls)'}
      </p>
    </section>
  );
}

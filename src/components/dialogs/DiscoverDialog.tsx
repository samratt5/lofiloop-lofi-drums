'use client';

import { useEffect, useState } from 'react';
import { ExternalLink, Play, Radio } from 'lucide-react';
import { DISCOVER_PICKS, STATIONS, discoverSource, pickProject, radioSource } from '@/lib/discover';
import { buildSongTimeline } from '@/lib/audio/sequence';
import { GENRES } from '@/lib/generate/genres';
import { startListening } from '@/lib/listen';
import type { Project } from '@/lib/project/types';
import { createId } from '@/lib/utils/id';
import { actions } from '@/lib/store/studio';
import { ui, useUi } from '@/lib/store/ui';
import { Button, IconButton } from '@/components/ui/Button';
import { Dialog } from '@/components/ui/Dialog';
import { Cover } from '@/components/common/Cover';
import { formatDuration } from '@/lib/utils/format';
import { saveNow } from '@/components/studio/bootstrap';

interface Card {
  id: string;
  blurb: string;
  project: Project;
  seconds: number;
}

/** Stable cover seed from a station id (FNV-1a). */
function stationSeed(id: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < id.length; i++) h = Math.imul(h ^ id.charCodeAt(i), 0x01000193);
  return h >>> 0;
}

function openCopy(project: Project) {
  void saveNow();
  const now = Date.now();
  const copy = { ...project, id: createId('prj'), createdAt: now, updatedAt: now };
  actions.load(copy);
  ui.selectTrack(copy.tracks[0]?.id ?? null);
  ui.closeDialog();
  ui.toast(`Opened “${copy.name}”. It’s yours to remix and saved in your library.`, 'success');
}

export function DiscoverDialog() {
  const open = useUi((s) => s.dialog === 'discover');
  const [cards, setCards] = useState<Card[] | null>(null);

  // Songs are generated on first open (a few milliseconds each), then cached.
  useEffect(() => {
    if (!open || cards) return;
    const id = setTimeout(() => {
      setCards(
        DISCOVER_PICKS.map((pick) => {
          const project = pickProject(pick);
          return { id: pick.id, blurb: pick.blurb, project, seconds: buildSongTimeline(project).totalSeconds };
        }),
      );
    }, 0);
    return () => clearTimeout(id);
  }, [open, cards]);

  const listen = (index: number) => {
    startListening(discoverSource(), index);
    ui.closeDialog();
  };

  return (
    <Dialog
      open={open}
      onClose={ui.closeDialog}
      title="Discover"
      description="Full songs written right here on your device. Listen, then open any of them to make it your own."
      size="lg"
    >
      <section aria-labelledby="radio-title" className="mb-5">
        <h3 id="radio-title" className="mb-2 flex items-center gap-1.5 text-sm font-semibold">
          <Radio className="text-accent size-4" /> Radio
          <span className="text-fg-subtle text-xs font-normal">· endless new songs</span>
        </h3>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
          {STATIONS.map((station) => (
            <button
              key={station.id}
              type="button"
              onClick={() => {
                startListening(radioSource(station));
                ui.closeDialog();
              }}
              className="border-line bg-surface-2 hover:border-accent group flex items-center gap-2.5 rounded-xl border p-2 text-left transition-colors"
            >
              <span className="relative">
                <Cover
                  seed={stationSeed(station.id)}
                  title={station.name}
                  styles={station.styles.map((s) => GENRES[s.genre].name)}
                  size={40}
                />
                <span className="absolute inset-0 flex items-center justify-center rounded-lg bg-black/35 text-white opacity-0 transition-opacity group-hover:opacity-100">
                  <Play className="size-4 fill-current" />
                </span>
              </span>
              <span className="min-w-0">
                <span className="block truncate text-sm font-semibold">{station.name}</span>
                <span className="text-fg-muted block truncate text-xs">{station.blurb}</span>
              </span>
            </button>
          ))}
        </div>
      </section>

      <section aria-labelledby="gallery-title">
        <div className="mb-2 flex items-center gap-2">
          <h3 id="gallery-title" className="text-sm font-semibold">
            Gallery
          </h3>
          <Button
            size="xs"
            variant="ghost"
            icon={<Play />}
            className="ml-auto"
            disabled={!cards}
            onClick={() => listen(0)}
          >
            Play all
          </Button>
        </div>
        {!cards ? (
          <p className="text-fg-muted py-10 text-center text-sm">Writing songs…</p>
        ) : (
          <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
            {cards.map((card, index) => (
              <li key={card.id} className="group flex flex-col gap-1.5">
                <button
                  type="button"
                  onClick={() => listen(index)}
                  className="relative overflow-hidden rounded-xl"
                  aria-label={`Listen to ${card.project.name}`}
                >
                  <Cover
                    seed={card.project.meta.coverSeed}
                    title={card.project.name}
                    styles={card.project.meta.styles}
                    size={200}
                    text
                    fluid
                    className="rounded-xl"
                  />
                  <span className="absolute inset-0 flex items-center justify-center bg-black/35 text-white opacity-0 transition-opacity group-focus-within:opacity-100 group-hover:opacity-100">
                    <span className="bg-accent text-accent-fg flex size-11 items-center justify-center rounded-full">
                      <Play className="size-5 translate-x-px fill-current" />
                    </span>
                  </span>
                </button>
                <div className="flex items-start gap-1">
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-semibold">{card.project.name}</p>
                    <p className="text-fg-muted truncate text-xs">
                      {formatDuration(card.seconds)} · {card.blurb}
                    </p>
                  </div>
                  <IconButton label="Open in the studio" size="xs" tip="top" onClick={() => openCopy(card.project)}>
                    <ExternalLink />
                  </IconButton>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </Dialog>
  );
}

'use client';

import { Dices } from 'lucide-react';
import { GENRE_IDS } from '@/lib/generate/genres';
import { generateBeat } from '@/lib/generate/generators';
import { randomSeed } from '@/lib/music/rng';
import { TEMPLATES, type TemplateKind } from '@/lib/project/templates';
import { formatDuration } from '@/lib/utils/format';
import type { Project } from '@/lib/project/types';
import { actions } from '@/lib/store/studio';
import { ui, useUi } from '@/lib/store/ui';
import { Button } from '@/components/ui/Button';
import { Dialog } from '@/components/ui/Dialog';
import { saveNow } from '@/components/studio/bootstrap';

const GROUPS: { title: string; kinds: TemplateKind[] }[] = [
  { title: 'Start from scratch', kinds: ['blank', 'demo'] },
  { title: 'Full songs', kinds: ['song'] },
  { title: 'Loops', kinds: ['loop'] },
];

function start(project: Project) {
  void saveNow();
  actions.load(project);
  ui.selectTrack(project.tracks[0]?.id ?? null);
  ui.closeDialog();
}

export function NewBeatDialog() {
  const open = useUi((s) => s.dialog === 'new');
  return (
    <Dialog
      open={open}
      onClose={ui.closeDialog}
      title="Start a new beat"
      description="Your current beat is saved in the library. Want something specific? Use Write a song in the Create panel."
      size="lg"
      footer={
        <Button
          variant="primary"
          icon={<Dices />}
          onClick={() => {
            const genre = GENRE_IDS[Math.floor(Math.random() * GENRE_IDS.length)];
            start(generateBeat(genre, { seed: randomSeed() }));
          }}
        >
          Surprise me
        </Button>
      }
    >
      {GROUPS.map((group) => {
        const items = TEMPLATES.filter((t) => group.kinds.includes(t.kind));
        if (!items.length) return null;
        return (
          <section key={group.title} className="mb-4 last:mb-0">
            <h3 className="text-fg-subtle mb-2 text-[10px] font-semibold tracking-widest uppercase">{group.title}</h3>
            <ul className="grid gap-2 sm:grid-cols-2">
              {items.map((t) => (
                <li key={t.id}>
                  <button
                    type="button"
                    onClick={() => start(t.create())}
                    className="border-line bg-surface-2 hover:border-accent/60 hover:bg-accent-soft flex h-full w-full flex-col items-start gap-1 rounded-xl border p-3.5 text-left transition-colors"
                  >
                    <span className="flex w-full items-baseline gap-2">
                      <span className="text-sm font-semibold">{t.name}</span>
                      {t.minutes && (
                        <span className="text-fg-subtle ml-auto font-mono text-[11px]">
                          {formatDuration(t.minutes * 60)}
                        </span>
                      )}
                    </span>
                    <span className="text-fg-muted text-xs leading-relaxed">{t.description}</span>
                  </button>
                </li>
              ))}
            </ul>
          </section>
        );
      })}
    </Dialog>
  );
}

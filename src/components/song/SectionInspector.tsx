'use client';

import { useState } from 'react';
import { Copy, Dices, Lock, LockOpen, Pencil, Trash2 } from 'lucide-react';
import { regenerateSection, type SectionParts } from '@/lib/generate/song';
import { randomSeed } from '@/lib/music/rng';
import { SECTION_LABELS } from '@/lib/project/factory';
import {
  BPM_MAX,
  BPM_MIN,
  ENTER_TRANSITIONS,
  EXIT_TRANSITIONS,
  MAX_SECTION_REPEATS,
  SECTION_KINDS,
  type EnterTransition,
  type ExitTransition,
  type SectionKind,
} from '@/lib/project/types';
import { actions, getProject, useStudio } from '@/lib/store/studio';
import { ui, useUi } from '@/lib/store/ui';
import { setMainView } from '@/lib/transport';
import { Button } from '@/components/ui/Button';
import { DragNumber } from '@/components/ui/DragNumber';
import { Select } from '@/components/ui/Select';
import { Switch } from '@/components/ui/Switch';
import { SECTION_COLORS } from './sectionStyle';

const ENTER_LABELS: Record<EnterTransition, string> = { none: 'Cut in', filter: 'Filter sweep up', fade: 'Fade in' };
const EXIT_LABELS: Record<ExitTransition, string> = {
  none: 'Cut out',
  filter: 'Filter sweep down',
  fade: 'Fade out',
  drop: 'Drop (silence on the last beat)',
  tapeStop: 'Tape stop',
};

function Field({ label, children, htmlFor }: { label: string; children: React.ReactNode; htmlFor?: string }) {
  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={htmlFor} className="text-fg-subtle text-[10px] font-semibold tracking-widest uppercase">
        {label}
      </label>
      {children}
    </div>
  );
}

const PARTS: { value: SectionParts; label: string }[] = [
  { value: 'all', label: 'Everything' },
  { value: 'drums', label: 'Drums' },
  { value: 'harmony', label: 'Chords and bass' },
  { value: 'melody', label: 'Melody' },
];

function regenerate(sectionId: string, parts: SectionParts) {
  const before = getProject();
  const next = regenerateSection(before, sectionId, { seed: randomSeed(), parts });
  if (next === before) {
    ui.toast('Nothing to regenerate here (the section is locked or the song is full).', 'info');
    return;
  }
  actions.replace(next, 'Regenerate section');
}

export function SectionInspector() {
  const [parts, setParts] = useState<SectionParts>('all');
  const selectedId = useUi((s) => s.selectedSectionId);
  const section = useStudio((s) => s.project.arrangement.find((x) => x.id === selectedId) ?? null);
  const patterns = useStudio((s) => s.project.patterns);
  const bpm = useStudio((s) => s.project.bpm);
  const count = useStudio((s) => s.project.arrangement.length);

  if (!section) {
    return (
      <p className="text-fg-muted p-4 text-sm">
        Select a section in the timeline to edit it. Drag sections to reorder them, drag their right edge to change how
        many times they repeat, and click the grid below to choose which tracks play in each section.
      </p>
    );
  }

  const set = (patch: Parameters<typeof actions.updateSection>[1]) => actions.updateSection(section.id, patch);

  return (
    <div className="flex flex-wrap items-start gap-x-6 gap-y-4 p-4">
      <div className="flex w-full flex-col gap-2 sm:w-56">
        <Field label="Name" htmlFor="section-name">
          <input
            id="section-name"
            key={section.id}
            defaultValue={section.name}
            maxLength={40}
            onBlur={(e) => e.target.value.trim() && set({ name: e.target.value.trim() })}
            onKeyDown={(e) => {
              if (e.key === 'Enter') e.currentTarget.blur();
              e.stopPropagation();
            }}
            className="border-line bg-surface-2 focus:border-line-strong h-8 rounded-lg border px-2 text-sm outline-none"
          />
        </Field>
        <Field label="Type" htmlFor="section-kind">
          <div className="flex items-center gap-2">
            <span className="size-3 shrink-0 rounded-full" style={{ background: SECTION_COLORS[section.kind] }} />
            <Select
              id="section-kind"
              wrapperClassName="flex-1"
              value={section.kind}
              onChange={(e) => set({ kind: e.target.value as SectionKind })}
            >
              {SECTION_KINDS.map((k) => (
                <option key={k} value={k}>
                  {SECTION_LABELS[k]}
                </option>
              ))}
            </Select>
          </div>
        </Field>
      </div>

      <div className="flex w-full flex-col gap-2 sm:w-56">
        <Field label="Pattern" htmlFor="section-pattern">
          <Select id="section-pattern" value={section.patternId} onChange={(e) => set({ patternId: e.target.value })}>
            {patterns.map((p) => (
              <option key={p.id} value={p.id}>
                Pattern {p.name} · {p.length / 16} bar{p.length === 16 ? '' : 's'}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Last repeat plays" htmlFor="section-fill">
          <Select
            id="section-fill"
            value={section.fillPatternId ?? ''}
            onChange={(e) => set({ fillPatternId: e.target.value || null })}
          >
            <option value="">The same pattern</option>
            {patterns
              .filter((p) => p.id !== section.patternId)
              .map((p) => (
                <option key={p.id} value={p.id}>
                  Pattern {p.name} (fill)
                </option>
              ))}
          </Select>
        </Field>
      </div>

      <div className="flex gap-2">
        <DragNumber
          label="Repeats"
          value={section.repeats}
          min={1}
          max={MAX_SECTION_REPEATS}
          step={1}
          defaultValue={1}
          format={(v) => `×${v}`}
          onChange={(v) => set({ repeats: v })}
        />
        <DragNumber
          label="Key"
          value={section.transpose}
          min={-12}
          max={12}
          step={1}
          defaultValue={0}
          format={(v) => (v === 0 ? '±0' : `${v > 0 ? '+' : ''}${v} st`)}
          onChange={(v) => set({ transpose: v })}
        />
        <DragNumber
          label="Tempo"
          value={section.bpm ?? bpm}
          min={BPM_MIN}
          max={BPM_MAX}
          step={1}
          format={(v) => (section.bpm === null ? `${v} (song)` : `${v}`)}
          onChange={(v) => set({ bpm: v === bpm ? null : v })}
        />
      </div>

      <div className="flex w-full flex-col gap-2 sm:w-60">
        <Field label="Enter" htmlFor="section-enter">
          <Select
            id="section-enter"
            value={section.enter}
            onChange={(e) => set({ enter: e.target.value as EnterTransition })}
          >
            {ENTER_TRANSITIONS.map((t) => (
              <option key={t} value={t}>
                {ENTER_LABELS[t]}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Exit" htmlFor="section-exit">
          <Select
            id="section-exit"
            value={section.exit}
            onChange={(e) => set({ exit: e.target.value as ExitTransition })}
          >
            {EXIT_TRANSITIONS.map((t) => (
              <option key={t} value={t}>
                {EXIT_LABELS[t]}
              </option>
            ))}
          </Select>
        </Field>
      </div>

      <div className="flex w-full flex-col gap-2 sm:w-56">
        <Switch
          checked={section.locked}
          onChange={(locked) => set({ locked })}
          label="Lock section"
          description="Keep it when regenerating the song"
        />
        <div className="flex gap-1.5">
          <Button
            size="sm"
            variant="primary"
            icon={<Dices />}
            disabled={section.locked}
            onClick={() => regenerate(section.id, parts)}
            title="Write new patterns for this section in the song's key and style"
          >
            Regenerate
          </Button>
          <Select
            aria-label="Parts to regenerate"
            value={parts}
            onChange={(e) => setParts(e.target.value as SectionParts)}
            disabled={section.locked}
            wrapperClassName="flex-1"
          >
            {PARTS.map((p) => (
              <option key={p.value} value={p.value}>
                {p.label}
              </option>
            ))}
          </Select>
        </div>
        <div className="flex flex-wrap gap-1.5">
          <Button
            size="sm"
            icon={<Pencil />}
            onClick={() => {
              actions.selectPattern(section.patternId);
              setMainView('pattern');
            }}
          >
            Edit pattern
          </Button>
          <Button
            size="sm"
            variant="ghost"
            icon={<Copy />}
            onClick={() => {
              const id = actions.duplicateSection(section.id);
              if (id) useUi.setState({ selectedSectionId: id });
            }}
          >
            Duplicate
          </Button>
          <Button
            size="sm"
            variant="danger"
            icon={<Trash2 />}
            disabled={count <= 1}
            onClick={() => {
              actions.removeSection(section.id);
              useUi.setState({ selectedSectionId: null });
              ui.toast(`Deleted ${section.name}`, 'info', { label: 'Undo', run: actions.undo });
            }}
          >
            Delete
          </Button>
        </div>
        <p className="text-fg-subtle flex items-center gap-1 text-[11px]">
          {section.locked ? <Lock className="size-3" /> : <LockOpen className="size-3" />}
          {section.locked ? 'Locked sections are skipped by the generator.' : 'Unlocked: the generator may rewrite it.'}
        </p>
      </div>
    </div>
  );
}

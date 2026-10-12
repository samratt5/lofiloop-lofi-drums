'use client';

import { ChevronDown, ChevronUp } from 'lucide-react';
import { useStudio } from '@/lib/store/studio';
import { ui, useUi } from '@/lib/store/ui';
import { IconButton } from '@/components/ui/Button';
import { cn } from '@/lib/utils/cn';
import { SectionInspector } from './SectionInspector';
import { SECTION_COLORS } from './sectionStyle';

/** Bottom dock in the arrangement view, showing the selected section. */
export function SongDock() {
  const open = useUi((s) => s.inspectorOpen);
  const selectedId = useUi((s) => s.selectedSectionId);
  const section = useStudio((s) => s.project.arrangement.find((x) => x.id === selectedId) ?? null);
  return (
    <section
      aria-label="Section inspector"
      className={cn(
        'border-line bg-surface flex shrink-0 flex-col border-t transition-[height] duration-200',
        open ? 'h-[248px] sm:h-[232px]' : 'h-10',
      )}
    >
      <div className="border-line flex h-10 shrink-0 items-center gap-2 border-b px-2 sm:px-3">
        {section && <span className="size-3 rounded-full" style={{ background: SECTION_COLORS[section.kind] }} />}
        <span className="truncate text-sm font-semibold">{section ? section.name : 'Section'}</span>
        <IconButton
          label={open ? 'Collapse inspector' : 'Expand inspector'}
          tip="top"
          className="ml-auto"
          onClick={() => ui.set({ inspectorOpen: !open })}
        >
          {open ? <ChevronDown /> : <ChevronUp />}
        </IconButton>
      </div>
      {open && (
        <div className="min-h-0 flex-1 overflow-auto">
          <SectionInspector />
        </div>
      )}
    </section>
  );
}

'use client';

import { useState } from 'react';
import { actions, useStudio } from '@/lib/store/studio';

export function ProjectName() {
  const name = useStudio((s) => s.project.name);
  const [draft, setDraft] = useState<string | null>(null);

  const commit = () => {
    if (draft !== null) {
      const trimmed = draft.trim();
      if (trimmed && trimmed !== name) actions.setName(trimmed);
    }
    setDraft(null);
  };

  return (
    <input
      aria-label="Beat name"
      value={draft ?? name}
      onFocus={(e) => {
        setDraft(name);
        e.currentTarget.select();
      }}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter') e.currentTarget.blur();
        if (e.key === 'Escape') {
          setDraft(null);
          e.currentTarget.blur();
        }
      }}
      maxLength={120}
      spellCheck={false}
      className="text-fg hover:border-line focus:border-line-strong focus:bg-surface-2 h-8 w-full min-w-0 truncate rounded-md border border-transparent bg-transparent px-2 text-sm font-semibold transition-colors focus:outline-none"
    />
  );
}

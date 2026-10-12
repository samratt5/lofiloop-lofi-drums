'use client';

import { useCallback, useEffect, useState } from 'react';
import { ArrowLeftRight, Bookmark, Pencil, RotateCcw, Trash2 } from 'lucide-react';
import {
  deleteSnapshot,
  listSnapshots,
  loadSnapshot,
  renameSnapshot,
  saveSnapshot,
  StorageError,
  type SnapshotMeta,
} from '@/lib/storage/library';
import { startCompare } from '@/lib/compare';
import { engine } from '@/lib/audio/engine';
import { togglePlayback } from '@/lib/transport';
import { actions, getProject, useStudio } from '@/lib/store/studio';
import { ui, useUi } from '@/lib/store/ui';
import { Button, IconButton } from '@/components/ui/Button';
import { Dialog } from '@/components/ui/Dialog';
import { formatDuration, formatRelativeTime } from '@/lib/utils/format';
import { cn } from '@/lib/utils/cn';

function errorMessage(error: unknown, fallback: string) {
  return error instanceof StorageError ? error.message : fallback;
}

/** Saves the open project as an automatic version (before big, destructive changes). */
export async function autoSnapshot(): Promise<void> {
  try {
    await saveSnapshot(getProject(), '', { auto: true });
  } catch {
    // Best-effort: undo still covers the change.
  }
}

export function VersionsDialog() {
  const open = useUi((s) => s.dialog === 'versions');
  const projectId = useStudio((s) => s.project.id);
  const [items, setItems] = useState<SnapshotMeta[] | null>(null);
  const [name, setName] = useState('');
  const [renaming, setRenaming] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      setItems(await listSnapshots(projectId));
    } catch (error) {
      setItems([]);
      ui.toast(errorMessage(error, 'Could not read saved versions.'), 'error');
    }
  }, [projectId]);

  useEffect(() => {
    if (!open) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- reset transient UI when the dialog opens
    setRenaming(null);
    void refresh();
  }, [open, refresh]);

  const save = async () => {
    try {
      await saveSnapshot(getProject(), name.trim() || `Version ${(items?.filter((i) => !i.auto).length ?? 0) + 1}`);
      setName('');
      ui.toast('Version saved', 'success');
      await refresh();
    } catch (error) {
      ui.toast(errorMessage(error, 'Could not save the version.'), 'error');
    }
  };

  const restore = async (meta: SnapshotMeta) => {
    const project = await loadSnapshot(meta.id).catch(() => null);
    if (!project) {
      ui.toast('That version could not be opened.', 'error');
      return;
    }
    // Keep what's there now as a version too, so restoring is never a one-way door.
    await saveSnapshot(getProject(), '', { auto: true }).catch(() => undefined);
    actions.replace(project, `Restore “${meta.name}”`);
    ui.closeDialog();
    ui.toast(`Restored “${meta.name}”`, 'success', { label: 'Undo', run: actions.undo });
  };

  const compare = async (meta: SnapshotMeta) => {
    const project = await loadSnapshot(meta.id).catch(() => null);
    if (!project) return;
    startCompare(project, meta.name);
    ui.closeDialog();
    if (!engine.isPlaying) void togglePlayback();
  };

  const remove = async (meta: SnapshotMeta) => {
    await deleteSnapshot(meta.id).catch(() => undefined);
    await refresh();
  };

  return (
    <Dialog
      open={open}
      onClose={ui.closeDialog}
      title="Versions"
      description="Save the beat as it is now, come back to it later or A/B it against what you have. Versions are also saved automatically before big changes."
      size="lg"
    >
      <form
        className="mb-4 flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          void save();
        }}
      >
        <label className="flex-1">
          <span className="sr-only">Version name</span>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => e.stopPropagation()}
            maxLength={60}
            placeholder="Name this version (optional)"
            className="border-line bg-surface-2 focus:border-line-strong h-9 w-full rounded-lg border px-3 text-sm outline-none"
          />
        </label>
        <Button type="submit" variant="primary" icon={<Bookmark />}>
          Save version
        </Button>
      </form>
      {items === null ? (
        <p className="text-fg-muted py-8 text-center text-sm">Loading…</p>
      ) : items.length === 0 ? (
        <p className="text-fg-muted py-8 text-center text-sm">No versions of this beat yet.</p>
      ) : (
        <ul className="flex flex-col gap-1">
          {items.map((m) => (
            <li
              key={m.id}
              className="group hover:bg-surface-2 flex items-center gap-3 rounded-xl border border-transparent px-3 py-2"
            >
              <Bookmark className={cn('size-4 shrink-0', m.auto ? 'text-fg-subtle' : 'text-accent fill-current')} />
              <div className="min-w-0 flex-1">
                {renaming === m.id ? (
                  <input
                    autoFocus
                    defaultValue={m.name}
                    maxLength={60}
                    aria-label="Version name"
                    onBlur={async (e) => {
                      const value = e.target.value.trim();
                      setRenaming(null);
                      if (value && value !== m.name) {
                        await renameSnapshot(m.id, value).catch(() => undefined);
                        await refresh();
                      }
                    }}
                    onKeyDown={(e) => {
                      e.stopPropagation();
                      if (e.key === 'Enter') e.currentTarget.blur();
                      if (e.key === 'Escape') setRenaming(null);
                    }}
                    className="border-line bg-surface-2 h-7 w-full rounded-md border px-2 text-sm outline-none"
                  />
                ) : (
                  <p className="truncate text-sm font-semibold">{m.name}</p>
                )}
                <p className="text-fg-muted text-xs">
                  {formatRelativeTime(m.createdAt)} · {formatDuration(m.seconds)} · {m.bpm} BPM
                  {m.auto ? ' · automatic' : ''}
                </p>
              </div>
              <div className="flex items-center gap-0.5">
                <Button size="xs" variant="outline" icon={<ArrowLeftRight />} onClick={() => void compare(m)}>
                  A/B
                </Button>
                <Button size="xs" variant="outline" icon={<RotateCcw />} onClick={() => void restore(m)}>
                  Restore
                </Button>
                <IconButton label="Rename" tip="top" onClick={() => setRenaming(m.id)}>
                  <Pencil />
                </IconButton>
                <IconButton label="Delete" tip="top" className="hover:text-danger" onClick={() => void remove(m)}>
                  <Trash2 />
                </IconButton>
              </div>
            </li>
          ))}
        </ul>
      )}
    </Dialog>
  );
}

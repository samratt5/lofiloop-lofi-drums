'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Copy, Download, FileUp, FolderOpen, HardDrive, Play, Search, Trash2 } from 'lucide-react';
import { createId } from '@/lib/utils/id';
import { downloadBlob } from '@/lib/export/download';
import { ProjectParseError } from '@/lib/project/serialize';
import type { Project } from '@/lib/project/types';
import {
  deleteProject,
  duplicateProject,
  estimateStorage,
  exportBundle,
  importBundle,
  listProjects,
  loadProject,
  saveProject,
  StorageError,
  type ProjectMeta,
} from '@/lib/storage/library';
import { hydrateSamples } from '@/lib/storage/hydrate';
import { startListening, type ListenItem } from '@/lib/listen';
import { actions, getProject, useStudio } from '@/lib/store/studio';
import { ui, useUi } from '@/lib/store/ui';
import { Button, IconButton } from '@/components/ui/Button';
import { Dialog } from '@/components/ui/Dialog';
import { Cover } from '@/components/common/Cover';
import { formatBytes, formatDuration, formatRelativeTime, slugify } from '@/lib/utils/format';
import { cn } from '@/lib/utils/cn';
import { saveNow } from '@/components/studio/bootstrap';

/** Project files with embedded samples can be large; anything bigger isn't ours. */
const MAX_IMPORT_BYTES = 120 * 1024 * 1024;

async function openProject(project: Project) {
  await saveNow();
  actions.load(project);
  ui.selectTrack(project.tracks[0]?.id ?? null);
  ui.closeDialog();
  void hydrateSamples(project);
}

function listenItem(meta: ProjectMeta, currentId: string): ListenItem {
  return {
    key: meta.id,
    title: meta.name,
    artist: '',
    seed: meta.coverSeed,
    styles: meta.styles,
    load: async () => (meta.id === currentId ? getProject() : loadProject(meta.id)),
  };
}

function StorageMeter() {
  const [usage, setUsage] = useState<{ usage: number; quota: number } | null>(null);
  useEffect(() => {
    let alive = true;
    void estimateStorage().then((u) => alive && setUsage(u));
    return () => {
      alive = false;
    };
  }, []);
  if (!usage || !usage.quota) return null;
  return (
    <span className="text-fg-subtle hidden items-center gap-1.5 text-xs sm:flex" title="Space used in this browser">
      <HardDrive className="size-3.5" />
      {formatBytes(usage.usage)} of {formatBytes(usage.quota)}
    </span>
  );
}

export function LibraryDialog() {
  const open = useUi((s) => s.dialog === 'library');
  const currentId = useStudio((s) => s.project.id);
  const [items, setItems] = useState<ProjectMeta[] | null>(null);
  const [query, setQuery] = useState('');
  const [confirming, setConfirming] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const refresh = useCallback(async () => {
    try {
      setItems(await listProjects());
    } catch (error) {
      setItems([]);
      ui.toast(error instanceof StorageError ? error.message : 'Could not read your library.', 'error');
    }
  }, []);

  useEffect(() => {
    if (!open) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- reset transient UI when the dialog opens
    setConfirming(null);
    // Save first so the open beat's entry is fresh.
    void saveNow().then(refresh);
  }, [open, refresh]);

  const importFiles = async (files: FileList | File[]) => {
    const file = Array.from(files)[0];
    if (!file) return;
    if (file.size > MAX_IMPORT_BYTES) {
      ui.toast('That file is too large to be a LofiLoop project.', 'error');
      return;
    }
    try {
      const { project, samplesImported } = await importBundle(await file.text());
      const exists = (items ?? []).some((m) => m.id === project.id);
      const copy: Project = { ...project, id: exists ? createId('prj') : project.id, updatedAt: Date.now() };
      await saveProject(copy);
      await openProject(copy);
      ui.toast(
        `Imported “${copy.name}”${samplesImported ? ` with ${samplesImported} sample${samplesImported === 1 ? '' : 's'}` : ''}`,
        'success',
      );
    } catch (error) {
      ui.toast(
        error instanceof ProjectParseError || error instanceof StorageError
          ? error.message
          : 'Could not import that file.',
        'error',
      );
    }
  };

  const open_ = async (id: string) => {
    const project = await loadProject(id).catch(() => null);
    if (project) await openProject(project);
    else ui.toast('That beat could not be opened.', 'error');
  };

  const duplicate = async (id: string) => {
    if (id === currentId) await saveNow();
    const copy = await duplicateProject(id).catch(() => null);
    if (!copy) ui.toast('Could not duplicate that beat.', 'error');
    await refresh();
  };

  const download = async (id: string) => {
    const project = id === currentId ? getProject() : await loadProject(id);
    if (!project) return;
    const hasSamples = project.tracks.some((t) => t.sample);
    downloadBlob(await exportBundle(project, { includeSamples: hasSamples }), `${slugify(project.name)}.lofiloop.json`);
  };

  const remove = async (id: string) => {
    setConfirming(null);
    await deleteProject(id);
    if (id === currentId) {
      const next = (await listProjects())[0];
      const project = next ? await loadProject(next.id) : null;
      if (project) actions.load(project);
      else ui.openDialog('new');
    }
    await refresh();
  };

  const q = query.trim().toLowerCase();
  const filtered = (items ?? []).filter(
    (m) => m.name.toLowerCase().includes(q) || m.styles.some((s) => s.toLowerCase().includes(q)),
  );

  const playFrom = (index: number) => {
    const list = filtered;
    startListening(
      {
        label: q ? `Library · “${query.trim()}”` : 'Your library',
        kind: 'library',
        size: list.length,
        item: (i) => (list[i] ? listenItem(list[i], currentId) : null),
      },
      index,
    );
    ui.closeDialog();
  };

  return (
    <Dialog
      open={open}
      onClose={ui.closeDialog}
      title="Your beats"
      description="Everything is saved in this browser, even offline. Download a file to back a beat up or move it to another device."
      size="lg"
      footer={
        <>
          <input
            ref={fileRef}
            type="file"
            accept=".json,application/json"
            className="hidden"
            onChange={(e) => {
              if (e.target.files) void importFiles(e.target.files);
              e.target.value = '';
            }}
          />
          <Button variant="ghost" icon={<FileUp />} onClick={() => fileRef.current?.click()}>
            Import file
          </Button>
          <span className="mr-auto">
            <StorageMeter />
          </span>
          <Button variant="primary" onClick={() => ui.openDialog('new')}>
            New beat
          </Button>
        </>
      }
    >
      <div
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          void importFiles(e.dataTransfer.files);
        }}
        className={cn('rounded-xl transition-colors', dragging && 'bg-accent-soft ring-accent ring-dashed ring-2')}
      >
        <div className="mb-3 flex items-center gap-2">
          <label className="relative block flex-1">
            <span className="sr-only">Search beats</span>
            <Search className="text-fg-subtle pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2" />
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search by name or style"
              className="border-line bg-surface-2 focus:border-line-strong h-9 w-full rounded-lg border pr-3 pl-9 text-sm outline-none"
            />
          </label>
          <Button icon={<Play />} disabled={!filtered.length} onClick={() => playFrom(0)}>
            Play all
          </Button>
        </div>
        {items === null ? (
          <p className="text-fg-muted py-10 text-center text-sm">Opening your library…</p>
        ) : filtered.length === 0 ? (
          <p className="text-fg-muted py-10 text-center text-sm">
            {items.length
              ? 'No beats match your search.'
              : 'No saved beats yet. Drop a .json project here to import it.'}
          </p>
        ) : (
          <ul className="flex flex-col gap-1">
            {filtered.map((m, index) => {
              const current = m.id === currentId;
              return (
                <li
                  key={m.id}
                  className={cn(
                    'group flex items-center gap-3 rounded-xl border px-2 py-2 transition-colors',
                    current ? 'border-accent/50 bg-accent-soft' : 'hover:bg-surface-2 border-transparent',
                  )}
                >
                  <button
                    type="button"
                    onClick={() => playFrom(index)}
                    className="group/cover relative shrink-0 rounded-lg"
                    aria-label={`Listen to ${m.name}`}
                  >
                    <Cover seed={m.coverSeed} title={m.name} styles={m.styles} size={48} />
                    <span className="absolute inset-0 flex items-center justify-center rounded-lg bg-black/40 text-white opacity-0 transition-opacity group-hover/cover:opacity-100 group-focus-visible/cover:opacity-100">
                      <Play className="size-5 fill-current" />
                    </span>
                  </button>
                  <button
                    type="button"
                    disabled={current}
                    onClick={() => void open_(m.id)}
                    className="min-w-0 flex-1 text-left disabled:cursor-default"
                  >
                    <span className="flex items-center gap-2">
                      <span className="truncate text-sm font-semibold">{m.name}</span>
                      {current && (
                        <span className="bg-accent text-accent-fg rounded px-1.5 py-px text-[10px] font-bold">
                          OPEN
                        </span>
                      )}
                    </span>
                    <span className="text-fg-muted mt-0.5 block truncate text-xs">
                      {formatDuration(m.seconds)} · {m.bpm} BPM · {m.key} · {m.sections} section
                      {m.sections === 1 ? '' : 's'} · edited {formatRelativeTime(m.updatedAt)}
                    </span>
                  </button>
                  {confirming === m.id ? (
                    <div className="flex items-center gap-1">
                      <Button size="xs" variant="danger" onClick={() => void remove(m.id)}>
                        Delete
                      </Button>
                      <Button size="xs" variant="ghost" onClick={() => setConfirming(null)}>
                        Keep
                      </Button>
                    </div>
                  ) : (
                    <div className="flex items-center gap-0.5 opacity-100 transition-opacity sm:opacity-0 sm:group-focus-within:opacity-100 sm:group-hover:opacity-100">
                      {!current && (
                        <IconButton label="Open" tip="top" onClick={() => void open_(m.id)}>
                          <FolderOpen />
                        </IconButton>
                      )}
                      <IconButton label="Duplicate" tip="top" onClick={() => void duplicate(m.id)}>
                        <Copy />
                      </IconButton>
                      <IconButton label="Download file" tip="top" onClick={() => void download(m.id)}>
                        <Download />
                      </IconButton>
                      <IconButton
                        label="Delete"
                        tip="top"
                        onClick={() => setConfirming(m.id)}
                        className="hover:text-danger"
                      >
                        <Trash2 />
                      </IconButton>
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </Dialog>
  );
}

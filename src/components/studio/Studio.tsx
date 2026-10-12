'use client';

import { useEffect } from 'react';
import { createId } from '@/lib/utils/id';
import { decodeShareData, readShareHash } from '@/lib/project/share';
import { actions, useStudio } from '@/lib/store/studio';
import { ui, useUi } from '@/lib/store/ui';
import { useHotkeys } from '@/hooks/useHotkeys';
import { useMeters } from '@/hooks/useMeters';
import { useIsPlaying } from '@/hooks/usePlayhead';
import { Toaster } from '@/components/ui/Toaster';
import { ExportDialog } from '@/components/dialogs/ExportDialog';
import { LibraryDialog } from '@/components/dialogs/LibraryDialog';
import { NewBeatDialog } from '@/components/dialogs/NewBeatDialog';
import { ShareDialog } from '@/components/dialogs/ShareDialog';
import { ShortcutsDialog } from '@/components/dialogs/ShortcutsDialog';
import { saveNow } from './bootstrap';
import { CompareBar } from '@/components/listen/CompareBar';
import { ListenBar } from '@/components/listen/ListenBar';
import { VersionsDialog } from '@/components/dialogs/VersionsDialog';
import { DiscoverDialog } from '@/components/dialogs/DiscoverDialog';
import { SongDock } from '@/components/song/SongDock';
import { SongView } from '@/components/song/SongView';
import { Inspector } from './Inspector';
import { KeyboardDock } from './KeyboardDock';
import { PerformanceMode } from './PerformanceMode';
import { Tour } from './Tour';
import { PatternBar } from './PatternBar';
import { Sequencer } from './Sequencer';
import { Sidebar } from './Sidebar';
import { StatusBar } from './StatusBar';
import { TopBar } from './TopBar';

/** Opens a beat shared via `#beat=...` as a new copy in the library. */
function useSharedBeat() {
  useEffect(() => {
    const data = readShareHash(window.location.hash);
    if (!data) return;
    window.history.replaceState(null, '', window.location.pathname + window.location.search);
    decodeShareData(data)
      .then((shared) => {
        const now = Date.now();
        void saveNow();
        const project = { ...shared, id: createId('prj'), createdAt: now, updatedAt: now };
        actions.load(project);
        ui.selectTrack(project.tracks[0]?.id ?? null);
        ui.toast(`Opened shared beat “${project.name}”. It's saved in your library.`, 'success');
      })
      .catch(() => ui.toast('That share link is broken or incomplete.', 'error'));
  }, []);
}

/**
 * Next streams its metadata <title> in after the studio mounts, so a plain
 * effect gets overwritten; re-assert the beat's name whenever the head changes.
 */
function useDocumentTitle(title: string) {
  useEffect(() => {
    const apply = () => {
      if (document.title !== title) document.title = title;
    };
    apply();
    const observer = new MutationObserver(apply);
    observer.observe(document.head, { childList: true, subtree: true, characterData: true });
    return () => observer.disconnect();
  }, [title]);
}

/** Keep the space bar from re-clicking the last focused button after we use it for play/stop. */
function useSpaceGuard() {
  useEffect(() => {
    const onKeyUp = (e: KeyboardEvent) => {
      if (e.key === ' ' && e.target instanceof HTMLButtonElement) e.preventDefault();
    };
    window.addEventListener('keyup', onKeyUp, true);
    return () => window.removeEventListener('keyup', onKeyUp, true);
  }, []);
}

export default function Studio() {
  const playing = useIsPlaying();
  const name = useStudio((s) => s.project.name);
  const view = useUi((s) => s.mainView);
  useDocumentTitle(`${name} · LofiLoop`);
  useHotkeys();
  useSpaceGuard();
  useSharedBeat();
  useMeters(playing);

  return (
    <div className="bg-bg text-fg flex h-dvh flex-col overflow-hidden">
      <TopBar />
      <div className="flex min-h-0 flex-1">
        <main className="flex min-w-0 flex-1 flex-col">
          <PatternBar />
          {view === 'song' ? (
            <>
              <SongView />
              <SongDock />
            </>
          ) : (
            <>
              <Sequencer />
              <Inspector />
            </>
          )}
        </main>
        <Sidebar />
      </div>
      <KeyboardDock />
      <CompareBar />
      <ListenBar />
      <StatusBar />
      <ExportDialog />
      <LibraryDialog />
      <NewBeatDialog />
      <ShareDialog />
      <ShortcutsDialog />
      <VersionsDialog />
      <DiscoverDialog />
      <PerformanceMode />
      <Tour />
      <Toaster />
    </div>
  );
}

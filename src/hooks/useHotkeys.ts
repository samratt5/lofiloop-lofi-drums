'use client';

import { useEffect } from 'react';
import { engine } from '@/lib/audio/engine';
import { liveInput } from '@/lib/input/live';
import { actions, getProject, selectActivePattern, useStudio } from '@/lib/store/studio';
import { ui, useUi } from '@/lib/store/ui';
import { tapTempo } from '@/lib/utils/tapTempo';
import { saveNow } from '@/components/studio/bootstrap';
import { togglePlayback } from '@/lib/transport';

function isEditable(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  const tag = target.tagName;
  if (tag === 'TEXTAREA' || tag === 'SELECT') return true;
  if (tag === 'INPUT') {
    const type = (target as HTMLInputElement).type;
    return !['range', 'checkbox', 'radio', 'button'].includes(type);
  }
  return false;
}

function modalOpen(): boolean {
  return Boolean(document.querySelector('dialog[open]'));
}

export const SHORTCUTS: { keys: string[]; action: string; group: string }[] = [
  { keys: ['Space'], action: 'Play / stop', group: 'Transport' },
  { keys: ['K'], action: 'Toggle metronome', group: 'Transport' },
  { keys: ['T'], action: 'Tap tempo', group: 'Transport' },
  { keys: ['1–8'], action: 'Select pattern A–H', group: 'Patterns' },
  { keys: ['Mod', 'C'], action: 'Copy pattern', group: 'Patterns' },
  { keys: ['Mod', 'V'], action: 'Paste pattern', group: 'Patterns' },
  { keys: ['↑', '↓'], action: 'Select track', group: 'Tracks' },
  { keys: ['M'], action: 'Mute selected track', group: 'Tracks' },
  { keys: ['S'], action: 'Solo selected track', group: 'Tracks' },
  { keys: ['Mod', 'D'], action: 'Duplicate selected track', group: 'Tracks' },
  { keys: ['Del'], action: 'Clear selected track', group: 'Tracks' },
  { keys: ['Mod', 'Z'], action: 'Undo', group: 'Project' },
  { keys: ['Mod', 'Shift', 'Z'], action: 'Redo', group: 'Project' },
  { keys: ['Mod', 'S'], action: 'Save now', group: 'Project' },
  { keys: ['Mod', 'E'], action: 'Export', group: 'Project' },
  { keys: ['Mod', 'O'], action: 'Open library', group: 'Project' },
  { keys: ['P'], action: 'Play the selected track from your keyboard', group: 'Keyboard piano' },
  { keys: ['Z–/', 'Q–]'], action: 'Notes (two rows, like a piano)', group: 'Keyboard piano' },
  { keys: ['←', '→'], action: 'Octave down / up', group: 'Keyboard piano' },
  { keys: ['Shift'], action: 'Accent (hold while playing)', group: 'Keyboard piano' },
  { keys: ['Esc'], action: 'Leave piano mode (letter and number shortcuts return)', group: 'Keyboard piano' },
  { keys: ['?'], action: 'Show shortcuts', group: 'Help' },
];

function selectRelativeTrack(delta: number) {
  const { tracks } = getProject();
  if (!tracks.length) return;
  const current = useUi.getState().selectedTrackId;
  const index = tracks.findIndex((t) => t.id === current);
  const next = tracks[Math.min(tracks.length - 1, Math.max(0, index < 0 ? 0 : index + delta))];
  ui.selectTrack(next.id);
  document.querySelector(`[data-track-row="${next.id}"]`)?.scrollIntoView({ block: 'nearest' });
}

export function useHotkeys() {
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.defaultPrevented || isEditable(e.target)) return;
      const mod = e.metaKey || e.ctrlKey;
      const key = e.key.toLowerCase();

      if (modalOpen()) return;

      if (mod) {
        if (key === 'z' && !e.shiftKey) {
          e.preventDefault();
          actions.undo();
        } else if ((key === 'z' && e.shiftKey) || key === 'y') {
          e.preventDefault();
          actions.redo();
        } else if (key === 's') {
          e.preventDefault();
          void saveNow(true);
        } else if (key === 'e') {
          e.preventDefault();
          ui.openDialog('export');
        } else if (key === 'o') {
          e.preventDefault();
          ui.openDialog('library');
        } else if (key === 'd') {
          e.preventDefault();
          const id = useUi.getState().selectedTrackId;
          if (id) {
            const created = actions.duplicateTrack(id);
            if (created) ui.selectTrack(created);
          }
        } else if (key === 'c' && !window.getSelection()?.toString()) {
          const pattern = selectActivePattern(useStudio.getState());
          useUi.setState({ patternClipboard: structuredClone(pattern.steps) });
          ui.toast(`Copied pattern ${pattern.name}`);
        } else if (key === 'v') {
          const clip = useUi.getState().patternClipboard;
          if (!clip) return;
          e.preventDefault();
          const pattern = selectActivePattern(useStudio.getState());
          actions.pastePattern(pattern.id, clip);
          ui.toast(`Pasted into pattern ${pattern.name}`);
        }
        return;
      }

      if (e.altKey) return;

      switch (e.key) {
        case ' ':
          e.preventDefault();
          if (!e.repeat) void togglePlayback();
          return;
        case 'ArrowUp':
        case 'ArrowDown':
          if ((e.target as HTMLElement | null)?.closest('[data-grid-nav]')) return;
          e.preventDefault();
          selectRelativeTrack(e.key === 'ArrowUp' ? -1 : 1);
          return;
        case 'Delete':
        case 'Backspace': {
          const id = useUi.getState().selectedTrackId;
          if (id) {
            e.preventDefault();
            actions.clearTrack(id);
          }
          return;
        }
        case '?':
          e.preventDefault();
          ui.openDialog('shortcuts');
          return;
        case 'Escape':
          useUi.setState({ stepEditor: null });
          if (liveInput.getState().pianoOn) liveInput.enablePiano(false);
          return;
      }

      if (/^[1-8]$/.test(e.key)) {
        const pattern = getProject().patterns[Number(e.key) - 1];
        if (pattern) actions.selectPattern(pattern.id);
        return;
      }

      const selected = useUi.getState().selectedTrackId;
      switch (key) {
        case 'm':
          if (selected) actions.toggleMute(selected);
          break;
        case 's':
          if (selected) actions.toggleSolo(selected);
          break;
        case 'k': {
          const next = !useUi.getState().metronome;
          useUi.setState({ metronome: next });
          engine.setMetronome(next);
          ui.toast(next ? 'Metronome on' : 'Metronome off');
          break;
        }
        case 't': {
          const bpm = tapTempo();
          if (bpm) actions.setBpm(bpm);
          break;
        }
        case 'p':
          liveInput.enablePiano(true);
          if (!selected) ui.toast('Select a track to play it from your keyboard', 'info');
          break;
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);
}

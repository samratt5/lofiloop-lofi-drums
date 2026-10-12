import { create } from 'zustand';
import type { Step } from '@/lib/project/types';
import { DEFAULT_THEME, isThemeId, type ThemeId } from '@/lib/themes';
import { readPrefs, writePrefs } from './persistence';

export type SidebarTab = 'create' | 'fx' | 'mixer';
export type MainView = 'pattern' | 'song';
export type InspectorTab = 'sound' | 'notes' | 'lanes';
export type DialogId = 'export' | 'library' | 'shortcuts' | 'new' | 'share' | 'versions' | 'discover' | null;
export type ToastTone = 'info' | 'success' | 'error';

export interface Toast {
  id: number;
  message: string;
  tone: ToastTone;
  action?: { label: string; run: () => void };
}

export interface StepEditorTarget {
  trackId: string;
  index: number;
  anchor: { x: number; y: number };
}

export type SaveStatus = 'idle' | 'saving' | 'saved' | 'error';

interface Prefs {
  theme: ThemeId;
  metronome: boolean;
  audition: boolean;
  sidebarOpen: boolean;
  sidebarTab: SidebarTab;
  inspectorOpen: boolean;
  mainView: MainView;
  /** Arrangement zoom in pixels per bar */
  songZoom: number;
  /** Keep the playhead in view while the song plays */
  followPlayhead: boolean;
  /** The guided tour has been shown (or skipped) */
  tourSeen: boolean;
}

const DEFAULT_PREFS: Prefs = {
  theme: DEFAULT_THEME,
  metronome: false,
  audition: true,
  sidebarOpen: true,
  sidebarTab: 'create',
  inspectorOpen: true,
  mainView: 'pattern',
  songZoom: 28,
  followPlayhead: true,
  tourSeen: false,
};

interface UiState extends Prefs {
  /** Side panel as an overlay drawer on small screens (not persisted) */
  drawerOpen: boolean;
  selectedTrackId: string | null;
  inspectorTab: InspectorTab;
  dialog: DialogId;
  stepEditor: StepEditorTarget | null;
  toasts: Toast[];
  patternClipboard: Record<string, Step[]> | null;
  saveStatus: SaveStatus;
  savedAt: number | null;
  selectedSectionId: string | null;
  /** Where song playback starts, in bars */
  songCursor: number;
  /** Full-screen performance view */
  performance: boolean;
}

function loadPrefs(): Prefs {
  const prefs = readPrefs(DEFAULT_PREFS);
  return { ...prefs, theme: isThemeId(prefs.theme) ? prefs.theme : DEFAULT_THEME };
}

export const useUi = create<UiState>()(() => ({
  ...loadPrefs(),
  drawerOpen: false,
  selectedTrackId: null,
  inspectorTab: 'sound',
  dialog: null,
  stepEditor: null,
  toasts: [],
  patternClipboard: null,
  saveStatus: 'idle',
  savedAt: null,
  selectedSectionId: null,
  songCursor: 0,
  performance: false,
}));

useUi.subscribe((state, prev) => {
  const keys = Object.keys(DEFAULT_PREFS) as (keyof Prefs)[];
  if (keys.some((k) => state[k] !== prev[k])) {
    writePrefs(Object.fromEntries(keys.map((k) => [k, state[k]])));
  }
});

let toastId = 0;

export const ui = {
  set: useUi.setState,
  selectTrack: (id: string | null) => useUi.setState({ selectedTrackId: id }),
  openDialog: (dialog: DialogId) => useUi.setState({ dialog, stepEditor: null, drawerOpen: false }),
  /** Open the side panel on a tab: docked on desktop, as a drawer on small screens. */
  openPanel: (tab: SidebarTab) => {
    const desktop = window.matchMedia('(min-width: 1024px)').matches;
    useUi.setState(desktop ? { sidebarOpen: true, sidebarTab: tab } : { drawerOpen: true, sidebarTab: tab });
  },
  closeDialog: () => useUi.setState({ dialog: null }),
  setTheme: (theme: ThemeId) => {
    document.documentElement.dataset.theme = theme;
    useUi.setState({ theme });
  },
  toast: (message: string, tone: ToastTone = 'info', action?: Toast['action']) => {
    const id = ++toastId;
    useUi.setState((s) => ({ toasts: [...s.toasts.slice(-3), { id, message, tone, action }] }));
    setTimeout(() => ui.dismissToast(id), tone === 'error' ? 7000 : 4000);
    return id;
  },
  dismissToast: (id: number) => useUi.setState((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),
};

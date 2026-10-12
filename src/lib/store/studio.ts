/**
 * Project state with labelled undo/redo. Every mutation goes through `update`,
 * which uses immer for structural sharing so history snapshots stay cheap.
 */
import { produce, type Draft } from 'immer';
import { create } from 'zustand';
import { snapToScale, type ChordType, type ScaleId } from '@/lib/music/theory';
import { clamp } from '@/lib/utils/math';
import { createId } from '@/lib/utils/id';
import { INSTRUMENTS, defaultParams, type InstrumentId } from '@/lib/project/instruments';
import {
  createPattern,
  createSection,
  createSteps,
  createTrack,
  defaultTrackFx,
  nextPatternName,
  rootNoteFor,
} from '@/lib/project/factory';
import {
  BPM_MAX,
  BPM_MIN,
  MAX_AUTOMATION_POINTS,
  MAX_PATTERNS,
  MAX_SECTION_REPEATS,
  MAX_SECTIONS,
  MAX_STEP_OFFSET,
  MAX_STEPS,
  MAX_TRACKS,
  SWING_MAX,
  SWING_MIN,
  type Ambience,
  type AutomationPoint,
  type AutomationTarget,
  type LoopRegion,
  type MasterFx,
  type Pattern,
  type PlayMode,
  type Project,
  type ProjectMeta,
  type SampleRef,
  type Section,
  type SectionKind,
  type Step,
  type Track,
  type TrackFx,
} from '@/lib/project/types';

const HISTORY_LIMIT = 200;
const COALESCE_MS = 800;

export interface UpdateOptions {
  /** false: don't record (selection, view state). Default true. */
  history?: boolean;
  /** Consecutive updates with the same key merge into one undo step (knob drags). */
  coalesce?: string;
  /** Shown in the history panel. */
  label?: string;
}

export interface HistoryEntry {
  /** Project state before (in `past`) or after (in `future`) the labelled change */
  project: Project;
  label: string;
  at: number;
}

interface StudioState {
  project: Project;
  past: HistoryEntry[];
  future: HistoryEntry[];
  coalesceKey: string | null;
  coalesceAt: number;

  update: (recipe: (draft: Draft<Project>) => void, options?: UpdateOptions) => void;
  undo: () => void;
  redo: () => void;
  /** Jump through history: negative undoes, positive redoes. */
  travel: (steps: number) => void;
  /** Replace the whole project (open, import, template). Clears history. */
  load: (project: Project) => void;
  /** Swap in new contents for the open project as one undoable step (restore a version, generate a song). */
  replace: (project: Project, label: string) => void;
}

export const useStudio = create<StudioState>()((set, get) => ({
  project: null as unknown as Project,
  past: [],
  future: [],
  coalesceKey: null,
  coalesceAt: 0,

  update: (recipe, options = {}) => {
    const { project, past, coalesceKey, coalesceAt } = get();
    const next = produce(project, (draft) => {
      recipe(draft);
    });
    if (next === project) return;
    if (options.history === false) {
      set({ project: next });
      return;
    }
    const stamped = produce(next, (draft) => {
      draft.updatedAt = Date.now();
    });
    const now = Date.now();
    // A recording take stays one undo step however long the pauses between notes are.
    const window = options.coalesce?.startsWith('record:') ? Infinity : COALESCE_MS;
    const merge = options.coalesce !== undefined && options.coalesce === coalesceKey && now - coalesceAt < window;
    set({
      project: stamped,
      past: merge ? past : [...past, { project, label: options.label ?? 'Edit', at: now }].slice(-HISTORY_LIMIT),
      future: [],
      coalesceKey: options.coalesce ?? null,
      coalesceAt: now,
    });
  },

  undo: () => {
    const { past, project, future } = get();
    const previous = past[past.length - 1];
    if (!previous) return;
    set({
      project: keepSelection(previous.project, project),
      past: past.slice(0, -1),
      future: [{ project, label: previous.label, at: previous.at }, ...future].slice(0, HISTORY_LIMIT),
      coalesceKey: null,
    });
  },

  redo: () => {
    const { past, project, future } = get();
    const next = future[0];
    if (!next) return;
    set({
      project: keepSelection(next.project, project),
      past: [...past, { project, label: next.label, at: next.at }].slice(-HISTORY_LIMIT),
      future: future.slice(1),
      coalesceKey: null,
    });
  },

  travel: (steps) => {
    const { undo, redo } = get();
    for (let i = 0; i < Math.abs(steps); i++) {
      if (steps < 0) undo();
      else redo();
    }
  },

  load: (project) => set({ project, past: [], future: [], coalesceKey: null }),

  replace: (next, label) => {
    const { project, past } = get();
    const now = Date.now();
    set({
      project: { ...next, id: project.id, createdAt: project.createdAt, updatedAt: now },
      past: [...past, { project, label, at: now }].slice(-HISTORY_LIMIT),
      future: [],
      coalesceKey: null,
    });
  },
}));

/** Undo shouldn't yank the view to another pattern unless the pattern no longer exists. */
function keepSelection(target: Project, current: Project): Project {
  if (target.activePatternId === current.activePatternId) return target;
  if (!target.patterns.some((p) => p.id === current.activePatternId)) return target;
  return { ...target, activePatternId: current.activePatternId };
}

// ---------------------------------------------------------------------------
// Selectors

export const selectActivePattern = (s: { project: Project }): Pattern =>
  s.project.patterns.find((p) => p.id === s.project.activePatternId) ?? s.project.patterns[0];

export function getProject(): Project {
  return useStudio.getState().project;
}

// ---------------------------------------------------------------------------
// Actions

const update = (recipe: (draft: Draft<Project>) => void, options?: UpdateOptions) =>
  useStudio.getState().update(recipe, options);

function activePattern(draft: Draft<Project>): Draft<Pattern> {
  return draft.patterns.find((p) => p.id === draft.activePatternId) ?? draft.patterns[0];
}

function findTrack(draft: Draft<Project>, trackId: string): Draft<Track> | undefined {
  return draft.tracks.find((t) => t.id === trackId);
}

function findSection(draft: Draft<Project>, sectionId: string): Draft<Section> | undefined {
  return draft.arrangement.find((s) => s.id === sectionId);
}

function cleanStep(step: Draft<Step>, patch: Partial<Step>) {
  if (patch.on !== undefined) step.on = patch.on;
  if (patch.vel !== undefined) step.vel = clamp(patch.vel, 0.05, 1);
  if (patch.note !== undefined) step.note = Math.round(clamp(patch.note, 0, 127));
  if (patch.prob !== undefined) step.prob = clamp(patch.prob, 0, 1);
  if (patch.ratchet !== undefined) step.ratchet = Math.round(clamp(patch.ratchet, 1, 4));
  if (patch.len !== undefined) step.len = Math.round(clamp(patch.len, 1, 16));
  if (patch.offset !== undefined) step.offset = clamp(patch.offset, -MAX_STEP_OFFSET, MAX_STEP_OFFSET);
}

export type SectionPatch = Partial<
  Pick<
    Section,
    'name' | 'kind' | 'patternId' | 'repeats' | 'fillPatternId' | 'transpose' | 'bpm' | 'enter' | 'exit' | 'locked'
  >
>;

export type TrackPatch = Partial<
  Pick<Track, 'name' | 'volume' | 'pan' | 'reverb' | 'delay' | 'duck' | 'feel' | 'humanize'>
>;

export const actions = {
  undo: () => useStudio.getState().undo(),
  redo: () => useStudio.getState().redo(),
  travel: (steps: number) => useStudio.getState().travel(steps),
  load: (project: Project) => useStudio.getState().load(project),
  replace: (project: Project, label: string) => useStudio.getState().replace(project, label),

  // --- project settings ---
  setName: (name: string) =>
    update(
      (d) => {
        d.name = name.slice(0, 120);
      },
      { coalesce: 'name', label: 'Rename beat' },
    ),
  setBpm: (bpm: number) =>
    update(
      (d) => {
        d.bpm = Math.round(clamp(bpm, BPM_MIN, BPM_MAX));
      },
      { coalesce: 'bpm', label: 'Change tempo' },
    ),
  setSwing: (swing: number) =>
    update(
      (d) => {
        d.swing = clamp(swing, SWING_MIN, SWING_MAX);
      },
      { coalesce: 'swing', label: 'Change swing' },
    ),
  setVolume: (volume: number) =>
    update(
      (d) => {
        d.volume = clamp(volume, 0, 1);
      },
      { coalesce: 'volume', label: 'Master volume' },
    ),
  /** Change key; optionally transpose every melodic note along with it. */
  setKey: (root: number, scale: ScaleId, transpose = true) =>
    update(
      (d) => {
        const shift = ((root - d.root + 18) % 12) - 6;
        if (transpose) {
          for (const pattern of d.patterns) {
            for (const track of d.tracks) {
              const def = INSTRUMENTS[track.instrument];
              if (!def.melodic || def.sampler) continue;
              for (const step of pattern.steps[track.id] ?? []) {
                const moved = clamp(step.note + shift, 0, 127);
                step.note = snapToScale(moved, root, scale);
              }
            }
          }
        }
        d.root = root;
        d.scale = scale;
      },
      { label: 'Change key' },
    ),
  setPlayMode: (mode: PlayMode) =>
    update(
      (d) => {
        d.playMode = mode;
      },
      { history: false },
    ),
  setFx: (fx: Partial<MasterFx>, coalesce?: string) =>
    update(
      (d) => {
        Object.assign(d.fx, fx);
      },
      { coalesce: coalesce ?? `fx:${Object.keys(fx).join(',')}`, label: 'Master effects' },
    ),
  setAmbience: (patch: Partial<Ambience>) =>
    update(
      (d) => {
        if (patch.type !== undefined) d.ambience.type = patch.type;
        if (patch.level !== undefined) d.ambience.level = clamp(patch.level, 0, 1);
      },
      { coalesce: 'ambience', label: 'Ambience' },
    ),
  setSidechain: (trackId: string | null) =>
    update(
      (d) => {
        d.sidechain = trackId && d.tracks.some((t) => t.id === trackId) ? trackId : null;
      },
      { label: 'Sidechain source' },
    ),
  setMeta: (patch: Partial<ProjectMeta>) =>
    update(
      (d) => {
        if (patch.artist !== undefined) d.meta.artist = patch.artist.slice(0, 80);
        if (patch.coverSeed !== undefined) d.meta.coverSeed = Math.floor(Math.abs(patch.coverSeed)) % 2 ** 31;
        if (patch.styles !== undefined) d.meta.styles = patch.styles.slice(0, 8);
      },
      { coalesce: 'meta', label: 'Song details' },
    ),
  setLoop: (loop: LoopRegion | null) =>
    update(
      (d) => {
        d.loop = loop && loop.end > loop.start ? { start: Math.max(0, loop.start), end: loop.end } : null;
      },
      { history: false },
    ),

  // --- patterns ---
  selectPattern: (id: string) =>
    update(
      (d) => {
        if (d.patterns.some((p) => p.id === id)) d.activePatternId = id;
      },
      { history: false },
    ),
  addPattern: (copyFrom?: string) => {
    let created: string | null = null;
    update(
      (d) => {
        if (d.patterns.length >= MAX_PATTERNS) return;
        const source = copyFrom ? d.patterns.find((p) => p.id === copyFrom) : undefined;
        const pattern = createPattern(
          nextPatternName(d.patterns),
          d.tracks,
          d.root,
          source?.length ?? activePattern(d).length,
        );
        if (source) {
          for (const track of d.tracks) {
            pattern.steps[track.id] = (source.steps[track.id] ?? []).map((s) => ({ ...s }));
          }
        }
        const index = d.patterns.findIndex((p) => p.id === (copyFrom ?? d.activePatternId));
        d.patterns.splice(index + 1, 0, pattern);
        d.activePatternId = pattern.id;
        created = pattern.id;
      },
      { label: copyFrom ? 'Duplicate pattern' : 'New pattern' },
    );
    return created;
  },
  removePattern: (id: string) =>
    update(
      (d) => {
        if (d.patterns.length <= 1) return;
        const index = d.patterns.findIndex((p) => p.id === id);
        if (index < 0) return;
        d.patterns.splice(index, 1);
        d.arrangement = d.arrangement.filter((s) => s.patternId !== id);
        for (const s of d.arrangement) if (s.fillPatternId === id) s.fillPatternId = null;
        if (!d.arrangement.length) d.arrangement.push(createSection(d.patterns[0].id, { name: d.patterns[0].name }));
        if (d.activePatternId === id) d.activePatternId = d.patterns[Math.max(0, index - 1)].id;
      },
      { label: 'Delete pattern' },
    ),
  renamePattern: (id: string, name: string) =>
    update(
      (d) => {
        const p = d.patterns.find((x) => x.id === id);
        if (p) p.name = name.slice(0, 24) || p.name;
      },
      { label: 'Rename pattern' },
    ),
  setPatternLength: (id: string, length: number) =>
    update(
      (d) => {
        const p = d.patterns.find((x) => x.id === id);
        if (p) p.length = Math.round(clamp(length, 1, MAX_STEPS));
      },
      { label: 'Pattern length' },
    ),
  /** Copy the first `from` steps across the rest of the pattern, e.g. 16 → 32. */
  extendPattern: (id: string, length: number) =>
    update(
      (d) => {
        const p = d.patterns.find((x) => x.id === id);
        if (!p) return;
        const from = p.length;
        const to = Math.round(clamp(length, 1, MAX_STEPS));
        for (const track of d.tracks) {
          const steps = p.steps[track.id];
          if (!steps) continue;
          for (let i = from; i < to; i++) steps[i] = { ...steps[i % from] };
        }
        p.length = to;
      },
      { label: 'Double pattern' },
    ),
  clearPattern: (id: string) =>
    update(
      (d) => {
        const p = d.patterns.find((x) => x.id === id);
        if (!p) return;
        for (const track of d.tracks) {
          const note = rootNoteFor(track.instrument, d.root);
          for (const step of p.steps[track.id] ?? []) {
            step.on = false;
            step.note = note;
          }
        }
      },
      { label: 'Clear pattern' },
    ),
  pastePattern: (id: string, data: Record<string, Step[]>) =>
    update(
      (d) => {
        const p = d.patterns.find((x) => x.id === id);
        if (!p) return;
        for (const track of d.tracks) {
          const src = data[track.id];
          if (src) p.steps[track.id] = src.slice(0, MAX_STEPS).map((s) => ({ ...s, offset: s.offset ?? 0 }));
        }
      },
      { label: 'Paste pattern' },
    ),

  // --- arrangement ---
  addSection: (options: { patternId?: string; index?: number; kind?: SectionKind } = {}) => {
    let created: string | null = null;
    update(
      (d) => {
        if (d.arrangement.length >= MAX_SECTIONS) return;
        const patternId =
          options.patternId && d.patterns.some((p) => p.id === options.patternId)
            ? options.patternId
            : d.activePatternId;
        const kind = options.kind ?? 'custom';
        const pattern = d.patterns.find((p) => p.id === patternId)!;
        const section = createSection(patternId, {
          kind,
          name: kind === 'custom' ? pattern.name : undefined,
        });
        const index =
          options.index === undefined ? d.arrangement.length : clamp(options.index, 0, d.arrangement.length);
        d.arrangement.splice(index, 0, section);
        created = section.id;
      },
      { label: 'Add section' },
    );
    return created;
  },
  duplicateSection: (sectionId: string) => {
    let created: string | null = null;
    update(
      (d) => {
        if (d.arrangement.length >= MAX_SECTIONS) return;
        const index = d.arrangement.findIndex((s) => s.id === sectionId);
        if (index < 0) return;
        const copy: Section = { ...d.arrangement[index], id: createId('s'), muted: [...d.arrangement[index].muted] };
        d.arrangement.splice(index + 1, 0, copy);
        created = copy.id;
      },
      { label: 'Duplicate section' },
    );
    return created;
  },
  removeSection: (sectionId: string) =>
    update(
      (d) => {
        if (d.arrangement.length <= 1) return;
        d.arrangement = d.arrangement.filter((s) => s.id !== sectionId);
      },
      { label: 'Delete section' },
    ),
  moveSection: (from: number, to: number) =>
    update(
      (d) => {
        const n = d.arrangement.length;
        if (from === to || from < 0 || to < 0 || from >= n || to >= n) return;
        const [section] = d.arrangement.splice(from, 1);
        d.arrangement.splice(to, 0, section);
      },
      { label: 'Move section' },
    ),
  updateSection: (sectionId: string, patch: SectionPatch) =>
    update(
      (d) => {
        const s = findSection(d, sectionId);
        if (!s) return;
        const ids = new Set(d.patterns.map((p) => p.id));
        if (patch.name !== undefined) s.name = patch.name.slice(0, 40) || s.name;
        if (patch.kind !== undefined) s.kind = patch.kind;
        if (patch.patternId !== undefined && ids.has(patch.patternId)) s.patternId = patch.patternId;
        if (patch.repeats !== undefined) s.repeats = Math.round(clamp(patch.repeats, 1, MAX_SECTION_REPEATS));
        if (patch.fillPatternId !== undefined) {
          s.fillPatternId = patch.fillPatternId && ids.has(patch.fillPatternId) ? patch.fillPatternId : null;
        }
        if (patch.transpose !== undefined) s.transpose = Math.round(clamp(patch.transpose, -12, 12));
        if (patch.bpm !== undefined) s.bpm = patch.bpm === null ? null : Math.round(clamp(patch.bpm, BPM_MIN, BPM_MAX));
        if (patch.enter !== undefined) s.enter = patch.enter;
        if (patch.exit !== undefined) s.exit = patch.exit;
        if (patch.locked !== undefined) s.locked = patch.locked;
      },
      { coalesce: `section:${sectionId}:${Object.keys(patch).join(',')}`, label: 'Edit section' },
    ),
  toggleSectionMute: (sectionId: string, trackId: string) =>
    update(
      (d) => {
        const s = findSection(d, sectionId);
        if (!s || !d.tracks.some((t) => t.id === trackId)) return;
        const i = s.muted.indexOf(trackId);
        if (i >= 0) s.muted.splice(i, 1);
        else s.muted.push(trackId);
      },
      { label: 'Section mute' },
    ),
  setSectionMutes: (sectionId: string, muted: string[]) =>
    update(
      (d) => {
        const s = findSection(d, sectionId);
        if (!s) return;
        const ids = new Set(d.tracks.map((t) => t.id));
        s.muted = [...new Set(muted.filter((id) => ids.has(id)))];
      },
      { label: 'Section mutes' },
    ),

  // --- automation ---
  addLane: (target: AutomationTarget, initial = 0.5) => {
    let created: string | null = null;
    update(
      (d) => {
        if (d.automation.some((l) => l.target === target)) return;
        const lane = { id: createId('a'), target, points: [{ t: 0, v: clamp(initial, 0, 1) }] };
        d.automation.push(lane);
        created = lane.id;
      },
      { label: 'Add automation' },
    );
    return created;
  },
  removeLane: (laneId: string) =>
    update(
      (d) => {
        d.automation = d.automation.filter((l) => l.id !== laneId);
      },
      { label: 'Remove automation' },
    ),
  setLanePoints: (laneId: string, points: AutomationPoint[]) =>
    update(
      (d) => {
        const lane = d.automation.find((l) => l.id === laneId);
        if (!lane) return;
        lane.points = points
          .map((p) => ({ t: Math.max(0, p.t), v: clamp(p.v, 0, 1) }))
          .sort((a, b) => a.t - b.t)
          .slice(0, MAX_AUTOMATION_POINTS);
      },
      { coalesce: `lane:${laneId}`, label: 'Draw automation' },
    ),

  // --- tracks ---
  addTrack: (instrument: InstrumentId) => {
    let created: string | null = null;
    update(
      (d) => {
        if (d.tracks.length >= MAX_TRACKS) return;
        const track = createTrack(instrument);
        d.tracks.push(track);
        for (const p of d.patterns) p.steps[track.id] = createSteps(rootNoteFor(instrument, d.root));
        created = track.id;
      },
      { label: 'Add track' },
    );
    return created;
  },
  removeTrack: (trackId: string) =>
    update(
      (d) => {
        const index = d.tracks.findIndex((t) => t.id === trackId);
        if (index < 0) return;
        d.tracks.splice(index, 1);
        for (const p of d.patterns) delete p.steps[trackId];
        for (const s of d.arrangement) s.muted = s.muted.filter((id) => id !== trackId);
        d.automation = d.automation.filter((l) => !l.target.startsWith(`track.${trackId}.`));
        if (d.sidechain === trackId) d.sidechain = null;
      },
      { label: 'Delete track' },
    ),
  duplicateTrack: (trackId: string) => {
    let created: string | null = null;
    update(
      (d) => {
        if (d.tracks.length >= MAX_TRACKS) return;
        const index = d.tracks.findIndex((t) => t.id === trackId);
        if (index < 0) return;
        const source = d.tracks[index];
        const copy: Track = {
          ...source,
          params: { ...source.params },
          fx: { ...source.fx },
          sample: source.sample ? { ...source.sample, slices: [...source.sample.slices] } : null,
          id: createId('t'),
          name: `${source.name} 2`,
          solo: false,
        };
        d.tracks.splice(index + 1, 0, copy);
        for (const p of d.patterns) p.steps[copy.id] = (p.steps[trackId] ?? []).map((s) => ({ ...s }));
        for (const s of d.arrangement) if (s.muted.includes(trackId)) s.muted.push(copy.id);
        created = copy.id;
      },
      { label: 'Duplicate track' },
    );
    return created;
  },
  moveTrack: (from: number, to: number) =>
    update(
      (d) => {
        if (from === to || from < 0 || to < 0 || from >= d.tracks.length || to >= d.tracks.length) return;
        const [track] = d.tracks.splice(from, 1);
        d.tracks.splice(to, 0, track);
      },
      { label: 'Move track' },
    ),
  updateTrack: (trackId: string, patch: TrackPatch) =>
    update(
      (d) => {
        const t = findTrack(d, trackId);
        if (!t) return;
        if (patch.name !== undefined) t.name = patch.name.slice(0, 80);
        if (patch.volume !== undefined) t.volume = clamp(patch.volume, 0, 1);
        if (patch.pan !== undefined) t.pan = clamp(patch.pan, -1, 1);
        if (patch.reverb !== undefined) t.reverb = clamp(patch.reverb, 0, 1);
        if (patch.delay !== undefined) t.delay = clamp(patch.delay, 0, 1);
        if (patch.duck !== undefined) t.duck = clamp(patch.duck, 0, 1);
        if (patch.feel !== undefined) t.feel = clamp(patch.feel, -1, 1);
        if (patch.humanize !== undefined) t.humanize = clamp(patch.humanize, 0, 1);
      },
      { coalesce: `track:${trackId}:${Object.keys(patch).join(',')}`, label: 'Mix' },
    ),
  setTrackFx: (trackId: string, patch: Partial<TrackFx>) =>
    update(
      (d) => {
        const t = findTrack(d, trackId);
        if (!t) return;
        for (const [key, value] of Object.entries(patch) as [keyof TrackFx, number][]) {
          if (key in t.fx) t.fx[key] = clamp(value, 0, 1);
        }
      },
      { coalesce: `trackfx:${trackId}:${Object.keys(patch).join(',')}`, label: 'Track effects' },
    ),
  resetTrackFx: (trackId: string) =>
    update(
      (d) => {
        const t = findTrack(d, trackId);
        if (t) t.fx = defaultTrackFx();
      },
      { label: 'Reset track effects' },
    ),
  toggleMute: (trackId: string) =>
    update(
      (d) => {
        const t = findTrack(d, trackId);
        if (t) t.mute = !t.mute;
      },
      { label: 'Mute' },
    ),
  toggleSolo: (trackId: string, exclusive = false) =>
    update(
      (d) => {
        const t = findTrack(d, trackId);
        if (!t) return;
        const next = !t.solo;
        if (exclusive) for (const other of d.tracks) other.solo = false;
        t.solo = next;
      },
      { label: 'Solo' },
    ),
  setChord: (trackId: string, chord: ChordType) =>
    update(
      (d) => {
        const t = findTrack(d, trackId);
        if (t && INSTRUMENTS[t.instrument].polyphonic) t.chord = chord;
      },
      { label: 'Chord mode' },
    ),
  setParam: (trackId: string, key: string, value: number) =>
    update(
      (d) => {
        const t = findTrack(d, trackId);
        if (!t) return;
        const def = INSTRUMENTS[t.instrument].params.find((p) => p.id === key);
        if (def) t.params[key] = clamp(value, def.min, def.max);
      },
      { coalesce: `param:${trackId}:${key}`, label: 'Sound' },
    ),
  resetParams: (trackId: string) =>
    update(
      (d) => {
        const t = findTrack(d, trackId);
        if (t) t.params = defaultParams(t.instrument);
      },
      { label: 'Reset sound' },
    ),
  changeInstrument: (trackId: string, instrument: InstrumentId) =>
    update(
      (d) => {
        const t = findTrack(d, trackId);
        if (!t || t.instrument === instrument) return;
        const oldDef = INSTRUMENTS[t.instrument];
        const newDef = INSTRUMENTS[instrument];
        if (t.name === oldDef.name) t.name = newDef.name;
        t.instrument = instrument;
        t.params = defaultParams(instrument);
        if (!newDef.polyphonic) t.chord = 'off';
        if (!newDef.sampler) t.sample = null;
        const base = rootNoteFor(instrument, d.root);
        for (const p of d.patterns) {
          for (const step of p.steps[t.id] ?? []) {
            if (!newDef.melodic || !oldDef.melodic) {
              step.note = base;
              continue;
            }
            // Keep melodies, just move them into the new instrument's range.
            let note = step.note;
            while (note < newDef.noteRange[0]) note += 12;
            while (note > newDef.noteRange[1]) note -= 12;
            step.note = note;
          }
        }
      },
      { label: 'Change instrument' },
    ),
  setSample: (trackId: string, sample: SampleRef | null) =>
    update(
      (d) => {
        const t = findTrack(d, trackId);
        if (t && INSTRUMENTS[t.instrument].sampler)
          t.sample = sample ? { ...sample, slices: [...sample.slices] } : null;
      },
      { label: 'Load sample' },
    ),
  updateSample: (trackId: string, patch: Partial<Omit<SampleRef, 'id'>>) =>
    update(
      (d) => {
        const t = findTrack(d, trackId);
        if (!t?.sample) return;
        const s = t.sample;
        if (patch.name !== undefined) s.name = patch.name.slice(0, 120);
        if (patch.root !== undefined) s.root = Math.round(clamp(patch.root, 0, 127));
        if (patch.mode !== undefined) s.mode = patch.mode;
        if (patch.start !== undefined) s.start = clamp(patch.start, 0, s.end - 0.001);
        if (patch.end !== undefined) s.end = clamp(patch.end, s.start + 0.001, 1);
        if (patch.slices !== undefined) {
          const slices = [...new Set(patch.slices.map((x) => clamp(x, 0, 1)))].sort((a, b) => a - b).slice(0, 64);
          if (slices[0] !== 0) slices.unshift(0);
          s.slices = slices;
        }
      },
      { coalesce: `sample:${trackId}:${Object.keys(patch).join(',')}`, label: 'Edit sample' },
    ),

  // --- steps (active pattern unless a pattern id is given) ---
  toggleStep: (trackId: string, index: number) =>
    update(
      (d) => {
        const step = activePattern(d).steps[trackId]?.[index];
        if (step) step.on = !step.on;
      },
      { label: 'Toggle step' },
    ),
  setStepsOn: (trackId: string, indices: number[], on: boolean) =>
    update(
      (d) => {
        const steps = activePattern(d).steps[trackId];
        if (!steps) return;
        for (const i of indices) if (steps[i]) steps[i].on = on;
      },
      { coalesce: `paint:${trackId}`, label: on ? 'Paint steps' : 'Erase steps' },
    ),
  setStep: (trackId: string, index: number, patch: Partial<Step>, coalesce?: string, patternId?: string) =>
    update(
      (d) => {
        const p = patternId ? d.patterns.find((x) => x.id === patternId) : activePattern(d);
        const step = p?.steps[trackId]?.[index];
        if (step) cleanStep(step, patch);
      },
      { coalesce, label: 'Edit step' },
    ),
  setTrackSteps: (trackId: string, steps: Step[], patternId?: string) =>
    update(
      (d) => {
        const p = patternId ? d.patterns.find((x) => x.id === patternId) : activePattern(d);
        if (!p || !p.steps[trackId]) return;
        p.steps[trackId] = steps.slice(0, MAX_STEPS).map((s) => ({ ...s, offset: s.offset ?? 0 }));
      },
      { label: 'Transform track' },
    ),
  setManySteps: (data: Record<string, Step[]>, patternId?: string) =>
    update(
      (d) => {
        const p = patternId ? d.patterns.find((x) => x.id === patternId) : activePattern(d);
        if (!p) return;
        for (const [trackId, steps] of Object.entries(data)) {
          if (p.steps[trackId])
            p.steps[trackId] = steps.slice(0, MAX_STEPS).map((s) => ({ ...s, offset: s.offset ?? 0 }));
        }
      },
      { label: 'Generate pattern' },
    ),
  clearTrack: (trackId: string) =>
    update(
      (d) => {
        const t = findTrack(d, trackId);
        if (!t) return;
        const note = rootNoteFor(t.instrument, d.root);
        for (const step of activePattern(d).steps[trackId] ?? []) {
          step.on = false;
          step.note = note;
        }
      },
      { label: 'Clear track' },
    ),
  /** Write a recorded note; consecutive notes in one take merge into one undo step. */
  recordNote: (patternId: string, trackId: string, index: number, patch: Partial<Step>, take: string) =>
    update(
      (d) => {
        const step = d.patterns.find((p) => p.id === patternId)?.steps[trackId]?.[index];
        if (step) cleanStep(step, { ...patch, on: true });
      },
      { coalesce: `record:${take}`, label: 'Record' },
    ),
};

/** Seconds of music in the arrangement at a given tempo, for quick display. */
export function selectSongBars(project: Project): number {
  const byId = new Map(project.patterns.map((p) => [p.id, p]));
  return project.arrangement.reduce((sum, s) => {
    const main = byId.get(s.patternId)?.length ?? 0;
    const fill = s.fillPatternId ? (byId.get(s.fillPatternId)?.length ?? main) : main;
    return sum + (main * (s.repeats - 1) + fill) / 16;
  }, 0);
}

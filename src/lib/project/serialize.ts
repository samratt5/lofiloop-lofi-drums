/**
 * Compact, versioned project file format used for local storage, JSON export
 * and share links. Only active steps are stored, which keeps files small.
 * Version 2 files (pattern chains) are migrated to version 3 (song sections).
 */
import { z } from 'zod';
import { SCALE_IDS, type ChordType, type ScaleId } from '@/lib/music/theory';
import { clamp } from '@/lib/utils/math';
import { createId } from '@/lib/utils/id';
import { INSTRUMENTS, defaultParams, isInstrumentId } from './instruments';
import {
  createSection,
  createStep,
  defaultAmbience,
  defaultFx,
  defaultMeta,
  defaultTrackFx,
  nextPatternName,
  rootNoteFor,
} from './factory';
import {
  AMBIENCE_TYPES,
  BPM_MAX,
  BPM_MIN,
  DELAY_DIVISIONS,
  ENTER_TRANSITIONS,
  EXIT_TRANSITIONS,
  MASTER_AUTOMATION_PARAMS,
  MAX_AUTOMATION_POINTS,
  MAX_PATTERNS,
  MAX_SECTION_REPEATS,
  MAX_SECTIONS,
  MAX_STEP_OFFSET,
  MAX_STEPS,
  MAX_TRACKS,
  PROJECT_VERSION,
  SECTION_KINDS,
  SWING_MAX,
  SWING_MIN,
  TRACK_AUTOMATION_PARAMS,
  type AutomationLane,
  type AutomationTarget,
  type MasterFx,
  type Pattern,
  type Project,
  type SampleRef,
  type Section,
  type Step,
  type Track,
  type TrackFx,
} from './types';

export const FILE_FORMAT = 'lofiloop';

/** [index, velocity 0-100, note, probability 0-100, ratchet, length, offset -50..50] */
type Hit = number[];

const num = z.number().refine(Number.isFinite, 'must be a finite number');
const id = z.string().min(1).max(64);

const trackFxSchema = z
  .object({ cutoff: num, resonance: num, highpass: num, drive: num, crush: num, chorus: num })
  .partial();

const sampleSchema = z.object({
  id,
  name: z.string().max(120),
  root: num,
  mode: z.enum(['pitched', 'chop']),
  slices: z.array(num).max(64),
  start: num,
  end: num,
});

const trackSchema = z.object({
  id,
  name: z.string().max(80),
  instrument: z.string(),
  volume: num,
  pan: num,
  mute: z.boolean(),
  solo: z.boolean(),
  reverb: num.optional(),
  delay: num.optional(),
  chord: z.enum(['off', 'triad', 'seventh', 'ninth']).optional(),
  params: z.record(z.string(), num).optional(),
  fx: trackFxSchema.optional(),
  duck: num.optional(),
  feel: num.optional(),
  humanize: num.optional(),
  sample: sampleSchema.nullable().optional(),
});

const hitSchema = z.array(num).min(1).max(7);

const patternSchema = z.object({
  id,
  name: z.string().max(24),
  length: num,
  hits: z.record(z.string(), z.array(hitSchema).max(MAX_STEPS)),
});

const fxSchema = z
  .object({
    tone: num,
    crackle: num,
    wow: num,
    crush: num,
    drive: num,
    reverbSize: num,
    reverbMix: num,
    delayDivision: z.enum(DELAY_DIVISIONS),
    delayFeedback: num,
    delayMix: num,
    glue: num,
  })
  .partial();

const sectionSchema = z.object({
  id,
  name: z.string().max(40),
  kind: z.enum(SECTION_KINDS).optional(),
  patternId: z.string(),
  repeats: num.optional(),
  fillPatternId: z.string().nullable().optional(),
  muted: z.array(z.string()).max(MAX_TRACKS).optional(),
  transpose: num.optional(),
  bpm: num.nullable().optional(),
  enter: z.enum(ENTER_TRANSITIONS).optional(),
  exit: z.enum(EXIT_TRANSITIONS).optional(),
  locked: z.boolean().optional(),
});

const laneSchema = z.object({
  id,
  target: z.string().max(100),
  points: z.array(z.object({ t: num, v: num })).max(MAX_AUTOMATION_POINTS),
});

const baseProject = {
  id: id.optional(),
  name: z.string().max(120),
  bpm: num,
  swing: num,
  root: num,
  scale: z.string(),
  volume: num.optional(),
  tracks: z.array(trackSchema).max(MAX_TRACKS),
  patterns: z.array(patternSchema).min(1).max(MAX_PATTERNS),
  activePatternId: z.string().optional(),
  playMode: z.enum(['pattern', 'song']).optional(),
  fx: fxSchema.optional(),
  createdAt: num.optional(),
  updatedAt: num.optional(),
};

const v2Schema = z.object({
  format: z.literal(FILE_FORMAT),
  version: z.literal(2),
  project: z.object({ ...baseProject, chain: z.array(z.string()).max(256).optional() }),
});

const v3Schema = z.object({
  format: z.literal(FILE_FORMAT),
  version: z.literal(3),
  project: z.object({
    ...baseProject,
    arrangement: z.array(sectionSchema).max(MAX_SECTIONS).optional(),
    automation: z.array(laneSchema).max(64).optional(),
    loop: z.object({ start: num, end: num }).nullable().optional(),
    ambience: z
      .object({ type: z.enum(AMBIENCE_TYPES), level: num })
      .partial()
      .optional(),
    sidechain: z.string().nullable().optional(),
    meta: z
      .object({ artist: z.string().max(80), coverSeed: num, styles: z.array(z.string().max(40)).max(8) })
      .partial()
      .optional(),
  }),
});

const fileSchema = z.discriminatedUnion('version', [v2Schema, v3Schema]);

export type ProjectFile = z.infer<typeof v3Schema>;
type RawProject = z.infer<typeof v2Schema>['project'] | z.infer<typeof v3Schema>['project'];

/** Hits past the pattern length are kept too, so shortening a pattern is reversible. */
function encodeHits(steps: Step[]): Hit[] {
  const hits: Hit[] = [];
  for (let i = 0; i < Math.min(MAX_STEPS, steps.length); i++) {
    const s = steps[i];
    if (!s.on) continue;
    const hit = [i, Math.round(s.vel * 100), s.note, Math.round(s.prob * 100), s.ratchet, s.len];
    const offset = Math.round(s.offset * 100);
    if (offset !== 0) hit.push(offset);
    hits.push(hit);
  }
  return hits;
}

export function toProjectFile(project: Project): ProjectFile {
  return {
    format: FILE_FORMAT,
    version: PROJECT_VERSION,
    project: {
      id: project.id,
      name: project.name,
      bpm: project.bpm,
      swing: project.swing,
      root: project.root,
      scale: project.scale,
      volume: project.volume,
      tracks: project.tracks.map((t) => ({
        ...t,
        params: { ...t.params },
        fx: { ...t.fx },
        sample: t.sample ? { ...t.sample, slices: [...t.sample.slices] } : null,
      })),
      patterns: project.patterns.map((p) => ({
        id: p.id,
        name: p.name,
        length: p.length,
        hits: Object.fromEntries(project.tracks.map((t) => [t.id, encodeHits(p.steps[t.id] ?? [])])),
      })),
      activePatternId: project.activePatternId,
      playMode: project.playMode,
      arrangement: project.arrangement.map((s) => ({ ...s, muted: [...s.muted] })),
      automation: project.automation.map((l) => ({ ...l, points: l.points.map((p) => ({ ...p })) })),
      loop: project.loop ? { ...project.loop } : null,
      ambience: { ...project.ambience },
      sidechain: project.sidechain,
      fx: { ...project.fx },
      meta: { ...project.meta, styles: [...project.meta.styles] },
      createdAt: project.createdAt,
      updatedAt: project.updatedAt,
    },
  };
}

export function serializeProject(project: Project, pretty = false): string {
  return JSON.stringify(toProjectFile(project), null, pretty ? 2 : undefined);
}

export class ProjectParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ProjectParseError';
  }
}

const unit = (v: number | undefined, fallback: number) => clamp(v ?? fallback, 0, 1);

function normalizeTrackFx(raw: Partial<TrackFx> | undefined): TrackFx {
  const d = defaultTrackFx();
  return {
    cutoff: unit(raw?.cutoff, d.cutoff),
    resonance: unit(raw?.resonance, d.resonance),
    highpass: unit(raw?.highpass, d.highpass),
    drive: unit(raw?.drive, d.drive),
    crush: unit(raw?.crush, d.crush),
    chorus: unit(raw?.chorus, d.chorus),
  };
}

function normalizeSample(raw: z.infer<typeof sampleSchema> | null | undefined): SampleRef | null {
  if (!raw) return null;
  const slices = [...new Set(raw.slices.map((s) => clamp(s, 0, 1)))].sort((a, b) => a - b);
  if (slices[0] !== 0) slices.unshift(0);
  const start = clamp(raw.start, 0, 1);
  return {
    id: raw.id,
    name: raw.name.trim() || 'Sample',
    root: Math.round(clamp(raw.root, 0, 127)),
    mode: raw.mode,
    slices: slices.slice(0, 64),
    start,
    end: clamp(raw.end, start, 1) || 1,
  };
}

function normalizeTrack(raw: z.infer<typeof trackSchema>, usedIds: Set<string>): Track | null {
  if (!isInstrumentId(raw.instrument)) return null;
  const def = INSTRUMENTS[raw.instrument];
  const params = defaultParams(raw.instrument);
  for (const p of def.params) {
    const value = raw.params?.[p.id];
    if (typeof value === 'number') params[p.id] = clamp(value, p.min, p.max);
  }
  let trackId = raw.id;
  if (usedIds.has(trackId)) trackId = createId('t');
  usedIds.add(trackId);
  const chord: ChordType = def.polyphonic ? (raw.chord ?? 'off') : 'off';
  return {
    id: trackId,
    name: raw.name.trim() || def.name,
    instrument: raw.instrument,
    volume: clamp(raw.volume, 0, 1),
    pan: clamp(raw.pan, -1, 1),
    mute: raw.mute,
    solo: raw.solo,
    reverb: unit(raw.reverb, 0),
    delay: unit(raw.delay, 0),
    chord,
    params,
    fx: normalizeTrackFx(raw.fx),
    duck: unit(raw.duck, 0),
    feel: clamp(raw.feel ?? 0, -1, 1),
    humanize: unit(raw.humanize, 0),
    sample: def.sampler ? normalizeSample(raw.sample) : null,
  };
}

function normalizeFx(raw: Partial<MasterFx> | undefined): MasterFx {
  const fx = { ...defaultFx(), ...raw };
  return {
    tone: unit(fx.tone, 0.7),
    crackle: unit(fx.crackle, 0),
    wow: unit(fx.wow, 0),
    crush: unit(fx.crush, 0),
    drive: unit(fx.drive, 0),
    reverbSize: unit(fx.reverbSize, 0.5),
    reverbMix: unit(fx.reverbMix, 0),
    delayDivision: fx.delayDivision,
    delayFeedback: clamp(fx.delayFeedback, 0, 0.9),
    delayMix: unit(fx.delayMix, 0),
    glue: unit(fx.glue, 0),
  };
}

function normalizeSection(
  raw: z.infer<typeof sectionSchema>,
  patternIds: Set<string>,
  trackIds: Map<string, string>,
  usedIds: Set<string>,
): Section | null {
  if (!patternIds.has(raw.patternId)) return null;
  let sectionId = raw.id;
  if (usedIds.has(sectionId)) sectionId = createId('s');
  usedIds.add(sectionId);
  const muted = [...new Set((raw.muted ?? []).map((t) => trackIds.get(t)).filter((t): t is string => Boolean(t)))];
  return {
    id: sectionId,
    name: raw.name.trim() || 'Section',
    kind: raw.kind ?? 'custom',
    patternId: raw.patternId,
    repeats: Math.round(clamp(raw.repeats ?? 1, 1, MAX_SECTION_REPEATS)),
    fillPatternId: raw.fillPatternId && patternIds.has(raw.fillPatternId) ? raw.fillPatternId : null,
    muted,
    transpose: Math.round(clamp(raw.transpose ?? 0, -12, 12)),
    bpm: raw.bpm == null ? null : Math.round(clamp(raw.bpm, BPM_MIN, BPM_MAX)),
    enter: raw.enter ?? 'none',
    exit: raw.exit ?? 'none',
    locked: raw.locked ?? false,
  };
}

function normalizeTarget(target: string, trackIds: Map<string, string>): AutomationTarget | null {
  const parts = target.split('.');
  if (parts[0] === 'master' && parts.length === 2) {
    return (MASTER_AUTOMATION_PARAMS as readonly string[]).includes(parts[1]) ? (target as AutomationTarget) : null;
  }
  if (parts[0] === 'track' && parts.length === 3) {
    const trackId = trackIds.get(parts[1]);
    if (!trackId || !(TRACK_AUTOMATION_PARAMS as readonly string[]).includes(parts[2])) return null;
    return `track.${trackId}.${parts[2]}` as AutomationTarget;
  }
  return null;
}

/** Collapse a v2 chain like [A, A, B, A] into sections with repeats. */
function sectionsFromChain(chain: string[], patterns: Pattern[]): Section[] {
  const byId = new Map(patterns.map((p) => [p.id, p]));
  const sections: Section[] = [];
  for (const patternId of chain) {
    const pattern = byId.get(patternId);
    if (!pattern) continue;
    const last = sections[sections.length - 1];
    if (last && last.patternId === patternId && last.repeats < MAX_SECTION_REPEATS) last.repeats += 1;
    else sections.push(createSection(patternId, { name: pattern.name }));
  }
  return sections.slice(0, MAX_SECTIONS);
}

/** Parse and validate a project file (object or JSON string). Throws ProjectParseError. */
export function parseProjectFile(input: unknown): Project {
  let data = input;
  if (typeof input === 'string') {
    try {
      data = JSON.parse(input);
    } catch {
      throw new ProjectParseError('The file is not valid JSON.');
    }
  }
  const result = fileSchema.safeParse(data);
  if (!result.success) {
    const issue = result.error.issues[0];
    const where = issue?.path.length ? ` at "${issue.path.join('.')}"` : '';
    throw new ProjectParseError(`Not a valid LofiLoop project${where}: ${issue?.message ?? 'unknown error'}`);
  }
  const raw: RawProject = result.data.project;
  const root = Math.round(clamp(raw.root, 0, 11));
  const scale = ((SCALE_IDS as string[]).includes(raw.scale) ? raw.scale : 'minor') as ScaleId;

  const usedTrackIds = new Set<string>();
  const trackIdMap = new Map<string, string>();
  const tracks: Track[] = [];
  for (const rawTrack of raw.tracks) {
    const track = normalizeTrack(rawTrack, usedTrackIds);
    if (!track) continue;
    trackIdMap.set(rawTrack.id, track.id);
    tracks.push(track);
  }

  const usedPatternIds = new Set<string>();
  const patterns: Pattern[] = [];
  for (const rawPattern of raw.patterns) {
    let patternId = rawPattern.id;
    if (usedPatternIds.has(patternId)) patternId = createId('p');
    usedPatternIds.add(patternId);
    const steps: Record<string, Step[]> = {};
    for (const [rawTrackId, trackId] of trackIdMap) {
      const track = tracks.find((t) => t.id === trackId)!;
      const def = INSTRUMENTS[track.instrument];
      const baseNote = rootNoteFor(track.instrument, root);
      const arr = Array.from({ length: MAX_STEPS }, () => createStep(baseNote));
      for (const hit of rawPattern.hits[rawTrackId] ?? []) {
        const index = Math.round(hit[0]);
        if (index < 0 || index >= MAX_STEPS) continue;
        arr[index] = {
          on: true,
          vel: clamp((hit[1] ?? 80) / 100, 0.05, 1),
          note: def.melodic ? Math.round(clamp(hit[2] ?? baseNote, 0, 127)) : baseNote,
          prob: clamp((hit[3] ?? 100) / 100, 0, 1),
          ratchet: Math.round(clamp(hit[4] ?? 1, 1, 4)),
          len: Math.round(clamp(hit[5] ?? 1, 1, 16)),
          offset: clamp((hit[6] ?? 0) / 100, -MAX_STEP_OFFSET, MAX_STEP_OFFSET),
        };
      }
      steps[trackId] = arr;
    }
    patterns.push({
      id: patternId,
      name: rawPattern.name.trim() || nextPatternName(patterns),
      length: Math.round(clamp(rawPattern.length, 1, MAX_STEPS)),
      steps,
    });
  }

  const patternIds = new Set(patterns.map((p) => p.id));
  const activePatternId =
    raw.activePatternId && patternIds.has(raw.activePatternId) ? raw.activePatternId : patterns[0].id;
  const now = Date.now();

  let arrangement: Section[];
  let automation: AutomationLane[] = [];
  let v3: z.infer<typeof v3Schema>['project'] | null = null;
  if ('chain' in raw) {
    arrangement = sectionsFromChain(raw.chain ?? [], patterns);
  } else {
    v3 = raw as z.infer<typeof v3Schema>['project'];
    const usedSectionIds = new Set<string>();
    arrangement = (v3.arrangement ?? [])
      .map((s) => normalizeSection(s, patternIds, trackIdMap, usedSectionIds))
      .filter((s): s is Section => s !== null);
    const usedLaneIds = new Set<string>();
    for (const lane of v3.automation ?? []) {
      const target = normalizeTarget(lane.target, trackIdMap);
      if (!target || usedLaneIds.has(lane.id)) continue;
      usedLaneIds.add(lane.id);
      automation.push({
        id: lane.id,
        target,
        points: lane.points.map((p) => ({ t: Math.max(0, p.t), v: clamp(p.v, 0, 1) })).sort((a, b) => a.t - b.t),
      });
    }
    // One lane per target
    const seen = new Set<string>();
    automation = automation.filter((l) => !seen.has(l.target) && seen.add(l.target));
  }
  if (!arrangement.length) arrangement = [createSection(activePatternId, { name: 'A' })];

  const loop =
    v3?.loop && v3.loop.end > v3.loop.start
      ? { start: Math.max(0, v3.loop.start), end: Math.max(v3.loop.start, v3.loop.end) }
      : null;
  const ambience = { ...defaultAmbience(), ...v3?.ambience };
  const sidechain = v3?.sidechain ? (trackIdMap.get(v3.sidechain) ?? null) : null;
  const meta = { ...defaultMeta(), ...v3?.meta };

  return {
    version: PROJECT_VERSION,
    id: raw.id ?? createId('prj'),
    name: raw.name.trim() || 'Untitled beat',
    bpm: Math.round(clamp(raw.bpm, BPM_MIN, BPM_MAX)),
    swing: clamp(raw.swing, SWING_MIN, SWING_MAX),
    root,
    scale,
    volume: clamp(raw.volume ?? 0.8, 0, 1),
    tracks,
    patterns,
    activePatternId,
    playMode: raw.playMode ?? 'pattern',
    arrangement,
    automation,
    loop,
    ambience: { type: ambience.type, level: clamp(ambience.level, 0, 1) },
    sidechain,
    fx: normalizeFx(raw.fx),
    meta: {
      artist: meta.artist.trim(),
      coverSeed: Math.floor(Math.abs(meta.coverSeed)) % 2 ** 31,
      styles: [...meta.styles],
    },
    createdAt: raw.createdAt ?? now,
    updatedAt: raw.updatedAt ?? now,
  };
}

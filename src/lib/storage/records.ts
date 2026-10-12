/** Pure helpers that turn projects into stored records. */
import { buildSongTimeline } from '@/lib/audio/sequence';
import { NOTE_NAMES, SCALES } from '@/lib/music/theory';
import { serializeProject } from '@/lib/project/serialize';
import type { Project } from '@/lib/project/types';
import type { ProjectRecord } from './db';
import type { ProjectMeta } from './types';

/** Song length in seconds, rounded to milliseconds. */
export function songSeconds(project: Project): number {
  return Math.round(buildSongTimeline(project).totalSeconds * 1000) / 1000;
}

export function projectMeta(project: Project): ProjectMeta {
  return {
    id: project.id,
    name: project.name,
    bpm: project.bpm,
    key: `${NOTE_NAMES[project.root]} ${SCALES[project.scale].label.toLowerCase()}`,
    tracks: project.tracks.length,
    patterns: project.patterns.length,
    sections: project.arrangement.length,
    seconds: songSeconds(project),
    styles: [...project.meta.styles],
    coverSeed: project.meta.coverSeed,
    updatedAt: project.updatedAt,
  };
}

export function projectRecords(project: Project): { record: ProjectRecord; meta: ProjectMeta } {
  return { record: { id: project.id, json: serializeProject(project) }, meta: projectMeta(project) };
}

/** Monotonic millisecond clock so records created in the same tick still sort deterministically. */
let lastStamp = 0;
export function stamp(): number {
  lastStamp = Math.max(Date.now(), lastStamp + 1);
  return lastStamp;
}

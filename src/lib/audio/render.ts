/** Offline (faster than realtime) rendering through the exact same mixer, voices and performer as playback. */
import { createRng } from '@/lib/music/rng';
import type { Project, Track } from '@/lib/project/types';
import { Mixer } from './mixer';
import { Performer } from './performer';
import { VoicePlayer } from './player';
import { renderTimeline, stepDuration, type SongTimeline } from './sequence';

export type RenderMode = 'pattern' | 'song';

export interface RenderOptions {
  mode: RenderMode;
  /** How many times to repeat the pattern / song */
  repeats: number;
  sampleRate?: 44100 | 48000;
  /** Let reverb and delay ring out after the last bar */
  tail?: boolean;
  seed?: number;
  onProgress?: (progress: number) => void;
  signal?: AbortSignal;
}

const LEAD_IN = 0.02;
const TAIL_SECONDS = 3;
/** Schedule notes in windows so long songs don't allocate every node up front. */
const WINDOW_SECONDS = 4;

export function renderLength(project: Project, mode: RenderMode, repeats: number, tail = true): number {
  return LEAD_IN + renderTimeline(project, mode, repeats).totalSeconds + (tail ? TAIL_SECONDS : 0.05);
}

function throwIfAborted(signal?: AbortSignal) {
  if (signal?.aborted) throw new DOMException('Export cancelled', 'AbortError');
}

interface PassOptions {
  timeline: SongTimeline;
  songMode: boolean;
  seconds: number;
  sampleRate: number;
  seed: number;
  /** Mix settings (a stem render mutes the other tracks here) */
  mixProject: Project;
  onlyTracks?: ReadonlySet<string>;
  onProgress?: (progress: number) => void;
  signal?: AbortSignal;
}

/** Walks every step of the timeline in order, like the realtime scheduler. */
function* stepsOf(timeline: SongTimeline) {
  for (const slot of timeline.slots) {
    const dur = stepDuration(slot.bpm);
    for (let i = 0; i < slot.pattern.length; i++) {
      yield { slot, step: i, time: LEAD_IN + slot.startTime + i * dur };
    }
  }
}

async function renderPass(project: Project, options: PassOptions): Promise<AudioBuffer> {
  throwIfAborted(options.signal);
  const { seconds, sampleRate, timeline, songMode } = options;
  const ctx = new OfflineAudioContext(2, Math.ceil(seconds * sampleRate), sampleRate);
  const mixer = new Mixer(ctx, ctx.destination, { realtime: false });
  mixer.sync(options.mixProject);
  mixer.setTransportActive(true, 0);
  const player = new VoicePlayer(ctx, mixer);
  const performer = new Performer(mixer, player, { rng: createRng(options.seed), onlyTracks: options.onlyTracks });

  const steps = stepsOf(timeline);
  let pending = steps.next();
  const scheduleUntil = (limit: number) => {
    while (!pending.done && pending.value.time < limit) {
      const { slot, step, time } = pending.value;
      if (step === 0 && songMode) performer.enterSlot(slot, time);
      performer.playStep(project, {
        pattern: slot.pattern,
        step,
        time,
        bpm: slot.bpm,
        transpose: slot.transpose,
        muted: slot.muted,
        songStep: songMode ? slot.startStep + step : null,
      });
      pending = steps.next();
    }
  };

  const canSuspend = typeof ctx.suspend === 'function';
  if (canSuspend && seconds > WINDOW_SECONDS * 1.5) {
    // Suspend every half window and top up the schedule, keeping ~2s of notes queued ahead.
    scheduleUntil(WINDOW_SECONDS);
    for (let t = WINDOW_SECONDS / 2; t < seconds - 0.1; t += WINDOW_SECONDS / 2) {
      const at = t;
      ctx
        .suspend(at)
        .then(() => {
          options.onProgress?.(Math.min(0.99, at / seconds));
          // After a cancel, stop scheduling; the render finishes quickly and is discarded below.
          if (!options.signal?.aborted) scheduleUntil(at + WINDOW_SECONDS);
          return ctx.resume();
        })
        .catch(() => undefined);
    }
  } else {
    scheduleUntil(Infinity);
  }

  const buffer = await ctx.startRendering();
  throwIfAborted(options.signal);
  options.onProgress?.(1);
  return buffer;
}

/** Render the full mix. */
export async function renderMix(project: Project, options: RenderOptions): Promise<AudioBuffer> {
  const timeline = renderTimeline(project, options.mode, options.repeats);
  return renderPass(project, {
    timeline,
    songMode: options.mode === 'song',
    seconds: renderLength(project, options.mode, options.repeats, options.tail ?? true),
    sampleRate: options.sampleRate ?? 44100,
    seed: options.seed ?? 7,
    mixProject: project,
    onProgress: options.onProgress,
    signal: options.signal,
  });
}

export interface Stem {
  track: Track;
  buffer: AudioBuffer;
}

/** Render every audible track on its own (with its sends), for mixing elsewhere. */
export async function renderStems(project: Project, options: RenderOptions): Promise<Stem[]> {
  const timeline = renderTimeline(project, options.mode, options.repeats);
  const seconds = renderLength(project, options.mode, options.repeats, options.tail ?? true);
  const anySolo = project.tracks.some((t) => t.solo);
  const tracks = project.tracks.filter((t) => !t.mute && (!anySolo || t.solo));
  const stems: Stem[] = [];
  for (let i = 0; i < tracks.length; i++) {
    const track = tracks[i];
    // Crackle and ambience belong to the master, not to any one stem.
    const mixProject: Project = {
      ...project,
      tracks: project.tracks.map((t) => ({ ...t, mute: t.id !== track.id, solo: false })),
      fx: { ...project.fx, crackle: 0 },
      ambience: { ...project.ambience, type: 'none' },
    };
    const buffer = await renderPass(project, {
      timeline,
      songMode: options.mode === 'song',
      seconds,
      sampleRate: options.sampleRate ?? 44100,
      // Same seed as the mix, so probability rolls match and the stems sum to the mix.
      seed: options.seed ?? 7,
      mixProject,
      onlyTracks: new Set([track.id]),
      signal: options.signal,
      onProgress: (p) => options.onProgress?.((i + p) / tracks.length),
    });
    stems.push({ track, buffer });
  }
  options.onProgress?.(1);
  return stems;
}

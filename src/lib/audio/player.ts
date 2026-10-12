/**
 * Turns NoteEvents into voices: applies track params, chord splitting and
 * strumming, monophonic retriggering with glide, hi-hat style choke groups and
 * sample lookup. Used by both the live engine and the offline renderer.
 */
import { INSTRUMENTS, type InstrumentId } from '@/lib/project/instruments';
import type { Project, Track } from '@/lib/project/types';
import { VOICES, type SampleVoiceData, type Voice } from './instruments';
import type { Mixer } from './mixer';
import type { NoteEvent } from './sequence';
import { sampleBank } from './samples';

const warned = new Set<string>();

/** FNV-1a: a stable non-negative seed from a track id (same id → same kit sound). */
function hashId(id: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < id.length; i++) {
    h ^= id.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

interface HeldVoice {
  voice: Voice;
  note: number;
}

/**
 * Params from old or hand-edited files can be missing or non-finite; voices
 * expect every param in range, so fall back to the instrument's defaults.
 */
function safeParams(instrument: InstrumentId, params: Record<string, number>): Record<string, number> {
  const def = INSTRUMENTS[instrument];
  let clean: Record<string, number> | null = null;
  for (const p of def.params) {
    const v = params[p.id];
    if (v === undefined || Number.isFinite(v)) continue;
    clean ??= { ...params };
    clean[p.id] = p.default;
  }
  return clean ?? params;
}

export class VoicePlayer {
  private readonly mono = new Map<string, HeldVoice>();
  private readonly chokes = new Map<string, Voice>();
  private active: Voice[] = [];

  constructor(
    private readonly ctx: BaseAudioContext,
    private readonly mixer: Mixer,
  ) {}

  trigger(project: Project, event: NoteEvent, track?: Track): Voice[] {
    const t = track ?? project.tracks.find((tr) => tr.id === event.trackId);
    if (!t) return [];
    const destination = this.mixer.input(t.id);
    if (!destination) return [];
    return this.play(t, event, destination);
  }

  /** Play a track's instrument outside the sequence (auditioning, live keyboard). */
  preview(track: Track, event: NoteEvent, destination?: AudioNode): Voice[] {
    const target = destination ?? this.mixer.input(track.id) ?? this.mixer.previewInput;
    return this.play(track, event, target);
  }

  /** Fade out everything that is still sounding (transport stop). */
  stopAll(time: number): void {
    for (const voice of this.active) voice.stop(time);
    this.active = [];
    this.mono.clear();
    this.chokes.clear();
  }

  private play(track: Track, event: NoteEvent, destination: AudioNode): Voice[] {
    const def = INSTRUMENTS[track.instrument];
    const voiceFn = VOICES[track.instrument];
    const { time } = event;

    let sample: SampleVoiceData | undefined;
    if (def.sampler) {
      const buffer = track.sample ? sampleBank.get(track.sample.id) : undefined;
      if (!buffer || !track.sample) return [];
      sample = { buffer, ref: track.sample };
    }

    if (def.chokeGroup) this.chokes.get(def.chokeGroup)?.stop(time);

    let glideFrom: number | undefined;
    if (def.mono) {
      const held = this.mono.get(track.id);
      if (held && held.voice.end > time) {
        glideFrom = held.note;
        held.voice.stop(time);
      }
    }

    // Keep chords from clipping: scale by 1/sqrt(n). Guitars strum their chords.
    const notes = def.mono ? event.notes.slice(0, 1) : event.notes;
    const chordScale = notes.length > 1 ? (1 / Math.sqrt(notes.length)) * 1.2 : 1;
    const strum = notes.length > 1 ? (track.params.strum ?? 0) : 0;
    const params = safeParams(track.instrument, track.params);
    const voices: Voice[] = [];
    notes.forEach((note, i) => {
      const at = time + i * strum;
      let voice: Voice;
      try {
        voice = voiceFn(
          this.ctx,
          destination,
          {
            time: at,
            note,
            velocity: event.velocity * chordScale * (1 - i * strum * 2),
            duration: Math.max(0.02, event.duration - i * strum),
            glideFrom,
            sample,
            variantSeed: hashId(track.id),
          },
          params,
        );
      } catch (error) {
        // A broken voice must never stall the scheduler or an export; skip the note.
        if (!warned.has(track.instrument)) {
          warned.add(track.instrument);
          console.warn(`LofiLoop: could not play ${track.instrument}`, error);
        }
        return;
      }
      voices.push(voice);
      this.active.push(voice);
      if (def.mono) this.mono.set(track.id, { voice, note });
      if (def.chokeGroup) this.chokes.set(def.chokeGroup, voice);
    });
    this.prune(time);
    return voices;
  }

  private prune(now: number) {
    if (this.active.length < 256) return;
    this.active = this.active.filter((v) => v.end > now);
  }
}

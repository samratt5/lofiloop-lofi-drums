/**
 * Plays one step of the song: note events, sidechain ducking, automation and
 * section transitions. Shared by the realtime engine and the offline renderer
 * so exports sound exactly like playback.
 */
import type { Rng } from '@/lib/music/rng';
import type { Pattern, Project } from '@/lib/project/types';
import type { Mixer } from './mixer';
import type { VoicePlayer } from './player';
import {
  automationValue,
  eventsForStep,
  sidechainSource,
  stepDuration,
  type NoteEvent,
  type TimelineSlot,
} from './sequence';

export interface StepPlay {
  pattern: Pattern;
  /** Step index within the pattern */
  step: number;
  /** Unswung start time of the step, in context seconds */
  time: number;
  bpm: number;
  transpose?: number;
  muted?: ReadonlySet<string>;
  /** Song position in 16ths; enables automation. Null in pattern mode. */
  songStep: number | null;
}

export interface PerformerOptions {
  rng: Rng;
  /** Only sound these tracks (stems). Sidechain still follows the full mix. */
  onlyTracks?: ReadonlySet<string>;
}

/** Length of each exit effect, in 16th steps. */
const EXIT_STEPS = { filter: 32, fade: 64, drop: 4, tapeStop: 8 } as const;
/** Entry effects run for up to two bars. */
const ENTER_STEPS = 32;

export class Performer {
  constructor(
    private readonly mixer: Mixer,
    private readonly player: VoicePlayer,
    private readonly options: PerformerOptions,
  ) {}

  playStep(project: Project, play: StepPlay): NoteEvent[] {
    const events = eventsForStep(project, play.pattern, play.step, play.time, {
      rng: this.options.rng,
      bpm: play.bpm,
      transpose: play.transpose,
      muted: play.muted,
      position: play.songStep ?? play.step,
    });
    const source = sidechainSource(project);
    const { onlyTracks } = this.options;
    for (const event of events) {
      if (!onlyTracks || onlyTracks.has(event.trackId)) this.player.trigger(project, event);
      if (event.trackId === source) this.duck(project, event.time, play.bpm);
    }
    if (play.songStep !== null && project.automation.length) {
      const bar = play.songStep / 16;
      for (const lane of project.automation) {
        const value = automationValue(lane, bar);
        if (value !== null) this.mixer.automate(lane.target, value, play.time);
      }
    }
    return events;
  }

  /** Schedule entry/exit effects for a pass of a section, called at the slot's first step. */
  enterSlot(slot: TimelineSlot, slotTime: number): void {
    const section = slot.section;
    if (!section) return;
    const dur = stepDuration(slot.bpm);
    const slotEnd = slotTime + slot.pattern.length * dur;
    if (slot.repeat === 0 && section.enter !== 'none') {
      // Finish before the section's own exit effect starts so they never fight over a param.
      const total = slot.pattern.length * section.repeats;
      const exit = section.exit === 'none' ? 0 : Math.min(EXIT_STEPS[section.exit], slot.pattern.length);
      const steps = Math.max(1, Math.min(ENTER_STEPS, total - exit));
      this.mixer.enterTransition(section.enter, slotTime, slotTime + steps * dur);
    }
    if (slot.last && section.exit !== 'none') {
      const steps = Math.min(EXIT_STEPS[section.exit], slot.pattern.length);
      this.mixer.exitTransition(section.exit, slotEnd - steps * dur, slotEnd);
    }
  }

  private duck(project: Project, time: number, bpm: number) {
    const release = Math.min(0.28, (60 / bpm) * 0.45);
    for (const track of project.tracks) {
      if (track.duck > 0) this.mixer.duck(track.id, time, track.duck, release);
    }
  }
}

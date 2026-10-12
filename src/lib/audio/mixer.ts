/**
 * Mixer and master chain, built identically for the live AudioContext and
 * for OfflineAudioContext exports:
 *
 *   strip: input -> high-pass -> low-pass -> drive -> crush -> chorus -> fader -> duck -> mute -> pan
 *
 *   strips ─┬─> sum ─────────────────┐
 *           ├─> reverb send ─> IR ───┤
 *           └─> delay send ─> ping-pong
 *                                    v
 *   bus trim -> drive -> crush -> wow/flutter -> tone (+ crackle) -> transitions (sweep, filter lane, fade, tape stop)
 *     -> glue (+ ambience) -> master -> limiter -> safety clipper
 */
import { kWeightingFilters } from '@/lib/export/loudness';
import { dbToGain, expMap } from '@/lib/utils/math';
import type {
  AmbienceType,
  AutomationTarget,
  EnterTransition,
  ExitTransition,
  MasterFx,
  Project,
  Track,
  TrackFx,
} from '@/lib/project/types';
import { hasSolo, isAudible } from './sequence';
import { crushCurve, saturationCurve } from './instruments/utils';
import { ambienceBuffer } from './ambience';
import { crackleBuffer, delaySeconds, faderGain, impulseResponse, safetyCurve, toneFrequency } from './fx';

interface Strip {
  input: GainNode;
  highpass: BiquadFilterNode;
  lowpass: BiquadFilterNode;
  drive: WaveShaperNode;
  drivePost: GainNode;
  crushDry: GainNode;
  crushWet: GainNode;
  crushShaper: WaveShaperNode;
  chorusIn: GainNode;
  chorusDelay: DelayNode;
  chorusWet: GainNode;
  chorusDepth: GainNode;
  chorusLfo: OscillatorNode;
  volume: GainNode;
  duck: GainNode;
  mute: GainNode;
  pan: StereoPannerNode;
  reverb: GainNode;
  delay: GainNode;
  analyser?: AnalyserNode;
  fx: TrackFx | null;
}

export interface MixerOptions {
  /** Live contexts smooth parameter changes, get meters and debounce reverb rebuilds. */
  realtime: boolean;
}

const SMOOTHING = 0.015;
/** About -5 dB of mix-bus headroom. */
const BUS_TRIM = 0.56;
const OPEN = 20000;

function cutoffHz(v: number): number {
  return expMap(v, 120, OPEN);
}

function highpassHz(v: number): number {
  return v <= 0.001 ? 10 : 20 * Math.pow(2, v * 9);
}

export class Mixer {
  readonly ctx: BaseAudioContext;
  readonly output: GainNode;
  readonly analyser: AnalyserNode | null = null;
  /** K-weighted signal for the loudness meter (realtime only). */
  readonly loudnessAnalyser: AnalyserNode | null = null;

  private readonly realtime: boolean;
  private readonly strips = new Map<string, Strip>();
  private readonly sum: GainNode;
  private readonly convolver: ConvolverNode;
  private readonly reverbIn: GainNode;
  private readonly reverbReturn: GainNode;
  private readonly delayIn: GainNode;
  private readonly delayL: DelayNode;
  private readonly delayR: DelayNode;
  private readonly feedbackL: GainNode;
  private readonly feedbackR: GainNode;
  private readonly delayReturn: GainNode;
  private readonly drivePre: GainNode;
  private readonly driveShaper: WaveShaperNode;
  private readonly drivePost: GainNode;
  private readonly crushDry: GainNode;
  private readonly crushWet: GainNode;
  private readonly crushShaper: WaveShaperNode;
  private readonly wowDelay: DelayNode;
  private readonly wowDepth: GainNode;
  private readonly flutterDepth: GainNode;
  private readonly lfos: OscillatorNode[] = [];
  private readonly toneHp: BiquadFilterNode;
  private readonly toneLp: BiquadFilterNode;
  private readonly sweep: BiquadFilterNode;
  /** Master filter automation lane (separate from the transition sweep so they never fight) */
  private readonly laneFilter: BiquadFilterNode;
  private readonly fade: GainNode;
  private readonly tapeStop: DelayNode;
  private readonly crackle: AudioBufferSourceNode;
  private readonly crackleGain: GainNode;
  private readonly ambienceGain: GainNode;
  private ambienceSource: AudioBufferSourceNode | null = null;
  private ambienceType: AmbienceType = 'none';
  private ambienceLevel = 0;
  private readonly glue: DynamicsCompressorNode;
  private readonly makeup: GainNode;
  private readonly master: GainNode;
  private readonly limiter: DynamicsCompressorNode;
  private readonly clipper: WaveShaperNode;

  private fx: MasterFx | null = null;
  private bpm = 0;
  private reverbSize = -1;
  private reverbTimer: ReturnType<typeof setTimeout> | null = null;
  private transportActive = false;
  private disposed = false;
  /** Params currently driven by automation lanes; project syncs leave them alone. */
  private readonly automated = new Set<AutomationTarget>();

  constructor(ctx: BaseAudioContext, destination: AudioNode, { realtime }: MixerOptions) {
    this.ctx = ctx;
    this.realtime = realtime;

    this.sum = ctx.createGain();

    // Reverb bus
    this.reverbIn = ctx.createGain();
    this.convolver = ctx.createConvolver();
    this.reverbReturn = ctx.createGain();
    const reverbHp = ctx.createBiquadFilter();
    reverbHp.type = 'highpass';
    reverbHp.frequency.value = 180;
    this.reverbIn.connect(reverbHp).connect(this.convolver).connect(this.reverbReturn);

    // Ping-pong delay bus with a darkening feedback loop
    this.delayIn = ctx.createGain();
    this.delayL = ctx.createDelay(2);
    this.delayR = ctx.createDelay(2);
    this.feedbackL = ctx.createGain();
    this.feedbackR = ctx.createGain();
    const loopToneL = ctx.createBiquadFilter();
    const loopToneR = ctx.createBiquadFilter();
    loopToneL.type = loopToneR.type = 'lowpass';
    loopToneL.frequency.value = loopToneR.frequency.value = 3200;
    const delayHp = ctx.createBiquadFilter();
    delayHp.type = 'highpass';
    delayHp.frequency.value = 250;
    const merger = ctx.createChannelMerger(2);
    this.delayReturn = ctx.createGain();
    this.delayIn.connect(delayHp).connect(this.delayL);
    this.delayL.connect(loopToneL).connect(this.feedbackL).connect(this.delayR);
    this.delayR.connect(loopToneR).connect(this.feedbackR).connect(this.delayL);
    this.delayL.connect(merger, 0, 0);
    this.delayR.connect(merger, 0, 1);
    merger.connect(this.delayReturn);

    // Tape drive; a full kit summed at unity overdrives the bus, so trim it first.
    this.drivePre = ctx.createGain();
    this.driveShaper = ctx.createWaveShaper();
    this.driveShaper.oversample = '2x';
    this.drivePost = ctx.createGain();
    const busTrim = ctx.createGain();
    busTrim.gain.value = BUS_TRIM;
    this.sum.connect(busTrim);
    this.reverbReturn.connect(busTrim);
    this.delayReturn.connect(busTrim);
    busTrim.connect(this.drivePre).connect(this.driveShaper).connect(this.drivePost);

    // Bit crusher (dry/wet so it can be fully bypassed)
    this.crushDry = ctx.createGain();
    this.crushWet = ctx.createGain();
    this.crushShaper = ctx.createWaveShaper();
    this.wowDelay = ctx.createDelay(0.1);
    this.wowDelay.delayTime.value = 0.008;
    this.drivePost.connect(this.crushDry).connect(this.wowDelay);
    this.drivePost.connect(this.crushShaper).connect(this.crushWet).connect(this.wowDelay);

    // Wow & flutter: slow + fast pitch drift via a modulated delay line
    this.wowDepth = ctx.createGain();
    this.flutterDepth = ctx.createGain();
    const wow = ctx.createOscillator();
    wow.frequency.value = 0.55;
    const flutter = ctx.createOscillator();
    flutter.frequency.value = 6.5;
    wow.connect(this.wowDepth).connect(this.wowDelay.delayTime);
    flutter.connect(this.flutterDepth).connect(this.wowDelay.delayTime);
    this.lfos.push(wow, flutter);

    // Tone
    this.toneHp = ctx.createBiquadFilter();
    this.toneHp.type = 'highpass';
    this.toneLp = ctx.createBiquadFilter();
    this.toneLp.type = 'lowpass';
    this.toneLp.Q.value = 0.6;
    this.wowDelay.connect(this.toneHp).connect(this.toneLp);

    // Vinyl crackle runs through the tone filter so dark settings muffle it too
    this.crackle = ctx.createBufferSource();
    this.crackle.buffer = crackleBuffer(ctx);
    this.crackle.loop = true;
    this.crackleGain = ctx.createGain();
    this.crackleGain.gain.value = 0;
    this.crackle.connect(this.crackleGain).connect(this.toneHp);

    // Section transitions: DJ-style sweep filter, fade and a tape-stop delay line
    this.sweep = ctx.createBiquadFilter();
    this.sweep.type = 'lowpass';
    this.sweep.Q.value = 1.1;
    this.sweep.frequency.value = this.nyquist;
    this.laneFilter = ctx.createBiquadFilter();
    this.laneFilter.type = 'lowpass';
    this.laneFilter.Q.value = 0.9;
    this.laneFilter.frequency.value = this.nyquist;
    this.fade = ctx.createGain();
    this.tapeStop = ctx.createDelay(3);
    this.tapeStop.delayTime.value = 0;

    // Bus glue, master volume and a safety limiter
    this.glue = ctx.createDynamicsCompressor();
    this.glue.attack.value = 0.015;
    this.glue.release.value = 0.25;
    this.glue.knee.value = 12;
    this.makeup = ctx.createGain();
    this.master = ctx.createGain();
    this.limiter = ctx.createDynamicsCompressor();
    this.limiter.threshold.value = -2;
    this.limiter.knee.value = 0;
    this.limiter.ratio.value = 20;
    this.limiter.attack.value = 0.001;
    this.limiter.release.value = 0.08;
    // The compressor-based limiter lets fast transients through; a soft clipper catches them.
    this.clipper = ctx.createWaveShaper();
    this.clipper.curve = safetyCurve();
    this.clipper.oversample = '4x';
    this.output = ctx.createGain();
    this.toneLp
      .connect(this.sweep)
      .connect(this.laneFilter)
      .connect(this.fade)
      .connect(this.tapeStop)
      .connect(this.glue)
      .connect(this.makeup)
      .connect(this.master)
      .connect(this.limiter)
      .connect(this.clipper)
      .connect(this.output);
    this.output.connect(destination);

    // Ambience sits under the music and skips the section transitions.
    this.ambienceGain = ctx.createGain();
    this.ambienceGain.gain.value = 0;
    this.ambienceGain.connect(this.glue);

    if (realtime) {
      this.analyser = ctx.createAnalyser();
      this.analyser.fftSize = 2048;
      this.analyser.smoothingTimeConstant = 0.75;
      this.output.connect(this.analyser);

      // Exact ITU-R BS.1770 K-weighting (the same filters the export meter uses).
      this.loudnessAnalyser = ctx.createAnalyser();
      this.loudnessAnalyser.fftSize = 32768;
      let node: AudioNode = this.output;
      for (const f of kWeightingFilters(ctx.sampleRate)) {
        node = node.connect(ctx.createIIRFilter(Array.from(f.b), Array.from(f.a)));
      }
      node.connect(this.loudnessAnalyser);
    }

    for (const lfo of this.lfos) lfo.start(0);
    this.crackle.start(0);
  }

  private get nyquist(): number {
    return Math.min(OPEN, this.ctx.sampleRate / 2 - 200);
  }

  /** Where voices for a track should connect. */
  input(trackId: string): AudioNode | null {
    return this.strips.get(trackId)?.input ?? null;
  }

  /** Voices that don't belong to a track (instrument browser previews). */
  get previewInput(): AudioNode {
    return this.sum;
  }

  trackAnalyser(trackId: string): AnalyserNode | undefined {
    return this.strips.get(trackId)?.analyser;
  }

  /** Vinyl noise and ambience only run while the transport plays. */
  setTransportActive(active: boolean, time = this.ctx.currentTime): void {
    this.transportActive = active;
    this.applyBeds(time);
  }

  sync(project: Project): void {
    if (this.disposed) return;
    const anySolo = hasSolo(project.tracks);
    const seen = new Set<string>();
    for (const track of project.tracks) {
      seen.add(track.id);
      let strip = this.strips.get(track.id);
      if (!strip) {
        strip = this.createStrip();
        this.strips.set(track.id, strip);
        this.updateStrip(strip, track, anySolo, true);
      } else {
        this.updateStrip(strip, track, anySolo, false);
      }
    }
    for (const [id, strip] of this.strips) {
      if (!seen.has(id)) {
        this.removeStrip(strip);
        this.strips.delete(id);
      }
    }
    if (!this.automated.has('master.volume')) this.set(this.master.gain, faderGain(project.volume));
    this.syncFx(project.fx, project.bpm);
    this.syncAmbience(project.ambience.type, project.ambience.level);
  }

  // --- song features ---

  /** Dip a track's level on a sidechain hit, recovering over `release` seconds. */
  duck(trackId: string, time: number, depth: number, release: number): void {
    const strip = this.strips.get(trackId);
    if (!strip || depth <= 0) return;
    const g = strip.duck.gain;
    g.setTargetAtTime(1 - Math.min(0.95, depth), time, 0.003);
    g.setTargetAtTime(1, time + 0.025, Math.max(0.02, release / 3));
  }

  /** Ramp an automated parameter to `value` (0..1) by `time`. */
  automate(target: AutomationTarget, value: number, time: number): void {
    const resolved = this.resolveTarget(target);
    if (!resolved) return;
    const [param, mapped] = resolved(value);
    if (!this.automated.has(target)) {
      this.automated.add(target);
      param.cancelScheduledValues(time);
      param.setValueAtTime(mapped, time);
    } else {
      param.linearRampToValueAtTime(mapped, time);
    }
  }

  /** Hand automated params back to the project settings (transport stop, lane removed). */
  releaseAutomation(project: Project): void {
    const time = this.ctx.currentTime;
    for (const target of this.automated) this.resolveTarget(target)?.(0)[0].cancelScheduledValues(time);
    this.automated.clear();
    // Not a project setting, so sync() won't restore it: open the lane filter again.
    this.laneFilter.frequency.setValueAtTime(this.nyquist, time);
    for (const strip of this.strips.values()) strip.fx = null;
    this.fx = null;
    this.bpm = 0;
    this.sync(project);
  }

  /** Schedule a section's entry effect between `start` and `end` (seconds). */
  enterTransition(type: EnterTransition, start: number, end: number): void {
    if (type === 'filter') {
      const f = this.sweep.frequency;
      f.cancelScheduledValues(start);
      f.setValueAtTime(320, start);
      f.exponentialRampToValueAtTime(this.nyquist, end);
    } else if (type === 'fade') {
      // Linear in amplitude rises quickly at first, which sounds like an even fade-in.
      const g = this.fade.gain;
      g.cancelScheduledValues(start);
      g.setValueAtTime(0, start);
      g.linearRampToValueAtTime(1, end);
    }
  }

  /**
   * Schedule a section's exit effect, fully reset by `end` for the next section.
   * Events are appended rather than cleared: steps are scheduled in time order and
   * an entry effect always finishes before the exit starts, so nothing overlaps.
   */
  exitTransition(type: ExitTransition, start: number, end: number): void {
    const f = this.sweep.frequency;
    const g = this.fade.gain;
    if (type === 'filter') {
      f.setValueAtTime(this.nyquist, start);
      f.exponentialRampToValueAtTime(380, end);
      f.setValueAtTime(this.nyquist, end);
    } else if (type === 'fade') {
      g.setValueAtTime(1, start);
      g.linearRampToValueAtTime(0, end);
      g.setValueAtTime(1, end);
    } else if (type === 'drop') {
      g.setValueAtTime(1, start);
      g.setTargetAtTime(0, start, 0.008);
      g.setValueAtTime(1, end);
    } else if (type === 'tapeStop') {
      // Growing delay slows playback: delay(t) = t² / 2D gives speed 1 - t/D.
      const duration = Math.max(0.05, end - start);
      const points = 64;
      const curve = new Float32Array(points);
      for (let i = 0; i < points; i++) {
        const t = (i / (points - 1)) * duration;
        curve[i] = Math.min(2.9, (t * t) / (2 * duration));
      }
      const d = this.tapeStop.delayTime;
      // A value curve may not overlap other events on the same param.
      d.cancelScheduledValues(start);
      d.setValueCurveAtTime(curve, start, duration);
      d.setValueAtTime(0, end + 0.001);
      g.setValueAtTime(1, start);
      g.linearRampToValueAtTime(1, start + duration * 0.5);
      g.linearRampToValueAtTime(0, end);
      g.setValueAtTime(1, end + 0.001);
    }
  }

  /** Momentary performance effects: a low-pass sweep, a reverb/echo wash and a tape stop. */
  liveEffect(kind: 'filter' | 'wash' | 'tapeStop', active: boolean, time: number, bpm: number): void {
    if (kind === 'filter') {
      const f = this.sweep.frequency;
      f.cancelScheduledValues(time);
      f.setValueAtTime(f.value, time);
      if (active) f.exponentialRampToValueAtTime(420, time + 0.6);
      else f.exponentialRampToValueAtTime(this.nyquist, time + 0.25);
    } else if (kind === 'wash') {
      const base = this.fx ?? { reverbMix: 0.35, delayMix: 0.25, delayFeedback: 0.35 };
      for (const [param, on, off] of [
        [this.reverbReturn.gain, 1.6, base.reverbMix * 1.4],
        [this.delayReturn.gain, 1, base.delayMix * 0.9],
        [this.feedbackL.gain, 0.78, base.delayFeedback],
        [this.feedbackR.gain, 0.78, base.delayFeedback],
      ] as const) {
        param.cancelScheduledValues(time);
        param.setTargetAtTime(active ? on : off, time, active ? 0.15 : 0.4);
      }
    } else if (kind === 'tapeStop' && active) {
      const beat = 60 / bpm;
      this.exitTransition('tapeStop', time, time + beat * 2);
    }
  }

  /** Clear pending transitions (transport stop or seek). */
  resetTransitions(time = this.ctx.currentTime): void {
    for (const param of [this.sweep.frequency, this.fade.gain, this.tapeStop.delayTime]) {
      param.cancelScheduledValues(time);
    }
    this.sweep.frequency.setValueAtTime(this.nyquist, time);
    this.fade.gain.setValueAtTime(1, time);
    this.tapeStop.delayTime.setValueAtTime(0, time);
    for (const strip of this.strips.values()) {
      strip.duck.gain.cancelScheduledValues(time);
      strip.duck.gain.setValueAtTime(1, time);
    }
  }

  dispose(): void {
    this.disposed = true;
    if (this.reverbTimer) clearTimeout(this.reverbTimer);
    for (const lfo of this.lfos) lfo.stop();
    this.crackle.stop();
    this.ambienceSource?.stop();
    this.output.disconnect();
    for (const strip of this.strips.values()) this.removeStrip(strip);
    this.strips.clear();
  }

  // --- internals ---

  private resolveTarget(target: AutomationTarget): ((v: number) => [AudioParam, number]) | null {
    const parts = target.split('.');
    if (parts[0] === 'master') {
      switch (parts[1]) {
        case 'volume':
          return (v) => [this.master.gain, faderGain(v)];
        case 'tone':
          return (v) => [this.toneLp.frequency, Math.min(this.nyquist, toneFrequency(v))];
        case 'filter':
          return (v) => [this.laneFilter.frequency, Math.min(this.nyquist, expMap(v, 150, OPEN))];
        case 'reverbMix':
          return (v) => [this.reverbReturn.gain, v * 1.4];
        case 'delayMix':
          return (v) => [this.delayReturn.gain, v * 0.9];
        case 'wow':
          return (v) => [this.wowDepth.gain, v * 0.0022];
        default:
          return null;
      }
    }
    const strip = this.strips.get(parts[1]);
    if (!strip) return null;
    switch (parts[2]) {
      case 'volume':
        return (v) => [strip.volume.gain, faderGain(v)];
      case 'pan':
        return (v) => [strip.pan.pan, v * 2 - 1];
      case 'cutoff':
        return (v) => [strip.lowpass.frequency, Math.min(this.nyquist, cutoffHz(v))];
      case 'reverb':
        return (v) => [strip.reverb.gain, v];
      case 'delay':
        return (v) => [strip.delay.gain, v];
      default:
        return null;
    }
  }

  private createStrip(): Strip {
    const { ctx } = this;
    const highpass = ctx.createBiquadFilter();
    highpass.type = 'highpass';
    highpass.frequency.value = 10;
    const lowpass = ctx.createBiquadFilter();
    lowpass.type = 'lowpass';
    lowpass.frequency.value = this.nyquist;
    const drive = ctx.createWaveShaper();
    drive.oversample = '2x';
    const crushShaper = ctx.createWaveShaper();
    const chorusDelay = ctx.createDelay(0.05);
    chorusDelay.delayTime.value = 0.012;
    const chorusLfo = ctx.createOscillator();
    chorusLfo.frequency.value = 0.7;
    const strip: Strip = {
      input: ctx.createGain(),
      highpass,
      lowpass,
      drive,
      drivePost: ctx.createGain(),
      crushDry: ctx.createGain(),
      crushWet: ctx.createGain(),
      crushShaper,
      chorusIn: ctx.createGain(),
      chorusDelay,
      chorusWet: ctx.createGain(),
      chorusDepth: ctx.createGain(),
      chorusLfo,
      volume: ctx.createGain(),
      duck: ctx.createGain(),
      mute: ctx.createGain(),
      pan: ctx.createStereoPanner(),
      reverb: ctx.createGain(),
      delay: ctx.createGain(),
      fx: null,
    };
    strip.crushWet.gain.value = 0;
    strip.chorusWet.gain.value = 0;
    strip.chorusDepth.gain.value = 0;
    strip.input.connect(highpass).connect(lowpass).connect(drive).connect(strip.drivePost);
    strip.drivePost.connect(strip.crushDry).connect(strip.chorusIn);
    strip.drivePost.connect(crushShaper).connect(strip.crushWet).connect(strip.chorusIn);
    strip.chorusIn.connect(strip.volume);
    strip.chorusIn.connect(chorusDelay).connect(strip.chorusWet).connect(strip.volume);
    chorusLfo.connect(strip.chorusDepth).connect(chorusDelay.delayTime);
    chorusLfo.start(0);
    strip.volume.connect(strip.duck).connect(strip.mute).connect(strip.pan);
    strip.pan.connect(this.sum);
    strip.pan.connect(strip.reverb).connect(this.reverbIn);
    strip.pan.connect(strip.delay).connect(this.delayIn);
    if (this.realtime) {
      strip.analyser = ctx.createAnalyser();
      strip.analyser.fftSize = 512;
      strip.pan.connect(strip.analyser);
    }
    return strip;
  }

  private updateStrip(strip: Strip, track: Track, anySolo: boolean, immediate: boolean) {
    const auto = (p: string) => this.automated.has(`track.${track.id}.${p}` as AutomationTarget);
    if (!auto('volume')) this.set(strip.volume.gain, faderGain(track.volume), immediate);
    if (!auto('pan')) this.set(strip.pan.pan, track.pan, immediate);
    if (!auto('reverb')) this.set(strip.reverb.gain, track.reverb, immediate);
    if (!auto('delay')) this.set(strip.delay.gain, track.delay, immediate);
    this.set(strip.mute.gain, isAudible(track, anySolo) ? 1 : 0, immediate);

    const prev = strip.fx;
    const fx = track.fx;
    const first = prev === null || immediate;
    if ((first || prev.cutoff !== fx.cutoff || prev.resonance !== fx.resonance) && !auto('cutoff')) {
      this.set(strip.lowpass.frequency, fx.cutoff >= 0.999 ? this.nyquist : cutoffHz(fx.cutoff), first);
    }
    if (first || prev.resonance !== fx.resonance) this.set(strip.lowpass.Q, 0.5 + fx.resonance * 12, first);
    if (first || prev.highpass !== fx.highpass) this.set(strip.highpass.frequency, highpassHz(fx.highpass), first);
    if (first || prev.drive !== fx.drive) {
      const on = fx.drive >= 0.01;
      const amount = fx.drive * 0.7;
      const k = 1 + amount * 12;
      strip.drive.curve = on ? saturationCurve(amount) : null;
      // Compensate most of the curve's gain so drive adds grit, not just volume.
      this.set(strip.drivePost.gain, on ? Math.pow(Math.tanh(k) / k, 0.7) : 1, first);
    }
    if (first || prev.crush !== fx.crush) {
      const on = fx.crush >= 0.01;
      if (on) strip.crushShaper.curve = crushCurve(12 - fx.crush * 9);
      this.set(strip.crushDry.gain, on ? 0 : 1, first);
      this.set(strip.crushWet.gain, on ? 0.9 : 0, first);
    }
    if (first || prev.chorus !== fx.chorus) {
      this.set(strip.chorusWet.gain, fx.chorus * 0.7, first);
      this.set(strip.chorusDepth.gain, fx.chorus * 0.004, first);
    }
    strip.fx = { ...fx };
  }

  private removeStrip(strip: Strip) {
    const t = this.ctx.currentTime;
    strip.mute.gain.setTargetAtTime(0, t, SMOOTHING);
    const disconnect = () => {
      try {
        strip.chorusLfo.stop();
      } catch {
        // already stopped
      }
      for (const node of Object.values(strip)) {
        if (node && typeof node === 'object' && 'disconnect' in node) (node as AudioNode).disconnect();
      }
    };
    if (this.realtime) setTimeout(disconnect, 200);
    else disconnect();
  }

  private syncFx(fx: MasterFx, bpm: number) {
    const prev = this.fx;
    const first = prev === null;
    const auto = (p: string) => this.automated.has(`master.${p}` as AutomationTarget);

    if (first || prev.drive !== fx.drive) {
      // Push into the curve, then undo its small-signal gain so drive adds warmth, not volume.
      const amount = fx.drive * 0.5;
      const k = 1 + amount * 12;
      const pre = 1 + fx.drive * 1.5;
      const on = fx.drive >= 0.01;
      this.driveShaper.curve = on ? saturationCurve(amount) : null;
      this.set(this.drivePre.gain, on ? pre : 1, first);
      this.set(this.drivePost.gain, on ? Math.tanh(k) / (k * pre) : 1, first);
    }
    if (first || prev.crush !== fx.crush) {
      const on = fx.crush > 0.01;
      if (on) this.crushShaper.curve = crushCurve(14 - fx.crush * 10);
      this.set(this.crushDry.gain, on ? 0 : 1, first);
      this.set(this.crushWet.gain, on ? 0.9 : 0, first);
    }
    if ((first || prev.wow !== fx.wow) && !auto('wow')) {
      this.set(this.wowDepth.gain, fx.wow * 0.0022, first);
      this.set(this.flutterDepth.gain, fx.wow * 0.00025, first);
    }
    if (first || prev.tone !== fx.tone) {
      if (!auto('tone')) this.set(this.toneLp.frequency, Math.min(this.nyquist, toneFrequency(fx.tone)), first);
      this.set(this.toneHp.frequency, 25 + (1 - fx.tone) * 110, first);
    }
    if (first || prev.glue !== fx.glue) {
      this.set(this.glue.threshold, -4 - fx.glue * 22, first);
      this.set(this.glue.ratio, 1.5 + fx.glue * 3, first);
      this.set(this.makeup.gain, dbToGain(fx.glue * 5), first);
    }
    if ((first || prev.reverbMix !== fx.reverbMix) && !auto('reverbMix')) {
      this.set(this.reverbReturn.gain, fx.reverbMix * 1.4, first);
    }
    if (first || prev.reverbSize !== fx.reverbSize) this.scheduleReverb(fx.reverbSize, first);
    if ((first || prev.delayMix !== fx.delayMix) && !auto('delayMix')) {
      this.set(this.delayReturn.gain, fx.delayMix * 0.9, first);
    }
    if (first || prev.delayFeedback !== fx.delayFeedback) {
      this.set(this.feedbackL.gain, fx.delayFeedback, first);
      this.set(this.feedbackR.gain, fx.delayFeedback, first);
    }
    if (first || prev.delayDivision !== fx.delayDivision || this.bpm !== bpm) {
      const seconds = Math.min(1.9, delaySeconds(fx.delayDivision, bpm));
      this.set(this.delayL.delayTime, seconds, first, 0.05);
      this.set(this.delayR.delayTime, seconds, first, 0.05);
    }
    const crackleChanged = first || prev.crackle !== fx.crackle;
    this.fx = fx;
    this.bpm = bpm;
    if (crackleChanged) this.applyBeds(this.ctx.currentTime);
  }

  private syncAmbience(type: AmbienceType, level: number) {
    if (type !== this.ambienceType) {
      this.ambienceType = type;
      if (this.ambienceSource) {
        const old = this.ambienceSource;
        if (this.realtime) setTimeout(() => old.stop(), 300);
        else old.stop();
        this.ambienceSource = null;
      }
      if (type !== 'none') {
        const src = this.ctx.createBufferSource();
        src.buffer = ambienceBuffer(this.ctx, type);
        src.loop = true;
        src.connect(this.ambienceGain);
        src.start(0);
        this.ambienceSource = src;
      }
    }
    const next = type === 'none' ? 0 : level;
    if (next !== this.ambienceLevel) {
      this.ambienceLevel = next;
      this.applyBeds(this.ctx.currentTime);
    }
  }

  /** Crackle and ambience fade with the transport. */
  private applyBeds(time: number) {
    const crackle = this.transportActive && this.fx ? this.fx.crackle * 0.35 : 0;
    const ambience = this.transportActive ? this.ambienceLevel * 0.6 : 0;
    if (this.realtime) {
      this.crackleGain.gain.setTargetAtTime(crackle, time, 0.08);
      this.ambienceGain.gain.setTargetAtTime(ambience, time, 0.25);
    } else {
      this.crackleGain.gain.setValueAtTime(crackle, time);
      this.ambienceGain.gain.setValueAtTime(ambience, time);
    }
  }

  private scheduleReverb(size: number, immediate: boolean) {
    if (Math.abs(size - this.reverbSize) < 0.001) return;
    const build = () => {
      this.reverbTimer = null;
      if (this.disposed) return;
      this.reverbSize = size;
      this.convolver.buffer = impulseResponse(this.ctx, size);
    };
    if (immediate || !this.realtime) {
      build();
      return;
    }
    if (this.reverbTimer) clearTimeout(this.reverbTimer);
    this.reverbTimer = setTimeout(build, 120);
  }

  private set(param: AudioParam, value: number, immediate = false, smoothing = SMOOTHING) {
    if (!this.realtime || immediate) {
      param.cancelScheduledValues(0);
      param.value = value;
      return;
    }
    param.setTargetAtTime(value, this.ctx.currentTime, smoothing);
  }
}

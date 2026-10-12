/**
 * "Band" voices: nylon guitar and upright bass (Karplus–Strong strings through
 * body resonances), ensemble strings, flute and vocal "oohs" (formant synthesis).
 */
import { midiToFreq } from '@/lib/music/theory';
import { quantise, stringBuffer } from './karplus';
import { gate, kRate, num, retrigger, variant, vel, vibratoDepth } from './shared';
import {
  VoiceBuilder,
  filter,
  gain,
  gateEnvelope,
  noiseSource,
  osc,
  percEnvelope,
  velocityGain,
  type VoiceFn,
} from './utils';

function panner(ctx: BaseAudioContext, pan: number): StereoPannerNode | GainNode {
  if (typeof ctx.createStereoPanner !== 'function') return gain(ctx, 1);
  const node = ctx.createStereoPanner();
  node.pan.value = Math.max(-1, Math.min(1, pan));
  return node;
}

/** Nylon-string guitar; plucks ring out naturally (the gate is ignored, like the synth pluck). */
export const guitar: VoiceFn = (ctx, out, { time, note, velocity }, p) => {
  const v = new VoiceBuilder(ctx, out, time);
  const velo = vel(velocity);
  const tone = num(p, 'tone', 0.45, 0, 1);
  const decay = num(p, 'decay', 1.6, 0.1, 8);
  const body = quantise(num(p, 'body', 0.5, 0, 1), 10);
  const rr = variant(time, note, 3);

  const src = ctx.createBufferSource();
  src.buffer = stringBuffer(ctx, note, {
    decay,
    brightness: 0.2 + tone * 0.55,
    pickPosition: 0.11 + rr * 0.025,
    softness: 0.2,
    seed: 101 + rr,
    // Air cavity and top-plate resonances with a slight upper-mid scoop
    body: {
      peaks: [
        [102, 1.8, 2 + body * 7],
        [215, 1.3, body * 5],
        [1400, 0.8, -1 - body * 3],
      ],
      highpass: 60,
    },
  });
  // Softer plucks are darker
  const lp = filter(ctx, 'lowpass', 1400 + tone * 4000 + velo * velo * 5000, 0.5);
  src.connect(lp).connect(v.output);
  v.source(src, time + src.buffer.duration);

  v.output.gain.value = velocityGain(velo) * 0.55;
  return retrigger(out, note, time, v.finish(), 0.04);
};

/** Upright bass: a finger-plucked string with a woody thump; mono, rings until the next note. */
export const upright: VoiceFn = (ctx, out, { time, note, velocity }, p) => {
  const v = new VoiceBuilder(ctx, out, time);
  const velo = vel(velocity);
  const tone = num(p, 'tone', 0.4, 0, 1);
  const decay = num(p, 'decay', 0.9, 0.1, 6);
  const thump = num(p, 'thump', 0.5, 0, 1);
  const freq = midiToFreq(note);
  const rr = variant(time, note, 2);

  const src = ctx.createBufferSource();
  src.buffer = stringBuffer(ctx, note, {
    decay,
    brightness: 0.05 + tone * 0.4,
    pickPosition: 0.18 + rr * 0.03,
    softness: 0.75 - tone * 0.35,
    seed: 211 + rr,
    body: { peaks: [[95, 1.2, 3]], highpass: 32 },
  });
  const lp = filter(ctx, 'lowpass', 500 + tone * 2400 + velo * 500, 0.6);
  src.connect(lp).connect(v.output);
  v.source(src, time + src.buffer.duration);

  if (thump > 0.01) {
    // Finger hitting the fingerboard: a short low knock at the note plus a soft noise tap
    const knock = osc(ctx, 'sine', freq * 2);
    knock.frequency.setValueAtTime(freq * 2, time);
    knock.frequency.exponentialRampToValueAtTime(freq, time + 0.04);
    const knockAmp = gain(ctx, 0);
    percEnvelope(knockAmp.gain, time, thump * 0.35, 0.07, 0.002);
    knock.connect(knockAmp).connect(v.output);
    v.source(knock, time + 0.12);

    const noise = noiseSource(ctx, v, time, time + 0.06);
    const band = filter(ctx, 'lowpass', 700, 0.8);
    const tapAmp = gain(ctx, 0);
    percEnvelope(tapAmp.gain, time, thump * 0.25, 0.025, 0.001);
    noise.connect(band).connect(tapAmp).connect(v.output);
  }

  v.output.gain.value = velocityGain(velo) * 0.95;
  return v.finish();
};

/** String ensemble: three detuned saws spread across the stereo field, with delayed vibrato. */
export const strings: VoiceFn = (ctx, out, { time, note, velocity, duration }, p) => {
  const v = new VoiceBuilder(ctx, out, time);
  const velo = vel(velocity);
  const attack = num(p, 'attack', 0.35, 0.005, 4);
  const release = num(p, 'release', 1, 0.02, 6);
  const bright = num(p, 'bright', 0.45, 0, 1);
  const vibrato = num(p, 'vibrato', 0.3, 0, 1);
  const ensemble = num(p, 'ensemble', 0.5, 0, 1);
  const freq = midiToFreq(note);
  const end = gateEnvelope(
    v.output.gain,
    time,
    velocityGain(velo) * 0.096,
    attack,
    1,
    0.9,
    time + gate(duration),
    release,
  );

  // The bowed tone opens up (brightens) over the attack
  const cutoff = Math.min(16000, freq * (1.5 + bright * 5) + 500 + bright * 3500);
  const lp = filter(ctx, 'lowpass', cutoff, 0.7 + bright * 0.5);
  kRate(lp.frequency).setValueAtTime(cutoff * 0.45, time);
  lp.frequency.linearRampToValueAtTime(cutoff, time + attack + 0.1);
  const hp = filter(ctx, 'highpass', Math.max(80, freq * 0.6), 0.6);
  lp.connect(hp).connect(v.output);

  const vib = osc(ctx, 'sine', 5.1 + (note % 5) * 0.08);
  const vibDepth = gain(ctx, 0);
  vibratoDepth(vibDepth.gain, time, vibrato * 14, Math.min(0.35, attack * 0.8), 0.4);
  vib.connect(vibDepth);
  v.source(vib, end);

  // Each player gets its own tuning, vibrato depth/direction and seat in the stereo field
  const spread = 3 + ensemble * 13;
  const width = ensemble * 0.75;
  const players: [number, number, number][] = [
    [-spread, -width, 1 + ensemble * 0.4],
    [spread * 0.35, 0, -0.8],
    [spread, width, 0.6 - ensemble * 0.3],
  ];
  for (const [detune, pan, motion] of players) {
    const saw = osc(ctx, 'sawtooth', freq);
    kRate(saw.detune).value = detune;
    vibDepth.connect(gain(ctx, motion)).connect(saw.detune);
    saw.connect(panner(ctx, pan)).connect(lp);
    v.source(saw, end);
  }
  return retrigger(out, note, time, v.finish(), Math.max(0.03, attack));
};

/** Breathy flute: sine-rich tone, chiff and breath noise, pitch scoop and delayed vibrato. */
export const flute: VoiceFn = (ctx, out, { time, note, velocity, duration }, p) => {
  const v = new VoiceBuilder(ctx, out, time);
  const velo = vel(velocity);
  const attack = num(p, 'attack', 0.06, 0.005, 2);
  const breath = num(p, 'breath', 0.35, 0, 1);
  const vibrato = num(p, 'vibrato', 0.35, 0, 1);
  const bright = num(p, 'bright', 0.5, 0, 1);
  const release = num(p, 'release', 0.15, 0.02, 3);
  const freq = midiToFreq(note);
  const gateEnd = time + gate(duration);

  const amp = gain(ctx, 0);
  const end = gateEnvelope(amp.gain, time, 1, attack, 0.25, 0.82, gateEnd, release);
  amp.connect(v.output);

  const tone = filter(ctx, 'lowpass', Math.min(16000, freq * (2.5 + bright * 4) + bright * 2000), 0.5);
  tone.connect(amp);

  const vib = osc(ctx, 'sine', 5 + (note % 3) * 0.15);
  const vibCents = gain(ctx, 0);
  vibratoDepth(vibCents.gain, time, vibrato * 16, 0.22 + attack, 0.35);
  vib.connect(vibCents);
  // Breath pressure follows the vibrato a little
  const tremolo = gain(ctx, 1);
  const tremDepth = gain(ctx, 0);
  vibratoDepth(tremDepth.gain, time, vibrato * 0.06, 0.22 + attack, 0.35);
  vib.connect(tremDepth).connect(tremolo.gain);
  tremolo.connect(tone);
  v.source(vib, end);

  const partials: [OscillatorType, number, number][] = [
    ['sine', 1, 1],
    ['triangle', 1, 0.12 + bright * 0.3],
    ['sine', 2, 0.1 + bright * 0.22],
    ['sine', 3, bright * 0.08],
  ];
  for (const [type, ratio, level] of partials) {
    if (level <= 0.001) continue;
    const o = osc(ctx, type, freq * ratio);
    // Lipping up into the note
    kRate(o.detune).setValueAtTime(-30, time);
    o.detune.linearRampToValueAtTime(0, time + Math.min(0.12, attack + 0.04));
    vibCents.connect(o.detune);
    o.connect(gain(ctx, level)).connect(tremolo);
    v.source(o, end);
  }

  if (breath > 0.01) {
    const noise = noiseSource(ctx, v, time, end);
    const band = filter(ctx, 'bandpass', Math.min(12000, freq * 3), 0.9);
    const air = filter(ctx, 'highpass', 900, 0.5);
    const breathAmp = gain(ctx, 0);
    const g = breathAmp.gain;
    // Chiff on the onset, then a steady breath bed
    g.setValueAtTime(0, time);
    g.linearRampToValueAtTime(breath * (0.5 + velo * 0.4), time + Math.min(0.02, attack));
    g.setTargetAtTime(breath * 0.16, time + 0.03, 0.05);
    noise.connect(band).connect(air).connect(breathAmp).connect(amp);
  }

  v.output.gain.value = velocityGain(velo) * 0.36;
  return v.finish();
};

/** Vowel formants (Hz) and relative levels for "oo", "ah" and "ee". */
const VOWELS: { f: [number, number, number]; g: [number, number, number]; bw: [number, number, number] }[] = [
  { f: [350, 780, 2600], g: [1, 0.32, 0.06], bw: [70, 90, 140] },
  { f: [760, 1200, 2750], g: [1, 0.6, 0.16], bw: [90, 110, 150] },
  { f: [300, 2250, 3050], g: [1, 0.22, 0.18], bw: [70, 110, 160] },
];

function vowelAt(morph: number, index: number) {
  const x = Math.min(1, Math.max(0, morph)) * 2;
  const a = VOWELS[Math.min(1, Math.floor(x))];
  const b = VOWELS[Math.min(2, Math.floor(x) + 1)];
  const t = x >= 2 ? 1 : x - Math.floor(x);
  const lerp = (u: number, w: number) => u + (w - u) * t;
  return { f: lerp(a.f[index], b.f[index]), g: lerp(a.g[index], b.g[index]), bw: lerp(a.bw[index], b.bw[index]) };
}

/** Choir "oohs": two detuned voices through a three-formant vowel filter plus breath. */
export const vox: VoiceFn = (ctx, out, { time, note, velocity, duration }, p) => {
  const v = new VoiceBuilder(ctx, out, time);
  const velo = vel(velocity);
  const vowel = num(p, 'vowel', 0.2, 0, 1);
  const attack = num(p, 'attack', 0.25, 0.005, 4);
  const release = num(p, 'release', 0.8, 0.02, 6);
  const vibrato = num(p, 'vibrato', 0.3, 0, 1);
  const air = num(p, 'air', 0.3, 0, 1);
  const freq = midiToFreq(note);
  const end = gateEnvelope(
    v.output.gain,
    time,
    velocityGain(velo) * 0.28,
    attack,
    1,
    0.9,
    time + gate(duration),
    release,
  );

  // Higher voices have slightly higher formants
  const scale = note >= 67 ? 1.1 : note <= 52 ? 0.92 : 1;
  // Mono throughout: the formant bank is the expensive part, and the track's pan/chorus handle width.
  const bank = gain(ctx, 1);
  const smooth = filter(ctx, 'lowpass', 5200, 0.5);
  bank.connect(smooth).connect(v.output);

  const source = gain(ctx, 0.5);
  for (let i = 0; i < 3; i++) {
    const { f, g, bw } = vowelAt(vowel, i);
    const fc = Math.min(ctx.sampleRate * 0.45, f * scale);
    const formant = filter(ctx, 'bandpass', fc, fc / bw);
    // A bandpass has unity peak gain; narrow bands pass less of the buzz, so lift them
    source
      .connect(formant)
      .connect(gain(ctx, g * Math.sqrt(fc / bw) * 0.9))
      .connect(bank);
  }

  const vib = osc(ctx, 'sine', 5.3 + (note % 4) * 0.1);
  const vibDepth = gain(ctx, 0);
  vibratoDepth(vibDepth.gain, time, vibrato * 20, Math.min(0.4, attack), 0.45);
  vib.connect(vibDepth);
  v.source(vib, end);

  const singers: [number, number][] = [
    [-7, 1],
    [6, -0.85],
  ];
  for (const [detune, motion] of singers) {
    const o = osc(ctx, 'sawtooth', freq);
    kRate(o.detune).value = detune;
    vibDepth.connect(gain(ctx, motion)).connect(o.detune);
    o.connect(source);
    v.source(o, end);
  }

  if (air > 0.01) {
    // Breath through the same vowel filter reads as a whispered vowel
    const noise = noiseSource(ctx, v, time, end);
    noise.connect(gain(ctx, air * 0.5)).connect(source);
  }
  return retrigger(out, note, time, v.finish(), Math.max(0.03, attack));
};

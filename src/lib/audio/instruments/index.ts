import type { InstrumentId } from '@/lib/project/instruments';
import * as band from './band';
import * as drums from './drums';
import { riser } from './riser';
import { sampler } from './sampler';
import * as synths from './synths';
import type { VoiceFn } from './utils';
import { wurli } from './wurli';

export type { SampleVoiceData, Voice, VoiceFn, VoiceInput, VoiceParams } from './utils';

export const VOICES: Record<InstrumentId, VoiceFn> = {
  kick: drums.kick,
  kick2: drums.kick2,
  kick3: drums.kick3,
  '808': synths.bass808,
  snare: drums.snare,
  snare2: drums.snare2,
  clap: drums.clap,
  hat: drums.hat,
  hat2: drums.hat2,
  openhat: drums.openhat,
  openhat2: drums.openhat2,
  rim: drums.rim,
  shaker: drums.shaker,
  shaker2: drums.shaker2,
  tom: drums.tom,
  crash: drums.crash,
  keys: synths.keys,
  pad: synths.pad,
  pluck: synths.pluck,
  bell: synths.bell,
  lead: synths.lead,
  bass: synths.subBass,
  wurli,
  guitar: band.guitar,
  strings: band.strings,
  flute: band.flute,
  vox: band.vox,
  upright: band.upright,
  riser,
  sampler,
};

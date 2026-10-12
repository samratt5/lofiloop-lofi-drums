/**
 * Music-video export: renders an animated, audio-reactive scene frame by frame
 * and encodes it with WebCodecs through mediabunny (loaded on demand).
 * H.264 + AAC in MP4 when the browser can encode it, otherwise VP9/VP8 + Opus
 * in WebM. Faster than realtime, streamed frame by frame, abortable.
 */
import { canvasToBlob, context2d, createCanvas, type AnyCanvas, type Ctx2D } from '@/lib/visual/canvas';
import { drawCover } from '@/lib/visual/cover';
import { analyzeAudio, silentFeatures } from '@/lib/visual/features';
import type { Mood } from '@/lib/visual/palette';
import { clearSceneCache, drawScene, drawScenePreview, type SceneId } from '@/lib/visual/scenes';
import type { PcmAudio } from './wav';

export type VideoFormat = 'mp4' | 'webm';
type VideoCodecId = 'avc' | 'hevc' | 'vp9' | 'av1' | 'vp8';
type AudioCodecId = 'aac' | 'opus';

export interface VideoCodecs {
  video: VideoCodecId;
  audio: AudioCodecId;
}

export interface VideoSupport {
  /** An MP4 can be written (see `mp4Codecs`; H.264 + AAC is the widely compatible combination) */
  mp4: boolean;
  webm: boolean;
  mp4Codecs: VideoCodecs | null;
  webmCodecs: VideoCodecs | null;
  /** True when MP4 would be H.264 + AAC (plays everywhere, incl. QuickTime / iOS) */
  mp4Compatible: boolean;
}

export interface VideoExportOptions {
  audio: PcmAudio;
  scene: SceneId;
  width: number;
  height: number;
  /** Frames per second (default 30) */
  fps?: number;
  title: string;
  artist?: string;
  seed: number;
  mood?: Partial<Mood>;
  /** 'auto' picks MP4 only for H.264 + AAC, else WebM (default 'auto') */
  format?: 'auto' | VideoFormat;
  /** Bits per second; defaults to a resolution-based rate suited to slow lofi motion */
  videoBitrate?: number;
  /** Bits per second (default 192 kbps) */
  audioBitrate?: number;
  /** Custom cover art for the vinyl label / visualizer; generated from the seed otherwise */
  cover?: CanvasImageSource;
  onProgress?: (progress: number) => void;
  signal?: AbortSignal;
}

export interface VideoExportResult {
  blob: Blob;
  format: VideoFormat;
  mimeType: string;
  codecs: VideoCodecs;
  /** Seconds */
  duration: number;
  width: number;
  height: number;
}

type Mediabunny = typeof import('mediabunny');

const MP4_VIDEO: VideoCodecId[] = ['avc', 'vp9', 'av1'];
const MP4_AUDIO: AudioCodecId[] = ['aac', 'opus'];
const WEBM_VIDEO: VideoCodecId[] = ['vp9', 'vp8', 'av1'];
const WEBM_AUDIO: AudioCodecId[] = ['opus'];
/** Audio is fed to the encoder this far ahead of the video frames. */
const AUDIO_LEAD_SECONDS = 1;
const AUDIO_CHUNK_SECONDS = 1;

function abortError(): DOMException {
  return new DOMException('Export cancelled', 'AbortError');
}

function throwIfAborted(signal?: AbortSignal) {
  if (signal?.aborted) throw abortError();
}

/** H.264 / VP9 want even dimensions for 4:2:0 chroma. */
function even(n: number): number {
  return Math.max(16, Math.round(n / 2) * 2);
}

/** Default bitrate: ~0.07 bits per pixel per frame, clamped to 1.5..16 Mbps. */
export function defaultVideoBitrate(width: number, height: number, fps: number): number {
  return Math.round(Math.min(16e6, Math.max(1.5e6, width * height * fps * 0.07)));
}

function frameCount(audio: PcmAudio): number {
  return audio.channels.reduce((m, c) => Math.max(m, c.length), 0);
}

interface Probe {
  width: number;
  height: number;
  fps: number;
  videoBitrate: number;
  audioBitrate: number;
  channels: number;
  sampleRate: number;
}

interface AudioChoice {
  codec: AudioCodecId;
  /** Resample to this rate when the encoder rejects the source rate (Opus wants 48 kHz). */
  resampleTo?: number;
}

async function firstVideo(mb: Mediabunny, list: VideoCodecId[], p: Probe): Promise<VideoCodecId | null> {
  for (const codec of list) {
    try {
      const ok = await mb.canEncodeVideo(codec, {
        width: p.width,
        height: p.height,
        frameRate: p.fps,
        quality: new mb.Quality({ bitrate: p.videoBitrate }),
      });
      if (ok) return codec;
    } catch {
      // try the next codec
    }
  }
  return null;
}

async function firstAudio(mb: Mediabunny, list: AudioCodecId[], p: Probe): Promise<AudioChoice | null> {
  for (const codec of list) {
    for (const sampleRate of [p.sampleRate, 48000]) {
      try {
        const ok = await mb.canEncodeAudio(codec, {
          numberOfChannels: p.channels,
          sampleRate,
          quality: new mb.Quality({ bitrate: p.audioBitrate }),
        });
        if (ok) return sampleRate === p.sampleRate ? { codec } : { codec, resampleTo: sampleRate };
      } catch {
        // try the next option
      }
      if (sampleRate === 48000) break;
    }
  }
  return null;
}

async function probe(mb: Mediabunny, p: Probe) {
  const hasWebCodecs = typeof VideoEncoder !== 'undefined' && typeof AudioEncoder !== 'undefined';
  if (!hasWebCodecs) return { mp4: null, webm: null };
  const [mp4Video, mp4Audio, webmVideo, webmAudio] = await Promise.all([
    firstVideo(mb, MP4_VIDEO, p),
    firstAudio(mb, MP4_AUDIO, p),
    firstVideo(mb, WEBM_VIDEO, p),
    firstAudio(mb, WEBM_AUDIO, p),
  ]);
  return {
    mp4: mp4Video && mp4Audio ? { video: mp4Video, audio: mp4Audio } : null,
    webm: webmVideo && webmAudio ? { video: webmVideo, audio: webmAudio } : null,
  };
}

/** Which formats this browser can export at the given size (default 1920x1080, 30 fps, stereo 48 kHz). */
export async function videoSupport(
  size: { width?: number; height?: number; fps?: number } = {},
): Promise<VideoSupport> {
  const none: VideoSupport = { mp4: false, webm: false, mp4Codecs: null, webmCodecs: null, mp4Compatible: false };
  if (typeof window === 'undefined' && typeof self === 'undefined') return none;
  try {
    const mb = await import('mediabunny');
    const width = even(size.width ?? 1920);
    const height = even(size.height ?? 1080);
    const fps = size.fps ?? 30;
    const found = await probe(mb, {
      width,
      height,
      fps,
      videoBitrate: defaultVideoBitrate(width, height, fps),
      audioBitrate: 192000,
      channels: 2,
      sampleRate: 48000,
    });
    const mp4Codecs = found.mp4 ? { video: found.mp4.video, audio: found.mp4.audio.codec } : null;
    const webmCodecs = found.webm ? { video: found.webm.video, audio: found.webm.audio.codec } : null;
    return {
      mp4: !!mp4Codecs,
      webm: !!webmCodecs,
      mp4Codecs,
      webmCodecs,
      mp4Compatible: mp4Codecs?.video === 'avc' && mp4Codecs.audio === 'aac',
    };
  } catch {
    return none;
  }
}

function renderCoverCanvas(size: number, options: VideoExportOptions): AnyCanvas | null {
  const canvas = createCanvas(size, size);
  const ctx = canvas && context2d(canvas);
  if (!canvas || !ctx) return null;
  drawCover(ctx, { size, seed: options.seed, title: options.title, artist: options.artist, mood: options.mood });
  return canvas;
}

/** Renders `scene` over `audio` into a video file. Rejects with an AbortError DOMException when cancelled. */
export async function exportVideo(options: VideoExportOptions): Promise<VideoExportResult> {
  const { audio, signal, onProgress } = options;
  throwIfAborted(signal);
  const fps = Math.min(60, Math.max(1, Math.round(options.fps ?? 30)));
  const width = even(options.width);
  const height = even(options.height);
  const sampleRate = Math.round(audio.sampleRate);
  const channels = audio.channels.filter((c) => c && c.length).slice(0, 2);
  const samples = frameCount(audio);
  if (!channels.length || samples === 0 || !(sampleRate > 0)) throw new RangeError('exportVideo: audio is empty');
  const duration = samples / sampleRate;
  const videoBitrate = Math.round(options.videoBitrate ?? defaultVideoBitrate(width, height, fps));
  const audioBitrate = Math.round(options.audioBitrate ?? 192000);

  const mb = await import('mediabunny');
  throwIfAborted(signal);
  const found = await probe(mb, {
    width,
    height,
    fps,
    videoBitrate,
    audioBitrate,
    channels: channels.length,
    sampleRate,
  });
  const wanted = options.format ?? 'auto';
  let format: VideoFormat;
  if (wanted === 'mp4') format = 'mp4';
  else if (wanted === 'webm') format = 'webm';
  else format = found.mp4?.video === 'avc' && found.mp4.audio.codec === 'aac' ? 'mp4' : found.webm ? 'webm' : 'mp4';
  const choice = format === 'mp4' ? found.mp4 : found.webm;
  if (!choice) {
    throw new Error(
      typeof VideoEncoder === 'undefined'
        ? 'Video export needs WebCodecs, which this browser does not support.'
        : `This browser cannot encode ${format.toUpperCase()} video at ${width}x${height}.`,
    );
  }

  const canvas = createCanvas(width, height);
  const ctx: Ctx2D | null = canvas && context2d(canvas, { alpha: false });
  if (!canvas || !ctx) throw new Error('exportVideo: no canvas implementation available');

  onProgress?.(0);
  // Analysis is synchronous (~0.3 s for 5 minutes); let the UI paint first.
  await new Promise((r) => setTimeout(r, 0));
  const features = analyzeAudio({ sampleRate, channels }, fps);
  throwIfAborted(signal);
  const cover = options.cover ?? renderCoverCanvas(Math.min(1024, Math.round(Math.min(width, height) * 0.6)), options);

  const approxBytes = ((videoBitrate + audioBitrate) * duration) / 8;
  const output = new mb.Output({
    format:
      format === 'mp4'
        ? new mb.Mp4OutputFormat({ fastStart: approxBytes < 256e6 ? 'in-memory' : false })
        : new mb.WebMOutputFormat(),
    target: new mb.BufferTarget(),
  });
  const videoSource = new mb.CanvasSource(canvas, {
    codec: choice.video,
    quality: new mb.Quality({ bitrate: videoBitrate }),
    keyFrameInterval: 2,
    latencyMode: 'quality',
  });
  const audioSource = new mb.AudioSampleSource({
    codec: choice.audio.codec,
    quality: new mb.Quality({ bitrate: audioBitrate }),
    ...(choice.audio.resampleTo ? { transform: { sampleRate: choice.audio.resampleTo } } : {}),
  });
  output.addVideoTrack(videoSource, { frameRate: fps });
  output.addAudioTrack(audioSource);
  output.setMetadataTags({ title: options.title || undefined, artist: options.artist || undefined });

  let audioPos = 0;
  const chunk = Math.round(sampleRate * AUDIO_CHUNK_SECONDS);
  const addAudioUntil = async (seconds: number) => {
    const until = Math.min(samples, Math.ceil(seconds * sampleRate));
    while (audioPos < until) {
      const n = Math.min(chunk, samples - audioPos);
      const planar = new Float32Array(n * channels.length);
      channels.forEach((ch, c) => {
        const part = ch.subarray(audioPos, Math.min(ch.length, audioPos + n));
        planar.set(part, c * n);
      });
      for (let i = 0; i < planar.length; i++) if (planar[i] !== planar[i]) planar[i] = 0; // NaN guard
      const sample = new mb.AudioSample({
        data: planar,
        format: 'f32-planar',
        numberOfChannels: channels.length,
        sampleRate,
        timestamp: audioPos / sampleRate,
      });
      try {
        await audioSource.add(sample);
      } finally {
        sample.close();
      }
      audioPos += n;
    }
  };

  const onAbort = () => void output.cancel().catch(() => {});
  signal?.addEventListener('abort', onAbort, { once: true });
  try {
    await output.start();
    const total = Math.max(1, Math.ceil(duration * fps - 1e-9));
    const silent = silentFeatures();
    let lastReport = 0;
    for (let i = 0; i < total; i++) {
      throwIfAborted(signal);
      const t = i / fps;
      await addAudioUntil(t + AUDIO_LEAD_SECONDS);
      drawScene(ctx, options.scene, {
        t,
        width,
        height,
        seed: options.seed,
        features: features[i] ?? silent,
        title: options.title,
        artist: options.artist,
        progress: Math.min(1, t / duration),
        cover: cover ?? undefined,
        mood: options.mood,
      });
      // The last frame ends exactly where the audio does.
      await videoSource.add(t, Math.max(1e-3, Math.min(1 / fps, duration - t)));
      const now = performance.now();
      if (onProgress && now - lastReport > 100) {
        lastReport = now;
        onProgress(0.02 + 0.96 * ((i + 1) / total));
      }
    }
    await addAudioUntil(duration);
    throwIfAborted(signal);
    videoSource.close();
    audioSource.close();
    await output.finalize();
    throwIfAborted(signal);
    const buffer = output.target.buffer;
    if (!buffer) throw new Error('exportVideo: encoder produced no data');
    const mimeType = await output.getMimeType().catch(() => output.format.mimeType);
    onProgress?.(1);
    return {
      blob: new Blob([buffer], { type: mimeType }),
      format,
      mimeType,
      codecs: { video: choice.video, audio: choice.audio.codec },
      duration,
      width,
      height,
    };
  } catch (error) {
    if (output.state !== 'canceled' && output.state !== 'finalized') await output.cancel().catch(() => {});
    if (signal?.aborted) throw abortError();
    throw error;
  } finally {
    signal?.removeEventListener('abort', onAbort);
    clearSceneCache();
  }
}

/** Single still frame of a scene as a PNG (thumbnails / previews), with neutral audio features. */
export async function renderSceneStill(
  options: Pick<VideoExportOptions, 'scene' | 'width' | 'height' | 'title' | 'artist' | 'seed' | 'mood' | 'cover'> & {
    t?: number;
  },
): Promise<Blob> {
  const canvas = createCanvas(options.width, options.height);
  const ctx = canvas && context2d(canvas);
  if (!canvas || !ctx) throw new Error('renderSceneStill: no canvas implementation available');
  drawScenePreview(ctx, options.scene, {
    width: options.width,
    height: options.height,
    seed: options.seed,
    title: options.title,
    artist: options.artist,
    mood: options.mood,
    cover: options.cover,
    t: options.t,
  });
  return canvasToBlob(canvas);
}

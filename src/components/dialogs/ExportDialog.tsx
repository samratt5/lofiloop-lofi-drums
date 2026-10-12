'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import {
  AudioWaveform,
  Clapperboard,
  Download,
  FileArchive,
  FileMusic,
  Image as ImageIcon,
  Music2,
} from 'lucide-react';
import { renderLength, renderMix, renderStems, type RenderMode } from '@/lib/audio/render';
import { audioBufferToPcm, encodeWav, encodeWavBytes, normalize, type WavBitDepth } from '@/lib/export/wav';
import { downloadBlob } from '@/lib/export/download';
import { useStudio } from '@/lib/store/studio';
import { ui, useUi } from '@/lib/store/ui';
import { Button } from '@/components/ui/Button';
import { Dialog } from '@/components/ui/Dialog';
import { Segmented } from '@/components/ui/Segmented';
import { Switch } from '@/components/ui/Switch';
import { formatBytes, formatDuration, slugify } from '@/lib/utils/format';
import { cn } from '@/lib/utils/cn';
import type { VideoSupport } from '@/lib/export/video';
import { VIDEO_SIZES, VideoSettings, type VideoChoice } from './VideoSettings';

type Format = 'wav' | 'mp3' | 'video' | 'stems' | 'midi' | 'cover';
type Level = 'mix' | 'peak' | 'stream' | 'loud';

const LEVELS: { value: Level; label: string; title: string; lufs?: number }[] = [
  { value: 'mix', label: 'As mixed', title: 'Exactly what you hear in the studio' },
  { value: 'peak', label: 'Peak', title: 'Raise the highest peak to −0.3 dB' },
  { value: 'stream', label: '−14 LUFS', title: 'Mastered for Spotify, YouTube and Apple Music', lufs: -14 },
  { value: 'loud', label: '−10 LUFS', title: 'Louder master for clubs and beat stores', lufs: -10 },
];

const FORMATS: { id: Format; label: string; detail: string; icon: typeof Music2 }[] = [
  { id: 'wav', label: 'WAV', detail: 'Lossless master', icon: AudioWaveform },
  { id: 'mp3', label: 'MP3', detail: 'Small, easy to share', icon: Music2 },
  { id: 'video', label: 'Video', detail: 'Animated scene for YouTube or Reels', icon: Clapperboard },
  { id: 'stems', label: 'Stems', detail: 'One WAV per track (.zip)', icon: FileArchive },
  { id: 'midi', label: 'MIDI', detail: 'Notes for your DAW', icon: FileMusic },
  { id: 'cover', label: 'Cover art', detail: '3000 px square PNG', icon: ImageIcon },
];

export function ExportDialog() {
  const open = useUi((s) => s.dialog === 'export');
  const project = useStudio((s) => s.project);
  const [format, setFormat] = useState<Format>('wav');
  const [mode, setMode] = useState<RenderMode>(project.playMode);
  const [repeats, setRepeats] = useState(2);
  const [bitDepth, setBitDepth] = useState<WavBitDepth>(24);
  const [kbps, setKbps] = useState<192 | 320>(320);
  const [sampleRate, setSampleRate] = useState<44100 | 48000>(44100);
  const [tail, setTail] = useState(true);
  const [level, setLevel] = useState<Level>('stream');
  const [video, setVideo] = useState<VideoChoice>({ scene: 'window', size: 'landscape', format: 'auto' });
  const [support, setSupport] = useState<VideoSupport | null>(null);

  // Probing encoders loads the video library, so only do it once someone picks Video.
  useEffect(() => {
    if (format !== 'video' || support) return;
    let alive = true;
    void import('@/lib/export/video')
      .then(({ videoSupport }) => videoSupport())
      .then((result) => alive && setSupport(result))
      .catch(
        () => alive && setSupport({ mp4: false, webm: false, mp4Codecs: null, webmCodecs: null, mp4Compatible: false }),
      );
    return () => {
      alive = false;
    };
  }, [format, support]);
  const [progress, setProgress] = useState<number | null>(null);
  const [stage, setStage] = useState('');
  const abort = useRef<AbortController | null>(null);

  const busy = progress !== null;

  // Start from what's playing each time the dialog opens: a whole song plays once, a loop twice.
  useEffect(() => {
    if (!open) return;
    const { playMode } = useStudio.getState().project;
    setMode(playMode);
    setRepeats(playMode === 'song' ? 1 : 2);
  }, [open]);

  const seconds = useMemo(() => renderLength(project, mode, repeats, tail), [project, mode, repeats, tail]);
  const anySolo = project.tracks.some((t) => t.solo);
  const stemCount = project.tracks.filter((t) => !t.mute && (!anySolo || t.solo)).length;
  const estimate =
    format === 'wav'
      ? seconds * sampleRate * 2 * (bitDepth / 8)
      : format === 'mp3'
        ? (seconds * kbps * 1000) / 8
        : format === 'stems'
          ? seconds * sampleRate * 2 * (bitDepth / 8) * stemCount
          : format === 'cover'
            ? 6_000_000
            : format === 'video'
              ? (seconds * (VIDEO_SIZES[video.size].width * VIDEO_SIZES[video.size].height * 30 * 0.07 + 192_000)) / 8
              : 0;
  const base = `${slugify(project.name)}-${project.bpm}bpm`;

  const run = async () => {
    const controller = new AbortController();
    abort.current = controller;
    setProgress(0);
    let report = '';
    try {
      if (format === 'cover') {
        setStage('Painting the cover');
        const { renderCover } = await import('@/lib/visual/cover');
        const blob = await renderCover({
          size: 3000,
          seed: project.meta.coverSeed,
          title: project.name,
          artist: project.meta.artist,
          styles: project.meta.styles,
        });
        downloadBlob(blob, `${slugify(project.name)}-cover.png`);
      } else if (format === 'midi') {
        const { exportMidi, midiBlob } = await import('@/lib/export/midi');
        downloadBlob(midiBlob(exportMidi(project, { mode, repeats })), `${base}.mid`);
      } else if (format === 'stems') {
        setStage('Rendering stems');
        const { createZip } = await import('@/lib/export/zip');
        const stems = await renderStems(project, {
          mode,
          repeats,
          sampleRate,
          tail,
          signal: controller.signal,
          onProgress: (p) => setProgress(p * 0.95),
        });
        setStage('Packing zip');
        const files = stems.map((stem, i) => ({
          name: `${base}/${String(i + 1).padStart(2, '0')}-${slugify(stem.track.name)}.wav`,
          data: encodeWavBytes(audioBufferToPcm(stem.buffer), bitDepth),
        }));
        downloadBlob(new Blob([createZip(files)], { type: 'application/zip' }), `${base}-stems.zip`);
      } else {
        setStage('Rendering audio');
        const buffer = await renderMix(project, {
          mode,
          repeats,
          sampleRate: format === 'video' ? 48000 : sampleRate,
          tail,
          signal: controller.signal,
          onProgress: (p) => setProgress(p * (format === 'mp3' ? 0.5 : format === 'video' ? 0.25 : 0.95)),
        });
        let pcm = audioBufferToPcm(buffer);
        // Video renders the audio first, then spends most of its time drawing frames.
        const target = LEVELS.find((l) => l.value === level)?.lufs;
        if (level === 'peak') pcm = normalize(pcm);
        else if (target !== undefined) {
          setStage('Mastering');
          const { masterAsync } = await import('@/lib/export/masterAsync');
          const result = await masterAsync(pcm, { targetLufs: target, ceilingDbtp: -1 });
          pcm = result.audio;
          report = `Mastered to ${result.after.lufs.toFixed(1)} LUFS, peaks at ${result.after.truePeak.toFixed(1)} dBTP`;
        }
        if (format === 'wav') {
          downloadBlob(encodeWav(pcm, bitDepth), `${base}.wav`);
        } else if (format === 'video') {
          setStage('Filming the video');
          const [{ exportVideo }, { moodFromProject }] = await Promise.all([
            import('@/lib/export/video'),
            import('@/lib/visual/palette'),
          ]);
          const { width, height } = VIDEO_SIZES[video.size];
          const result = await exportVideo({
            audio: pcm,
            scene: video.scene,
            width,
            height,
            title: project.name,
            artist: project.meta.artist,
            seed: project.meta.coverSeed,
            mood: moodFromProject(project),
            format: video.format,
            signal: controller.signal,
            onProgress: (p) => setProgress(0.25 + p * 0.75),
          });
          downloadBlob(result.blob, `${base}.${result.format}`);
        } else {
          setStage('Encoding MP3');
          const { encodeMp3 } = await import('@/lib/export/mp3');
          const blob = await encodeMp3(pcm, {
            kbps,
            signal: controller.signal,
            onProgress: (p) => setProgress(0.5 + p * 0.5),
          });
          downloadBlob(blob, `${base}.mp3`);
        }
      }
      ui.toast(report ? `Export ready. ${report}.` : 'Export ready. Check your downloads.', 'success');
      ui.closeDialog();
    } catch (error) {
      if ((error as Error).name === 'AbortError') ui.toast('Export cancelled');
      else {
        console.error(error);
        ui.toast('Export failed. Try a shorter range or another format.', 'error');
      }
    } finally {
      abort.current = null;
      setProgress(null);
      setStage('');
    }
  };

  return (
    <Dialog
      open={open}
      onClose={ui.closeDialog}
      title="Export"
      description={`${project.name} · ${project.bpm} BPM`}
      locked={busy}
      footer={
        busy ? (
          <Button variant="ghost" onClick={() => abort.current?.abort()}>
            Cancel
          </Button>
        ) : (
          <>
            <Button variant="ghost" onClick={ui.closeDialog}>
              Close
            </Button>
            <Button variant="primary" icon={<Download />} onClick={run}>
              Export {FORMATS.find((f) => f.id === format)?.label}
            </Button>
          </>
        )
      }
    >
      <fieldset disabled={busy} className="flex flex-col gap-5">
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
          {FORMATS.map((f) => (
            <button
              key={f.id}
              type="button"
              aria-pressed={format === f.id}
              onClick={() => setFormat(f.id)}
              className={cn(
                'flex flex-col items-start gap-1 rounded-xl border p-3 text-left transition-colors',
                format === f.id ? 'border-accent bg-accent-soft' : 'border-line bg-surface-2 hover:border-line-strong',
              )}
            >
              <f.icon className={cn('size-5', format === f.id ? 'text-accent' : 'text-fg-muted')} />
              <span className="text-sm font-semibold">{f.label}</span>
              <span className="text-fg-muted text-[11px] leading-tight">{f.detail}</span>
            </button>
          ))}
        </div>

        <div className={cn('grid gap-4 sm:grid-cols-2', format === 'cover' && 'hidden')}>
          <div className="flex flex-col gap-1.5">
            <span className="text-fg-muted text-xs font-medium">Range</span>
            <Segmented
              label="Range"
              value={mode}
              onChange={setMode}
              options={[
                { value: 'pattern', label: 'Current pattern' },
                { value: 'song', label: `Song (${project.arrangement.length})` },
              ]}
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <span className="text-fg-muted text-xs font-medium">Repeat</span>
            <Segmented
              label="Repeat"
              value={String(repeats)}
              onChange={(v) => setRepeats(Number(v))}
              options={['1', '2', '4', '8'].map((v) => ({ value: v, label: `${v}×` }))}
            />
          </div>
          {format !== 'midi' && format !== 'cover' && format !== 'video' && (
            <>
              <div className="flex flex-col gap-1.5">
                <span className="text-fg-muted text-xs font-medium">{format === 'mp3' ? 'Bitrate' : 'Bit depth'}</span>
                {format === 'mp3' ? (
                  <Segmented
                    label="Bitrate"
                    value={String(kbps)}
                    onChange={(v) => setKbps(Number(v) as 192 | 320)}
                    options={[
                      { value: '192', label: '192 kbps' },
                      { value: '320', label: '320 kbps' },
                    ]}
                  />
                ) : (
                  <Segmented
                    label="Bit depth"
                    value={String(bitDepth)}
                    onChange={(v) => setBitDepth(Number(v) as WavBitDepth)}
                    options={[
                      { value: '16', label: '16-bit' },
                      { value: '24', label: '24-bit' },
                      { value: '32', label: '32-bit float' },
                    ]}
                  />
                )}
              </div>
              <div className="flex flex-col gap-1.5">
                <span className="text-fg-muted text-xs font-medium">Sample rate</span>
                <Segmented
                  label="Sample rate"
                  value={String(sampleRate)}
                  onChange={(v) => setSampleRate(Number(v) as 44100 | 48000)}
                  options={[
                    { value: '44100', label: '44.1 kHz' },
                    { value: '48000', label: '48 kHz' },
                  ]}
                />
              </div>
            </>
          )}
        </div>

        {format === 'video' && <VideoSettings project={project} value={video} onChange={setVideo} support={support} />}

        {(format === 'wav' || format === 'mp3' || format === 'video') && (
          <div className="flex flex-col gap-1.5">
            <span className="text-fg-muted text-xs font-medium">Loudness</span>
            <Segmented
              label="Loudness"
              value={level}
              onChange={setLevel}
              options={LEVELS.map(({ value, label, title }) => ({ value, label, title }))}
              className="w-full [&>button]:flex-1"
            />
            <p className="text-fg-subtle text-[11px]">
              {LEVELS.find((l) => l.value === level)?.title}. Peaks stay under −1 dBTP.
            </p>
          </div>
        )}

        {format === 'cover' && (
          <p className="text-fg-muted text-sm">
            The cover is generated from your beat’s name and style. Change it any time under Share → Cover.
          </p>
        )}

        {format !== 'midi' && format !== 'cover' && (
          <div className="border-line rounded-xl border px-3 py-1">
            <Switch
              checked={tail}
              onChange={setTail}
              label="Let effects ring out"
              description="Adds 3 seconds so reverb and echo tails aren't cut off"
            />
          </div>
        )}

        <dl className="bg-surface-2 grid grid-cols-3 gap-2 rounded-xl p-3 text-center">
          <div>
            <dt className="text-fg-subtle text-[10px] font-semibold tracking-widest uppercase">Length</dt>
            <dd className="font-mono text-sm font-semibold">{formatDuration(seconds)}</dd>
          </div>
          <div>
            <dt className="text-fg-subtle text-[10px] font-semibold tracking-widest uppercase">Size</dt>
            <dd className="font-mono text-sm font-semibold">
              {format === 'midi' ? '< 50 KB' : `~${formatBytes(estimate)}`}
            </dd>
          </div>
          <div>
            <dt className="text-fg-subtle text-[10px] font-semibold tracking-widest uppercase">Tracks</dt>
            <dd className="font-mono text-sm font-semibold">
              {format === 'stems' ? `${stemCount} files` : project.tracks.length}
            </dd>
          </div>
        </dl>
      </fieldset>

      {busy && (
        <div className="mt-5" role="status" aria-live="polite">
          <div className="text-fg-muted mb-1.5 flex justify-between text-xs">
            <span>{stage || 'Preparing'}…</span>
            <span className="font-mono">{Math.round((progress ?? 0) * 100)}%</span>
          </div>
          <div className="bg-surface-3 h-1.5 overflow-hidden rounded-full">
            <div
              className="bg-accent h-full rounded-full transition-[width] duration-200"
              style={{ width: `${Math.max(3, (progress ?? 0) * 100)}%` }}
            />
          </div>
        </div>
      )}
    </Dialog>
  );
}

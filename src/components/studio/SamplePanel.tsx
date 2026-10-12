'use client';

import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { FileAudio, Grid3x3, Mic, Scissors, Square, Trash2, Upload, Wand2 } from 'lucide-react';
import { detectOnsets, equalSlices, monoData, waveformPeaks } from '@/lib/audio/chop';
import { CHOP_BASE_NOTE } from '@/lib/audio/instruments/sampler';
import { decodeAudio, sampleBank } from '@/lib/audio/samples';
import { engine } from '@/lib/audio/engine';
import { noteName } from '@/lib/music/theory';
import { createStep } from '@/lib/project/factory';
import { MAX_STEPS, type SampleRef, type Track } from '@/lib/project/types';
import { MAX_SAMPLE_BYTES, saveSample, StorageError } from '@/lib/storage/library';
import { actions, selectActivePattern, useStudio } from '@/lib/store/studio';
import { ui } from '@/lib/store/ui';
import { Button, IconButton } from '@/components/ui/Button';
import { DragNumber } from '@/components/ui/DragNumber';
import { Segmented } from '@/components/ui/Segmented';
import { cn } from '@/lib/utils/cn';

const MAX_RECORD_SECONDS = 30;

function useSampleBuffer(id: string | undefined) {
  const version = useSyncExternalStore(
    sampleBank.subscribe,
    () => sampleBank.version,
    () => 0,
  );
  // eslint-disable-next-line react-hooks/exhaustive-deps -- re-read when the bank changes
  return useMemo(() => (id ? sampleBank.get(id) : undefined), [id, version]);
}

async function importAudio(track: Track, data: ArrayBuffer, name: string, type: string) {
  if (data.byteLength > MAX_SAMPLE_BYTES) {
    ui.toast('That file is too large (50 MB max).', 'error');
    return;
  }
  let buffer: AudioBuffer;
  try {
    buffer = await decodeAudio(data);
  } catch {
    ui.toast('That file isn’t audio this browser can read. Try WAV, MP3, OGG or FLAC.', 'error');
    return;
  }
  try {
    const meta = await saveSample({ name, type, data, duration: buffer.duration });
    sampleBank.set(meta.id, buffer);
    const ref: SampleRef = {
      id: meta.id,
      name: name.replace(/\.[a-z0-9]+$/i, '').slice(0, 60) || 'Sample',
      root: 60,
      // Long material (loops, phrases) is usually chopped; short hits are played pitched.
      mode: buffer.duration > 1.5 ? 'chop' : 'pitched',
      slices: [0],
      start: 0,
      end: 1,
    };
    if (ref.mode === 'chop') {
      ref.slices = detectOnsets(monoData(channels(buffer)), buffer.sampleRate);
      if (ref.slices.length < 2) ref.slices = equalSlices(8);
    }
    actions.setSample(track.id, ref);
    ui.toast(`Loaded “${ref.name}”`, 'success');
  } catch (error) {
    ui.toast(error instanceof StorageError ? error.message : 'Could not store that sample.', 'error');
  }
}

function channels(buffer: AudioBuffer): Float32Array[] {
  return Array.from({ length: buffer.numberOfChannels }, (_, i) => buffer.getChannelData(i));
}

/** Records up to 30 s from the microphone. */
function useMicRecorder(onDone: (data: ArrayBuffer, type: string) => void) {
  const [state, setState] = useState<'idle' | 'recording'>('idle');
  const recorder = useRef<MediaRecorder | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (recorder.current?.state === 'recording') recorder.current.stop();
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );

  const start = async () => {
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') {
      ui.toast('This browser can’t record audio.', 'error');
      return;
    }
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
      });
    } catch {
      ui.toast('Microphone access was blocked. Allow it in the address bar to record.', 'error');
      return;
    }
    const chunks: Blob[] = [];
    const rec = new MediaRecorder(stream);
    rec.ondataavailable = (e) => e.data.size && chunks.push(e.data);
    rec.onstop = async () => {
      stream.getTracks().forEach((t) => t.stop());
      setState('idle');
      if (timer.current) clearTimeout(timer.current);
      const blob = new Blob(chunks, { type: rec.mimeType || 'audio/webm' });
      if (blob.size) onDone(await blob.arrayBuffer(), blob.type);
    };
    rec.start();
    recorder.current = rec;
    setState('recording');
    timer.current = setTimeout(() => rec.state === 'recording' && rec.stop(), MAX_RECORD_SECONDS * 1000);
  };

  const stop = () => {
    if (recorder.current?.state === 'recording') recorder.current.stop();
  };

  return { state, start, stop };
}

type Drag = { kind: 'start' | 'end' } | { kind: 'slice'; index: number };

function Waveform({ track, sample, buffer }: { track: Track; sample: SampleRef; buffer: AudioBuffer }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const boxRef = useRef<HTMLDivElement>(null);
  const [drag, setDrag] = useState<Drag | null>(null);
  const [preview, setPreview] = useState<{ start: number; end: number; slices: number[] } | null>(null);
  const shown = preview ?? { start: sample.start, end: sample.end, slices: sample.slices };
  const peaks = useMemo(() => waveformPeaks(monoData(channels(buffer)), 600), [buffer]);

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;
    const dpr = window.devicePixelRatio || 1;
    const { width, height } = canvas.getBoundingClientRect();
    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(height * dpr);
    ctx.scale(dpr, dpr);
    const styles = getComputedStyle(canvas);
    const accent = styles.getPropertyValue('--accent').trim() || '#ffb86b';
    const muted = styles.getPropertyValue('--fg-subtle').trim() || '#777';
    const mid = height / 2;
    const n = peaks.max.length;
    for (let i = 0; i < n; i++) {
      const x = (i / n) * width;
      const inside = i / n >= shown.start && i / n <= shown.end;
      ctx.fillStyle = inside ? accent : muted;
      ctx.globalAlpha = inside ? 0.9 : 0.35;
      const top = mid - peaks.max[i] * mid * 0.95;
      const bottom = mid - peaks.min[i] * mid * 0.95;
      ctx.fillRect(x, top, Math.max(1, width / n - 0.5), Math.max(1, bottom - top));
    }
    ctx.globalAlpha = 1;
  }, [peaks, shown.start, shown.end]);

  const toFraction = (clientX: number) => {
    const r = boxRef.current!.getBoundingClientRect();
    return Math.min(1, Math.max(0, (clientX - r.left) / r.width));
  };
  // Slices are stored relative to the trim region.
  const sliceX = (s: number) => shown.start + s * (shown.end - shown.start);
  const toSlice = (x: number) => (x - shown.start) / Math.max(0.001, shown.end - shown.start);

  const onMove = (e: React.PointerEvent) => {
    if (!drag) return;
    const x = toFraction(e.clientX);
    if (drag.kind === 'start') setPreview({ ...shown, start: Math.min(x, shown.end - 0.01) });
    else if (drag.kind === 'end') setPreview({ ...shown, end: Math.max(x, shown.start + 0.01) });
    else if (drag.kind === 'slice') {
      const slices = [...shown.slices];
      slices[drag.index] = Math.min(0.999, Math.max(0.001, toSlice(x)));
      setPreview({ ...shown, slices });
    }
  };
  const onUp = () => {
    if (drag && preview) {
      if (drag.kind === 'slice') actions.updateSample(track.id, { slices: preview.slices });
      else actions.updateSample(track.id, { start: preview.start, end: preview.end });
    }
    setDrag(null);
    setPreview(null);
  };

  const chop = sample.mode === 'chop';
  return (
    <div
      ref={boxRef}
      className="border-line bg-surface-2 relative h-28 touch-none overflow-hidden rounded-lg border select-none"
      onPointerMove={onMove}
      onPointerUp={onUp}
      onPointerCancel={onUp}
      onDoubleClick={(e) => {
        if (!chop) return;
        const s = toSlice(toFraction(e.clientX));
        if (s <= 0 || s >= 1) return;
        actions.updateSample(track.id, { slices: [...sample.slices, s] });
      }}
      title={chop ? 'Double-click to add a slice. Drag markers to move them; right-click one to remove it.' : undefined}
    >
      <canvas ref={canvasRef} className="absolute inset-0 size-full" aria-hidden />
      {chop &&
        shown.slices.map((s, i) => (
          <div
            key={i}
            className="absolute inset-y-0 w-3 -translate-x-1/2 cursor-ew-resize"
            style={{ left: `${sliceX(s) * 100}%` }}
            onPointerDown={(e) => {
              e.stopPropagation();
              if (i === 0) return;
              e.currentTarget.setPointerCapture(e.pointerId);
              setDrag({ kind: 'slice', index: i });
            }}
            onContextMenu={(e) => {
              e.preventDefault();
              if (i > 0) actions.updateSample(track.id, { slices: sample.slices.filter((_, k) => k !== i) });
            }}
          >
            <span className="bg-fg/70 absolute inset-y-0 left-1/2 w-px" />
            <button
              type="button"
              className="bg-fg text-bg absolute top-1 left-1/2 min-w-4 -translate-x-1/2 rounded px-1 font-mono text-[9px] font-bold"
              onPointerDown={(e) => e.stopPropagation()}
              onClick={() => void engine.preview(track, CHOP_BASE_NOTE + i)}
              aria-label={`Play slice ${i + 1} (${noteName(CHOP_BASE_NOTE + i)})`}
            >
              {i + 1}
            </button>
          </div>
        ))}
      {(['start', 'end'] as const).map((kind) => (
        <div
          key={kind}
          role="slider"
          tabIndex={0}
          aria-label={kind === 'start' ? 'Trim start' : 'Trim end'}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={Math.round(shown[kind] * 100)}
          onKeyDown={(e) => {
            const delta = e.key === 'ArrowLeft' ? -0.005 : e.key === 'ArrowRight' ? 0.005 : 0;
            if (!delta) return;
            e.preventDefault();
            e.stopPropagation();
            actions.updateSample(track.id, { [kind]: sample[kind] + delta * (e.shiftKey ? 10 : 1) });
          }}
          onPointerDown={(e) => {
            e.stopPropagation();
            e.currentTarget.setPointerCapture(e.pointerId);
            setDrag({ kind });
          }}
          className="group absolute inset-y-0 w-4 -translate-x-1/2 cursor-ew-resize focus-visible:outline-none"
          style={{ left: `${shown[kind] * 100}%` }}
        >
          <span className="bg-accent group-focus-visible:ring-accent absolute inset-y-0 left-1/2 w-0.5 -translate-x-1/2 group-focus-visible:ring-2" />
          <span
            className={cn(
              'bg-accent absolute bottom-0 h-3 w-2',
              kind === 'start' ? 'left-1/2 rounded-tr' : 'right-1/2 rounded-tl',
            )}
          />
        </div>
      ))}
    </div>
  );
}

/** Upload, record, trim and chop the sample a sampler track plays. */
export function SamplePanel({ track }: { track: Track }) {
  const sample = track.sample;
  const buffer = useSampleBuffer(sample?.id);
  const pattern = useStudio(selectActivePattern);
  const fileRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const mic = useMicRecorder((data, type) => void importAudio(track, data, 'Recording', type));

  const onFiles = async (files: FileList | null) => {
    const file = files?.[0];
    if (file) await importAudio(track, await file.arrayBuffer(), file.name, file.type || 'audio/*');
  };

  const autoChop = () => {
    if (!sample || !buffer) return;
    const slices = detectOnsets(monoData(channels(buffer)), buffer.sampleRate, {
      start: sample.start,
      end: sample.end,
    });
    actions.updateSample(track.id, { slices: slices.length > 1 ? slices : equalSlices(8) });
  };

  /** Lays the slices out across the pattern in their original order, rebuilding the loop. */
  const sliceToPattern = () => {
    if (!sample) return;
    const steps = Array.from({ length: MAX_STEPS }, () => createStep(CHOP_BASE_NOTE));
    sample.slices.forEach((s, i) => {
      const at = Math.min(pattern.length - 1, Math.round(s * pattern.length));
      const next = i + 1 < sample.slices.length ? sample.slices[i + 1] : 1;
      steps[at] = createStep(CHOP_BASE_NOTE + i, {
        on: true,
        len: Math.max(1, Math.min(16, Math.round((next - s) * pattern.length))),
      });
    });
    actions.setManySteps({ [track.id]: steps });
    ui.toast('Slices laid out across the pattern', 'success', { label: 'Undo', run: actions.undo });
  };

  const drop = {
    onDragOver: (e: React.DragEvent) => {
      e.preventDefault();
      setDragging(true);
    },
    onDragLeave: () => setDragging(false),
    onDrop: (e: React.DragEvent) => {
      e.preventDefault();
      setDragging(false);
      void onFiles(e.dataTransfer.files);
    },
  };

  const input = (
    <input
      ref={fileRef}
      type="file"
      accept="audio/*,.wav,.mp3,.ogg,.flac,.m4a,.aif,.aiff"
      className="hidden"
      onChange={(e) => {
        void onFiles(e.target.files);
        e.target.value = '';
      }}
    />
  );

  const micButton =
    mic.state === 'recording' ? (
      <Button size="sm" variant="danger" icon={<Square className="fill-current" />} onClick={mic.stop}>
        Stop recording
      </Button>
    ) : (
      <Button size="sm" variant="ghost" icon={<Mic />} onClick={() => void mic.start()}>
        Record mic
      </Button>
    );

  if (!sample) {
    return (
      <section className="w-full" aria-label="Sample">
        {input}
        <div
          {...drop}
          className={cn(
            'border-line-strong flex flex-col items-center gap-2 rounded-xl border border-dashed px-4 py-6 text-center',
            dragging && 'border-accent bg-accent-soft',
          )}
        >
          <FileAudio className="text-fg-subtle size-6" />
          <p className="text-sm font-medium">Drop an audio file here</p>
          <p className="text-fg-muted max-w-sm text-xs">
            A single hit plays across the keyboard. A loop or phrase gets chopped into slices you can rearrange. Files
            stay in this browser.
          </p>
          <div className="mt-1 flex gap-2">
            <Button size="sm" variant="primary" icon={<Upload />} onClick={() => fileRef.current?.click()}>
              Choose file
            </Button>
            {micButton}
          </div>
        </div>
      </section>
    );
  }

  return (
    <section className="flex w-full flex-col gap-2" aria-label="Sample" {...drop}>
      {input}
      <div className="flex flex-wrap items-center gap-2">
        <FileAudio className="text-fg-subtle size-4" />
        <span className="max-w-48 truncate text-sm font-semibold" title={sample.name}>
          {sample.name}
        </span>
        {buffer && <span className="text-fg-subtle font-mono text-[11px]">{buffer.duration.toFixed(2)} s</span>}
        <Segmented
          label="Sample mode"
          size="xs"
          value={sample.mode}
          onChange={(mode) => {
            actions.updateSample(track.id, { mode });
            if (mode === 'chop' && sample.slices.length < 2) autoChop();
          }}
          options={[
            { value: 'pitched', label: 'Pitched', title: 'Play the sample up and down the keyboard' },
            { value: 'chop', label: 'Chop', title: 'Each note plays a different slice' },
          ]}
        />
        {sample.mode === 'pitched' ? (
          <DragNumber
            label="Root"
            value={sample.root}
            min={24}
            max={96}
            step={1}
            defaultValue={60}
            format={(v) => noteName(v)}
            onChange={(v) => actions.updateSample(track.id, { root: v })}
          />
        ) : (
          <>
            <Button size="xs" variant="outline" icon={<Wand2 />} onClick={autoChop} disabled={!buffer}>
              Find hits
            </Button>
            <Button
              size="xs"
              variant="outline"
              icon={<Scissors />}
              onClick={() =>
                actions.updateSample(track.id, { slices: equalSlices(sample.slices.length === 8 ? 16 : 8) })
              }
            >
              {sample.slices.length === 8 ? '16 equal' : '8 equal'}
            </Button>
            <Button size="xs" variant="outline" icon={<Grid3x3 />} onClick={sliceToPattern}>
              Slices to pattern
            </Button>
            <span className="text-fg-subtle text-[11px]">
              {sample.slices.length} slices · {noteName(CHOP_BASE_NOTE)} plays slice 1
            </span>
          </>
        )}
        <div className="ml-auto flex items-center gap-1">
          <Button size="xs" variant="ghost" icon={<Upload />} onClick={() => fileRef.current?.click()}>
            Replace
          </Button>
          {micButton}
          <IconButton label="Remove sample" size="xs" onClick={() => actions.setSample(track.id, null)}>
            <Trash2 />
          </IconButton>
        </div>
      </div>
      {buffer ? (
        <Waveform track={track} sample={sample} buffer={buffer} />
      ) : (
        <div className="border-line bg-surface-2 text-fg-muted flex h-28 items-center justify-center rounded-lg border text-xs">
          Loading sample… If it doesn’t appear, it may have been removed from this browser. Choose the file again.
        </div>
      )}
    </section>
  );
}

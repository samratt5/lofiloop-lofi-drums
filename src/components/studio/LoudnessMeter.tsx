'use client';

import { useEffect, useRef, useState } from 'react';
import { engine } from '@/lib/audio/engine';
import { useIsPlaying } from '@/hooks/usePlayhead';
import { cn } from '@/lib/utils/cn';

/** Momentary (400 ms) and short-term (~3 s) loudness of the master output, in LUFS. */
export function LoudnessMeter({ target = -14 }: { target?: number }) {
  const playing = useIsPlaying();
  const [reading, setReading] = useState<{ momentary: number; shortTerm: number } | null>(null);
  const shortTerm = useRef<number | null>(null);

  useEffect(() => {
    if (!playing) {
      shortTerm.current = null;
      return;
    }
    let buffer: Float32Array<ArrayBuffer> | null = null;
    const id = setInterval(() => {
      const analyser = engine.loudnessAnalyser;
      const ctx = engine.context;
      if (!analyser || !ctx) return;
      if (!buffer || buffer.length !== analyser.fftSize) buffer = new Float32Array(analyser.fftSize);
      analyser.getFloatTimeDomainData(buffer);
      const n = Math.min(buffer.length, Math.round(ctx.sampleRate * 0.4));
      let sum = 0;
      for (let i = buffer.length - n; i < buffer.length; i++) sum += buffer[i] * buffer[i];
      // The analyser hears a mono downmix; doubling approximates the two-channel sum of BS.1770.
      const ms = (2 * sum) / n;
      const momentary = ms > 1e-10 ? -0.691 + 10 * Math.log10(ms) : -70;
      const energy = Math.pow(10, (momentary + 0.691) / 10);
      const prev = shortTerm.current === null ? energy : Math.pow(10, (shortTerm.current + 0.691) / 10);
      const blended = prev * 0.87 + energy * 0.13;
      shortTerm.current = -0.691 + 10 * Math.log10(Math.max(1e-10, blended));
      setReading({ momentary, shortTerm: shortTerm.current });
    }, 100);
    return () => clearInterval(id);
  }, [playing]);

  const value = reading && playing ? reading.shortTerm : null;
  const fill = value === null ? 0 : Math.max(0, Math.min(1, (value + 40) / 40));
  const hot = value !== null && value > target + 1;

  return (
    <div className="flex flex-col gap-1.5" aria-live="off">
      <div className="flex items-baseline justify-between">
        <span className="text-fg-subtle text-[10px] font-semibold tracking-widest uppercase">Loudness</span>
        <span className={cn('font-mono text-sm font-semibold tabular-nums', hot ? 'text-warn' : 'text-fg')}>
          {value === null ? '–' : value.toFixed(1)} <span className="text-fg-subtle text-[10px] font-normal">LUFS</span>
        </span>
      </div>
      <div className="bg-surface-3 relative h-2 overflow-hidden rounded-full">
        <div
          className={cn('h-full rounded-full transition-[width] duration-100', hot ? 'bg-warn' : 'bg-success')}
          style={{ width: `${fill * 100}%` }}
        />
        <div
          className="bg-fg/60 absolute inset-y-0 w-px"
          style={{ left: `${((target + 40) / 40) * 100}%` }}
          title={`Streaming target ${target} LUFS`}
        />
      </div>
      <p className="text-fg-subtle text-[11px]">
        Streaming services play around {target} LUFS. Export with “Master for streaming” to hit it exactly.
      </p>
    </div>
  );
}

'use client';

import { useEffect, useRef } from 'react';
import { engine } from '@/lib/audio/engine';
import { useIsPlaying } from '@/hooks/usePlayhead';
import { useUi } from '@/lib/store/ui';
import { cn } from '@/lib/utils/cn';

const BARS = 28;

/** Small log-scaled spectrum that idles as a flat line when stopped. */
export function Visualizer({ className }: { className?: string }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const playing = useIsPlaying();
  const theme = useUi((s) => s.theme);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const styles = getComputedStyle(document.documentElement);
    const accent = styles.getPropertyValue('--accent').trim() || '#ffb86b';
    const idle = styles.getPropertyValue('--line-strong').trim() || 'rgba(255,255,255,0.14)';
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const { width, height } = canvas.getBoundingClientRect();
    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(height * dpr);
    ctx.scale(dpr, dpr);

    const levels = new Float32Array(BARS);
    let data: Uint8Array<ArrayBuffer> | null = null;
    let raf = 0;

    const draw = () => {
      ctx.clearRect(0, 0, width, height);
      const analyser = engine.analyser;
      if (analyser && playing) {
        if (!data || data.length !== analyser.frequencyBinCount) data = new Uint8Array(analyser.frequencyBinCount);
        analyser.getByteFrequencyData(data);
        const nyquist = (engine.context?.sampleRate ?? 44100) / 2;
        for (let i = 0; i < BARS; i++) {
          const lo = 40 * Math.pow(16000 / 40, i / BARS);
          const hi = 40 * Math.pow(16000 / 40, (i + 1) / BARS);
          const a = Math.floor((lo / nyquist) * data.length);
          const b = Math.max(a + 1, Math.floor((hi / nyquist) * data.length));
          let peak = 0;
          for (let j = a; j < b && j < data.length; j++) peak = Math.max(peak, data[j]);
          levels[i] = Math.max(peak / 255, levels[i] * 0.86);
        }
      } else {
        for (let i = 0; i < BARS; i++) levels[i] *= 0.85;
      }

      const gap = 2;
      const barWidth = (width - gap * (BARS - 1)) / BARS;
      for (let i = 0; i < BARS; i++) {
        const h = Math.max(2, levels[i] * height);
        ctx.fillStyle = levels[i] > 0.02 ? accent : idle;
        ctx.globalAlpha = levels[i] > 0.02 ? 0.35 + levels[i] * 0.65 : 1;
        const x = i * (barWidth + gap);
        ctx.beginPath();
        ctx.roundRect(x, height - h, barWidth, h, 1.5);
        ctx.fill();
      }
      ctx.globalAlpha = 1;
      if (playing || levels.some((l) => l > 0.01)) raf = requestAnimationFrame(draw);
    };
    draw();
    return () => cancelAnimationFrame(raf);
  }, [playing, theme]);

  return <canvas ref={canvasRef} aria-hidden className={cn('h-8 w-36', className)} />;
}

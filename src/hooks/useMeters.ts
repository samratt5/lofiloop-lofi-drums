'use client';

import { useEffect } from 'react';
import { engine } from '@/lib/audio/engine';

/**
 * One animation loop drives every `[data-meter="<trackId>"]` element by
 * writing a CSS variable directly, so meters never cause React renders.
 */
export function useMeters(playing: boolean) {
  useEffect(() => {
    const levels = new Map<string, number>();
    let buffer: Float32Array<ArrayBuffer> | null = null;
    let raf = 0;
    let quietFrames = 0;

    const tick = () => {
      const meters = document.querySelectorAll<HTMLElement>('[data-meter]');
      let anyLevel = false;
      for (const meter of meters) {
        const id = meter.dataset.meter!;
        const analyser = playing ? engine.trackAnalyser(id) : undefined;
        let peak = 0;
        if (analyser) {
          if (!buffer || buffer.length !== analyser.fftSize) buffer = new Float32Array(analyser.fftSize);
          analyser.getFloatTimeDomainData(buffer);
          for (let i = 0; i < buffer.length; i++) peak = Math.max(peak, Math.abs(buffer[i]));
        }
        const db = peak > 0 ? 20 * Math.log10(peak) : -60;
        const target = Math.max(0, Math.min(1, (db + 48) / 48));
        const level = Math.max(target, (levels.get(id) ?? 0) * 0.9);
        levels.set(id, level);
        if (level > 0.01) anyLevel = true;
        meter.style.setProperty('--level', level.toFixed(3));
        meter.dataset.clip = peak >= 0.99 ? 'true' : 'false';
      }
      quietFrames = anyLevel ? 0 : quietFrames + 1;
      if (playing || quietFrames < 5) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [playing]);
}

'use client';

import { useEffect, useRef, useState } from 'react';
import { CircleAlert } from 'lucide-react';
import type { VideoSupport } from '@/lib/export/video';
import { moodFromProject } from '@/lib/visual/palette';
import { SCENES, drawScenePreview, type SceneId } from '@/lib/visual/scenes';
import type { Project } from '@/lib/project/types';
import { Segmented } from '@/components/ui/Segmented';
import { cn } from '@/lib/utils/cn';

export const VIDEO_SIZES = {
  landscape: { width: 1920, height: 1080, label: '16:9', title: 'YouTube, 1920 × 1080' },
  square: { width: 1080, height: 1080, label: '1:1', title: 'Instagram posts, 1080 × 1080' },
  vertical: { width: 1080, height: 1920, label: '9:16', title: 'Reels, Shorts and TikTok, 1080 × 1920' },
} as const;

export type VideoSize = keyof typeof VIDEO_SIZES;

export interface VideoChoice {
  scene: SceneId;
  size: VideoSize;
  format: 'auto' | 'mp4' | 'webm';
}

function ScenePreview({ scene, project, size }: { scene: SceneId; project: Project; size: VideoSize }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const { width, height } = VIDEO_SIZES[size];
  const w = 160;
  const h = Math.round((w * height) / width);
  useEffect(() => {
    const canvas = ref.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
    try {
      drawScenePreview(ctx, scene, {
        width: canvas.width,
        height: canvas.height,
        seed: project.meta.coverSeed,
        title: project.name,
        artist: project.meta.artist,
        mood: moodFromProject(project),
      });
    } catch {
      // A preview is decoration; the export reports real problems.
    }
  }, [scene, project, w, h]);
  return (
    <canvas
      ref={ref}
      aria-hidden
      className="bg-surface-3 block w-full rounded-lg"
      style={{ aspectRatio: `${w}/${h}` }}
    />
  );
}

export function VideoSettings({
  project,
  value,
  onChange,
  support,
}: {
  project: Project;
  value: VideoChoice;
  onChange: (next: VideoChoice) => void;
  support: VideoSupport | null;
}) {
  // Previews redraw only when the dialog shows a different song, not on every edit.
  const [snapshot] = useState(project);
  if (support && !support.mp4 && !support.webm) {
    return (
      <p className="text-danger flex items-center gap-2 text-sm">
        <CircleAlert className="size-4 shrink-0" />
        This browser can’t encode video. Try a recent Chrome, Edge or Safari.
      </p>
    );
  }
  const vertical = value.size === 'vertical';
  return (
    <div className="flex flex-col gap-4">
      <div
        role="radiogroup"
        aria-label="Scene"
        className={cn('grid gap-2', vertical ? 'grid-cols-5' : 'grid-cols-3 sm:grid-cols-5')}
      >
        {SCENES.map((s) => (
          <button
            key={s.id}
            type="button"
            role="radio"
            aria-checked={value.scene === s.id}
            title={s.description}
            onClick={() => onChange({ ...value, scene: s.id })}
            className={cn(
              'flex flex-col gap-1 rounded-xl border p-1.5 text-left text-xs transition-colors',
              value.scene === s.id ? 'border-accent bg-accent-soft' : 'border-line hover:border-line-strong',
            )}
          >
            <ScenePreview scene={s.id} project={snapshot} size={value.size} />
            <span className="truncate px-0.5 font-medium">{s.label}</span>
          </button>
        ))}
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="flex flex-col gap-1.5">
          <span className="text-fg-muted text-xs font-medium">Shape</span>
          <Segmented
            label="Video shape"
            value={value.size}
            onChange={(size) => onChange({ ...value, size })}
            options={(Object.keys(VIDEO_SIZES) as VideoSize[]).map((k) => ({
              value: k,
              label: VIDEO_SIZES[k].label,
              title: VIDEO_SIZES[k].title,
            }))}
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <span className="text-fg-muted text-xs font-medium">File type</span>
          <Segmented
            label="Video file type"
            value={value.format}
            onChange={(format) => onChange({ ...value, format })}
            options={[
              { value: 'auto', label: 'Best', title: 'MP4 where it plays everywhere, otherwise WebM' },
              ...(support?.mp4 === false ? [] : [{ value: 'mp4' as const, label: 'MP4' }]),
              ...(support?.webm === false ? [] : [{ value: 'webm' as const, label: 'WebM' }]),
            ]}
          />
        </div>
      </div>
      {support && value.format === 'mp4' && !support.mp4Compatible && (
        <p className="text-warn text-xs">
          This browser can only put VP9 video in an MP4, which some players (QuickTime, older iPhones) can’t open. WebM
          or “Best” is safer here.
        </p>
      )}
      <p className="text-fg-subtle text-xs">
        Videos render faster than real time on most computers. Long songs at 1080p can take a few minutes.
      </p>
    </div>
  );
}

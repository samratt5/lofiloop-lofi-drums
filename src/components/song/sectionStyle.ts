import type { SectionKind } from '@/lib/project/types';

export const SECTION_COLORS: Record<SectionKind, string> = {
  intro: '#7fb0e8',
  verse: '#8fd07a',
  prechorus: '#f2c95e',
  hook: '#ff9a5c',
  break: '#b39cff',
  bridge: '#5ed6c9',
  drop: '#ff6f9c',
  outro: '#8fa3b8',
  custom: '#c9d1e0',
};

/** Minimum and maximum arrangement zoom in pixels per bar. */
export const ZOOM_MIN = 10;
export const ZOOM_MAX = 96;
export const TRACK_HEADER_WIDTH = 168;

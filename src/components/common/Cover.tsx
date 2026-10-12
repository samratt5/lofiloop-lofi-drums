'use client';

import { useMemo } from 'react';
import { coverDataUrl } from '@/lib/visual/cover';
import { cn } from '@/lib/utils/cn';

const cache = new Map<string, string>();
const CACHE_LIMIT = 200;

function cachedCover(
  seed: number,
  title: string,
  artist: string,
  styles: readonly string[],
  size: number,
  text: boolean,
) {
  const key = `${seed}|${title}|${artist}|${styles.join(',')}|${size}|${text}`;
  let url = cache.get(key);
  if (url === undefined) {
    url = coverDataUrl({ seed, title, artist, styles: [...styles], text }, size);
    if (cache.size >= CACHE_LIMIT) cache.delete(cache.keys().next().value!);
    cache.set(key, url);
  }
  return url;
}

interface CoverProps {
  seed: number;
  title: string;
  artist?: string;
  styles?: readonly string[];
  /** Rendered pixel size (drawn at 2× for sharp edges) */
  size?: number;
  text?: boolean;
  /** Fill the container's width (square) instead of a fixed size */
  fluid?: boolean;
  className?: string;
}

/** Generated album art for a beat. Deterministic for a seed and title, and cached. */
export function Cover({
  seed,
  title,
  artist = '',
  styles = [],
  size = 64,
  text = false,
  fluid = false,
  className,
}: CoverProps) {
  const stylesKey = styles.join(',');
  const url = useMemo(
    () => cachedCover(seed, title, artist, stylesKey ? stylesKey.split(',') : [], Math.min(1024, size * 2), text),
    [seed, title, artist, stylesKey, size, text],
  );
  return (
    <span
      aria-hidden
      className={cn(
        'bg-surface-3 block shrink-0 overflow-hidden rounded-lg bg-cover bg-center',
        fluid && 'aspect-square w-full',
        className,
      )}
      style={{ ...(fluid ? {} : { width: size, height: size }), backgroundImage: url ? `url(${url})` : undefined }}
    />
  );
}

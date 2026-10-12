/** Canvas plumbing shared by covers, scenes and video export (OffscreenCanvas first, DOM canvas fallback). */

export type Ctx2D = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;
export type AnyCanvas = OffscreenCanvas | HTMLCanvasElement;

/** A new canvas of the given size, or null when neither OffscreenCanvas nor a DOM is available (e.g. Node). */
export function createCanvas(width: number, height: number): AnyCanvas | null {
  const w = Math.max(1, Math.round(width));
  const h = Math.max(1, Math.round(height));
  if (typeof OffscreenCanvas !== 'undefined') {
    try {
      return new OffscreenCanvas(w, h);
    } catch {
      // fall through to the DOM
    }
  }
  if (typeof document !== 'undefined' && typeof document.createElement === 'function') {
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    return canvas;
  }
  return null;
}

export function context2d(canvas: AnyCanvas, options?: CanvasRenderingContext2DSettings): Ctx2D | null {
  return canvas.getContext('2d', options) as Ctx2D | null;
}

/** Encodes a canvas to a Blob (PNG by default). */
export async function canvasToBlob(canvas: AnyCanvas, type = 'image/png', quality?: number): Promise<Blob> {
  if ('convertToBlob' in canvas) return canvas.convertToBlob({ type, quality });
  return new Promise<Blob>((resolve, reject) =>
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('Canvas encoding failed'))), type, quality),
  );
}

/** Small keyed cache of pre-rendered layers so animated scenes only redraw what moves. */
export class LayerCache {
  private readonly entries = new Map<string, AnyCanvas>();

  constructor(private readonly limit = 12) {}

  /**
   * Returns a cached canvas for `key`, painting it on first use. Returns null
   * when no canvas implementation exists; callers then paint directly.
   */
  get(key: string, width: number, height: number, paint: (ctx: Ctx2D) => void): AnyCanvas | null {
    const hit = this.entries.get(key);
    if (hit) {
      this.entries.delete(key);
      this.entries.set(key, hit);
      return hit;
    }
    const canvas = createCanvas(width, height);
    const ctx = canvas && context2d(canvas);
    if (!canvas || !ctx) return null;
    paint(ctx);
    this.entries.set(key, canvas);
    while (this.entries.size > this.limit) {
      const oldest = this.entries.keys().next().value;
      if (oldest === undefined) break;
      this.entries.delete(oldest);
    }
    return canvas;
  }

  /** Draws the cached layer at (x, y), or paints straight onto `ctx` when caching is unavailable. */
  draw(ctx: Ctx2D, key: string, x: number, y: number, width: number, height: number, paint: (c: Ctx2D) => void) {
    const layer = this.get(key, width, height, paint);
    if (layer) {
      ctx.drawImage(layer, x, y);
    } else {
      ctx.save();
      ctx.translate(x, y);
      paint(ctx);
      ctx.restore();
    }
  }

  clear() {
    this.entries.clear();
  }
}

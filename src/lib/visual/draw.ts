/**
 * Procedural drawing primitives shared by cover art and animated scenes:
 * skies, moons, skylines, rain, bokeh, grain and a few cosy silhouettes.
 * Everything is deterministic from its seed / rng and the time argument.
 */
import { createRng, type Rng } from '@/lib/music/rng';
import { context2d, createCanvas, type AnyCanvas, type Ctx2D } from './canvas';
import { mixColor, rgba, type Palette } from './palette';

export const TAU = Math.PI * 2;

// ---- math ---------------------------------------------------------------

/** Fast integer hash of up to three ints to 0..1. */
export function hash3(a: number, b = 0, c = 0): number {
  let h = Math.imul(a | 0, 0x27d4eb2d) ^ Math.imul(b | 0, 0x165667b1) ^ Math.imul(c | 0, 0x9e3779b1);
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

export function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : Number.isNaN(v) ? lo : v;
}

export function smoothstep(a: number, b: number, x: number): number {
  const t = clamp((x - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
}

/** Positive modulo. */
export function mod(a: number, n: number): number {
  return ((a % n) + n) % n;
}

/** Smooth periodic 1D value noise (period = `knots`), returns roughly -1..1. */
export function noise1d(rng: Rng, knots = 64): (x: number) => number {
  const values = Array.from({ length: knots }, () => rng() * 2 - 1);
  return (x: number) => {
    const i = Math.floor(x);
    const f = x - i;
    const a = values[mod(i, knots)];
    const b = values[mod(i + 1, knots)];
    const s = f * f * (3 - 2 * f);
    return a + (b - a) * s;
  };
}

/** Fractal (multi-octave) version of `noise1d`. */
export function fbm1d(rng: Rng, octaves = 4): (x: number) => number {
  const layers = Array.from({ length: octaves }, () => noise1d(rng, 128));
  return (x: number) => {
    let sum = 0;
    let amp = 1;
    let norm = 0;
    for (let o = 0; o < octaves; o++) {
      sum += layers[o](x * 2 ** o) * amp;
      norm += amp;
      amp *= 0.5;
    }
    return sum / norm;
  };
}

// ---- basic shapes -------------------------------------------------------

export function roundRectPath(ctx: Ctx2D, x: number, y: number, w: number, h: number, r: number) {
  const rr = Math.max(0, Math.min(r, w / 2, h / 2));
  ctx.moveTo(x + rr, y);
  ctx.lineTo(x + w - rr, y);
  ctx.arcTo(x + w, y, x + w, y + rr, rr);
  ctx.lineTo(x + w, y + h - rr);
  ctx.arcTo(x + w, y + h, x + w - rr, y + h, rr);
  ctx.lineTo(x + rr, y + h);
  ctx.arcTo(x, y + h, x, y + h - rr, rr);
  ctx.lineTo(x, y + rr);
  ctx.arcTo(x, y, x + rr, y, rr);
  ctx.closePath();
}

export function fillRoundRect(
  ctx: Ctx2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
  fill: string | CanvasGradient,
) {
  ctx.beginPath();
  roundRectPath(ctx, x, y, w, h, r);
  ctx.fillStyle = fill;
  ctx.fill();
}

export function fillCircle(ctx: Ctx2D, x: number, y: number, r: number, fill: string | CanvasGradient) {
  ctx.beginPath();
  ctx.arc(x, y, Math.max(0, r), 0, TAU);
  ctx.fillStyle = fill;
  ctx.fill();
}

/** Soft radial glow, transparent at the edge. */
export function glow(ctx: Ctx2D, x: number, y: number, r: number, color: string, alpha: number) {
  if (!(r > 0) || !(alpha > 0)) return;
  const g = ctx.createRadialGradient(x, y, 0, x, y, r);
  g.addColorStop(0, rgba(color, alpha));
  g.addColorStop(0.35, rgba(color, alpha * 0.45));
  g.addColorStop(1, rgba(color, 0));
  ctx.fillStyle = g;
  ctx.fillRect(x - r, y - r, r * 2, r * 2);
}

// ---- sky ---------------------------------------------------------------

export function paintSky(ctx: Ctx2D, x: number, y: number, w: number, h: number, pal: Palette, midStop = 0.55) {
  const g = ctx.createLinearGradient(0, y, 0, y + h);
  g.addColorStop(0, pal.skyTop);
  g.addColorStop(clamp(midStop, 0.05, 0.95), pal.skyMid);
  g.addColorStop(1, pal.skyBottom);
  ctx.fillStyle = g;
  ctx.fillRect(x, y, w, h);
}

/** Stars in the top part of the box; brighter ones twinkle when `t` changes. */
export function paintStars(
  ctx: Ctx2D,
  seed: number,
  x: number,
  y: number,
  w: number,
  h: number,
  count: number,
  color: string,
  t = 0,
  alpha = 1,
) {
  const unit = Math.max(1, Math.min(w, h) / 900);
  for (let i = 0; i < count; i++) {
    const px = x + hash3(seed, i, 1) * w;
    // Bias towards the top.
    const py = y + Math.pow(hash3(seed, i, 2), 1.6) * h;
    const big = hash3(seed, i, 3);
    const tw = 0.55 + 0.45 * Math.sin(t * (0.8 + hash3(seed, i, 4) * 2.2) + hash3(seed, i, 5) * TAU);
    const a = alpha * (0.25 + 0.75 * big) * (big > 0.85 ? tw : 0.75 + 0.25 * tw);
    const s = unit * (big > 0.93 ? 2.2 : big > 0.7 ? 1.5 : 1);
    ctx.fillStyle = rgba(color, a);
    ctx.fillRect(px - s / 2, py - s / 2, s, s);
    if (big > 0.97) glow(ctx, px, py, s * 6, color, a * 0.35);
  }
}

/** Moon disc (crescent when `crescent` > 0, 0..1 = how much is eaten) with a soft halo. */
export function paintMoon(ctx: Ctx2D, x: number, y: number, r: number, color: string, crescent = 0, tilt = -0.5) {
  glow(ctx, x, y, r * 5, color, 0.22);
  glow(ctx, x, y, r * 2.2, color, 0.35);
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(tilt);
  ctx.beginPath();
  if (crescent > 0.02) {
    const d = r * (0.25 + clamp(crescent, 0, 1) * 1.1);
    const hh = Math.sqrt(Math.max(0, r * r - (d * d) / 4));
    const a = Math.atan2(hh, d / 2);
    ctx.arc(0, 0, r, -a, a, true);
    ctx.arc(d, 0, r, Math.PI - a, Math.PI + a, false);
    ctx.closePath();
  } else {
    ctx.arc(0, 0, r, 0, TAU);
  }
  ctx.fillStyle = color;
  ctx.fill();
  // Faint maria.
  ctx.clip();
  ctx.fillStyle = rgba('#000000', 0.06);
  for (let i = 0; i < 5; i++) {
    ctx.beginPath();
    ctx.arc(-r * 0.3 + hash3(i, 7) * r * 0.6, -r * 0.4 + hash3(i, 8) * r * 0.8, r * (0.12 + hash3(i, 9) * 0.2), 0, TAU);
    ctx.fill();
  }
  ctx.restore();
}

/** Retro sun: vertical gradient disc whose lower half is cut into thinning stripes. */
export function paintSun(ctx: Ctx2D, x: number, y: number, r: number, top: string, bottom: string, stripes = 6) {
  glow(ctx, x, y, r * 3.2, top, 0.3);
  ctx.save();
  ctx.beginPath();
  ctx.rect(x - r, y - r, r * 2, r * 1.05);
  if (stripes > 0) {
    const start = y + r * 0.05;
    const band = (r * 0.95) / stripes;
    for (let i = 0; i < stripes; i++) {
      const gap = band * (0.15 + (0.55 * i) / stripes);
      ctx.rect(x - r, start + i * band + gap, r * 2, band - gap);
    }
  } else {
    ctx.rect(x - r, y, r * 2, r);
  }
  ctx.clip();
  const g = ctx.createLinearGradient(0, y - r, 0, y + r);
  g.addColorStop(0, top);
  g.addColorStop(1, bottom);
  fillCircle(ctx, x, y, r, g);
  ctx.restore();
}

/** A filled ridge line (hills, dunes) from `baseY` down to `bottom`. */
export function paintRidge(
  ctx: Ctx2D,
  f: (x: number) => number,
  x0: number,
  w: number,
  baseY: number,
  amp: number,
  freq: number,
  bottom: number,
  fill: string | CanvasGradient,
) {
  const steps = 96;
  ctx.beginPath();
  ctx.moveTo(x0, bottom);
  for (let i = 0; i <= steps; i++) {
    const px = x0 + (w * i) / steps;
    ctx.lineTo(px, baseY - f((i / steps) * freq) * amp);
  }
  ctx.lineTo(x0 + w, bottom);
  ctx.closePath();
  ctx.fillStyle = fill;
  ctx.fill();
}

// ---- city ---------------------------------------------------------------

export interface Building {
  x: number;
  w: number;
  h: number;
  kind: 'flat' | 'step' | 'antenna' | 'tower' | 'dome' | 'tank';
  id: number;
}

/** Deterministic row of buildings between x0 and x1 with heights in [minH, maxH]. */
export function makeSkyline(rng: Rng, x0: number, x1: number, minH: number, maxH: number, unit: number): Building[] {
  const out: Building[] = [];
  let x = x0 - rng() * unit * 20;
  let id = 0;
  while (x < x1) {
    const w = unit * (18 + rng() * 46);
    const tall = rng();
    const h = minH + (maxH - minH) * Math.pow(tall, 1.4);
    const kinds: Building['kind'][] = ['flat', 'flat', 'step', 'antenna', 'tower', 'dome', 'tank'];
    const kind = kinds[Math.floor(rng() * kinds.length)];
    out.push({ x, w, h, kind, id: id++ });
    x += w + (rng() < 0.2 ? unit * rng() * 6 : -unit * rng() * 4);
  }
  return out;
}

export function paintBuildings(ctx: Ctx2D, buildings: Building[], baseY: number, fill: string, unit: number) {
  ctx.fillStyle = fill;
  ctx.beginPath();
  for (const b of buildings) {
    const top = baseY - b.h;
    ctx.rect(b.x, top, b.w, b.h + 2);
    switch (b.kind) {
      case 'step':
        ctx.rect(b.x + b.w * 0.18, top - b.h * 0.08, b.w * 0.64, b.h * 0.08 + 1);
        ctx.rect(b.x + b.w * 0.34, top - b.h * 0.14, b.w * 0.32, b.h * 0.06 + 1);
        break;
      case 'antenna':
        ctx.rect(b.x + b.w * 0.5 - unit * 0.8, top - b.h * 0.22, unit * 1.6, b.h * 0.22 + 1);
        break;
      case 'tower':
        ctx.moveTo(b.x, top + 1);
        ctx.lineTo(b.x + b.w / 2, top - Math.min(b.h * 0.18, b.w * 0.7));
        ctx.lineTo(b.x + b.w, top + 1);
        break;
      case 'dome':
        ctx.moveTo(b.x + b.w * 0.15, top + 1);
        ctx.arc(b.x + b.w / 2, top + 1, b.w * 0.35, Math.PI, 0);
        break;
      case 'tank': {
        const tw = Math.min(b.w * 0.4, unit * 12);
        ctx.rect(b.x + b.w * 0.2, top - tw * 0.9, tw, tw * 0.7);
        ctx.rect(b.x + b.w * 0.2 + tw * 0.1, top - tw * 0.25, unit, tw * 0.25 + 1);
        ctx.rect(b.x + b.w * 0.2 + tw * 0.8, top - tw * 0.25, unit, tw * 0.25 + 1);
        break;
      }
      default:
        break;
    }
  }
  ctx.fill();
}

/**
 * Lit windows. A few windows toggle slowly over time; `level` 0..1 scales
 * how many are on, `flicker` adds audio-driven brightness.
 */
export function paintWindows(
  ctx: Ctx2D,
  buildings: Building[],
  baseY: number,
  color: string,
  unit: number,
  seed: number,
  level = 0.35,
  t = 0,
  alpha = 0.9,
) {
  const cell = unit * 7;
  const ww = unit * 3.2;
  const wh = unit * 4.2;
  ctx.fillStyle = rgba(color, alpha);
  ctx.beginPath();
  for (const b of buildings) {
    const cols = Math.floor((b.w - unit * 6) / cell);
    const rows = Math.floor((b.h - unit * 10) / (cell * 1.25));
    if (cols < 1 || rows < 1) continue;
    const ox = b.x + (b.w - cols * cell) / 2 + (cell - ww) / 2;
    const style = hash3(seed, b.id, 99);
    for (let r = 0; r < rows; r++) {
      const y = baseY - b.h + unit * 6 + r * cell * 1.25;
      for (let c = 0; c < cols; c++) {
        let on = hash3(seed + b.id, r, c) < level * (style < 0.2 ? 0.3 : 1);
        const toggler = hash3(seed ^ 0x55, b.id * 131 + r, c);
        if (toggler < 0.06) {
          const period = 4 + toggler * 90;
          if (Math.floor(t / period + toggler * 17) % 2 === 1) on = !on;
        }
        if (on) ctx.rect(Math.round(ox + c * cell), Math.round(y), Math.ceil(ww), Math.ceil(wh));
      }
    }
  }
  ctx.fill();
}

// ---- weather & light ----------------------------------------------------

/** Falling rain streaks, deterministic in t. */
export function paintRain(
  ctx: Ctx2D,
  seed: number,
  w: number,
  h: number,
  count: number,
  t: number,
  color: string,
  alpha: number,
  slant = 0.12,
) {
  const unit = Math.min(w, h) / 1080;
  ctx.strokeStyle = rgba(color, alpha);
  ctx.lineWidth = Math.max(1, unit * 1.4);
  ctx.beginPath();
  for (let i = 0; i < count; i++) {
    const speed = 0.9 + hash3(seed, i, 11) * 0.8;
    const len = unit * (30 + hash3(seed, i, 12) * 60);
    const cycle = h + len + slant * h;
    const y = mod(hash3(seed, i, 13) * cycle + t * speed * h * 1.4, cycle) - len;
    const x = hash3(seed, i, 14) * (w + slant * h) - slant * (y + h * 0.1);
    ctx.moveTo(x, y);
    ctx.lineTo(x - slant * len, y + len);
  }
  ctx.stroke();
}

const spriteCache = new Map<string, AnyCanvas | null>();

/**
 * Pre-rendered disc sprite: `hard` 0..1 sets where the bokeh edge sits, 0 gives
 * the smooth `glow` falloff. Null without a canvas implementation.
 */
export function glowSprite(color: string, hard = 0.6): AnyCanvas | null {
  const key = `${color}:${hard}`;
  if (spriteCache.has(key)) return spriteCache.get(key) ?? null;
  const size = 128;
  const canvas = createCanvas(size, size);
  const c = canvas && context2d(canvas);
  if (canvas && c) {
    const g = c.createRadialGradient(64, 64, 0, 64, 64, 64);
    if (hard <= 0) {
      // Same falloff as `glow`
      g.addColorStop(0, rgba(color, 1));
      g.addColorStop(0.35, rgba(color, 0.45));
    } else {
      g.addColorStop(0, rgba(color, 0.9));
      g.addColorStop(clamp(hard, 0.05, 0.95), rgba(color, 0.55));
      g.addColorStop(Math.min(0.99, hard + 0.12), rgba(color, 0.2));
    }
    g.addColorStop(1, rgba(color, 0));
    c.fillStyle = g;
    c.fillRect(0, 0, size, size);
  }
  if (spriteCache.size > 64) spriteCache.clear();
  spriteCache.set(key, canvas ?? null);
  return canvas ?? null;
}

/** Cheap `glow` for per-frame use: draws a cached sprite. */
export function softGlow(ctx: Ctx2D, x: number, y: number, r: number, color: string, alpha: number) {
  bokeh(ctx, x, y, r, color, alpha, 0);
}

/** Draws a bokeh disc using a cached sprite when possible. */
export function bokeh(ctx: Ctx2D, x: number, y: number, r: number, color: string, alpha: number, hard = 0.6) {
  if (!(r > 0) || !(alpha > 0.002)) return;
  const sprite = glowSprite(color, hard);
  if (sprite) {
    ctx.globalAlpha = clamp(alpha, 0, 1);
    ctx.drawImage(sprite, x - r, y - r, r * 2, r * 2);
    ctx.globalAlpha = 1;
  } else {
    glow(ctx, x, y, r, color, alpha);
  }
}

/** Soft cone of light from (x, y) pointing down. */
export function paintLightCone(
  ctx: Ctx2D,
  x: number,
  y: number,
  topWidth: number,
  bottomWidth: number,
  length: number,
  color: string,
  alpha: number,
) {
  const g = ctx.createLinearGradient(0, y, 0, y + length);
  g.addColorStop(0, rgba(color, alpha));
  g.addColorStop(1, rgba(color, 0));
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.moveTo(x - topWidth / 2, y);
  ctx.lineTo(x + topWidth / 2, y);
  ctx.lineTo(x + bottomWidth / 2, y + length);
  ctx.lineTo(x - bottomWidth / 2, y + length);
  ctx.closePath();
  ctx.fill();
}

// ---- texture -------------------------------------------------------------

let grainTile: AnyCanvas | null | undefined;

function getGrainTile(): AnyCanvas | null {
  if (grainTile !== undefined) return grainTile;
  const size = 192;
  const canvas = createCanvas(size, size);
  const c = canvas && context2d(canvas);
  if (!canvas || !c || typeof c.createImageData !== 'function') {
    grainTile = null;
    return null;
  }
  const img = c.createImageData(size, size);
  const rng = createRng(0x6a1e);
  for (let i = 0; i < size * size; i++) {
    const v = rng() < 0.5 ? 0 : 255;
    img.data[i * 4] = v;
    img.data[i * 4 + 1] = v;
    img.data[i * 4 + 2] = v;
    img.data[i * 4 + 3] = Math.floor(rng() * rng() * 255);
  }
  c.putImageData(img, 0, 0);
  grainTile = canvas;
  return canvas;
}

/** Film grain over the box; `frame` shifts the noise so video grain moves. */
export function paintGrain(ctx: Ctx2D, w: number, h: number, amount: number, frame = 0) {
  if (!(amount > 0)) return;
  const tile = getGrainTile();
  ctx.save();
  ctx.globalAlpha = clamp(amount, 0, 1);
  if (tile) {
    const pattern = ctx.createPattern(tile, 'repeat');
    if (pattern) {
      const ox = Math.floor(hash3(frame, 1) * 192);
      const oy = Math.floor(hash3(frame, 2) * 192);
      ctx.translate(-ox, -oy);
      ctx.fillStyle = pattern;
      ctx.fillRect(ox, oy, w, h);
    }
  } else {
    // Sparse speckles when no canvas is available (tests / exotic hosts).
    const n = Math.min(4000, Math.floor((w * h) / 400));
    for (let i = 0; i < n; i++) {
      ctx.fillStyle = hash3(frame, i, 3) < 0.5 ? '#000000' : '#ffffff';
      ctx.fillRect(hash3(frame, i, 1) * w, hash3(frame, i, 2) * h, 1, 1);
    }
  }
  ctx.restore();
}

export function paintVignette(ctx: Ctx2D, w: number, h: number, strength: number, color = '#000000') {
  const r = Math.hypot(w, h) / 2;
  const g = ctx.createRadialGradient(w / 2, h / 2, r * 0.45, w / 2, h / 2, r);
  g.addColorStop(0, rgba(color, 0));
  g.addColorStop(1, rgba(color, clamp(strength, 0, 1)));
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, h);
}

// ---- silhouettes ----------------------------------------------------------

/** Potted plant with long leaves. `sway` in radians gently bends the leaves. */
export function paintPlant(
  ctx: Ctx2D,
  x: number,
  baseY: number,
  size: number,
  leaf: string,
  pot: string,
  seed: number,
  sway = 0,
) {
  const potW = size * 0.42;
  const potH = size * 0.34;
  const top = baseY - potH;
  const leaves = 7 + Math.floor(hash3(seed, 1) * 4);
  for (let i = 0; i < leaves; i++) {
    const k = i / (leaves - 1);
    const angle = -Math.PI / 2 + (k - 0.5) * 2.3 + (hash3(seed, i, 2) - 0.5) * 0.3 + sway * (0.6 + hash3(seed, i, 7));
    const len = size * (0.55 + hash3(seed, i, 3) * 0.45) * (1 - Math.abs(k - 0.5) * 0.5);
    const width = size * (0.07 + hash3(seed, i, 4) * 0.05);
    const droop = (k - 0.5) * 0.9;
    const bx = x + (k - 0.5) * potW * 0.3;
    const tipX = bx + Math.cos(angle + droop * 0.4) * len;
    const tipY = top + Math.sin(angle + droop * 0.4) * len + Math.abs(droop) * len * 0.35;
    const midX = bx + Math.cos(angle) * len * 0.55;
    const midY = top + Math.sin(angle) * len * 0.55;
    const nx = -Math.sin(angle) * width;
    const ny = Math.cos(angle) * width;
    ctx.beginPath();
    ctx.moveTo(bx, top + 2);
    ctx.quadraticCurveTo(midX + nx, midY + ny, tipX, tipY);
    ctx.quadraticCurveTo(midX - nx, midY - ny, bx, top + 2);
    ctx.fillStyle = i % 2 ? leaf : mixColor(leaf, '#000000', 0.15);
    ctx.fill();
  }
  ctx.beginPath();
  ctx.moveTo(x - potW / 2, top);
  ctx.lineTo(x + potW / 2, top);
  ctx.lineTo(x + potW * 0.38, baseY);
  ctx.lineTo(x - potW * 0.38, baseY);
  ctx.closePath();
  ctx.fillStyle = pot;
  ctx.fill();
  ctx.fillRect(x - potW * 0.54, top - potH * 0.08, potW * 1.08, potH * 0.18);
}

/** Mug with a handle; returns the rim centre for steam. */
export function paintMug(ctx: Ctx2D, x: number, baseY: number, size: number, body: string, accent?: string) {
  const w = size * 0.7;
  const h = size * 0.8;
  ctx.lineWidth = size * 0.1;
  ctx.strokeStyle = body;
  ctx.beginPath();
  ctx.arc(x + w / 2, baseY - h * 0.52, h * 0.22, -Math.PI / 2, Math.PI / 2);
  ctx.stroke();
  fillRoundRect(ctx, x - w / 2, baseY - h, w, h, size * 0.1, body);
  if (accent) {
    ctx.fillStyle = accent;
    ctx.fillRect(x - w / 2, baseY - h * 0.62, w, h * 0.14);
  }
  return { x, y: baseY - h };
}

/** Rising wisps of steam, animated by t. */
export function paintSteam(ctx: Ctx2D, x: number, y: number, height: number, t: number, color: string, alpha: number) {
  ctx.save();
  ctx.lineCap = 'round';
  for (let s = 0; s < 3; s++) {
    const phase = s * 2.1;
    ctx.beginPath();
    const steps = 18;
    for (let i = 0; i <= steps; i++) {
      const k = i / steps;
      const py = y - k * height;
      const px = x + (s - 1) * height * 0.12 + Math.sin(k * 5 - t * 1.6 + phase) * height * 0.1 * (0.3 + k);
      if (i === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    }
    const g = ctx.createLinearGradient(0, y, 0, y - height);
    const a = alpha * (0.6 + 0.4 * Math.sin(t * 0.9 + phase));
    g.addColorStop(0, rgba(color, 0));
    g.addColorStop(0.25, rgba(color, a));
    g.addColorStop(1, rgba(color, 0));
    ctx.strokeStyle = g;
    ctx.lineWidth = height * 0.05;
    ctx.stroke();
  }
  ctx.restore();
}

/** Stack of books lying flat; returns the top of the stack. */
export function paintBooks(ctx: Ctx2D, x: number, baseY: number, size: number, colors: string[], seed: number) {
  let y = baseY;
  const count = 2 + Math.floor(hash3(seed, 3) * 3);
  for (let i = 0; i < count; i++) {
    const w = size * (0.8 + hash3(seed, i, 1) * 0.35);
    const h = size * (0.1 + hash3(seed, i, 2) * 0.07);
    const off = (hash3(seed, i, 4) - 0.5) * size * 0.16;
    fillRoundRect(ctx, x - w / 2 + off, y - h, w, h, h * 0.2, colors[i % colors.length]);
    ctx.fillStyle = rgba('#ffffff', 0.12);
    ctx.fillRect(x - w / 2 + off + w * 0.06, y - h * 0.62, w * 0.88, Math.max(1, h * 0.12));
    y -= h;
  }
  return y;
}

/** A sitting cat seen from behind. */
export function paintCat(ctx: Ctx2D, x: number, baseY: number, size: number, color: string, tail = 0) {
  ctx.fillStyle = color;
  // Body
  ctx.beginPath();
  ctx.ellipse(x, baseY - size * 0.32, size * 0.3, size * 0.34, 0, 0, TAU);
  ctx.fill();
  // Head
  const hy = baseY - size * 0.74;
  ctx.beginPath();
  ctx.ellipse(x, hy, size * 0.19, size * 0.17, 0, 0, TAU);
  ctx.fill();
  // Ears
  ctx.beginPath();
  ctx.moveTo(x - size * 0.17, hy - size * 0.04);
  ctx.lineTo(x - size * 0.13, hy - size * 0.25);
  ctx.lineTo(x - size * 0.02, hy - size * 0.12);
  ctx.moveTo(x + size * 0.17, hy - size * 0.04);
  ctx.lineTo(x + size * 0.13, hy - size * 0.25);
  ctx.lineTo(x + size * 0.02, hy - size * 0.12);
  ctx.fill();
  // Tail
  ctx.lineWidth = size * 0.07;
  ctx.lineCap = 'round';
  ctx.strokeStyle = color;
  ctx.beginPath();
  ctx.moveTo(x + size * 0.2, baseY - size * 0.04);
  ctx.quadraticCurveTo(
    x + size * 0.55,
    baseY - size * 0.02,
    x + size * (0.52 + Math.sin(tail) * 0.05),
    baseY - size * (0.28 + Math.cos(tail) * 0.04),
  );
  ctx.stroke();
}

/** Street lamp; returns the lamp head position. */
export function paintStreetLamp(ctx: Ctx2D, x: number, baseY: number, height: number, color: string, facing = 1) {
  const pw = Math.max(2, height * 0.018);
  ctx.fillStyle = color;
  ctx.fillRect(x - pw * 1.6, baseY - height * 0.06, pw * 3.2, height * 0.06);
  ctx.fillRect(x - pw / 2, baseY - height, pw, height);
  ctx.strokeStyle = color;
  ctx.lineWidth = pw * 0.8;
  ctx.beginPath();
  ctx.moveTo(x, baseY - height + pw);
  ctx.quadraticCurveTo(x, baseY - height * 1.06, x + facing * height * 0.16, baseY - height * 1.04);
  ctx.stroke();
  const hx = x + facing * height * 0.18;
  const hy = baseY - height * 1.02;
  ctx.beginPath();
  ctx.moveTo(hx - height * 0.06, hy + height * 0.03);
  ctx.lineTo(hx + height * 0.06, hy + height * 0.03);
  ctx.lineTo(hx + height * 0.03, hy - height * 0.015);
  ctx.lineTo(hx - height * 0.03, hy - height * 0.015);
  ctx.closePath();
  ctx.fill();
  return { x: hx, y: hy + height * 0.03 };
}

/** Desk lamp (base, two-segment arm, shade); returns bulb position. */
export function paintDeskLamp(ctx: Ctx2D, x: number, baseY: number, size: number, color: string, facing = 1) {
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.ellipse(x, baseY - size * 0.02, size * 0.2, size * 0.05, 0, 0, TAU);
  ctx.fill();
  const elbowX = x - facing * size * 0.12;
  const elbowY = baseY - size * 0.62;
  const headX = x + facing * size * 0.3;
  const headY = baseY - size * 0.95;
  ctx.strokeStyle = color;
  ctx.lineWidth = size * 0.035;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(x, baseY - size * 0.05);
  ctx.lineTo(elbowX, elbowY);
  ctx.lineTo(headX, headY);
  ctx.stroke();
  ctx.save();
  ctx.translate(headX, headY);
  ctx.rotate(facing * 0.55);
  ctx.beginPath();
  ctx.moveTo(-size * 0.06, -size * 0.05);
  ctx.lineTo(size * 0.06, -size * 0.05);
  ctx.lineTo(size * 0.17, size * 0.14);
  ctx.lineTo(-size * 0.17, size * 0.14);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
  const bx = headX + facing * Math.sin(0.55) * size * 0.14;
  const by = headY + Math.cos(0.55) * size * 0.14;
  return { x: bx, y: by };
}

// ---- objects ------------------------------------------------------------

/**
 * Vinyl record with grooves and a static sheen. `label` is drawn rotated
 * inside the centre label when given, otherwise a coloured label.
 */
export function paintRecord(
  ctx: Ctx2D,
  cx: number,
  cy: number,
  r: number,
  angle: number,
  labelColor: string,
  accent: string,
  label?: CanvasImageSource | null,
) {
  fillCircle(ctx, cx, cy, r, '#0d0c10');
  ctx.lineWidth = Math.max(1, r / 260);
  for (let i = 0; i < 26; i++) {
    const rr = r * (0.38 + (i / 26) * 0.6);
    ctx.strokeStyle = i % 5 === 0 ? 'rgba(255,255,255,0.05)' : 'rgba(255,255,255,0.025)';
    ctx.beginPath();
    ctx.arc(cx, cy, rr, 0, TAU);
    ctx.stroke();
  }
  // Static sheen wedges (the reflection does not rotate with the record).
  ctx.save();
  ctx.beginPath();
  ctx.arc(cx, cy, r * 0.98, 0, TAU);
  ctx.clip();
  for (const [a0, a] of [
    [-2.4, 0.09],
    [0.75, 0.07],
  ] as const) {
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.arc(cx, cy, r, a0, a0 + 0.42);
    ctx.closePath();
    const g = ctx.createRadialGradient(cx, cy, r * 0.35, cx, cy, r);
    g.addColorStop(0, rgba('#ffffff', 0));
    g.addColorStop(0.7, rgba('#ffffff', a));
    g.addColorStop(1, rgba('#ffffff', a * 0.3));
    ctx.fillStyle = g;
    ctx.fill();
  }
  ctx.restore();
  const lr = r * 0.34;
  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate(angle);
  ctx.beginPath();
  ctx.arc(0, 0, lr, 0, TAU);
  ctx.clip();
  if (label) {
    ctx.drawImage(label, -lr, -lr, lr * 2, lr * 2);
  } else {
    ctx.fillStyle = labelColor;
    ctx.fillRect(-lr, -lr, lr * 2, lr * 2);
    ctx.fillStyle = accent;
    ctx.fillRect(-lr, -lr * 0.18, lr * 2, lr * 0.36);
  }
  // A mark so the rotation reads even with a symmetric label.
  ctx.fillStyle = rgba('#ffffff', 0.35);
  ctx.fillRect(lr * 0.45, -lr * 0.03, lr * 0.4, lr * 0.06);
  ctx.restore();
  ctx.strokeStyle = 'rgba(0,0,0,0.35)';
  ctx.lineWidth = Math.max(1, r / 120);
  ctx.beginPath();
  ctx.arc(cx, cy, lr, 0, TAU);
  ctx.stroke();
  fillCircle(ctx, cx, cy, Math.max(2, r * 0.025), '#d9d4cc');
}

/** Cassette tape centred at (cx, cy), `w` wide. `reel` rotates the reel teeth. */
export function paintCassette(ctx: Ctx2D, cx: number, cy: number, w: number, pal: Palette, reel = 0, labelText = '') {
  const h = w * 0.63;
  const x = cx - w / 2;
  const y = cy - h / 2;
  const u = w / 100;
  // Shell
  const shell = mixColor(pal.ink, pal.haze, 0.35);
  fillRoundRect(ctx, x, y, w, h, u * 4, shell);
  fillRoundRect(ctx, x + u * 1.2, y + u * 1.2, w - u * 2.4, h - u * 2.4, u * 3, mixColor(shell, pal.paper, 0.08));
  // Label
  fillRoundRect(ctx, x + u * 6, y + u * 6, w - u * 12, h * 0.62, u * 2, pal.paper);
  ctx.fillStyle = pal.accent;
  ctx.fillRect(x + u * 6, y + u * 6 + h * 0.1, w - u * 12, h * 0.08);
  ctx.fillStyle = pal.accent2;
  ctx.fillRect(x + u * 6, y + u * 6 + h * 0.2, w - u * 12, h * 0.035);
  if (labelText) {
    ctx.fillStyle = pal.ink;
    ctx.font = `600 ${Math.round(u * 4.2)}px ui-monospace, 'SFMono-Regular', Menlo, monospace`;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';
    ctx.fillText(labelText.slice(0, 28), x + u * 9, y + u * 6 + h * 0.08);
  }
  // Window
  const wx = x + w * 0.27;
  const wy = y + h * 0.36;
  fillRoundRect(ctx, wx, wy, w * 0.46, h * 0.22, h * 0.11, mixColor(pal.ink, '#000000', 0.3));
  for (const side of [-1, 1]) {
    const rx = cx + side * w * 0.17;
    const ry = wy + h * 0.11;
    const rr = h * 0.085;
    fillCircle(ctx, rx, ry, rr * (side < 0 ? 1.55 : 1.15), rgba('#2a1d17', 0.95));
    fillCircle(ctx, rx, ry, rr, pal.paper);
    ctx.save();
    ctx.translate(rx, ry);
    ctx.rotate(reel * side);
    ctx.fillStyle = mixColor(pal.ink, pal.skyMid, 0.4);
    for (let i = 0; i < 6; i++) {
      ctx.rotate(TAU / 6);
      ctx.fillRect(-rr * 0.12, -rr * 0.62, rr * 0.24, rr * 0.3);
    }
    ctx.restore();
    fillCircle(ctx, rx, ry, rr * 0.3, mixColor(pal.ink, pal.skyMid, 0.4));
  }
  // Bottom trapezoid with screw holes
  ctx.beginPath();
  ctx.moveTo(x + w * 0.2, y + h);
  ctx.lineTo(x + w * 0.25, y + h * 0.8);
  ctx.lineTo(x + w * 0.75, y + h * 0.8);
  ctx.lineTo(x + w * 0.8, y + h);
  ctx.closePath();
  ctx.fillStyle = mixColor(shell, '#000000', 0.2);
  ctx.fill();
  for (const px of [0.33, 0.45, 0.55, 0.67]) fillCircle(ctx, x + w * px, y + h * 0.9, u * 1.2, rgba('#000000', 0.5));
  for (const [px, py] of [
    [0.04, 0.06],
    [0.96, 0.06],
    [0.04, 0.94],
    [0.96, 0.94],
    [0.5, 0.06],
  ]) {
    fillCircle(ctx, x + w * px, y + h * py, u * 1.1, rgba('#000000', 0.35));
  }
}

// ---- text ---------------------------------------------------------------

export const SANS = 'ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif';
export const SERIF = 'ui-serif, Georgia, "Times New Roman", serif';
export const MONO = 'ui-monospace, "SFMono-Regular", Menlo, Consolas, "Liberation Mono", monospace';

export function setLetterSpacing(ctx: Ctx2D, px: number) {
  if ('letterSpacing' in ctx) (ctx as { letterSpacing: string }).letterSpacing = `${px}px`;
}

function measure(ctx: Ctx2D, text: string): number {
  const w = ctx.measureText(text)?.width;
  return typeof w === 'number' && Number.isFinite(w) ? w : text.length * 10;
}

/**
 * Splits `text` into at most `maxLines` lines and picks the largest font size
 * (<= `maxSize`) at which every line fits `maxWidth`.
 */
export function fitLines(
  ctx: Ctx2D,
  text: string,
  font: (size: number) => string,
  maxWidth: number,
  maxSize: number,
  maxLines = 2,
  minSize = 8,
): { lines: string[]; size: number } {
  const words = text.trim().split(/\s+/).filter(Boolean);
  if (!words.length) return { lines: [], size: maxSize };
  let size = Math.max(minSize, maxSize);
  while (true) {
    ctx.font = font(size);
    const lines: string[] = [];
    let line = '';
    for (const word of words) {
      const next = line ? `${line} ${word}` : word;
      if (!line || measure(ctx, next) <= maxWidth) line = next;
      else {
        lines.push(line);
        line = word;
      }
    }
    if (line) lines.push(line);
    const widest = Math.max(...lines.map((l) => measure(ctx, l)));
    if ((lines.length <= maxLines && widest <= maxWidth) || size <= minSize) {
      if (lines.length > maxLines) {
        const kept = lines.slice(0, maxLines);
        kept[maxLines - 1] = `${kept[maxLines - 1].replace(/\s*\S*$/, '')}…`;
        return { lines: kept, size };
      }
      return { lines, size };
    }
    size = Math.max(minSize, Math.floor(size * 0.92));
  }
}

/** Single-line text shrunk to fit, with an ellipsis as last resort. */
export function fitText(ctx: Ctx2D, text: string, font: (size: number) => string, maxWidth: number, maxSize: number) {
  let size = maxSize;
  ctx.font = font(size);
  while (size > 8 && measure(ctx, text) > maxWidth) {
    size = Math.floor(size * 0.92);
    ctx.font = font(size);
  }
  let out = text;
  while (out.length > 1 && measure(ctx, out) > maxWidth) out = `${out.slice(0, -2)}…`;
  return { text: out, size };
}

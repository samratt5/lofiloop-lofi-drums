/**
 * Procedural lofi cover art. A seed picks one of several layout families
 * (rainy window, sunset hills, street lamp, desk, abstract, vinyl, cassette)
 * and a palette; everything is drawn with Canvas 2D, no external assets.
 */
import { createRng, type Rng } from '@/lib/music/rng';
import { canvasToBlob, context2d, createCanvas, type Ctx2D } from './canvas';
import {
  bokeh,
  fbm1d,
  fillCircle,
  fillRoundRect,
  fitLines,
  fitText,
  glow,
  hash3,
  makeSkyline,
  MONO,
  paintBooks,
  paintBuildings,
  paintCassette,
  paintCat,
  paintDeskLamp,
  paintGrain,
  paintLightCone,
  paintMoon,
  paintMug,
  paintPlant,
  paintRain,
  paintRecord,
  paintRidge,
  paintSky,
  paintStars,
  paintSteam,
  paintStreetLamp,
  paintSun,
  paintVignette,
  paintWindows,
  SANS,
  SERIF,
  setLetterSpacing,
  TAU,
} from './draw';
import { mixColor, paletteFor, rgba, type Mood, type Palette } from './palette';

export const COVER_LAYOUTS = ['window', 'sunset', 'street', 'desk', 'abstract', 'vinyl', 'cassette'] as const;
export type CoverLayout = (typeof COVER_LAYOUTS)[number];

export interface CoverOptions {
  /** Square size in pixels */
  size: number;
  seed: number;
  title: string;
  artist?: string;
  mood?: Partial<Mood>;
  /** Style tags (e.g. project.meta.styles) nudge the layout choice */
  styles?: string[];
  /** Force a layout instead of picking one from the seed */
  layout?: CoverLayout;
  /** Draw title and artist (default true) */
  text?: boolean;
}

const STYLE_HINTS: [RegExp, CoverLayout][] = [
  [/rain|storm|drizzle/i, 'window'],
  [/sun|summer|golden|dusk|chillhop|morning/i, 'sunset'],
  [/city|street|night|urban|boom ?bap|trap/i, 'street'],
  [/study|desk|room|bedroom|coffee|rnb/i, 'desk'],
  [/ambient|dream|space|house|minimal/i, 'abstract'],
  [/jazz|vinyl|soul|record/i, 'vinyl'],
  [/tape|cassette|retro|90s/i, 'cassette'],
];

/** Deterministic layout for a seed; style tags make matching layouts more likely. */
export function coverLayoutFor(seed: number, styles: readonly string[] = []): CoverLayout {
  const rng = createRng((seed ^ 0x1a7057) >>> 0);
  const weights = COVER_LAYOUTS.map(() => 1);
  const text = styles.join(' ');
  for (const [pattern, layout] of STYLE_HINTS) {
    if (pattern.test(text)) weights[COVER_LAYOUTS.indexOf(layout)] += 2.5;
  }
  const total = weights.reduce((a, b) => a + b, 0);
  let r = rng() * total;
  for (let i = 0; i < COVER_LAYOUTS.length; i++) {
    r -= weights[i];
    if (r <= 0) return COVER_LAYOUTS[i];
  }
  return COVER_LAYOUTS[COVER_LAYOUTS.length - 1];
}

interface Frame {
  ctx: Ctx2D;
  S: number;
  /** One thousandth of the size: layouts are authored in a 1000-unit square */
  u: number;
  pal: Palette;
  rng: Rng;
  seed: number;
}

interface TextSpot {
  x: number;
  y: number;
  width: number;
  align: 'left' | 'center' | 'right';
  anchor: 'top' | 'bottom';
  maxSize: number;
  color?: string;
  soft?: string;
  shadow?: boolean;
}

// ---- layouts ------------------------------------------------------------

function layoutWindow({ ctx, S, u, pal, rng, seed }: Frame): TextSpot {
  const wall = mixColor(pal.ink, pal.skyMid, 0.18);
  ctx.fillStyle = wall;
  ctx.fillRect(0, 0, S, S);
  glow(ctx, S * 0.04, S * 0.95, S * 0.9, pal.accent, 0.22);

  const wx = 110 * u;
  const wy = 70 * u;
  const ww = 780 * u;
  const wh = 600 * u;
  ctx.save();
  ctx.beginPath();
  ctx.rect(wx, wy, ww, wh);
  ctx.clip();
  paintSky(ctx, wx, wy, ww, wh, pal, 0.6);
  if (pal.night) paintStars(ctx, seed, wx, wy, ww, wh * 0.5, 90, pal.glow, 0, 0.8);
  const moonLeft = rng() < 0.5;
  paintMoon(ctx, wx + ww * (moonLeft ? 0.24 : 0.74), wy + wh * 0.2, 46 * u, pal.glow, rng() * 0.6, -0.6);
  const far = makeSkyline(rng, wx, wx + ww, 90 * u, 260 * u, u);
  const baseY = wy + wh;
  paintBuildings(ctx, far, baseY - 70 * u, mixColor(pal.haze, pal.skyBottom, 0.45), u);
  paintWindows(ctx, far, baseY - 70 * u, pal.window, u * 0.8, seed, 0.12, 0, 0.4);
  const near = makeSkyline(rng, wx, wx + ww, 120 * u, 330 * u, u * 1.5);
  paintBuildings(ctx, near, baseY + 10 * u, pal.inkSoft, u * 1.5);
  paintWindows(ctx, near, baseY + 10 * u, pal.window, u * 1.4, seed + 1, 0.2, 0, 0.8);
  paintRain(ctx, seed, S, S, 160, 0.3, pal.paper, 0.12, 0.08);
  // City bokeh through wet glass
  const colors = [pal.window, pal.accent, pal.accent2, pal.glow];
  for (let i = 0; i < 26; i++) {
    const r = (18 + rng() * 50) * u;
    bokeh(ctx, wx + rng() * ww, wy + wh * (0.35 + rng() * 0.65), r, colors[i % 4], 0.12 + rng() * 0.25, 0.7);
  }
  // Condensation
  const fog = ctx.createLinearGradient(0, wy + wh * 0.55, 0, wy + wh);
  fog.addColorStop(0, rgba(pal.paper, 0));
  fog.addColorStop(1, rgba(pal.paper, 0.1));
  ctx.fillStyle = fog;
  ctx.fillRect(wx, wy, ww, wh);
  // Droplets on glass
  for (let i = 0; i < 150; i++) {
    const x = wx + rng() * ww;
    const y = wy + rng() * wh;
    const r = (1.5 + rng() * rng() * 7) * u;
    fillCircle(ctx, x, y, r, rgba(pal.ink, 0.25));
    fillCircle(ctx, x - r * 0.3, y - r * 0.3, r * 0.45, rgba(pal.paper, 0.35));
    if (r > 5 * u && rng() < 0.5) {
      ctx.fillStyle = rgba(pal.paper, 0.08);
      ctx.fillRect(x - r * 0.25, y, r * 0.5, (40 + rng() * 140) * u);
    }
  }
  ctx.restore();

  // Frame and mullions
  const frame = mixColor(pal.ink, pal.accent, 0.1);
  const fw = 22 * u;
  ctx.fillStyle = frame;
  ctx.fillRect(wx - fw, wy - fw, ww + fw * 2, fw);
  ctx.fillRect(wx - fw, wy + wh, ww + fw * 2, fw);
  ctx.fillRect(wx - fw, wy - fw, fw, wh + fw * 2);
  ctx.fillRect(wx + ww, wy - fw, fw, wh + fw * 2);
  ctx.fillRect(wx + ww / 2 - fw * 0.4, wy, fw * 0.8, wh);
  ctx.fillRect(wx, wy + wh * 0.42, ww, fw * 0.7);
  // Sill
  const sillY = wy + wh + fw;
  fillRoundRect(ctx, wx - 60 * u, sillY, ww + 120 * u, 26 * u, 6 * u, mixColor(frame, pal.accent, 0.12));
  ctx.fillStyle = rgba(pal.accent, 0.25);
  ctx.fillRect(wx - 60 * u, sillY, ww + 120 * u, 3 * u);
  // Things on the sill
  const plantLeft = rng() < 0.5;
  paintPlant(
    ctx,
    wx + ww * (plantLeft ? 0.1 : 0.9),
    sillY,
    170 * u,
    pal.inkSoft,
    mixColor(pal.accent, pal.ink, 0.5),
    seed,
  );
  if (rng() < 0.55) paintCat(ctx, wx + ww * (plantLeft ? 0.78 : 0.22), sillY, 150 * u, pal.ink, 0.4);
  else {
    const rim = paintMug(ctx, wx + ww * (plantLeft ? 0.8 : 0.2), sillY, 70 * u, mixColor(pal.paper, pal.ink, 0.35));
    paintSteam(ctx, rim.x, rim.y - 6 * u, 90 * u, seed % 7, pal.paper, 0.25);
  }
  return {
    x: 70 * u,
    y: 960 * u,
    width: 860 * u,
    align: 'left',
    anchor: 'bottom',
    maxSize: 74 * u,
    color: pal.paper,
    soft: mixColor(pal.paper, pal.accent, 0.5),
  };
}

function paintPine(ctx: Ctx2D, x: number, baseY: number, h: number, color: string) {
  const w = h * 0.36;
  ctx.fillStyle = color;
  ctx.beginPath();
  for (let i = 0; i < 4; i++) {
    const top = baseY - h + (i * h) / 4.6;
    const bw = w * (0.45 + i * 0.2);
    ctx.moveTo(x, top);
    ctx.lineTo(x + bw / 2, top + h * 0.34);
    ctx.lineTo(x - bw / 2, top + h * 0.34);
    ctx.closePath();
  }
  ctx.rect(x - h * 0.025, baseY - h * 0.15, h * 0.05, h * 0.15);
  ctx.fill();
}

function softStreak(ctx: Ctx2D, x: number, y: number, w: number, h: number, color: string, alpha: number) {
  const g = ctx.createLinearGradient(x, 0, x + w, 0);
  g.addColorStop(0, rgba(color, 0));
  g.addColorStop(0.3, rgba(color, alpha));
  g.addColorStop(0.7, rgba(color, alpha));
  g.addColorStop(1, rgba(color, 0));
  fillRoundRect(ctx, x, y, w, h, h / 2, g);
}

function layoutSunset({ ctx, S, u, pal, rng, seed }: Frame): TextSpot {
  paintSky(ctx, 0, 0, S, S, pal, 0.45);
  if (pal.night) paintStars(ctx, seed, 0, 0, S, S * 0.4, 70, pal.glow, 0, 0.7);
  const variant = Math.floor(rng() * 3); // 0 poles, 1 pines, 2 lake
  const textRight = rng() < 0.5;
  const sunX = S * (textRight ? 0.3 + rng() * 0.15 : 0.55 + rng() * 0.15);
  const sunY = (variant === 2 ? 560 : 470 + rng() * 60) * u;
  const sunR = (150 + rng() * 80) * u;
  paintSun(ctx, sunX, sunY, sunR, pal.glow, pal.accent, 5 + Math.floor(rng() * 3));
  for (let i = 0; i < 6; i++) {
    const cw = (220 + rng() * 380) * u;
    softStreak(
      ctx,
      rng() * S - cw / 3,
      (200 + rng() * 330) * u,
      cw,
      (5 + rng() * 9) * u,
      pal.paper,
      0.1 + rng() * 0.14,
    );
  }
  // Birds
  ctx.strokeStyle = rgba(pal.ink, 0.7);
  ctx.lineWidth = 3 * u;
  ctx.lineCap = 'round';
  const flockX = sunX + (rng() - 0.5) * 300 * u;
  for (let i = 0; i < 3 + Math.floor(rng() * 3); i++) {
    const bx = flockX + (rng() - 0.3) * 180 * u;
    const by = (220 + rng() * 140) * u;
    const s = (7 + rng() * 8) * u;
    ctx.beginPath();
    ctx.moveTo(bx - s, by - s * 0.4);
    ctx.quadraticCurveTo(bx - s * 0.4, by - s * 0.6, bx, by);
    ctx.quadraticCurveTo(bx + s * 0.4, by - s * 0.6, bx + s, by - s * 0.4);
    ctx.stroke();
  }
  const far = mixColor(pal.haze, pal.skyBottom, 0.3);
  if (variant === 2) {
    // Mountains over a lake with a striped reflection
    const water = 700 * u;
    paintRidge(ctx, fbm1d(rng, 4), 0, S, 610 * u, 110 * u, 2.2, water, mixColor(far, pal.ink, 0.35));
    paintRidge(ctx, fbm1d(rng, 3), 0, S, 680 * u, 50 * u, 3.2, water, mixColor(far, pal.ink, 0.6));
    const wg = ctx.createLinearGradient(0, water, 0, S);
    wg.addColorStop(0, mixColor(pal.skyBottom, pal.ink, 0.35));
    wg.addColorStop(1, mixColor(pal.skyMid, pal.ink, 0.7));
    ctx.fillStyle = wg;
    ctx.fillRect(0, water, S, S - water);
    for (let i = 0; i < 14; i++) {
      const k = i / 14;
      const w = sunR * (1.6 - k * 0.9) * (0.7 + rng() * 0.5);
      ctx.fillStyle = rgba(i % 3 ? pal.glow : pal.accent, 0.55 * (1 - k));
      ctx.fillRect(sunX - w / 2 + (rng() - 0.5) * 30 * u, water + 10 * u + i * 20 * u, w, (4 + rng() * 4) * u);
    }
    paintRidge(ctx, fbm1d(rng, 2), 0, S, 960 * u, 20 * u, 1.5, S, pal.ink);
  } else {
    const layers = 4;
    for (let i = 0; i < layers; i++) {
      const k = i / (layers - 1);
      const color = mixColor(far, pal.ink, 0.25 + k * 0.75);
      paintRidge(ctx, fbm1d(rng, 3), 0, S, (650 + i * 92) * u, (62 - i * 6) * u, 1.5 + i * 0.6, S, color);
      if (i === 0) {
        const mist = ctx.createLinearGradient(0, 600 * u, 0, 760 * u);
        mist.addColorStop(0, rgba(pal.skyBottom, 0));
        mist.addColorStop(1, rgba(pal.skyBottom, 0.35));
        ctx.fillStyle = mist;
        ctx.fillRect(0, 600 * u, S, 160 * u);
      }
      if (variant === 1 && i >= 1) {
        const n = 3 + Math.floor(rng() * 5);
        const tone = i === layers - 1 ? pal.ink : mixColor(color, pal.ink, 0.25);
        for (let j = 0; j < n; j++) {
          const h = (60 + rng() * 80) * u * (0.6 + i * 0.25);
          paintPine(ctx, rng() * S, (650 + i * 92 + 30) * u, h, tone);
        }
      }
    }
  }
  if (variant === 0) {
    const poleLeft = !textRight;
    const poles = [S * (poleLeft ? 0.1 : 0.9), S * (poleLeft ? 0.62 : 0.38)];
    const heights = [440 * u, 240 * u];
    const bases = [1000 * u, 830 * u];
    ctx.fillStyle = pal.ink;
    poles.forEach((px, i) => {
      const h = heights[i];
      const b = bases[i];
      const pw = (i === 0 ? 11 : 6) * u;
      ctx.fillRect(px - pw / 2, b - h, pw, h);
      ctx.fillRect(px - h * 0.16, b - h * 0.94, h * 0.32, pw * 0.9);
      ctx.fillRect(px - h * 0.11, b - h * 0.84, h * 0.22, pw * 0.7);
    });
    ctx.strokeStyle = rgba(pal.ink, 0.8);
    ctx.lineWidth = 2 * u;
    for (const off of [-0.15, 0.15]) {
      const x0 = poles[0] + off * heights[0];
      const y0 = bases[0] - heights[0] * 0.94;
      const x1 = poles[1] + off * heights[1];
      const y1 = bases[1] - heights[1] * 0.94;
      const x2 = poleLeft ? S + 20 * u : -20 * u;
      ctx.beginPath();
      ctx.moveTo(poleLeft ? -20 * u : S + 20 * u, y0 + 30 * u);
      ctx.quadraticCurveTo((x0 + (poleLeft ? 0 : S)) / 2, y0 + 45 * u, x0, y0);
      ctx.quadraticCurveTo((x0 + x1) / 2, Math.max(y0, y1) + 50 * u, x1, y1);
      ctx.quadraticCurveTo((x1 + x2) / 2, y1 + 40 * u, x2, y1 + 20 * u);
      ctx.stroke();
    }
  }
  return {
    x: textRight ? 930 * u : 70 * u,
    y: 90 * u,
    width: 600 * u,
    align: textRight ? 'right' : 'left',
    anchor: 'top',
    maxSize: 78 * u,
    shadow: true,
  };
}

function layoutStreet({ ctx, S, u, pal, rng, seed }: Frame): TextSpot {
  paintSky(ctx, 0, 0, S, S * 0.85, pal, 0.6);
  if (pal.night) paintStars(ctx, seed, 0, 0, S, S * 0.55, 140, pal.glow, 0, 0.9);
  const lampRight = rng() < 0.5;
  paintMoon(ctx, S * (lampRight ? 0.22 : 0.78), 190 * u, 40 * u, pal.glow, 0.35 + rng() * 0.4, lampRight ? -0.5 : 0.5);
  const ground = 820 * u;
  const far = makeSkyline(rng, 0, S, 150 * u, 420 * u, u);
  paintBuildings(ctx, far, ground - 30 * u, mixColor(pal.haze, pal.skyMid, 0.35), u);
  paintWindows(ctx, far, ground - 30 * u, pal.window, u * 0.8, seed, 0.18, 0, 0.35);
  const near = makeSkyline(rng, 0, S, 110 * u, 300 * u, u * 1.6);
  paintBuildings(ctx, near, ground, pal.inkSoft, u * 1.6);
  paintWindows(ctx, near, ground, pal.window, u * 1.5, seed + 3, 0.28, 0, 0.85);
  // Haze at the horizon
  const haze = ctx.createLinearGradient(0, ground - 200 * u, 0, ground);
  haze.addColorStop(0, rgba(pal.skyBottom, 0));
  haze.addColorStop(1, rgba(pal.skyBottom, 0.25));
  ctx.fillStyle = haze;
  ctx.fillRect(0, ground - 200 * u, S, 200 * u);
  // Street
  ctx.fillStyle = pal.ink;
  ctx.fillRect(0, ground, S, S - ground);
  ctx.fillStyle = rgba(pal.haze, 0.25);
  ctx.fillRect(0, ground, S, 5 * u);
  for (let i = 0; i < 8; i++) {
    ctx.fillStyle = rgba(pal.paper, 0.08);
    ctx.fillRect(i * 140 * u + 20 * u, 920 * u, 70 * u, 6 * u);
  }
  const lx = S * (lampRight ? 0.74 : 0.26);
  const head = paintStreetLamp(ctx, lx, 900 * u, 560 * u, pal.ink, lampRight ? -1 : 1);
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  paintLightCone(ctx, head.x, head.y, 60 * u, 380 * u, 900 * u - head.y, pal.window, 0.2);
  glow(ctx, head.x, head.y, 180 * u, pal.window, 0.45);
  ctx.restore();
  fillCircle(ctx, head.x, head.y, 9 * u, mixColor(pal.window, '#ffffff', 0.5));
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  ctx.beginPath();
  ctx.ellipse(head.x, 905 * u, 240 * u, 40 * u, 0, 0, TAU);
  const pool = ctx.createRadialGradient(head.x, 905 * u, 0, head.x, 905 * u, 240 * u);
  pool.addColorStop(0, rgba(pal.window, 0.35));
  pool.addColorStop(1, rgba(pal.window, 0));
  ctx.fillStyle = pool;
  ctx.fill();
  ctx.restore();
  if (rng() < 0.7)
    paintCat(ctx, head.x + (lampRight ? -60 : 60) * u, 915 * u, 90 * u, mixColor(pal.ink, '#000000', 0.4), 1);
  if (rng() < 0.5) paintRain(ctx, seed, S, S, 220, 0.6, pal.paper, 0.13, 0.1);
  return {
    x: lampRight ? 70 * u : 930 * u,
    y: 330 * u,
    width: 560 * u,
    align: lampRight ? 'left' : 'right',
    anchor: 'top',
    maxSize: 74 * u,
    shadow: true,
  };
}

function layoutDesk({ ctx, S, u, pal, rng, seed }: Frame): TextSpot {
  const wall = mixColor(pal.ink, pal.skyMid, 0.28);
  const wallG = ctx.createLinearGradient(0, 0, 0, S);
  wallG.addColorStop(0, mixColor(wall, '#000000', 0.25));
  wallG.addColorStop(1, wall);
  ctx.fillStyle = wallG;
  ctx.fillRect(0, 0, S, S);
  const lampLeft = rng() < 0.5;
  // Window on the wall
  const wx = lampLeft ? 520 * u : 90 * u;
  const wy = 90 * u;
  const ww = 390 * u;
  const wh = 420 * u;
  ctx.save();
  ctx.beginPath();
  ctx.rect(wx, wy, ww, wh);
  ctx.clip();
  paintSky(ctx, wx, wy, ww, wh, pal, 0.7);
  if (pal.night) paintStars(ctx, seed, wx, wy, ww, wh * 0.7, 40, pal.glow, 0, 0.9);
  paintMoon(ctx, wx + ww * 0.68, wy + wh * 0.28, 34 * u, pal.glow, 0.5, -0.4);
  const city = makeSkyline(rng, wx, wx + ww, 40 * u, 150 * u, u * 0.8);
  paintBuildings(ctx, city, wy + wh, pal.inkSoft, u * 0.8);
  paintWindows(ctx, city, wy + wh, pal.window, u * 0.6, seed, 0.3, 0, 0.7);
  ctx.restore();
  const frame = mixColor(pal.ink, pal.accent, 0.12);
  ctx.strokeStyle = frame;
  ctx.lineWidth = 16 * u;
  ctx.strokeRect(wx, wy, ww, wh);
  ctx.fillStyle = frame;
  ctx.fillRect(wx + ww / 2 - 5 * u, wy, 10 * u, wh);
  // Desk
  const deskY = 760 * u;
  ctx.fillStyle = mixColor(pal.ink, pal.accent, 0.18);
  ctx.fillRect(0, deskY, S, 24 * u);
  ctx.fillStyle = mixColor(pal.ink, '#000000', 0.2);
  ctx.fillRect(0, deskY + 24 * u, S, S - deskY);
  // Lamp light
  const lampX = lampLeft ? 180 * u : 820 * u;
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  glow(ctx, lampX + (lampLeft ? 120 : -120) * u, deskY - 60 * u, 520 * u, pal.accent, 0.32);
  ctx.restore();
  const bulb = paintDeskLamp(ctx, lampX, deskY, 330 * u, pal.ink, lampLeft ? 1 : -1);
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  paintLightCone(ctx, bulb.x, bulb.y, 40 * u, 360 * u, deskY - bulb.y, pal.window, 0.22);
  glow(ctx, bulb.x, bulb.y, 90 * u, pal.window, 0.7);
  ctx.beginPath();
  ctx.ellipse(bulb.x, deskY + 4 * u, 220 * u, 26 * u, 0, 0, TAU);
  ctx.fillStyle = rgba(pal.window, 0.18);
  ctx.fill();
  ctx.restore();
  // Laptop with a soft screen glow
  const lx = lampLeft ? 470 * u : 530 * u;
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  glow(ctx, lx, deskY - 90 * u, 220 * u, pal.accent2, 0.22);
  ctx.restore();
  ctx.fillStyle = mixColor(pal.ink, '#000000', 0.3);
  ctx.beginPath();
  ctx.moveTo(lx - 150 * u, deskY - 190 * u);
  ctx.lineTo(lx + 110 * u, deskY - 190 * u);
  ctx.lineTo(lx + 140 * u, deskY - 6 * u);
  ctx.lineTo(lx - 120 * u, deskY - 6 * u);
  ctx.closePath();
  ctx.fill();
  fillRoundRect(ctx, lx - 170 * u, deskY - 10 * u, 340 * u, 12 * u, 4 * u, mixColor(pal.ink, pal.haze, 0.2));
  // Books, mug, plant
  const bx = lampLeft ? 800 * u : 200 * u;
  const bookTop = paintBooks(ctx, bx, deskY, 170 * u, [pal.accent, pal.accent2, pal.haze, pal.inkSoft], seed);
  const rim = paintMug(ctx, bx + 10 * u, bookTop, 72 * u, pal.paper, pal.accent);
  paintSteam(ctx, rim.x, rim.y - 8 * u, 120 * u, 1.3, pal.paper, 0.3);
  paintPlant(
    ctx,
    lampLeft ? 940 * u : 60 * u,
    deskY,
    230 * u,
    pal.inkSoft,
    mixColor(pal.accent, pal.ink, 0.45),
    seed + 5,
  );
  return {
    x: lampLeft ? 70 * u : 930 * u,
    y: 90 * u,
    width: 410 * u,
    align: lampLeft ? 'left' : 'right',
    anchor: 'top',
    maxSize: 62 * u,
    color: pal.paper,
    soft: mixColor(pal.paper, pal.accent, 0.5),
  };
}

function layoutAbstract({ ctx, S, u, pal, rng, seed }: Frame): TextSpot {
  const bg = ctx.createLinearGradient(0, 0, S * 0.3, S);
  bg.addColorStop(0, pal.skyTop);
  bg.addColorStop(1, pal.skyMid);
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, S, S);
  const blobs = [pal.skyBottom, pal.accent, pal.accent2, pal.haze];
  for (let i = 0; i < 5; i++) {
    glow(ctx, rng() * S, rng() * S, (350 + rng() * 400) * u, blobs[i % blobs.length], 0.35 + rng() * 0.25);
  }
  const variant = Math.floor(rng() * 3);
  // Big sun / circle
  const cx = S * (0.3 + rng() * 0.4);
  const cy = S * (0.28 + rng() * 0.2);
  const r = (170 + rng() * 90) * u;
  fillCircle(ctx, cx, cy, r, pal.accent);
  if (variant === 0) {
    // Stacked arches
    const ax = S * (rng() < 0.5 ? 0.25 : 0.75);
    for (let i = 0; i < 5; i++) {
      ctx.beginPath();
      ctx.arc(ax, 700 * u, (250 - i * 46) * u, Math.PI, 0);
      ctx.closePath();
      ctx.fillStyle = [pal.accent2, pal.paper, pal.skyBottom, pal.glow, pal.ink][i];
      ctx.fill();
    }
  } else if (variant === 1) {
    // Half circle eclipse + bars
    ctx.save();
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, TAU);
    ctx.clip();
    fillCircle(ctx, cx + r * 0.45, cy + r * 0.2, r, rgba(pal.ink, 0.85));
    ctx.restore();
    for (let i = 0; i < 6; i++) {
      ctx.fillStyle = i % 2 ? pal.accent2 : pal.paper;
      ctx.globalAlpha = 0.85;
      ctx.fillRect((90 + i * 28) * u, (520 + i * 18) * u, 700 * u, 10 * u);
    }
    ctx.globalAlpha = 1;
  } else {
    // Quarter circles grid
    const cell = 110 * u;
    const ox = S * (rng() < 0.5 ? 0.1 : 0.56);
    for (let i = 0; i < 3; i++) {
      for (let j = 0; j < 3; j++) {
        const x = ox + i * cell;
        const y = 340 * u + j * cell;
        const corner = Math.floor(hash3(i, j, seed) * 4);
        ctx.beginPath();
        const px = x + (corner % 2) * cell;
        const py = y + Math.floor(corner / 2) * cell;
        ctx.moveTo(px, py);
        ctx.arc(px, py, cell, (corner * Math.PI) / 2, (corner * Math.PI) / 2 + Math.PI / 2);
        ctx.closePath();
        ctx.fillStyle = [pal.accent2, pal.paper, pal.glow, pal.ink][(i + j) % 4];
        ctx.fill();
      }
    }
  }
  // Dot grid and fine lines
  ctx.fillStyle = rgba(pal.paper, 0.5);
  const dx = S * (rng() < 0.5 ? 0.66 : 0.1);
  for (let i = 0; i < 6; i++)
    for (let j = 0; j < 4; j++) fillCircle(ctx, dx + i * 26 * u, 90 * u + j * 26 * u, 3 * u, rgba(pal.paper, 0.55));
  ctx.strokeStyle = rgba(pal.paper, 0.45);
  ctx.lineWidth = 2 * u;
  ctx.beginPath();
  ctx.moveTo(70 * u, 975 * u);
  ctx.lineTo(930 * u, 975 * u);
  ctx.stroke();
  return {
    x: 70 * u,
    y: 940 * u,
    width: 860 * u,
    align: 'left',
    anchor: 'bottom',
    maxSize: 92 * u,
    shadow: true,
  };
}

function layoutVinyl({ ctx, S, u, pal, rng, seed }: Frame, title: string): TextSpot {
  const bg = ctx.createLinearGradient(0, 0, 0, S);
  bg.addColorStop(0, pal.skyTop);
  bg.addColorStop(1, mixColor(pal.skyMid, pal.ink, 0.3));
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, S, S);
  glow(ctx, S * 0.7, S * 0.35, S * 0.7, pal.accent, 0.25);
  // Stripes on the tabletop / wall
  for (let i = 0; i < 12; i++) {
    ctx.fillStyle = rgba(pal.paper, 0.025 + (i % 2) * 0.02);
    ctx.fillRect(0, i * 90 * u, S, 45 * u);
  }
  const sx = 90 * u;
  const sy = 120 * u;
  const sw = 560 * u;
  const rx = sx + sw * 0.5 + 270 * u + rng() * 40 * u;
  const ry = sy + sw / 2;
  paintRecord(ctx, rx, ry, 265 * u, rng() * TAU, pal.accent, pal.paper);
  // Label text on the record
  ctx.save();
  ctx.fillStyle = rgba(pal.ink, 0.8);
  ctx.font = `700 ${14 * u}px ${MONO}`;
  ctx.textAlign = 'center';
  ctx.fillText(title.slice(0, 16).toUpperCase(), rx, ry - 40 * u);
  ctx.restore();
  // Sleeve with its own mini art
  ctx.save();
  ctx.shadowColor = rgba('#000000', 0.45);
  ctx.shadowBlur = 40 * u;
  ctx.shadowOffsetY = 16 * u;
  fillRoundRect(ctx, sx, sy, sw, sw, 6 * u, pal.paper);
  ctx.restore();
  ctx.save();
  ctx.beginPath();
  ctx.rect(sx + 26 * u, sy + 26 * u, sw - 52 * u, sw - 52 * u);
  ctx.clip();
  const inner = sw - 52 * u;
  const ix = sx + 26 * u;
  const iy = sy + 26 * u;
  const art = Math.floor(rng() * 3);
  if (art === 0) {
    paintSky(ctx, ix, iy, inner, inner, pal, 0.5);
    paintSun(ctx, sx + sw / 2, sy + sw * 0.52, inner * 0.3, pal.glow, pal.accent, 6);
    paintRidge(ctx, fbm1d(rng, 3), sx, sw, sy + sw * 0.72, 30 * u, 2, sy + sw, mixColor(pal.inkSoft, pal.haze, 0.3));
    paintRidge(ctx, fbm1d(rng, 3), sx, sw, sy + sw * 0.84, 24 * u, 3, sy + sw, pal.ink);
    if (pal.night) paintStars(ctx, seed, ix, iy, inner, inner * 0.4, 40, pal.glow, 0, 0.8);
  } else if (art === 1) {
    // Moon over the sea
    paintSky(ctx, ix, iy, inner, inner, { ...pal, skyBottom: pal.skyMid }, 0.6);
    paintStars(ctx, seed, ix, iy, inner, inner * 0.6, 60, pal.glow, 0, 0.9);
    const sea = iy + inner * 0.62;
    paintMoon(ctx, sx + sw * 0.5, sy + sw * 0.36, inner * 0.13, pal.glow, 0, 0);
    ctx.fillStyle = mixColor(pal.ink, pal.skyTop, 0.4);
    ctx.fillRect(ix, sea, inner, inner);
    for (let i = 0; i < 16; i++) {
      const k = i / 16;
      const w = inner * (0.1 + k * 0.4) * (0.6 + rng() * 0.6);
      ctx.fillStyle = rgba(pal.glow, 0.6 * (1 - k * 0.7));
      ctx.fillRect(sx + sw / 2 - w / 2 + (rng() - 0.5) * 16 * u, sea + 6 * u + i * 12 * u, w, 3 * u);
    }
  } else {
    // Concentric colour bands
    ctx.fillStyle = pal.paper;
    ctx.fillRect(ix, iy, inner, inner);
    const bands = [pal.skyTop, pal.skyMid, pal.accent2, pal.skyBottom, pal.accent, pal.glow];
    const ccx = ix + inner * (rng() < 0.5 ? 0 : 1);
    const ccy = iy + inner;
    for (let i = 0; i < bands.length; i++) fillCircle(ctx, ccx, ccy, inner * (1.25 - i * 0.18), bands[i]);
  }
  ctx.restore();
  // Sleeve wear
  ctx.strokeStyle = rgba(pal.ink, 0.12);
  ctx.lineWidth = 3 * u;
  ctx.beginPath();
  ctx.arc(sx + sw / 2, sy + sw / 2, sw * 0.46, 0, TAU);
  ctx.stroke();
  return {
    x: 90 * u,
    y: 780 * u,
    width: 820 * u,
    align: 'left',
    anchor: 'top',
    maxSize: 76 * u,
    color: pal.paper,
    soft: mixColor(pal.paper, pal.accent, 0.5),
  };
}

function layoutCassette({ ctx, S, u, pal, rng, seed }: Frame, title: string): TextSpot {
  const bg = ctx.createRadialGradient(S * 0.5, S * 0.4, 0, S * 0.5, S * 0.4, S * 0.8);
  bg.addColorStop(0, pal.skyMid);
  bg.addColorStop(1, pal.skyTop);
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, S, S);
  // Checker floor / tabletop
  ctx.save();
  ctx.globalAlpha = 0.08;
  for (let i = 0; i < 20; i++) {
    for (let j = 0; j < 20; j++) {
      if ((i + j) % 2) continue;
      ctx.fillStyle = pal.paper;
      ctx.fillRect(i * 50 * u, j * 50 * u, 50 * u, 50 * u);
    }
  }
  ctx.restore();
  if (pal.night) paintStars(ctx, seed, 0, 0, S, S, 50, pal.glow, 0, 0.6);
  const tilt = (rng() - 0.5) * 0.3;
  const cx = S / 2;
  const cy = 420 * u;
  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate(tilt);
  // Tape ribbon spilling out
  ctx.strokeStyle = '#3a2418';
  ctx.lineWidth = 7 * u;
  ctx.beginPath();
  ctx.moveTo(-60 * u, 150 * u);
  ctx.bezierCurveTo(-220 * u, 330 * u, 250 * u, 260 * u, 150 * u, 400 * u);
  ctx.stroke();
  ctx.shadowColor = rgba('#000000', 0.5);
  ctx.shadowBlur = 50 * u;
  ctx.shadowOffsetY = 24 * u;
  fillRoundRect(ctx, -330 * u, -208 * u, 660 * u, 416 * u, 18 * u, pal.ink);
  ctx.shadowColor = 'transparent';
  paintCassette(ctx, 0, 0, 660 * u, pal, rng() * TAU, title.toUpperCase());
  ctx.restore();
  // Sparkles
  for (let i = 0; i < 6; i++) {
    const x = rng() * S;
    const y = rng() * 700 * u;
    const s = (6 + rng() * 10) * u;
    ctx.fillStyle = rgba(pal.glow, 0.7);
    ctx.beginPath();
    ctx.moveTo(x, y - s);
    ctx.lineTo(x + s * 0.25, y);
    ctx.lineTo(x, y + s);
    ctx.lineTo(x - s * 0.25, y);
    ctx.closePath();
    ctx.moveTo(x - s, y);
    ctx.lineTo(x, y + s * 0.25);
    ctx.lineTo(x + s, y);
    ctx.lineTo(x, y - s * 0.25);
    ctx.fill();
  }
  return {
    x: 500 * u,
    y: 950 * u,
    width: 860 * u,
    align: 'center',
    anchor: 'bottom',
    maxSize: 76 * u,
    shadow: true,
  };
}

// ---- typography -----------------------------------------------------------

type TitleFace = 'sans' | 'serif' | 'mono';

function titleFont(face: TitleFace, size: number): string {
  const px = Math.max(6, Math.round(size));
  if (face === 'serif') return `italic 500 ${px}px ${SERIF}`;
  if (face === 'mono') return `600 ${px}px ${MONO}`;
  return `700 ${px}px ${SANS}`;
}

function drawText(ctx: Ctx2D, spot: TextSpot, pal: Palette, face: TitleFace, title: string, artist?: string) {
  const color = spot.color ?? pal.text;
  const soft = spot.soft ?? pal.textSoft;
  const titleText = title.trim() || 'Untitled';
  const maxSize = face === 'mono' ? spot.maxSize * 0.8 : spot.maxSize;
  const { lines, size } = fitLines(
    ctx,
    titleText,
    (s) => titleFont(face, s),
    spot.width,
    maxSize,
    2,
    spot.maxSize * 0.3,
  );
  const lineH = size * 1.08;
  const artistSize = Math.max(8, Math.round(spot.maxSize * 0.3));
  const gap = artist ? artistSize * 1.1 : 0;
  const blockH = lines.length * lineH + (artist ? gap + artistSize : 0);
  let y = spot.anchor === 'top' ? spot.y + size * 0.86 : spot.y - blockH + size * 0.86;

  ctx.save();
  ctx.textAlign = spot.align;
  ctx.textBaseline = 'alphabetic';
  if (spot.shadow) {
    ctx.shadowColor = rgba('#000000', pal.text === pal.ink ? 0.12 : 0.45);
    ctx.shadowBlur = size * 0.35;
    ctx.shadowOffsetY = size * 0.05;
  }
  ctx.fillStyle = color;
  ctx.font = titleFont(face, size);
  setLetterSpacing(ctx, face === 'sans' ? -size * 0.02 : 0);
  for (const line of lines) {
    ctx.fillText(line, spot.x, y);
    y += lineH;
  }
  if (artist) {
    y += gap - lineH + artistSize;
    setLetterSpacing(ctx, artistSize * 0.28);
    const fitted = fitText(ctx, artist.toUpperCase(), (s) => `500 ${s}px ${MONO}`, spot.width, artistSize);
    ctx.font = `500 ${fitted.size}px ${MONO}`;
    ctx.fillStyle = soft;
    ctx.fillText(fitted.text, spot.x, y);
  }
  setLetterSpacing(ctx, 0);
  ctx.restore();
}

// ---- entry points -----------------------------------------------------------

/** Draws a complete square cover at (0, 0)..(size, size) on `ctx`. */
export function drawCover(ctx: Ctx2D, options: CoverOptions): void {
  const S = Math.max(16, options.size);
  const seed = Math.floor(Math.abs(options.seed)) >>> 0;
  const pal = paletteFor(seed, options.mood);
  const layout = options.layout ?? coverLayoutFor(seed, options.styles);
  const rng = createRng((seed * 2654435761) >>> 0);
  const frame: Frame = { ctx, S, u: S / 1000, pal, rng, seed };
  const title = options.title ?? '';

  ctx.save();
  ctx.beginPath();
  ctx.rect(0, 0, S, S);
  ctx.clip();
  let spot: TextSpot;
  switch (layout) {
    case 'window':
      spot = layoutWindow(frame);
      break;
    case 'sunset':
      spot = layoutSunset(frame);
      break;
    case 'street':
      spot = layoutStreet(frame);
      break;
    case 'desk':
      spot = layoutDesk(frame);
      break;
    case 'abstract':
      spot = layoutAbstract(frame);
      break;
    case 'vinyl':
      spot = layoutVinyl(frame, title);
      break;
    default:
      spot = layoutCassette(frame, title);
  }
  paintVignette(ctx, S, S, 0.38, pal.ink);
  paintGrain(ctx, S, S, 0.09, seed);
  if (options.text !== false) {
    const faces: TitleFace[] = ['sans', 'sans', 'serif', 'mono'];
    drawText(ctx, spot, pal, faces[Math.floor(hash3(seed, 77) * faces.length)], title, options.artist?.trim());
  }
  ctx.restore();
}

/** Renders a cover to a PNG blob (default 1400 px, a common streaming-store size). */
export async function renderCover(
  options: Omit<CoverOptions, 'size'> & { size?: number },
  type = 'image/png',
  quality?: number,
): Promise<Blob> {
  const size = Math.round(options.size ?? 1400);
  const canvas = createCanvas(size, size);
  const ctx = canvas && context2d(canvas);
  if (!canvas || !ctx) throw new Error('renderCover: no canvas implementation available');
  drawCover(ctx, { ...options, size });
  return canvasToBlob(canvas, type, quality);
}

/** Synchronous data URL for thumbnails (needs a DOM; returns '' elsewhere). */
export function coverDataUrl(options: Omit<CoverOptions, 'size'>, size = 256): string {
  if (typeof document === 'undefined') return '';
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (!ctx) return '';
  drawCover(ctx, { ...options, size });
  return canvas.toDataURL('image/png');
}

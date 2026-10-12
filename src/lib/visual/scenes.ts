/**
 * Animated, audio-reactive lofi scenes for video export and live previews.
 * `drawScene` is a pure function of its inputs (deterministic in `t`); static
 * layers are cached internally so only moving parts are redrawn per frame.
 */
import { createRng } from '@/lib/music/rng';
import { LayerCache, type Ctx2D } from './canvas';
import { drawCover } from './cover';
import {
  bokeh,
  clamp,
  fbm1d,
  fillCircle,
  fillRoundRect,
  fitLines,
  fitText,
  glow,
  glowSprite,
  hash3,
  makeSkyline,
  mod,
  MONO,
  paintBooks,
  paintBuildings,
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
  paintSun,
  paintVignette,
  paintWindows,
  roundRectPath,
  SANS,
  setLetterSpacing,
  softGlow,
  TAU,
  type Building,
} from './draw';
import { silentFeatures, SPECTRUM_BANDS, type FrameFeatures } from './features';
import { mixColor, paletteFor, rgba, type Mood, type Palette } from './palette';

export const SCENES = [
  { id: 'window', label: 'Rainy window', description: 'City lights through a rain-streaked window' },
  { id: 'city', label: 'Night city', description: 'Skyline, blinking lights and passing car trails' },
  { id: 'room', label: 'Cozy room', description: 'Desk lamp, steaming mug and a moonlit window' },
  { id: 'vinyl', label: 'Vinyl', description: 'A spinning record with the cover as its label' },
  { id: 'visualizer', label: 'Visualizer', description: 'Cover art with a circular spectrum ring' },
] as const;

export type SceneId = (typeof SCENES)[number]['id'];
export const SCENE_IDS: SceneId[] = SCENES.map((s) => s.id);

export function isSceneId(value: unknown): value is SceneId {
  return typeof value === 'string' && (SCENE_IDS as string[]).includes(value);
}

export interface SceneFrame {
  /** Seconds since the start of the song */
  t: number;
  width: number;
  height: number;
  seed: number;
  features: FrameFeatures;
  title: string;
  artist?: string;
  /** Song position 0..1 for the progress bar */
  progress: number;
  /** Cover art for the vinyl label and visualizer; generated from the seed when omitted */
  cover?: CanvasImageSource;
  mood?: Partial<Mood>;
  /** Title, artist and progress bar (default true) */
  overlay?: boolean;
  /** Film grain amount 0..1 (default 0.07) */
  grain?: number;
}

interface State {
  ctx: Ctx2D;
  W: number;
  H: number;
  /** One thousandth of the shorter side */
  u: number;
  portrait: boolean;
  pal: Palette;
  t: number;
  f: FrameFeatures;
  seed: number;
  key: string;
  frame: SceneFrame;
  /** Static foreground painted into the cached overlay layer (saves a full-frame composite) */
  top?: (c: Ctx2D) => void;
}

const layers = new LayerCache(24);
const coverCache = new LayerCache(4);

/** Drops cached layers (e.g. after an export) to free memory. */
export function clearSceneCache() {
  layers.clear();
  coverCache.clear();
}

const imageIds = new WeakMap<object, number>();
let nextImageId = 1;

/** Stable id for a caller-supplied image so cached layers refresh when it changes. */
function imageId(image: CanvasImageSource | undefined): number {
  if (!image) return 0;
  let id = imageIds.get(image);
  if (!id) {
    id = nextImageId++;
    imageIds.set(image, id);
  }
  return id;
}

function layer(s: State, name: string, paint: (c: Ctx2D) => void) {
  layers.draw(s.ctx, `${s.key}:${name}`, 0, 0, s.W, s.H, paint);
}

/** Cached layer covering only a sub-rectangle; `paint` uses frame coordinates. */
function boxLayer(s: State, name: string, x: number, y: number, w: number, h: number, paint: (c: Ctx2D) => void) {
  const bx = Math.max(0, Math.floor(x));
  const by = Math.max(0, Math.floor(y));
  const bw = Math.min(s.W, Math.ceil(x + w)) - bx;
  const bh = Math.min(s.H, Math.ceil(y + h)) - by;
  if (bw <= 0 || bh <= 0) return;
  const canvas = layers.get(`${s.key}:${name}`, bw, bh, (c) => {
    c.translate(-bx, -by);
    paint(c);
  });
  if (canvas) s.ctx.drawImage(canvas, bx, by);
  else paint(s.ctx);
}

function finite(v: number, fallback = 0): number {
  return Number.isFinite(v) ? v : fallback;
}

function sanitizeFeatures(f: FrameFeatures | undefined): FrameFeatures {
  if (!f) return silentFeatures();
  const c = (v: number) => clamp(finite(v), 0, 1);
  const spectrum = f.spectrum?.length === SPECTRUM_BANDS ? f.spectrum : silentFeatures().spectrum;
  return { rms: c(f.rms), bass: c(f.bass), mid: c(f.mid), high: c(f.high), beat: c(f.beat), spectrum };
}

/** Cover art for the scene: the given image or one generated (and cached) from the seed. */
function coverFor(s: State, size: number): CanvasImageSource | null {
  if (s.frame.cover) return s.frame.cover;
  const px = Math.max(64, Math.round(size));
  const key = `${s.seed}:${px}:${s.frame.title}:${s.frame.artist ?? ''}:${JSON.stringify(s.frame.mood ?? null)}`;
  return coverCache.get(key, px, px, (c) =>
    drawCover(c, { size: px, seed: s.seed, title: s.frame.title, artist: s.frame.artist, mood: s.frame.mood }),
  );
}

// ---- window ------------------------------------------------------------------

function windowGeometry(s: State) {
  const { W, H, u, portrait } = s;
  const fw = 28 * u;
  const sill = H * (portrait ? 0.12 : 0.15);
  return { fw, sill, gx: fw, gy: fw, gw: W - fw * 2, gh: H - sill - fw };
}

function sceneWindow(s: State) {
  const { ctx, W, H, u, pal, t, f, seed } = s;
  const g = windowGeometry(s);
  const farBase = g.gy + g.gh * 0.86;
  const rng = createRng(seed ^ 0x3a11);
  const far = makeSkyline(rng, 0, W, g.gh * 0.12, g.gh * 0.42, u * 1.1);
  const near = makeSkyline(rng, 0, W, g.gh * 0.18, g.gh * 0.55, u * 1.6);
  const nearBase = g.gy + g.gh + 20 * u;
  const moonX = W * (hash3(seed, 5) < 0.5 ? 0.24 : 0.74);

  layer(s, 'window-bg', (c) => {
    paintSky(c, 0, 0, W, H, pal, 0.62);
    paintMoon(c, moonX, g.gy + g.gh * 0.18, 50 * u, pal.glow, hash3(seed, 6) * 0.6, -0.6);
    paintBuildings(c, far, farBase, mixColor(pal.haze, pal.skyBottom, 0.45), u * 1.1);
    const haze = c.createLinearGradient(0, farBase - g.gh * 0.3, 0, farBase);
    haze.addColorStop(0, rgba(pal.skyBottom, 0));
    haze.addColorStop(1, rgba(pal.skyBottom, 0.35));
    c.fillStyle = haze;
    c.fillRect(0, farBase - g.gh * 0.3, W, g.gh * 0.3);
    paintBuildings(c, near, nearBase, pal.inkSoft, u * 1.6);
  });
  if (pal.night) paintStars(ctx, seed, 0, 0, W, g.gh * 0.45, Math.round(60 * (W / H + 1)), pal.glow, t, 0.8);
  const lit = pal.night ? 1 : 0.55;
  paintWindows(ctx, far, farBase, pal.window, u * 0.9, seed, 0.12, t, 0.35 * lit);
  paintWindows(ctx, near, nearBase, pal.window, u * 1.5, seed + 1, 0.16, t, (0.6 + 0.35 * f.bass) * lit);

  // Distant rain, heavier with the highs
  paintRain(ctx, seed, W, H, Math.round(90 + 140 * (W / 1920)), t, pal.paper, 0.07 + 0.1 * f.high, 0.1);

  // Out-of-focus lights on wet glass, breathing with the mids
  const colors = [pal.window, pal.accent, pal.accent2, pal.glow];
  const n = Math.round(22 + 22 * (W / H));
  for (let i = 0; i < n; i++) {
    const r = (22 + hash3(seed, i, 21) * 70) * u;
    const x = hash3(seed, i, 22) * W + Math.sin(t * 0.07 + i) * 12 * u;
    const y = g.gy + g.gh * (0.3 + hash3(seed, i, 23) * 0.7) + Math.cos(t * 0.05 + i * 1.7) * 8 * u;
    const breathe = 0.75 + 0.25 * Math.sin(t * (0.3 + hash3(seed, i, 24) * 0.4) + i);
    const a = (0.08 + hash3(seed, i, 25) * 0.2) * breathe * (0.6 + 0.6 * f.mid + 0.3 * f.beat);
    bokeh(ctx, x, y, r, colors[i % 4], a, 0.72);
  }

  layer(s, 'window-beads', (c) => {
    const r2 = createRng(seed ^ 0xbead);
    const count = Math.round((W * H) / 5200);
    for (let i = 0; i < count; i++) {
      const x = r2() * W;
      const y = g.gy + r2() * g.gh;
      const r = (1.4 + r2() * r2() * 7) * u;
      fillCircle(c, x, y + r * 0.3, r, rgba(pal.ink, 0.22));
      fillCircle(c, x, y, r * 0.85, rgba(pal.skyBottom, 0.18));
      fillCircle(c, x - r * 0.3, y - r * 0.3, r * 0.35, rgba(pal.paper, 0.45));
    }
    const fog = c.createLinearGradient(0, g.gy + g.gh * 0.5, 0, g.gy + g.gh);
    fog.addColorStop(0, rgba(pal.paper, 0));
    fog.addColorStop(1, rgba(pal.paper, 0.08));
    c.fillStyle = fog;
    c.fillRect(0, g.gy, W, g.gh);
  });

  // Drips sliding down the glass; more of them when the highs are busy
  const drips = 26;
  const active = 7 + f.high * 19;
  ctx.lineCap = 'round';
  for (let i = 0; i < drips; i++) {
    const vis = clamp(active - i, 0, 1);
    if (vis <= 0) continue;
    const rate = 0.04 + hash3(seed, i, 31) * 0.09;
    const p = mod(t * rate + hash3(seed, i, 32), 1);
    const y = g.gy + Math.pow(p, 1.6) * (g.gh + 40 * u);
    const x = g.gx + hash3(seed, i, 33) * g.gw + Math.sin(p * 9 + i) * 4 * u;
    const r = (3.5 + hash3(seed, i, 34) * 4) * u;
    const trail = Math.min(y - g.gy, (80 + hash3(seed, i, 35) * 220) * u);
    const a = vis * (0.55 + 0.45 * f.high);
    if (trail > 2) {
      const tg = ctx.createLinearGradient(0, y - trail, 0, y);
      tg.addColorStop(0, rgba(pal.paper, 0));
      tg.addColorStop(1, rgba(pal.paper, 0.18 * a));
      ctx.strokeStyle = tg;
      ctx.lineWidth = r * 0.7;
      ctx.beginPath();
      ctx.moveTo(x, y - trail);
      ctx.lineTo(x, y);
      ctx.stroke();
    }
    fillCircle(ctx, x, y + r * 0.3, r, rgba(pal.ink, 0.3 * a));
    fillCircle(ctx, x, y, r * 0.85, rgba(pal.skyBottom, 0.35 * a));
    fillCircle(ctx, x - r * 0.3, y - r * 0.35, r * 0.35, rgba(pal.paper, 0.8 * a));
  }
  if (f.beat > 0.02) {
    ctx.fillStyle = rgba(pal.glow, 0.035 * f.beat);
    ctx.fillRect(0, 0, W, H);
  }

  const catX = W - Math.max(140 * u, W * 0.1) - 210 * u;
  paintCat(ctx, catX, g.gy + g.gh + 4 * u, 170 * u, mixColor(pal.ink, '#000000', 0.3), t * 1.3);
  s.top = (c) => {
    const frame = mixColor(pal.ink, pal.accent, 0.1);
    c.fillStyle = frame;
    c.fillRect(0, 0, W, g.fw);
    c.fillRect(0, 0, g.fw, H);
    c.fillRect(W - g.fw, 0, g.fw, H);
    c.fillRect(0, g.gy + g.gh, W, H - g.gy - g.gh);
    if (!s.portrait) c.fillRect(W / 2 - g.fw * 0.4, 0, g.fw * 0.8, g.gy + g.gh);
    c.fillRect(0, g.gy + g.gh * 0.36, W, g.fw * 0.7);
    // Sill with warm interior light
    const sillY = g.gy + g.gh;
    const sg = c.createLinearGradient(0, sillY, 0, H);
    sg.addColorStop(0, mixColor(frame, pal.accent, 0.14));
    sg.addColorStop(1, mixColor(frame, '#000000', 0.35));
    c.fillStyle = sg;
    c.fillRect(0, sillY, W, H - sillY);
    c.fillStyle = rgba(pal.accent, 0.3);
    c.fillRect(0, sillY, W, Math.max(1, 3 * u));
    glow(c, W * 0.02, H, Math.max(W, H) * 0.55, pal.accent, 0.22);
    const plantX = W - Math.max(140 * u, W * 0.1);
    paintPlant(c, plantX, sillY + 4 * u, 230 * u, pal.ink, mixColor(pal.accent, pal.ink, 0.5), seed);
  };
}

// ---- city ---------------------------------------------------------------------

function sceneCity(s: State) {
  const { ctx, W, H, u, pal, t, f, seed, portrait } = s;
  const horizon = H * (portrait ? 0.58 : 0.6);
  const deck = H * (portrait ? 0.76 : 0.8);
  const rng = createRng(seed ^ 0xc17e);
  const far = makeSkyline(rng, 0, W, H * 0.08, H * (portrait ? 0.24 : 0.3), u);
  const mid = makeSkyline(rng, 0, W, H * 0.1, H * (portrait ? 0.34 : 0.42), u * 1.5);
  const moonX = W * (0.15 + hash3(seed, 3) * 0.7);

  layer(s, 'city-bg', (c) => {
    paintSky(c, 0, 0, W, deck, pal, 0.6);
    c.fillStyle = pal.skyBottom;
    c.fillRect(0, deck - 2, W, H - deck + 2);
    paintMoon(c, moonX, H * 0.16, 44 * u, pal.glow, 0.25 + hash3(seed, 4) * 0.5, -0.5);
    paintBuildings(c, far, horizon + H * 0.08, mixColor(pal.haze, pal.skyMid, 0.35), u);
    const haze = c.createLinearGradient(0, horizon - H * 0.2, 0, deck);
    haze.addColorStop(0, rgba(pal.skyBottom, 0));
    haze.addColorStop(1, rgba(pal.skyBottom, 0.45));
    c.fillStyle = haze;
    c.fillRect(0, horizon - H * 0.2, W, deck - horizon + H * 0.2);
    paintBuildings(c, mid, deck, pal.inkSoft, u * 1.5);
  });
  if (pal.night)
    paintStars(ctx, seed, 0, 0, W, horizon * 0.8, Math.round(90 * (W / H + 1)), pal.glow, t * (1 + f.high), 0.9);
  const lit = pal.night ? 1 : 0.5;
  paintWindows(ctx, far, horizon + H * 0.08, pal.window, u * 0.8, seed + 7, 0.14, t, 0.35 * lit);
  paintWindows(ctx, mid, deck, pal.window, u * 1.4, seed + 8, 0.24, t, (0.55 + 0.4 * f.bass) * lit);

  // Aviation lights on the tallest buildings
  const tall = [...mid].sort((a, b) => b.h - a.h).slice(0, 4);
  tall.forEach((b: Building, i) => {
    const on = mod(t + i * 0.37, 1.6 + i * 0.2) < 0.22;
    const x = b.x + b.w / 2;
    const y = deck - b.h - (b.kind === 'antenna' ? b.h * 0.22 : b.kind === 'step' ? b.h * 0.14 : 0) - 4 * u;
    fillCircle(ctx, x, y, 3 * u, on ? '#ff4d4d' : rgba('#ff4d4d', 0.25));
    if (on) glow(ctx, x, y, 30 * u, '#ff4d4d', 0.5);
  });

  // Water below the bridge with reflections
  layer(s, 'city-water', (c) => {
    const wg = c.createLinearGradient(0, deck, 0, H);
    wg.addColorStop(0, mixColor(pal.skyBottom, pal.ink, 0.55));
    wg.addColorStop(1, mixColor(pal.skyTop, pal.ink, 0.6));
    c.fillStyle = wg;
    c.fillRect(0, deck, W, H - deck);
    // Mirrored skyline, fading with depth
    c.save();
    c.globalAlpha = 0.3;
    c.translate(0, deck * 2);
    c.scale(1, -1);
    paintBuildings(c, mid, deck, mixColor(pal.inkSoft, pal.skyBottom, 0.25), u * 1.5);
    c.restore();
    const fade = c.createLinearGradient(0, deck, 0, H);
    fade.addColorStop(0, rgba(pal.ink, 0));
    fade.addColorStop(0.6, rgba(mixColor(pal.skyTop, pal.ink, 0.6), 0.9));
    fade.addColorStop(1, mixColor(pal.skyTop, pal.ink, 0.6));
    c.fillStyle = fade;
    c.fillRect(0, deck, W, H - deck);
  });
  const refl = Math.round(Math.max(20, (40 * W * (H - deck)) / 2e5));
  for (let i = 0; i < refl; i++) {
    const x = hash3(seed, i, 41) * W;
    const y = deck + 30 * u + hash3(seed, i, 42) * (H - deck - 30 * u);
    const w = (20 + hash3(seed, i, 43) * 80) * u * (1 + 0.4 * Math.sin(t * 1.3 + i));
    const a = (0.1 + 0.2 * hash3(seed, i, 44)) * (0.7 + 0.3 * Math.sin(t * 2.1 + i * 2.3)) * lit;
    ctx.fillStyle = rgba(i % 3 ? pal.window : pal.accent, a * (0.7 + 0.5 * f.bass));
    ctx.fillRect(x - w / 2 + Math.sin(t * 0.8 + i) * 6 * u, y, w, Math.max(1, 3 * u));
  }

  // Bridge deck with car light trails
  const deckH = 26 * u;
  ctx.fillStyle = pal.ink;
  ctx.fillRect(0, deck - deckH, W, deckH + 4 * u);
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  ctx.lineCap = 'round';
  const lanes = [
    { y: deck - deckH * 0.7, dir: 1, color: '#fff3d6' },
    { y: deck - deckH * 0.35, dir: -1, color: '#ff5a4d' },
  ];
  lanes.forEach((lane, li) => {
    for (let i = 0; i < 7; i++) {
      const speed = (0.12 + hash3(seed, i + li * 17, 51) * 0.1) * W;
      const len = (140 + hash3(seed, i + li * 17, 52) * 260) * u;
      const span = W + len * 2 + 200 * u;
      const p = mod(hash3(seed, i + li * 17, 53) * span + t * speed, span) - len;
      const head = lane.dir > 0 ? p : W - p;
      const tail = head - lane.dir * len;
      const g = ctx.createLinearGradient(tail, 0, head, 0);
      g.addColorStop(0, rgba(lane.color, 0));
      g.addColorStop(1, rgba(lane.color, 0.75));
      ctx.strokeStyle = g;
      ctx.lineWidth = 3.5 * u;
      ctx.beginPath();
      ctx.moveTo(tail, lane.y);
      ctx.lineTo(head, lane.y);
      ctx.stroke();
      bokeh(ctx, head, lane.y, 16 * u, lane.color, 0.5, 0.3);
    }
  });
  ctx.restore();
  if (f.beat > 0.02) glow(ctx, W / 2, deck, Math.max(W, H) * 0.6, pal.accent, 0.06 * f.beat);
  s.top = (c) => {
    c.fillStyle = pal.ink;
    c.fillRect(0, deck - deckH - 18 * u, W, 4 * u);
    for (let x = 0; x < W; x += 34 * u) c.fillRect(x, deck - deckH - 18 * u, 3 * u, 18 * u);
    // Lamp posts along the bridge
    for (let x = 60 * u; x < W; x += 420 * u) {
      c.fillRect(x, deck - deckH - 120 * u, 4 * u, 120 * u);
      c.fillRect(x - 10 * u, deck - deckH - 122 * u, 24 * u, 5 * u);
      glow(c, x + 2 * u, deck - deckH - 114 * u, 60 * u, pal.window, 0.45);
    }
  };
}

// ---- room ---------------------------------------------------------------------

function roomGeometry(s: State) {
  const { W, H, portrait } = s;
  const S = Math.min(W, H);
  const deskY = H * (portrait ? 0.7 : 0.74);
  const ww = portrait ? W * 0.72 : S * 0.62;
  const wh = portrait ? H * 0.34 : S * 0.46;
  const wx = W / 2 - ww / 2 + (portrait ? 0 : S * 0.08);
  const wy = deskY - wh - (portrait ? H * 0.1 : S * 0.14);
  return { S, deskY, wx, wy, ww, wh };
}

function sceneRoom(s: State) {
  const { ctx, W, H, u, pal, t, f, seed } = s;
  const g = roomGeometry(s);
  const wide = W > H * 1.4;
  const lampX = wide ? W / 2 - g.S * 0.62 : W * 0.17;
  const plantX = wide ? W / 2 + g.S * 0.66 : W * 0.86;
  const mugX = wide ? W / 2 + g.S * 0.3 : W * 0.62;
  const catX = g.wx + g.ww * 0.72;

  layer(s, 'room-bg', (c) => {
    const wall = mixColor(pal.ink, pal.skyMid, 0.3);
    const wg = c.createLinearGradient(0, 0, 0, g.deskY);
    wg.addColorStop(0, mixColor(wall, '#000000', 0.3));
    wg.addColorStop(1, wall);
    c.fillStyle = wg;
    c.fillRect(0, 0, W, H);
    // Window view
    c.save();
    c.beginPath();
    c.rect(g.wx, g.wy, g.ww, g.wh);
    c.clip();
    paintSky(c, g.wx, g.wy, g.ww, g.wh, pal, 0.7);
    paintMoon(c, g.wx + g.ww * 0.7, g.wy + g.wh * 0.3, 36 * u, pal.glow, 0.45, -0.4);
    const rng = createRng(seed ^ 0x5007);
    const city = makeSkyline(rng, g.wx, g.wx + g.ww, g.wh * 0.1, g.wh * 0.38, u * 0.9);
    paintBuildings(c, city, g.wy + g.wh, pal.inkSoft, u * 0.9);
    paintWindows(c, city, g.wy + g.wh, pal.window, u * 0.7, seed, 0.3, 0, pal.night ? 0.75 : 0.4);
    c.restore();
    // Poster on the wall
    if (wide) {
      const px = g.wx + g.ww + g.S * 0.14;
      const py = g.wy + g.wh * 0.08;
      const ps = g.S * 0.22;
      fillRoundRect(
        c,
        px - 8 * u,
        py - 8 * u,
        ps + 16 * u,
        ps * 1.3 + 16 * u,
        4 * u,
        mixColor(pal.ink, pal.accent, 0.1),
      );
      c.save();
      c.beginPath();
      c.rect(px, py, ps, ps * 1.3);
      c.clip();
      paintSky(c, px, py, ps, ps * 1.3, pal, 0.5);
      paintSun(c, px + ps / 2, py + ps * 0.7, ps * 0.28, pal.glow, pal.accent, 5);
      paintRidge(c, fbm1d(createRng(seed + 9), 3), px, ps, py + ps * 0.95, 10 * u, 2, py + ps * 1.3, pal.ink);
      c.restore();
    }
    // Desk
    c.fillStyle = mixColor(pal.ink, pal.accent, 0.2);
    c.fillRect(0, g.deskY, W, 22 * u);
    const dg = c.createLinearGradient(0, g.deskY, 0, H);
    dg.addColorStop(0, mixColor(pal.ink, '#000000', 0.1));
    dg.addColorStop(1, mixColor(pal.ink, '#000000', 0.45));
    c.fillStyle = dg;
    c.fillRect(0, g.deskY + 22 * u, W, H - g.deskY);
  });
  // Rain and stars in the window
  ctx.save();
  ctx.beginPath();
  ctx.rect(g.wx, g.wy, g.ww, g.wh);
  ctx.clip();
  if (pal.night) paintStars(ctx, seed, g.wx, g.wy, g.ww, g.wh * 0.5, 40, pal.glow, t, 0.9);
  ctx.translate(g.wx, g.wy);
  paintRain(ctx, seed, g.ww, g.wh, 50, t * 0.8, pal.paper, 0.12 + 0.1 * f.high, 0.12);
  ctx.restore();
  boxLayer(s, 'room-window-frame', g.wx - 40 * u, g.wy - 20 * u, g.ww + 80 * u, g.wh + 50 * u, (c) => {
    const frame = mixColor(pal.ink, pal.accent, 0.12);
    c.strokeStyle = frame;
    c.lineWidth = 18 * u;
    c.strokeRect(g.wx, g.wy, g.ww, g.wh);
    c.fillStyle = frame;
    c.fillRect(g.wx + g.ww / 2 - 5 * u, g.wy, 10 * u, g.wh);
    c.fillRect(g.wx - 30 * u, g.wy + g.wh, g.ww + 60 * u, 16 * u);
  });
  paintCat(ctx, catX, g.wy + g.wh, 120 * u, mixColor(pal.ink, '#000000', 0.35), t * 1.1);

  // Fairy lights across the top, twinkling on the beat
  const bulbs = Math.round(W / (70 * u));
  const sag = H * 0.05;
  ctx.strokeStyle = rgba(pal.ink, 0.8);
  ctx.lineWidth = 2 * u;
  ctx.beginPath();
  for (let i = 0; i <= 60; i++) {
    const k = i / 60;
    const y = H * 0.07 + Math.sin(k * Math.PI * 3) ** 2 * sag;
    if (i === 0) ctx.moveTo(k * W, y);
    else ctx.lineTo(k * W, y);
  }
  ctx.stroke();
  const bulbColors = [pal.window, pal.accent, pal.accent2, pal.glow];
  for (let i = 0; i < bulbs; i++) {
    const k = (i + 0.5) / bulbs;
    const x = k * W;
    const y = H * 0.07 + Math.sin(k * Math.PI * 3) ** 2 * sag + 6 * u;
    const tw = 0.6 + 0.4 * Math.sin(t * (1 + hash3(seed, i, 61)) + i * 1.9);
    const a = clamp(tw * (0.5 + 0.35 * f.mid) + f.beat * 0.4 * hash3(seed, i, 62), 0, 1);
    const color = bulbColors[i % 4];
    bokeh(ctx, x, y, 34 * u, color, a * 0.55, 0.25);
    fillCircle(ctx, x, y, 4.5 * u, mixColor(color, '#ffffff', 0.4));
  }

  // Lamp glow, pulsing with the bass
  const lampSize = g.S * 0.42;
  const pulse = 0.75 + 0.35 * f.bass + 0.15 * f.beat;
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  softGlow(ctx, lampX + lampSize * 0.3, g.deskY - lampSize * 0.4, g.S * 0.8, pal.accent, 0.3 * pulse);
  ctx.restore();
  boxLayer(s, 'room-props', 0, g.deskY - 340 * u, W, 360 * u, (c) => {
    // Laptop
    const lx = wide ? W / 2 - g.S * 0.12 : W * 0.4;
    c.fillStyle = mixColor(pal.ink, '#000000', 0.3);
    c.beginPath();
    c.moveTo(lx - 150 * u, g.deskY - 180 * u);
    c.lineTo(lx + 110 * u, g.deskY - 180 * u);
    c.lineTo(lx + 140 * u, g.deskY - 6 * u);
    c.lineTo(lx - 120 * u, g.deskY - 6 * u);
    c.closePath();
    c.fill();
    fillRoundRect(c, lx - 170 * u, g.deskY - 10 * u, 340 * u, 12 * u, 4 * u, mixColor(pal.ink, pal.haze, 0.2));
    const top = paintBooks(c, mugX, g.deskY, 190 * u, [pal.accent, pal.accent2, pal.haze, pal.inkSoft], seed);
    paintMug(c, mugX + 12 * u, top, 80 * u, pal.paper, pal.accent);
  });
  const bulb = paintDeskLamp(ctx, lampX, g.deskY, lampSize, pal.ink, 1);
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  paintLightCone(ctx, bulb.x, bulb.y, 40 * u, lampSize * 1.2, g.deskY - bulb.y, pal.window, 0.2 * pulse);
  bokeh(ctx, bulb.x, bulb.y, 110 * u, pal.window, 0.8 * pulse, 0.15);
  ctx.restore();
  // Steam from the mug
  const books = paintBooksHeight(seed, 190 * u);
  paintSteam(ctx, mugX + 12 * u, g.deskY - books - 80 * u * 0.8 - 6 * u, 150 * u, t, pal.paper, 0.28);
  paintPlant(
    ctx,
    plantX,
    g.deskY + 4 * u,
    300 * u,
    pal.inkSoft,
    mixColor(pal.accent, pal.ink, 0.45),
    seed + 3,
    Math.sin(t * 0.6) * 0.03 + f.mid * 0.02,
  );
}

/** Height of the `paintBooks` stack for a seed, without drawing. */
function paintBooksHeight(seed: number, size: number): number {
  const count = 2 + Math.floor(hash3(seed, 3) * 3);
  let h = 0;
  for (let i = 0; i < count; i++) h += size * (0.1 + hash3(seed, i, 2) * 0.07);
  return h;
}

// ---- vinyl -----------------------------------------------------------------------

function sceneVinyl(s: State) {
  const { ctx, W, H, u, pal, t, f, seed, portrait } = s;
  const S = Math.min(W, H);
  const wide = W > H * 1.4;
  const R = S * (portrait ? 0.4 : wide ? 0.36 : 0.33);
  const cx = wide ? W * 0.46 : W / 2;
  const cy = portrait ? H * 0.42 : wide ? H * 0.47 : H * 0.44;

  layer(s, 'vinyl-bg', (c) => {
    const bg = c.createLinearGradient(0, 0, W, H);
    bg.addColorStop(0, mixColor(pal.ink, pal.skyMid, 0.35));
    bg.addColorStop(1, mixColor(pal.ink, '#000000', 0.3));
    c.fillStyle = bg;
    c.fillRect(0, 0, W, H);
    // Wood grain
    const rng = createRng(seed ^ 0x3009);
    for (let i = 0; i < 70; i++) {
      c.strokeStyle = rgba(i % 2 ? pal.accent : '#000000', 0.03 + rng() * 0.03);
      c.lineWidth = (1 + rng() * 3) * u;
      c.beginPath();
      const y0 = rng() * H;
      c.moveTo(0, y0);
      c.bezierCurveTo(W * 0.3, y0 + (rng() - 0.5) * 40 * u, W * 0.7, y0 + (rng() - 0.5) * 40 * u, W, y0);
      c.stroke();
    }
    // Light beam from the top-left
    c.save();
    c.globalCompositeOperation = 'lighter';
    const beam = c.createLinearGradient(0, 0, W * 0.6, H);
    beam.addColorStop(0, rgba(pal.glow, 0.14));
    beam.addColorStop(1, rgba(pal.glow, 0));
    c.fillStyle = beam;
    c.beginPath();
    c.moveTo(W * 0.05, 0);
    c.lineTo(W * 0.35, 0);
    c.lineTo(W * 0.85, H);
    c.lineTo(W * 0.3, H);
    c.closePath();
    c.fill();
    c.restore();
    // Platter shadow and rim
    c.save();
    c.shadowColor = rgba('#000000', 0.55);
    c.shadowBlur = 60 * u;
    c.shadowOffsetY = 24 * u;
    fillCircle(c, cx, cy, R * 1.06, '#1b1a1f');
    c.restore();
    const rim = c.createLinearGradient(cx - R, cy - R, cx + R, cy + R);
    rim.addColorStop(0, '#6b6870');
    rim.addColorStop(0.5, '#2c2a30');
    rim.addColorStop(1, '#8a868f');
    fillCircle(c, cx, cy, R * 1.06, rim);
    fillCircle(c, cx, cy, R * 1.035, '#141317');
  });
  // Strobe dots on the platter edge, rotating with the record
  const angle = t * ((33.333 / 60) * TAU);
  ctx.fillStyle = rgba('#d8d2c8', 0.5);
  for (let i = 0; i < 90; i++) {
    const a = angle + (i / 90) * TAU;
    ctx.fillRect(cx + Math.cos(a) * R * 1.047 - u, cy + Math.sin(a) * R * 1.047 - u, 2.2 * u, 2.2 * u);
  }
  layers.draw(ctx, `${s.key}:vinyl-record`, cx - R, cy - R, Math.ceil(R * 2), Math.ceil(R * 2), (c) =>
    paintRecord(c, R, R, R, 0, 'rgba(0,0,0,0)', 'rgba(0,0,0,0)', null),
  );
  // Label: the cover art spinning
  const lr = R * 0.34;
  const label = coverFor(s, lr * 2.2);
  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate(angle);
  ctx.beginPath();
  ctx.arc(0, 0, lr, 0, TAU);
  ctx.clip();
  if (label) ctx.drawImage(label, -lr, -lr, lr * 2, lr * 2);
  else {
    ctx.fillStyle = pal.accent;
    ctx.fillRect(-lr, -lr, lr * 2, lr * 2);
    ctx.fillStyle = pal.paper;
    ctx.fillRect(-lr, -lr * 0.15, lr * 2, lr * 0.3);
  }
  ctx.fillStyle = rgba('#ffffff', 0.12);
  ctx.fillRect(lr * 0.55, -lr * 0.02, lr * 0.4, lr * 0.04);
  ctx.restore();
  fillCircle(ctx, cx, cy, Math.max(2, R * 0.022), '#d9d4cc');
  // Bass glow around the platter
  if (f.bass > 0.05) {
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.strokeStyle = rgba(pal.accent, 0.12 * f.bass + 0.1 * f.beat);
    ctx.lineWidth = 10 * u;
    ctx.beginPath();
    ctx.arc(cx, cy, R * 1.09, 0, TAU);
    ctx.stroke();
    ctx.restore();
  }

  // Tonearm: pivot top-right, tracks inwards over the song
  const px = cx + R * 1.2;
  const py = cy - R * 0.95;
  const armLen = R * 1.55;
  const startA = Math.PI * 0.62;
  const endA = Math.PI * 0.74;
  const p = clamp(finite(s.frame.progress), 0, 1);
  const wobble = Math.sin(t * 3.5) * 0.002 + f.bass * 0.003;
  const a = startA + (endA - startA) * p + wobble;
  const hx = px + Math.cos(a) * armLen;
  const hy = py + Math.sin(a) * armLen;
  ctx.save();
  ctx.shadowColor = rgba('#000000', 0.5);
  ctx.shadowBlur = 16 * u;
  ctx.shadowOffsetY = 10 * u;
  ctx.strokeStyle = '#c9c4bb';
  ctx.lineCap = 'round';
  ctx.lineWidth = 9 * u;
  ctx.beginPath();
  ctx.moveTo(px, py);
  ctx.lineTo(hx, hy);
  ctx.stroke();
  ctx.translate(hx, hy);
  ctx.rotate(a + 0.5);
  fillRoundRect(ctx, -14 * u, -24 * u, 28 * u, 58 * u, 6 * u, '#2a282e');
  ctx.restore();
  fillCircle(ctx, px, py, 34 * u, '#3a383f');
  fillCircle(ctx, px, py, 18 * u, '#9a958e');
  fillRoundRect(ctx, px + 20 * u, py - 70 * u, 26 * u, 60 * u, 6 * u, '#2a282e');

  // Dust drifting through the light
  for (let i = 0; i < 60; i++) {
    const x = mod(hash3(seed, i, 71) * W + t * (6 + hash3(seed, i, 72) * 14) * u, W);
    const y = mod(hash3(seed, i, 73) * H - t * (4 + hash3(seed, i, 74) * 10) * u, H);
    const tw = 0.5 + 0.5 * Math.sin(t * (0.5 + hash3(seed, i, 75)) + i);
    const r = (1 + hash3(seed, i, 76) * 2.2) * u;
    fillCircle(ctx, x, y, r, rgba(pal.glow, (0.15 + 0.35 * tw) * (0.7 + 0.5 * f.high)));
  }
}

// ---- visualizer ---------------------------------------------------------------------

function sceneVisualizer(s: State) {
  const { ctx, W, H, u, pal, t, f, seed, portrait } = s;
  const S = Math.min(W, H);
  const size = S * (portrait ? 0.44 : 0.36);
  const cx = W / 2;
  const cy = H * (portrait ? 0.42 : 0.44);
  const cover = coverFor(s, size);

  layer(s, 'viz-bg', (c) => {
    c.fillStyle = pal.skyTop;
    c.fillRect(0, 0, W, H);
    if (cover) {
      // Blurred backdrop: scale the cover down to 48 px (a cheap blur), then back up;
      // a real blur filter smooths the result where supported. Painted once and cached.
      const tiny = layers.get(`${s.key}:viz-tiny`, 48, 48, (tc) => tc.drawImage(cover, 0, 0, 48, 48));
      const side = Math.max(W, H) * 1.15;
      c.globalAlpha = 0.85;
      c.imageSmoothingEnabled = true;
      if ('filter' in c) c.filter = `blur(${Math.round(side / 60)}px)`;
      c.drawImage(tiny ?? cover, (W - side) / 2, (H - side) / 2, side, side);
      if ('filter' in c) c.filter = 'none';
      c.globalAlpha = 1;
    }
    c.fillStyle = rgba(pal.ink, 0.55);
    c.fillRect(0, 0, W, H);
    glow(c, cx, cy, S * 0.9, pal.accent, 0.18);
  });

  // Particles drifting outwards; brighter and bigger with energy
  const ringR = size * 0.76;
  const count = 110;
  for (let i = 0; i < count; i++) {
    const speed = 0.04 + hash3(seed, i, 81) * 0.08;
    const p = mod(hash3(seed, i, 82) + t * speed, 1);
    const ang = hash3(seed, i, 83) * TAU + Math.sin(t * 0.2 + i) * 0.05;
    const dist = ringR * (1 + p * 1.4 * (Math.max(W, H) / S));
    const x = cx + Math.cos(ang) * dist;
    const y = cy + Math.sin(ang) * dist;
    const a = Math.sin(p * Math.PI) * (0.25 + 0.5 * f.rms + 0.3 * f.beat);
    fillCircle(
      ctx,
      x,
      y,
      (1.2 + hash3(seed, i, 84) * 2.8) * u * (1 + f.beat * 0.6),
      rgba(i % 5 ? pal.glow : pal.accent, a),
    );
  }

  // Spectrum ring (mirrored so it is symmetric left/right)
  const half = 48;
  const bars = half * 2;
  const maxLen = size * 0.3;
  const beatScale = 1 + f.beat * 0.035;
  ctx.save();
  ctx.lineCap = 'round';
  ctx.lineWidth = Math.max(2, ((TAU * ringR) / bars) * 0.34);
  const glowColor = mixColor(pal.accent, pal.glow, 0.3);
  for (const pass of [0, 1]) {
    ctx.strokeStyle =
      pass === 0 ? rgba(glowColor, 0.16 + 0.12 * f.beat) : rgba(mixColor(pal.glow, '#ffffff', 0.2), 0.92);
    if (pass === 0) ctx.lineWidth *= 2.6;
    else ctx.lineWidth /= 2.6;
    ctx.beginPath();
    for (let i = 0; i < bars; i++) {
      // Interpolate the 32 bands across each half of the ring
      const k = ((i < half ? i : bars - 1 - i) / (half - 1)) * (SPECTRUM_BANDS - 1);
      const k0 = Math.floor(k);
      const k1 = Math.min(SPECTRUM_BANDS - 1, k0 + 1);
      const v = (f.spectrum[k0] ?? 0) * (1 - (k - k0)) + (f.spectrum[k1] ?? 0) * (k - k0);
      const ang = -Math.PI / 2 + ((i + 0.5) / bars) * TAU;
      const r0 = ringR * beatScale;
      const len = 4 * u + v * v * maxLen;
      const cos = Math.cos(ang);
      const sin = Math.sin(ang);
      ctx.moveTo(cx + cos * r0, cy + sin * r0);
      ctx.lineTo(cx + cos * (r0 + len), cy + sin * (r0 + len));
    }
    ctx.stroke();
  }
  ctx.restore();
  ctx.strokeStyle = rgba(pal.paper, 0.18 + 0.2 * f.rms);
  ctx.lineWidth = 2 * u;
  ctx.beginPath();
  ctx.arc(cx, cy, ringR * beatScale - 12 * u, 0, TAU);
  ctx.stroke();

  // Cover with a soft shadow (cached), gently pulsing on the beat
  const pad = size * 0.2;
  const card = layers.get(`${s.key}:viz-card:${Math.round(size)}`, size + pad * 2, size + pad * 2, (c) => {
    c.save();
    c.shadowColor = rgba('#000000', 0.6);
    c.shadowBlur = size * 0.08;
    c.shadowOffsetY = size * 0.03;
    fillRoundRect(c, pad, pad, size, size, size * 0.04, pal.ink);
    c.restore();
    c.save();
    c.beginPath();
    roundRectPath(c, pad, pad, size, size, size * 0.04);
    c.clip();
    if (cover) c.drawImage(cover, pad, pad, size, size);
    c.restore();
  });
  const scale = 1 + f.beat * 0.02 + f.bass * 0.01;
  const drawn = (size + pad * 2) * scale;
  if (card) ctx.drawImage(card, cx - drawn / 2, cy - drawn / 2, drawn, drawn);
  else {
    fillRoundRect(ctx, cx - size / 2, cy - size / 2, size, size, size * 0.04, pal.ink);
    if (cover) ctx.drawImage(cover, cx - size / 2, cy - size / 2, size, size);
  }
}

// ---- overlay ------------------------------------------------------------------------

function paintOverlayStatic(c: Ctx2D, s: State, centered: boolean) {
  const { W, H, u, pal } = s;
  const scrimH = H * 0.32;
  const sg = c.createLinearGradient(0, H - scrimH, 0, H);
  sg.addColorStop(0, rgba('#000000', 0));
  sg.addColorStop(1, rgba('#000000', 0.42));
  c.fillStyle = sg;
  c.fillRect(0, H - scrimH, W, scrimH);
  paintVignette(c, W, H, 0.42, mixColor(pal.ink, '#000000', 0.5));
  // Static grain baked into the cached overlay: filmic texture at no per-frame cost.
  paintGrain(c, W, H, clamp(finite(s.frame.grain ?? 0.07), 0, 1), s.seed);
  if (s.frame.overlay === false) return;
  const pad = 64 * u;
  const barY = H - pad * 0.9;
  const artistSize = Math.round(19 * u);
  const maxTitle = Math.round((s.portrait ? 52 : 46) * u);
  const width = centered ? W - pad * 2 : Math.min(W - pad * 2, 1100 * u);
  c.save();
  c.textAlign = centered ? 'center' : 'left';
  c.textBaseline = 'alphabetic';
  const x = centered ? W / 2 : pad;
  const title = s.frame.title.trim() || 'Untitled';
  const artist = s.frame.artist?.trim();
  const { lines, size } = fitLines(c, title, (px) => `700 ${Math.round(px)}px ${SANS}`, width, maxTitle, 2, 14 * u);
  let y = barY - 26 * u - (artist ? artistSize * 1.9 : 0) - (lines.length - 1) * size * 1.1;
  c.shadowColor = rgba('#000000', 0.5);
  c.shadowBlur = 18 * u;
  c.fillStyle = pal.paper;
  c.font = `700 ${Math.round(size)}px ${SANS}`;
  setLetterSpacing(c, -size * 0.015);
  for (const line of lines) {
    c.fillText(line, x, y);
    y += size * 1.1;
  }
  if (artist) {
    setLetterSpacing(c, artistSize * 0.3);
    const fitted = fitText(c, artist.toUpperCase(), (px) => `500 ${px}px ${MONO}`, width, artistSize);
    c.font = `500 ${fitted.size}px ${MONO}`;
    c.fillStyle = mixColor(pal.paper, pal.accent, 0.45);
    c.fillText(fitted.text, x, y - size * 1.1 + artistSize * 1.9);
  }
  setLetterSpacing(c, 0);
  c.restore();
  fillRoundRect(c, pad, barY, W - pad * 2, Math.max(2, 4 * u), 2 * u, rgba(pal.paper, 0.16));
}

function paintProgress(s: State) {
  if (s.frame.overlay === false) return;
  const { ctx, W, H, u, pal } = s;
  const pad = 64 * u;
  const barY = H - pad * 0.9;
  const p = clamp(finite(s.frame.progress), 0, 1);
  const h = Math.max(2, 4 * u);
  if (p > 0) fillRoundRect(ctx, pad, barY, Math.max(h, (W - pad * 2) * p), h, 2 * u, rgba(pal.accent, 0.9));
  const sprite = glowSprite(pal.accent, 0.3);
  if (sprite && p > 0) {
    ctx.globalAlpha = 0.5 + 0.4 * s.f.beat;
    ctx.drawImage(sprite, pad + (W - pad * 2) * p - 14 * u, barY + h / 2 - 14 * u, 28 * u, 28 * u);
    ctx.globalAlpha = 1;
  }
}

// ---- entry point ----------------------------------------------------------------------

/** Draws one frame of `sceneId` filling (0, 0)..(width, height). */
export function drawScene(ctx: Ctx2D, sceneId: SceneId, frame: SceneFrame): void {
  const W = Math.max(16, Math.round(finite(frame.width, 16)));
  const H = Math.max(16, Math.round(finite(frame.height, 16)));
  const seed = Math.floor(Math.abs(finite(frame.seed))) >>> 0;
  const pal = paletteFor(seed, frame.mood);
  const moodKey = frame.mood ? `${frame.mood.valence}/${frame.mood.energy}/${frame.mood.brightness}` : '-';
  const s: State = {
    ctx,
    W,
    H,
    u: Math.min(W, H) / 1000,
    portrait: H > W * 1.15,
    pal,
    t: Math.max(0, finite(frame.t)),
    f: sanitizeFeatures(frame.features),
    seed,
    key: `${sceneId}:${seed}:${W}x${H}:${moodKey}:${imageId(frame.cover)}`,
    frame,
  };
  ctx.save();
  ctx.beginPath();
  ctx.rect(0, 0, W, H);
  ctx.clip();
  switch (sceneId) {
    case 'window':
      sceneWindow(s);
      break;
    case 'city':
      sceneCity(s);
      break;
    case 'room':
      sceneRoom(s);
      break;
    case 'vinyl':
      sceneVinyl(s);
      break;
    default:
      sceneVisualizer(s);
  }
  const centered = sceneId === 'visualizer' || (sceneId === 'vinyl' && s.portrait);
  const textKey = `${frame.overlay === false ? 0 : 1}:${frame.title}:${frame.artist ?? ''}:${centered}:${frame.grain ?? ''}`;
  layer(s, `overlay:${textKey}`, (c) => {
    s.top?.(c);
    paintOverlayStatic(c, s, centered);
  });
  paintProgress(s);
  ctx.restore();
}

/** A representative still (for thumbnails and previews) at a given time with silent features. */
export function drawScenePreview(
  ctx: Ctx2D,
  sceneId: SceneId,
  options: Omit<SceneFrame, 't' | 'features' | 'progress'> & { t?: number; progress?: number },
): void {
  const f = silentFeatures();
  f.rms = 0.5;
  f.bass = 0.5;
  f.mid = 0.45;
  f.high = 0.35;
  for (let i = 0; i < SPECTRUM_BANDS; i++) f.spectrum[i] = 0.75 * Math.exp(-i / 14) * (0.8 + 0.2 * Math.sin(i * 1.7));
  drawScene(ctx, sceneId, { t: 12, progress: 0.35, ...options, features: f });
}

# What changed (rebuild)

Rebuilt from the original project. The goal was more lofi drums, less repetition,
and a phone-friendly studio. Everything else is untouched.

## 1. Why it repeated, and what was fixed

The drum instruments were synthesis-only: `kick`, `snare`, `hat`… were each built
live from oscillators and noise, so every beat reused the same three timbres. The
lofi generator also drew from a tiny palette — 5 grooves, 9 progressions, 1 kit.

Measured across 60 seeds, generating lofi beats:

|                                   | before | after |
| --------------------------------- | ------ | ----- |
| distinct drum lineups             | 1      | 10    |
| distinct kick/snare/hat skeletons | 30     | 45    |
| grooves for lofi                  | 5      | 28    |
| progressions for lofi             | 9      | 21    |
| drum samples                      | 0      | 252   |

## 2. Six new lofi drum instruments

`Deep Kick`, `Tape Kick`, `Vinyl Snare`, `Airy Hat`, `Long Open Hat` and
`Soft Shaker` join the kit, so the instrument picker and generated beats have
new sounds to draw on. Each is a full instrument: catalogue entry, voice (sample

- synthesis fallback), mixer defaults and generator role. They are wired into the
  lofi kit lineups, so a fresh beat can come out with any of them.

Files: `src/lib/project/instruments.ts`, `src/lib/audio/instruments/drums.ts`,
`src/lib/audio/instruments/index.ts`, `src/lib/generate/generators.ts`,
`src/lib/generate/song.ts`.

## 3. A 252-sample built-in drum kit

- **`tools/gen_drums.py`** — deterministic Python + numpy generator for 252 lofi
  one-shots (24 kicks, 24 snares, 24 hats, 16 each of open hats/rims/shakers/
  toms/claps, 12 crashes, plus 16/16/16/16/12/12 for the six new voices), each
  given a dusty tape character. Run: `python3 tools/gen_drums.py public/drums`.
- **`public/drums/`** — the generated WAVs (~3.3 MB) plus `manifest.json`.
- **`src/lib/audio/drumkit.ts`** — fetches and decodes the kit into a
  context-free buffer bank shared by live playback and exports.
- Drum voices play a sampled variant when the kit is loaded and fall back to
  synthesis when it is not. The variant is fixed per track (a stable seed from
  the track id), so a song keeps one kick/snare/hat character while the next song
  gets a different kit, and exports match playback.

## 4. Startup no longer waits on the samples

The kit is fetched **in the background**. The previous attempt made the studio
await all 124 sample downloads before it would render, which on a phone meant a
stalled splash screen — that is almost certainly why the app felt broken. Now the
voices simply use synthesis until the kit arrives.

Files: `src/components/studio/bootstrap.ts`.

## 5. Mobile fixes

- **Safe areas.** The viewport is declared `viewport-fit: cover` but nothing
  accounted for it, so on notched phones the top bar and bottom controls sat
  under the system UI. The studio shell now pads by
  `env(safe-area-inset-*)`. Files: `src/app/globals.css`,
  `src/components/studio/Studio.tsx`.
- **Tappable step grid.** The step pads were 26 px wide on phones; they are now
  34 px (the grid already scrolls horizontally). Files:
  `src/components/studio/Sequencer.tsx`.
- **Offline caching** of `/drums/` in the service worker (cache-first), so the
  kit works offline. File: `public/sw.js`.

## 6. Tests

- `src/lib/audio/drumkit.test.ts` (new) — loads the real kit through a mocked
  fetch/decoder, checks every pool (including the new voices), that drums play a
  decoded sample once loaded, and that the per-track variant is deterministic.
- `src/lib/generate/generators.test.ts` — accepts any of a genre's `kits` and
  validates them; the kept-kick test now recognises any kick-role instrument.

## Verifying

```bash
npm install
npm run dev            # http://localhost:3000
npm run check          # lint + typecheck + format + unit tests
npm run build
```

`npm run check` passes: lint, typecheck and formatting are clean, and the unit
suite passes apart from two failures that are pre-existing in this environment
(the jsdom-based tests, and one loudness test) — both fail identically on the
untouched original.

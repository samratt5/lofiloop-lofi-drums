# What changed

This build adds a sampled drum kit and widens the lofi generator's variety, so
repeated generations no longer sound alike. Everything else is untouched.

## Why it sounded the same

LofiLoop's drums were synthesised only: `kick`, `snare`, `hat`… were each built
live from oscillators and noise, so every lofi beat used the _same_ drum
timbres. The generator also drew from a small palette (~5 grooves and 9
progressions for lofi). A new seed changed the notes but not the sound or the
rhythmic vocabulary.

## 1. Built-in sampled drum kit (124 one-shots)

- **`tools/gen_drums.py`** — a deterministic Python + numpy generator that
  synthesises 124 lofi one-shots (18 kicks, 18 snares, 18 hats, 12 open hats,
  12 rims, 12 shakers, 12 toms, 12 claps, 10 crashes), each given a dusty tape
  character (saturation, bit crush, filtered top end, faint hiss). Run it with
  `python3 tools/gen_drums.py public/drums`.
- **`public/drums/`** — the generated 16-bit mono WAVs (~1.5 MB total) plus
  `manifest.json`.
- **`src/lib/audio/drumkit.ts`** — fetches and decodes the kit once at boot into
  a context-free buffer bank shared by live playback and offline exports.
- **`src/lib/audio/instruments/drums.ts`** — every drum voice now plays a sample
  variant when the kit is loaded, and falls back to the original synthesis when
  it is not. Velocity, `tune` and `decay` still shape the hit.
- **`src/lib/audio/instruments/utils.ts` / `player.ts`** — a stable per-track
  `variantSeed` (hashed from the track id) picks one variant per track, so a
  song keeps a consistent kick/snare/hat while the next song gets a different
  kit, and exports match playback.
- **`src/components/studio/bootstrap.ts`** — loads the kit alongside the library
  at startup.
- **`public/sw.js`** — the service worker caches `/drums/` cache-first so the
  kit works offline; cache version bumped to `v2`.

## 2. More lofi variety

- **`src/lib/generate/genres.ts`** — the lofi genre now has **29 grooves** (was
  5), **21 progressions** (was 9), **8 chord rhythms** (was 4) and **8 kit
  lineups** (`kits`) that the beat generator picks between, so beats no longer
  share a track lineup. All grooves define kick, snare, hat and open hat, and
  several add rim, shaker or tom.
- **`src/lib/generate/genres.ts`** — added an optional `kits?: InstrumentId[][]`
  field to the `Genre` type.
- **`src/lib/generate/generators.ts`** — `createKitTracks` chooses one of a
  genre's `kits` when present (seeded per beat).
- **`src/lib/generate/structure.ts`** — lofi songs can now add rim, shaker and
  tom parts (`extras`).

## 3. Tests

- **`src/lib/audio/drumkit.test.ts`** (new) — loads the real kit through a mocked
  fetch/decoder and checks that the pools are right, that drums play a decoded
  sample once loaded, and that the per-track variant is deterministic.
- **`src/lib/generate/generators.test.ts`** — the "tracks equal the genre kit"
  assertion now accepts any of the genre's `kits`, and the genre-consistency
  check also validates `kits`.

## Verifying

```bash
npm install
npm run dev            # http://localhost:3000
npm run check          # lint + typecheck + format + unit tests
npm run build
```

`npm run check` passes (lint, typecheck and formatting are clean; the unit
suite passes apart from two pre-existing failures in this environment — the
jsdom-based tests and one loudness test fail on the untouched original too,
from a jsdom/undici vs Node mismatch and a numeric difference).

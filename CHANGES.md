# What changed

## Latest: no more music-box bells in lofi

The lofi kit listed `bell` (the "Music Box" voice) as its melodic instrument, so
every generated lofi song put a toy bell on the melody. Bells belong to trap and
ambient, not to lofi.

- The lofi kit and all nine lofi kit lineups now use `wurli` (a warm electric
  piano) for the melody; one lineup uses `guitar` (nylon) for variety. Two
  lineups deliberately have no lead at all, so the beat can be chords-and-drums.
- The hand-made "Midnight Tape" demo track was also a bell melody; it is now a
  Wurli.
- The "Rainy Commute" template description no longer mentions a bell.
- A regression test asserts a default lofi song never contains a `bell`.

Files: `src/lib/generate/genres.ts`, `src/lib/project/templates.ts`,
`src/lib/generate/song.test.ts`.

## Lofi feel: stable swung boom-bap loops

A lofi beat is a **stable 1–2 bar boom-bap loop**: kick on the 1 with one
syncopated kick, snare on 2 and 4, soft heavily-swung hats, a ghost snare, and
nothing at full velocity. It repeats — the repetition is the style. The harmony
moves slowly, a chord a bar at most.

The generator did the opposite: `varyBar` re-rolled the kick on **every bar
after the first** (a 30% chance of an extra kick, a 15% chance of dropping one),
in both the beat and the song generators, and lofi's chord rhythms included a
half-bar span so chords changed twice a bar. That is the "random bs kicks".

Fixes:

1. **Authentic lofi grooves.** 28 busy grooves replaced with 12 soft boom-bap
   backbeats: kick on the 1 plus one syncopated kick, snare on 2 and 4 with a
   ghost on the last 16th, quiet swung 8th hats, the odd open hat, low
   velocities.
2. **Stable loops.** A per-genre `drums.vary` (0–1, default 1) scales every
   random per-bar change; lofi sets 0.12. Lofi also sets `fill: 'none'`, so a
   loop repeats instead of getting a drum fill every two bars.
3. **Slow harmonic rhythm.** Lofi's chord rhythms are all one-per-bar, and the
   progression list leads with two-chord vamps (`im7–IVm7`), the most lofi shape.
4. **Tempo and swing** tightened to 74–88 BPM and 58–66%.
5. **Curated samples.** The kick, snare and hat recipes were narrowed to one
   round, dusty character.

Measured across 30 generated lofi beats, before → after: bars identical within a
loop **0/30 → 26/30**; snare on 2 and 4 28/30 (the rest are the deliberate
half-time groove and clap kits); kick on the 1 in all 30.

## The sampled drum kit

- **`tools/gen_drums.py`** — deterministic Python + numpy generator for 252 lofi
  one-shots. Run: `python3 tools/gen_drums.py public/drums`.
- **`public/drums/`** — the generated WAVs (~3.3 MB) plus `manifest.json`.
- **`src/lib/audio/drumkit.ts`** — fetches and decodes the kit into a
  context-free buffer bank shared by live playback and exports, in the
  background, so the studio never waits on it.
- Six extra drum instruments (Deep Kick, Tape Kick, Vinyl Snare, Airy Hat, Long
  Open Hat, Soft Shaker) alongside the original kit.

## Mobile

Safe-area padding for notched phones (`viewport-fit: cover` was set with no
inset handling), a larger step-pad tap target, and cache-first offline caching
of `/drums/` in the service worker.

## Verifying

```bash
npm install
npm run dev            # http://localhost:3000
npm run check          # lint + typecheck + format + unit tests
npm run build
```

Lint, typecheck and formatting are clean. The unit suite passes apart from two
failures that are pre-existing in this environment (a loudness test and a
3-second performance test) — both fail identically on the untouched original.

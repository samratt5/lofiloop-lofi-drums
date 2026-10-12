# What changed (lofi feel)

The drums were the problem, and the cause was in the generator, not the samples.
This build makes the lofi output follow how lofi is actually played.

## What was wrong

A lofi beat is a **stable 1–2 bar boom-bap loop**: kick on the 1 with one
syncopated kick, snare on 2 and 4, soft heavily-swung hats, a ghost snare, and
nothing at full velocity. It repeats — the repetition is the style. The
harmony moves slowly (a chord a bar at most, often two chords for the whole
loop).

The generator did the opposite. `varyBar` re-rolled the kick on **every bar
after the first** (a 30% chance of an extra kick, a 15% chance of dropping one),
and lofi's chord rhythms included a half-bar span, so chords changed twice a
bar. That is the "random bs kicks" — and because the same routine runs in both
the beat and the song generators, it affected everything.

## The fixes

1. **Authentic lofi grooves.** The 28 grooves are replaced with 12 soft
   boom-bap backbeats: kick on the 1 plus one syncopated kick, snare on 2 and 4
   with a ghost on the last 16th, quiet swung 8th hats (`o.g.o.g.…`), the odd
   open hat. Velocities are low — nothing at full. File:
   `src/lib/generate/genres.ts`.
2. **Stable loops.** A new per-genre `drums.vary` (0–1, default 1) scales every
   random per-bar change; lofi sets it to 0.12. Lofi also sets `fill: 'none'`,
   so a loop repeats instead of getting a drum fill every two bars. Files:
   `src/lib/generate/genres.ts`, `src/lib/generate/generators.ts`.
3. **Slow harmonic rhythm.** Lofi's chord rhythms are all one-per-bar (the
   half-bar ones are gone), and the progression list leads with two-chord vamps
   (`im7–IVm7` and friends), the most lofi shape of all. File:
   `src/lib/generate/genres.ts`.
4. **Tempo and swing** tightened to the lofi band: 74–88 BPM, swing 58–66%.
5. **Curated samples.** The kick, snare, hat and open-hat recipes were narrowed
   to one round, dusty character (a lofi kick is round, not a modern click), so
   a song's kit is consistent instead of a lottery. File: `tools/gen_drums.py`
   (252 samples regenerated).

## Measured

Across 30 generated lofi beats, before → after:

|                                       | before | after     |
| ------------------------------------- | ------ | --------- |
| bars identical within a loop (stable) | 0/30   | **26/30** |
| snare on 2 and 4                      | 30/30  | 28/30     |
| kick on the 1                         | 30/30  | 30/30     |

The two beats without a snare on 2 and 4 are the deliberate half-time groove and
clap-kit lineups. The point of the first row is that the loop now repeats, which
is what makes it sound like lofi rather than a random walk.

## Verifying

```bash
npm install
npm run dev            # http://localhost:3000
npm run check          # lint + typecheck + format + unit tests
npm run build
```

Lint, typecheck and formatting are clean; the unit suite passes apart from two
failures that are pre-existing in this environment (a loudness test and a
3-second performance test) — both fail identically on the untouched original.

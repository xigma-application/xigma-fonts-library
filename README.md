# xigma-fonts-library

Font-atlas generation library for the [xigma](../xigma-app) design-tool family. Not a
component/UI library like [`xigma-app-shared`](../xigma-app-shared) — this repo produces the MSDF
glyph-atlas assets (`atlas.png` + `atlas.json`) that `xigma-app`'s WebGL text renderer consumes,
without shipping font binaries or the generator tooling inside the app's own bundle/repo.

## Why this repo exists

`xigma-app` renders text in WebGL using a real **MSDF (Multi-channel Signed Distance Field) glyph
atlas** — the same technique the real Figma uses, so glyph edges stay crisp at any zoom instead of
blurring like a rasterized bitmap. Today (see `xigma-app`'s
[`docs/ROADMAP.md`](../xigma-app/docs/ROADMAP.md), Etap 7) there's exactly one font (Inter), baked
once via `msdf-bmfont-xml` from a static TTF and bundled directly into the app's own repo/build
(`src/assets/fonts/inter/`, `npm run generate:font-atlas`).

Etap 9 of that roadmap ("Wiele fontów, atlas per font ładowany z serwera") calls out that this
doesn't scale past one font — every additional font baked into `xigma-app`'s own bundle adds
~150–300 KB unconditionally, even for users who never select it. The plan is:

- Font atlases move to a CDN/hosting, not `xigma-app`'s repo or build.
- `xigma-app` loads an atlas dynamically (`fetch`) only once a user actually selects that font, and
  caches it per `fontFamily`.
- **The generator itself moves to its own repo — this one** — instead of living inside `xigma-app`.
  Rather than committing raw font binaries to git permanently, this repo is meant to hold, per font,
  just a `charset.txt` (the character-set decision — ASCII, Polish diacritics, typography glyphs,
  etc. — a few hundred bytes) plus the generation script, which downloads the source TTF **on
  demand** from a public source (e.g. Google Fonts) rather than storing font binaries long-term.

In short: **`xigma-fonts-library` is the standalone MSDF font-atlas pipeline** — charset
definitions in, `atlas.png` + `atlas.json` per font out, ready to publish wherever `xigma-app` (or
any future consumer) fetches font atlases from.

## Baking unit: one static instance per (font, weight, style)

MSDF baking (`msdf-bmfont-xml`) needs a static TTF — it can't consume a variable font's axes
directly, and font size/line-height/letter-spacing/paragraph-spacing are pure render-time/layout
parameters that never require a re-bake (the atlas is a resolution-independent distance field; text
geometry is scaled and laid out from glyph metrics at draw time). What genuinely needs its own bake
is a different **weight or style** — those are different glyph outlines, not a transform of an
existing one. So the baking unit is font × weight × style, e.g. `inter-400`, `inter-700`,
`inter-400-italic` — each with its own `charset.txt`, its own frozen static TTF, and its own
`atlas.png`/`atlas.json`.

## `scripts/freeze_variable_font.py`

The first generalized pipeline step: freezes a variable-font TTF to a static weight/style instance
via `fontTools.varLib.instancer`, the same mechanism `xigma-app` used once, manually, to produce its
committed `Inter-Regular.ttf` (`wght=400 opsz=14`) before running its own `generate:font-atlas`.
Generalized here to arbitrary axis pins so it can produce any of the per-variant instances above.

```bash
pip install -r requirements.txt
python scripts/freeze_variable_font.py <input-variable.ttf> <output.ttf> wght=700
python scripts/freeze_variable_font.py <input-variable.ttf> <output.ttf> wght=400 opsz=14 ital=1
```

Verified end-to-end against the real Inter variable font (`ofl/inter/Inter[opsz,wght].ttf` from
google/fonts): freezing to `wght=700 opsz=14` produces a TTF with no `fvar` table and
`OS/2.usWeightClass == 700`, ready to feed into `msdf-bmfont-xml`.

## Current state

Beyond the freezing script above, no other generator code has been ported over yet. The reference
implementation to port/generalize next lives in `xigma-app`:

- `xigma-app/package.json`'s `generate:font-atlas` script — the current `msdf-bmfont-xml` CLI
  invocation (`fontSize=64`, `distanceRange=6`, `padding=2`).
- `xigma-app/src/assets/fonts/inter/` — the current single-font example: `inter-msdf.charset.txt`
  (the character set) and the generated `inter-msdf.json`/`inter-msdf.png` outputs.
- `xigma-app/docs/ROADMAP.md`, Etap 7 (MSDF rendering, tuning fontSize/distanceRange/mipmaps) and
  Etap 9 (the multi-font/CDN/this-repo plan) — the full "why" behind every generation parameter.
- On-demand TTF download from a public source (e.g. Google Fonts) — not built yet; the freeze script
  above currently takes a local input path.

## Related repos

- [`xigma-app`](../xigma-app) — the design-tool editor itself (consumer of the atlases this repo
  will produce).
- [`xigma-app-shared`](../xigma-app-shared) — shared React components/utils/SCSS, distributed via a
  git-pull script rather than an npm registry. Not a generator/build-tooling repo like this one, but
  the sibling example of "split out of `xigma-app` into its own repo" worth mirroring for
  distribution/versioning conventions once this repo has real output to ship.

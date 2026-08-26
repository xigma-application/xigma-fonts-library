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

## Current state

This repo is a fresh scaffold — no generator code has been ported over yet. The reference
implementation to port/generalize lives in `xigma-app`:

- `xigma-app/package.json`'s `generate:font-atlas` script — the current `msdf-bmfont-xml` CLI
  invocation (`fontSize=64`, `distanceRange=6`, `padding=2`).
- `xigma-app/src/assets/fonts/inter/` — the current single-font example: `inter-msdf.charset.txt`
  (the character set), `source/Inter-Regular.ttf` (statically extracted from the variable font via
  `fonttools varLib.instancer`, `wght=400 opsz=14`), and the generated `inter-msdf.json`/
  `inter-msdf.png` outputs.
- `xigma-app/docs/ROADMAP.md`, Etap 7 (MSDF rendering, tuning fontSize/distanceRange/mipmaps) and
  Etap 9 (the multi-font/CDN/this-repo plan) — the full "why" behind every generation parameter.

## Related repos

- [`xigma-app`](../xigma-app) — the design-tool editor itself (consumer of the atlases this repo
  will produce).
- [`xigma-app-shared`](../xigma-app-shared) — shared React components/utils/SCSS, distributed via a
  git-pull script rather than an npm registry. Not a generator/build-tooling repo like this one, but
  the sibling example of "split out of `xigma-app` into its own repo" worth mirroring for
  distribution/versioning conventions once this repo has real output to ship.

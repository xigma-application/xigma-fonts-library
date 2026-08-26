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

## Pipeline

Two steps, one per language, chained by `scripts/bake_font.sh`:

1. **`scripts/freeze_variable_font.py`** (Python, `fonttools`) — freezes a variable-font TTF to a
   static weight/style instance via `fontTools.varLib.instancer`. Generalizes the one-off, manual
   step `xigma-app` used to produce its committed `Inter-Regular.ttf` (`wght=400 opsz=14`) before
   running its own `generate:font-atlas`. MSDF baking can't consume a variable font's axes directly,
   hence this step.
2. **`scripts/bake_atlas.cjs`** (Node, `msdf-bmfont-xml`) — bakes the MSDF atlas from that static
   TTF, using the same parameters `xigma-app` tuned and verified (`fontSize=64`, `distanceRange=6`,
   `texturePadding=2`, `msdf`/`json`) — see `xigma-app/docs/ROADMAP.md`, Etap 7, for why those exact
   values. Uses the library's programmatic API rather than its CLI, since the CLI always names the
   output BMFont file after the *input TTF's filename*, ignoring `-o`/`filename` for anything but
   the texture page — confirmed against its source (`index.js`); `xigma-app`'s own
   `generate:font-atlas` works around the same quirk with a shell `mv`. This script instead writes
   every output under the name you pass explicitly, no post-hoc renaming needed.

```bash
pip install -r requirements.txt
npm install

# a variant dir needs a charset.txt before baking — the character set is a per-variant decision,
# not auto-generated
mkdir -p fonts/inter-700
cp fonts/inter-400/charset.txt fonts/inter-700/charset.txt   # or your own

scripts/bake_font.sh fonts/inter-700 /path/to/Inter[opsz,wght].ttf wght=700 opsz=14
```

Produces, per variant:

```
fonts/inter-700/
  charset.txt              # the character-set decision (committed)
  source/
    inter-700.ttf           # frozen static instance (committed — see note below)
    OFL.txt                 # font license, carried alongside the source TTF
  inter-700-msdf.json        # BMFont metadata (glyph metrics, atlas layout)
  inter-700-msdf.png         # the MSDF atlas texture
```

Each step is also independently runnable — `python scripts/freeze_variable_font.py <in> <out>
<axis=value>...` and `node scripts/bake_atlas.cjs --font <ttf> --charset <file> --out-dir <dir>
--name <name>` — see each file's own docstring/`--help`.

## `fonts/inter-400/` — a real, committed example

Baked end-to-end through this exact pipeline from the real Inter variable font
(`ofl/inter/Inter[opsz,wght].ttf`, google/fonts) at `wght=400 opsz=14`, using the same
`inter-msdf.charset.txt` content as `xigma-app`. Cross-checked against `xigma-app`'s own committed
`inter-msdf.json`: `scaleW`/`scaleH` (507×494) and `lineHeight`/`base` (77/62) come out identical,
confirming this pipeline reproduces `xigma-app`'s existing, already-verified output.

**Note on committing binaries**: this repo is meant as a local sandbox for baking fonts, not (yet)
a "no binaries in git" pipeline — so `source/*.ttf` and the baked atlas are committed here, unlike
the more automated on-demand-download version the ROADMAP's Etap 9 eventually envisions. Revisit
this once the repo moves past local experimentation.

## Not built yet

- On-demand TTF download from a public source (Google Fonts, etc.) — variant baking currently takes
  a local variable-font path.
- Publishing atlases anywhere (CDN/hosting) — outputs stay local to this repo for now.

## Related repos

- [`xigma-app`](../xigma-app) — the design-tool editor itself (consumer of the atlases this repo
  will produce).
- [`xigma-app-shared`](../xigma-app-shared) — shared React components/utils/SCSS, distributed via a
  git-pull script rather than an npm registry. Not a generator/build-tooling repo like this one, but
  the sibling example of "split out of `xigma-app` into its own repo" worth mirroring for
  distribution/versioning conventions once this repo has real output to ship.

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
existing one. So the baking unit is font × weight × style, e.g. `Inter-400`, `Inter-700`,
`Inter-400-Italic` — each with its own `charset.txt`, its own frozen static TTF, and its own
`atlas.png`/`atlas.json`, grouped under its font family: `fonts/<FontName>/<FontName>-<variant>/`.

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
mkdir -p fonts/Inter/Inter-700
cp fonts/Inter/Inter-400/charset.txt fonts/Inter/Inter-700/charset.txt   # or your own

scripts/bake_font.sh fonts/Inter/Inter-700 /path/to/Inter[opsz,wght].ttf wght=700 opsz=14
```

Produces, per variant — grouped `<FontName>/<FontName>-<variant>/`:

```
fonts/Inter/Inter-700/
  charset.txt              # the character-set decision (committed)
  source/
    Inter-700.ttf           # frozen static instance (committed — see note below)
    OFL.txt                 # font license, carried alongside the source TTF
  Inter-700-msdf.json        # BMFont metadata (glyph metrics, atlas layout)
  Inter-700-msdf.png         # the MSDF atlas texture
```

Each step is also independently runnable — `python scripts/freeze_variable_font.py <in> <out>
<axis=value>...` and `node scripts/bake_atlas.cjs --font <ttf> --charset <file> --out-dir <dir>
--name <name>` — see each file's own docstring/`--help`.

## `data/google-fonts-catalog.json` + `fonts/manifest.json` — the frontend-facing font list

Two layers, kept deliberately separate:

- **`data/google-fonts-catalog.json`** — the full "what could we offer" list: every Google Fonts
  family + its available weights/styles (2292 entries — 1946 families, some with a separate
  `"<Family> Italic"` entry), fetched once from Google's own public metadata endpoint
  (`fonts.google.com/metadata/fonts`) via `node scripts/fetch_google_fonts_catalog.mjs`. This is
  reference data, not a bake output — re-run it occasionally to pick up new/changed fonts, it isn't
  wired into `bake_font.sh`.
- **`fonts/manifest.json`** — `scripts/generate_manifest.mjs` turns that catalog into the manifest.
  Every entry, and every weight, always carries `preview`/`atlas`/`texture` — computed from this
  repo's own naming convention (the same one `bake_font.sh` writes to), not conditional on whether
  anything's actually been baked in this checkout. A consumer always knows the path a font *would*
  be at without branching on "does this field exist." Each weight also carries `baked: true/false`,
  checked against disk fresh on every run (then run automatically as `bake_font.sh`'s last step), so
  a consumer can tell a guaranteed hit from a path that needs baking-on-demand first — without a
  network round-trip just to find out. This is the "manifest/katalog dostępnych fontów" from
  `xigma-app/docs/ROADMAP.md` Etap 9 — what a font picker in `xigma-app`'s text-properties panel
  would fetch to know what's *offerable*, with `baked` distinguishing it from what's *ready right now*.

```json
[
  {
    "name": "Inter",
    "preview": "fonts/Inter/Inter.svg",
    "weights": [
      { "weight": 400, "atlas": "fonts/Inter/Inter-400/Inter-400-msdf.json", "texture": "fonts/Inter/Inter-400/Inter-400-msdf.png", "baked": true },
      { "weight": 700, "atlas": "fonts/Inter/Inter-700/Inter-700-msdf.json", "texture": "fonts/Inter/Inter-700/Inter-700-msdf.png", "baked": true }
    ]
  },
  {
    "name": "Roboto",
    "preview": "fonts/Roboto/Roboto.svg",
    "weights": [
      { "weight": 400, "atlas": "fonts/Roboto/Roboto-400/Roboto-400-msdf.json", "texture": "fonts/Roboto/Roboto-400/Roboto-400-msdf.png", "baked": false }
    ]
  }
]
```

`Roboto` above is a real example: it's in the Google Fonts catalog but hasn't been baked in this
checkout, so `baked: false` — the paths are still there, exactly where baking it would put them.
`preview`'s existence isn't checked the same way (unlike `atlas`/`texture`, a missing picker preview
is low-stakes — worst case a picker row falls back to plain text) — only `Inter`/`Inter Italic`
actually have one on disk right now, everything else's `preview` path is a prediction the same way
unbaked `atlas`/`texture` paths are. `name` is a display name, not a raw slug — italic variants group
under their own `"<FontName> Italic"` entry rather than mixing into the roman family's `weights`,
matching how a family/style picker would present them. Sorting is explicit alphabetical
(`localeCompare` with `{ sensitivity: 'base' }`, not the runtime's default locale) across all 2292
entries. Regenerate manually any time without a bake: `node scripts/generate_manifest.mjs`.

## `scripts/generate_preview_svg.py` — Figma-style picker previews

A font picker showing 1600+ rows can't load a real webfont per row just to render the family name —
Figma's own picker avoids this by pre-rendering each name as a small SVG built directly from the
font's glyph outlines (confirmed by inspecting its DOM: `svg-container font_preview--scaledFontPreview`,
a real vector snapshot, alongside a `visually_hidden` span with the plain text for accessibility).
This script does the same thing, via `fontTools`' pens (`SVGPathPen`, `BoundsPen`, `TransformPen`):
walks the glyphs for a given string, flips the y-axis (font outlines are y-up, SVG is y-down), bakes
in per-glyph x-advance, and crops the `viewBox` tightly to the actual ink.

```bash
python scripts/generate_preview_svg.py fonts/Inter/Inter-400/source/Inter-400.ttf "Inter" "fonts/Inter/Inter.svg"
python scripts/generate_preview_svg.py fonts/Inter/Inter-400-Italic/source/Inter-400-Italic.ttf "Inter Italic" "fonts/Inter/Inter Italic.svg"
```

One SVG per family/style is enough — unlike the atlas (genuinely different outlines per weight),
a name preview only needs one representative weight to be recognizable in a picker row. Output is
named after the display name verbatim, spaces and all (`fonts/<Family>/<name>.svg` — e.g.
`fonts/Advent Pro/Advent Pro Italic.svg`), which `generate_manifest.mjs` picks up automatically and
adds as that group's `preview` field — see above.

## `scripts/generate_all_previews.mjs` — every font in the catalog, not just Inter

Runs the previous script for all 2292 `data/google-fonts-catalog.json` entries at once — a picker
needs every row's preview available up front (unlike the atlas, which is only ever needed for the
one font actually selected), so unlike the atlas this can't be left to bake-on-miss.

Its font source is deliberately **not** `scripts/lib/googleFontsSource.mjs` (the google/fonts
GitHub repo, used for on-demand atlas baking below) — it uses Google's own CSS2 API instead
(`fonts.googleapis.com/css2?family=<Family>:wght@400`), spoofing an old-browser `User-Agent` to get
a plain `.ttf` back instead of `.woff2`. Two real advantages this ended up depending on: it's
already instanced to Regular/400 server-side (no `fontTools` freezing step needed at all for a
preview), and it works uniformly for **static-only families** too, which have no `[...]` variable
font for `googleFontsSource.mjs` to find — roughly half the catalog, it turns out. It's also not
subject to GitHub's 60-req/hour unauthenticated API limit, which the per-family Contents-API
lookups in `googleFontsSource.mjs` hit almost immediately during a full-catalog run (confirmed
directly: `x-ratelimit-remaining: 0` after ~90 lookups) — CSS2/gstatic is the actual font-serving
CDN, built for exactly this kind of volume.

```bash
node scripts/generate_all_previews.mjs
```

Skips any entry that already has a preview on disk, so it's safe to re-run after the catalog
changes. Continues past a single entry's failure (logged, not silent) rather than aborting the
whole run — real result from the full catalog: **2255 generated, 21 already present, 16 failed**
(98–99% coverage). Every failure is an explainable edge case, not a bug: fonts in a non-Latin
script with no glyphs to render their own Latin-alphabet name (Khmer, Noto Serif Myanmar, Noto
*Emoji, Karla Tamil *, ...), plus a handful where Google's CSS2 API doesn't serve a plain `400`
for that specific family. Failure details land in `.cache/preview-failures.json` (gitignored).

## `scripts/serve.mjs` — local dev server, bakes atlases on demand

This repo is a local sandbox, not something meant to run on a server (see "What's committed vs.
generated locally" below) — so instead of a CDN + queue + lock-based bake-on-demand backend, this
is the single-process local equivalent: "if it's not there, bake it; if it is, serve it
immediately." One developer, requests handled one at a time, nothing to deduplicate.

```bash
node scripts/serve.mjs         # http://localhost:8787
```

| Route | Behavior |
| --- | --- |
| `GET /fonts/manifest.json` | Regenerated fresh on every request |
| `GET /fonts/<Family>/<Family>-<weight>[-Italic]/<...>-msdf.json\|png` | Served if on disk; otherwise baked (full pipeline: freeze + MSDF) then served |
| `GET /fonts/<Family>/<name>.svg` | Served if on disk; otherwise a preview is generated (reuses an already-baked static TTF for that family/style if one exists, else freezes a fresh Regular/400 instance) then served |

Unlike the batch preview script above, on-demand **atlas** baking needs the actual variable font to
freeze an arbitrary requested weight from — for that, `scripts/lib/googleFontsSource.mjs` resolves
and downloads it from the google/fonts GitHub repo (not Google's CSS2 API, which only ever serves
pre-instanced weights, not the raw variable font instancing needs). Downloads are cached under
`.cache/` (gitignored) so a second weight of an already-seen family doesn't re-fetch it. A
family that ships only static per-weight files (no `[...]` variable font) fails with a clear error
rather than a silent 404 — on-demand *atlas* baking doesn't have the CSS2-API escape hatch the
preview script does, since it needs the freezable variable font, not a pre-instanced one.

Not every variable font shares the same axes — `Roboto[wdth,wght].ttf` has no `opsz` axis, for
example, unlike Inter. `scripts/freeze_variable_font.py` now drops a pin for an axis the font
doesn't have (printing a note to stderr) instead of crashing, so the server's blanket `opsz=14`
convention pin doesn't break every family that lacks that axis.

## What's committed vs. generated locally

Baking everything Google Fonts offers would be several GB (see sizing note below) — nowhere close
to git-shippable, and there's no single right answer for where the actual atlas files should live
(a project's own CDN, a local cache for offline dev, S3, whatever). So this repo draws the line at:
generator + **recipe** in git, generated **output** gitignored — each consumer bakes it themselves,
wherever they want the result to end up:

| Committed | Gitignored (baked locally, per consumer) |
| --- | --- |
| `data/google-fonts-catalog.json` (what *could* be offered) | `<variant>-msdf.json` / `.png` (the atlas) |
| `charset.txt` (the character-set decision, per baked variant) | `source/` (frozen static TTF + `OFL.txt`) |
| `manifest.json` (catalog merged with what's *actually* baked) | `.cache/` (downloaded sources, frozen preview instances) |
| `<Family>/<name>.svg` — **all 2276 of them**, full catalog | |

`fonts/manifest.json`'s `atlas`/`texture`/`preview` paths are always present, for every entry — see
the catalog/manifest section above for why (deterministic, convention-based, not conditional on a
local bake) — with `baked` as the per-weight signal for whether an atlas path is a guaranteed hit
today. A consumer runs `scripts/bake_font.sh` (or `scripts/serve.mjs`'s bake-on-miss, or their own
CI) to actually materialize a given atlas, into whatever storage they've chosen — local disk for
dev, a CDN for production — then re-runs `generate_manifest.mjs`, which flips `baked` to `true` once
it finds the files on disk.

Preview SVGs are the one piece of this repo's own bake output that's committed for the **whole**
catalog, not gitignored like atlas/source — a picker needs every row's preview at once (unlike an
atlas, only ever needed for the one font actually selected), so unlike the atlas this genuinely
can't be deferred to "bake it somewhere later." 33MB total across all 2276 generated previews is a
completely different scale problem than the atlas/source GB figures below.

**Sizing, for why the atlas/source split matters**: our own baked Inter (18 variants, this repo's
real worked example) averages ~760 KB/variant (source TTF + atlas json + png). Google Fonts' own
metadata (`fonts.google.com/metadata/fonts`) lists 1946 families averaging 4.04 styles each — baking
every atlas at that rate would be **~6 GB**, which is exactly why atlas/source stay gitignored while
previews (a completely different, much smaller order of magnitude) don't.

## `fonts/Inter/Inter-400/` — a real, worked example

Baked end-to-end through this exact pipeline from the real Inter variable font
(`ofl/inter/Inter[opsz,wght].ttf`, google/fonts) at `wght=400 opsz=14`, using the same
`inter-msdf.charset.txt` content as `xigma-app`. Cross-checked against `xigma-app`'s own committed
`inter-msdf.json`: `scaleW`/`scaleH` (507×494) and `lineHeight`/`base` (77/62) come out identical,
confirming this pipeline reproduces `xigma-app`'s existing, already-verified output. All 18 Inter
variants (100–900 × Roman/Italic) are baked and present on disk in this checkout, but per the policy
above, only their `charset.txt` files are actually tracked by git — the atlas/source files here are
a local, gitignored artifact of having run the pipeline, same as any other consumer's would be.

## Not built yet

- On-demand TTF download and bake-on-miss atlas generation **are** built now (`scripts/serve.mjs`)
  — but only for variable-font families; a family that ships only static per-weight files isn't
  supported by atlas baking yet (the preview script's Google CSS2-API path doesn't carry over,
  since atlas baking needs a freezable variable font, not a pre-instanced weight).
- Actually publishing baked output anywhere (CDN/hosting) — bake output is local-only right now;
  "gitignored" just means it isn't shipped via *this* repo, not that it's shipped anywhere else yet.
- A real "bake on first request, cache on CDN forever" flow for **production** (multiple
  concurrent users, dedup/locking so the same font isn't baked twice at once) — `scripts/serve.mjs`
  is the single-developer local equivalent, deliberately without any of that, per README's earlier
  "I need this locally, I'm probably never putting this on a server" scoping decision.

## Related repos

- [`xigma-app`](../xigma-app) — the design-tool editor itself (consumer of the atlases this repo
  will produce).
- [`xigma-app-shared`](../xigma-app-shared) — shared React components/utils/SCSS, distributed via a
  git-pull script rather than an npm registry. Not a generator/build-tooling repo like this one, but
  the sibling example of "split out of `xigma-app` into its own repo" worth mirroring for
  distribution/versioning conventions once this repo has real output to ship.

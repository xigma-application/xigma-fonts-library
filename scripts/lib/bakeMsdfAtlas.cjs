/**
 * The msdf-bmfont-xml call every atlas bake shares — the whole-variant atlas (scripts/atlas/bake_atlas.cjs)
 * and the Unicode glyph blocks (scripts/atlas/bake_glyph_block.cjs) must use identical parameters
 * (fontSize=64, distanceRange=6, texturePadding=2), or glyphs from a block would not line up with the
 * glyphs of the main atlas they are drawn next to.
 */

const fs = require('fs');
const path = require('path');
const generateBMFont = require('msdf-bmfont-xml');

const DEFAULT_FONT_SIZE = 64;
const DEFAULT_DISTANCE_RANGE = 6;
const DEFAULT_TEXTURE_PADDING = 2;
const DEFAULT_TEXTURE_SIZE = [2048, 2048];

function bakeMsdfAtlas(fontPath, charset, name, textureSize = DEFAULT_TEXTURE_SIZE) {
  const opt = {
    filename: name,
    outputType: 'json',
    fieldType: 'msdf',
    charset,
    fontSize: DEFAULT_FONT_SIZE,
    distanceRange: DEFAULT_DISTANCE_RANGE,
    texturePadding: DEFAULT_TEXTURE_PADDING,
    textureSize,
    smartSize: true,
  };

  return new Promise((resolve, reject) => {
    generateBMFont(fontPath, opt, (error, textures, font) => {
      if (error) {
        reject(error);
        return;
      }

      resolve({ textures, font });
    });
  });
}

// msdf-bmfont-xml quirk (confirmed against its source, index.js): the `filename` option only
// renames the texture page(s) — the BMFont data file is always named after the *input TTF's own
// filename* (fontPath's basename), never `opt.filename`. xigma-app's own generate:font-atlas
// script works around this with a shell `mv`; here we just dictate every output filename
// ourselves from `name`, ignoring what the library returned.
function writeMsdfAtlas(outDir, name, textures, font) {
  fs.mkdirSync(outDir, { recursive: true });

  textures.forEach((texture, index) => {
    const suffix = textures.length > 1 ? `.${index}` : '';
    fs.writeFileSync(path.join(outDir, `${name}${suffix}.png`), texture.texture);
  });

  const fontExtension = path.extname(font.filename);
  fs.writeFileSync(path.join(outDir, `${name}${fontExtension}`), font.data);
}

module.exports = { DEFAULT_TEXTURE_SIZE, bakeMsdfAtlas, writeMsdfAtlas };

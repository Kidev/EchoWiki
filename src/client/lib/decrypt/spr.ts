// GoldSrc / Quake sprite (SPR, "IDSP") reader.
//
// Sprites are a small header, a 256-entry palette, then a run of frames: each a
// width/height plus 8-bit indexed pixels. They're used for HUD icons, muzzle
// flashes, glows and many effects. We expand every frame against the palette and
// emit one PNG per frame, applying the alpha-test transparency convention.

import type { ProcessedAsset } from "./rmmv";
import { decodeIndexed } from "./goldsrc";
import { encodePngBlob } from "./png";

const IDSP_MAGIC = 0x50534449; // "IDSP" little-endian
const MAX_PIXELS = 4_194_304;
const MAX_FRAMES = 256;

const SPR_INDEXALPHA = 2;
const SPR_ALPHATEST = 3;

function sanitize(name: string): string {
  return (
    name
      .replace(/\.spr$/i, "")
      .replace(/[^a-z0-9_-]/gi, "_")
      .toLowerCase() || "spr"
  );
}

export async function* processSprFile(
  file: File,
): AsyncGenerator<ProcessedAsset> {
  const buffer = await file.arrayBuffer();
  const view = new DataView(buffer);
  if (view.byteLength < 42 || view.getUint32(0, true) !== IDSP_MAGIC) return;

  // version(4) type(4) texFormat(4) radius(4) maxW(4) maxH(4) numFrames(4)
  // beamLen(4) syncType(4) = 36 bytes after the magic-inclusive header start.
  const texFormat = view.getInt32(8, true);
  const numFrames = view.getInt32(28, true);
  if (numFrames <= 0 || numFrames > MAX_FRAMES) return;

  // Palette: uint16 count (almost always 256) then count*3 RGB.
  const palCount = view.getUint16(40, true);
  const palStart = 42;
  if (palStart + palCount * 3 > view.byteLength) return;
  const bytes = new Uint8Array(buffer);
  const palette = bytes.subarray(palStart, palStart + 768);

  const transparent =
    texFormat === SPR_ALPHATEST || texFormat === SPR_INDEXALPHA;

  const name = sanitize(file.name);
  let pos = palStart + palCount * 3;

  for (let f = 0; f < numFrames; f++) {
    // frame: group(4) originX(4) originY(4) width(4) height(4) then pixels.
    if (pos + 20 > view.byteLength) break;
    const width = view.getInt32(pos + 12, true);
    const height = view.getInt32(pos + 16, true);
    pos += 20;
    if (width <= 0 || height <= 0 || width * height > MAX_PIXELS) break;
    if (pos + width * height > view.byteLength) break;

    const indices = bytes.subarray(pos, pos + width * height);
    pos += width * height;

    const rgba = decodeIndexed(indices, width, height, palette, transparent);
    const blob = await encodePngBlob(width, height, rgba);
    const stored =
      numFrames === 1 ? `sprites/${name}.png` : `sprites/${name}_${f}.png`;
    yield { path: stored, blob, mimeType: "image/png" };
  }
}

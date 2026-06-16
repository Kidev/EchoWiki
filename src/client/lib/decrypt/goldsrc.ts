// Shared GoldSrc (Quake-derived) palettized-image primitives.
//
// GoldSrc textures (WAD3 lumps, BSP embedded miptex) and sprites (SPR) are all
// 8-bit indexed images with a trailing 256-entry RGB palette. The index->RGBA
// expansion and the GoldSrc transparency conventions live here so the WAD, BSP
// and SPR readers share one implementation.

import type { DecodedImage } from "./tga";

const MAX_PIXELS = 16_777_216; // 4096*4096

// Expand an 8-bit indexed image against a 768-byte (256*RGB) palette.
// `transparent` enables the GoldSrc "{"-texture convention where palette index
// 255 (a pure-blue key) becomes fully transparent.
export function decodeIndexed(
  indices: Uint8Array,
  width: number,
  height: number,
  palette: Uint8Array,
  transparent: boolean,
): Uint8Array {
  const out = new Uint8Array(width * height * 4);
  for (let i = 0; i < width * height; i++) {
    const idx = indices[i]!;
    if (transparent && idx === 255) {
      out[i * 4 + 3] = 0;
      continue;
    }
    const p = idx * 3;
    out[i * 4] = palette[p] ?? 0;
    out[i * 4 + 1] = palette[p + 1] ?? 0;
    out[i * 4 + 2] = palette[p + 2] ?? 0;
    out[i * 4 + 3] = 255;
  }
  return out;
}

// Decode a miptex_t struct (WAD3 type 0x43 / BSP texture lump). `bytes` is the
// whole containing buffer; `start` is the offset of the struct. Returns null for
// external textures (offset 0 = "look this up in a WAD") and malformed structs.
export function decodeMiptex(
  bytes: Uint8Array,
  start: number,
): DecodedImage | null {
  if (start + 40 > bytes.length) return null;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);

  // szName[16] then width,height then mip offsets[4].
  let nameEnd = start;
  while (nameEnd < start + 16 && bytes[nameEnd] !== 0) nameEnd++;
  const name = new TextDecoder().decode(bytes.subarray(start, nameEnd));

  const width = view.getUint32(start + 16, true);
  const height = view.getUint32(start + 20, true);
  const mip0 = view.getUint32(start + 24, true);
  const mip3 = view.getUint32(start + 36, true);
  if (width <= 0 || height <= 0 || width * height > MAX_PIXELS) return null;
  if (mip0 === 0) return null; // external (WAD-referenced) texture

  const pixelStart = start + mip0;
  if (pixelStart + width * height > bytes.length) return null;

  // Palette sits after the 4 mip levels: a uint16 count then count*3 RGB.
  const paletteCount = start + mip3 + (width >> 3) * (height >> 3);
  if (paletteCount + 2 > bytes.length) return null;
  const palStart = paletteCount + 2;
  if (palStart + 768 > bytes.length + 1) return null;

  const indices = bytes.subarray(pixelStart, pixelStart + width * height);
  const palette = bytes.subarray(palStart, palStart + 768);
  const transparent = name.startsWith("{");
  return {
    width,
    height,
    rgba: decodeIndexed(indices, width, height, palette, transparent),
  };
}

// Decode a qpic_t (WAD3 type 0x42 / font 0x46): width,height, indices, then a
// uint16-prefixed palette. Used for HUD/menu graphics and fonts.
export function decodeQpic(
  bytes: Uint8Array,
  start: number,
): DecodedImage | null {
  if (start + 8 > bytes.length) return null;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const width = view.getUint32(start, true);
  const height = view.getUint32(start + 4, true);
  if (width <= 0 || height <= 0 || width * height > MAX_PIXELS) return null;

  const pixelStart = start + 8;
  const pixelEnd = pixelStart + width * height;
  if (pixelEnd + 2 > bytes.length) return null;
  const palCount = view.getUint16(pixelEnd, true);
  const palStart = pixelEnd + 2;
  const palBytes = Math.min(palCount * 3, 768);
  if (palStart + palBytes > bytes.length) return null;

  const palette = bytes.subarray(palStart, palStart + 768);
  const indices = bytes.subarray(pixelStart, pixelEnd);
  return {
    width,
    height,
    rgba: decodeIndexed(indices, width, height, palette, false),
  };
}

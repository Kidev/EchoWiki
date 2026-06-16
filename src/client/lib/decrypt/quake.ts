// Quake (id Tech 2) palettized-texture primitives: the direct ancestor of
// GoldSrc. Quake images are 8-bit indexed but, unlike GoldSrc, they do NOT embed
// a palette: every texture shares the engine palette shipped as gfx/palette.lmp.
// Callers obtain that 768-byte palette (from the same PAK/folder) and pass it in,
// so colours are exact rather than guessed.
//
// Covered here: the .lmp/qpic picture format, WAD2 archives (Quake's gfx.wad),
// and Quake1 BSP (v29) embedded miptex. Quake2 .wal is handled too when a Quake2
// palette is supplied.

import type { DecodedImage } from "./tga";

const WAD2_MAGIC = 0x32444157; // "WAD2"
const MAX_PIXELS = 16_777_216;
const QUAKE_BSP_VERSION = 29;
const BSP_TEXTURE_LUMP = 2;

function indexedToRgba(
  indices: Uint8Array,
  width: number,
  height: number,
  palette: Uint8Array,
): Uint8Array {
  const out = new Uint8Array(width * height * 4);
  for (let i = 0; i < width * height; i++) {
    const p = (indices[i] ?? 0) * 3;
    out[i * 4] = palette[p] ?? 0;
    out[i * 4 + 1] = palette[p + 1] ?? 0;
    out[i * 4 + 2] = palette[p + 2] ?? 0;
    out[i * 4 + 3] = 255;
  }
  return out;
}

// Quake .lmp / qpic picture: int32 width, int32 height, then width*height indices.
export function decodeQuakeLmp(
  bytes: Uint8Array,
  start: number,
  size: number,
  palette: Uint8Array,
): DecodedImage | null {
  if (size < 8) return null;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const width = view.getInt32(start, true);
  const height = view.getInt32(start + 4, true);
  if (width <= 0 || height <= 0 || width * height > MAX_PIXELS) return null;
  if (8 + width * height > size) return null;
  const indices = bytes.subarray(start + 8, start + 8 + width * height);
  return {
    width,
    height,
    rgba: indexedToRgba(indices, width, height, palette),
  };
}

// Quake miptex_t (no embedded palette): name[16], width, height, offsets[4].
export function decodeQuakeMiptex(
  bytes: Uint8Array,
  start: number,
  palette: Uint8Array,
): DecodedImage | null {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (start + 40 > bytes.length) return null;
  const width = view.getUint32(start + 16, true);
  const height = view.getUint32(start + 20, true);
  const mip0 = view.getUint32(start + 24, true);
  if (width <= 0 || height <= 0 || width * height > MAX_PIXELS) return null;
  if (mip0 === 0) return null;
  const pixelStart = start + mip0;
  if (pixelStart + width * height > bytes.length) return null;
  const indices = bytes.subarray(pixelStart, pixelStart + width * height);
  return {
    width,
    height,
    rgba: indexedToRgba(indices, width, height, palette),
  };
}

// Quake2 .wal texture: name[32], width(u32), height(u32), offsets[4]. Uses the
// Quake2 engine palette (supplied by the caller).
export function decodeWal(
  buffer: ArrayBuffer,
  palette: Uint8Array,
): DecodedImage | null {
  const view = new DataView(buffer);
  if (view.byteLength < 100) return null;
  const width = view.getUint32(32, true);
  const height = view.getUint32(36, true);
  const mip0 = view.getUint32(40, true);
  if (width <= 0 || height <= 0 || width * height > MAX_PIXELS) return null;
  if (mip0 === 0 || mip0 + width * height > view.byteLength) return null;
  const indices = new Uint8Array(buffer, mip0, width * height);
  return {
    width,
    height,
    rgba: indexedToRgba(indices, width, height, palette),
  };
}

export type NamedImage = DecodedImage & { name: string };

function lumpName16(bytes: Uint8Array, off: number): string {
  let end = off;
  while (end < off + 16 && bytes[end] !== 0) end++;
  return new TextDecoder().decode(bytes.subarray(off, end));
}

// Decode every miptex / qpic lump from a WAD2 archive (Quake's gfx.wad).
export function decodeQuakeWad2(
  buffer: ArrayBuffer,
  palette: Uint8Array,
): NamedImage[] {
  const view = new DataView(buffer);
  const bytes = new Uint8Array(buffer);
  if (view.byteLength < 12 || view.getUint32(0, true) !== WAD2_MAGIC) return [];

  const numEntries = view.getInt32(4, true);
  const dirOffset = view.getInt32(8, true);
  if (numEntries <= 0 || numEntries > 65536) return [];
  if (dirOffset < 0 || dirOffset + numEntries * 32 > view.byteLength) return [];

  const out: NamedImage[] = [];
  for (let i = 0; i < numEntries; i++) {
    const e = dirOffset + i * 32;
    const offset = view.getInt32(e, true);
    const type = view.getUint8(e + 4 + 8); // after offset/dsize/size
    const name = lumpName16(bytes, e + 16);
    if (offset < 0 || offset >= view.byteLength) continue;

    let img: DecodedImage | null = null;
    if (type === 0x44) {
      img = decodeQuakeMiptex(bytes, offset, palette); // 'D' miptex
    } else if (type === 0x42 || type === 0x45) {
      img = decodeQuakeLmp(bytes, offset, view.byteLength - offset, palette);
    }
    if (img) out.push({ ...img, name: name || `lump_${i}` });
  }
  return out;
}

// Decode embedded miptex from a Quake1 BSP (version 29).
export function decodeQuakeBspTextures(
  buffer: ArrayBuffer,
  palette: Uint8Array,
): NamedImage[] {
  const view = new DataView(buffer);
  const bytes = new Uint8Array(buffer);
  if (view.byteLength < 4 || view.getInt32(0, true) !== QUAKE_BSP_VERSION) {
    return [];
  }
  const lumpEntry = 4 + BSP_TEXTURE_LUMP * 8;
  const texOffset = view.getInt32(lumpEntry, true);
  if (texOffset <= 0 || texOffset + 4 > view.byteLength) return [];
  const numMiptex = view.getInt32(texOffset, true);
  if (numMiptex <= 0 || numMiptex > 4096) return [];
  if (texOffset + 4 + numMiptex * 4 > view.byteLength) return [];

  const out: NamedImage[] = [];
  for (let i = 0; i < numMiptex; i++) {
    const rel = view.getInt32(texOffset + 4 + i * 4, true);
    if (rel < 0) continue;
    const start = texOffset + rel;
    const name = lumpName16(bytes, start);
    const img = decodeQuakeMiptex(bytes, start, palette);
    if (img) out.push({ ...img, name: name || `tex_${i}` });
  }
  return out;
}

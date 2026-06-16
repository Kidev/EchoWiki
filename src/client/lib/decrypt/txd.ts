// RenderWare Texture Dictionary (TXD) decoder: the texture container of the
// RenderWare engine that powers the 3D-era Grand Theft Auto games (III, Vice
// City, San Andreas) and many other PS2/Xbox/PC titles of that era.
//
// A TXD is a tree of RenderWare "chunks". We walk it to the Texture Native
// chunks and decode each one's largest mip. The PC builds we target store
// textures as Direct3D 8/9 rasters: DXT1/3/5 block compression, 16/24/32-bit
// uncompressed layouts, or 8-bit palettized: all of which we expand to RGBA.
// Console-swizzled (PS2/Xbox) rasters and unknown D3D formats are skipped.

import { decodeBC1, decodeBC2, decodeBC3, rgb565 } from "./texture-blocks";
import type { DecodedImage } from "./tga";

const CHUNK_STRUCT = 0x01;
const CHUNK_TEXTURE_NATIVE = 0x15;
const CHUNK_TEXTURE_DICTIONARY = 0x16;
const MAX_PIXELS = 16_777_216;

// rwRASTERFORMAT base-format codes (rasterFormat & 0x0F00).
const FMT_1555 = 0x0100;
const FMT_565 = 0x0200;
const FMT_4444 = 0x0300;
const FMT_LUM8 = 0x0400;
const FMT_888 = 0x0600;
const FMT_555 = 0x0a00;
const PAL8 = 0x2000;
const PAL4 = 0x4000;

type ChunkHeader = {
  type: number;
  size: number;
  end: number;
  dataStart: number;
};

function readChunkHeader(view: DataView, pos: number): ChunkHeader | null {
  if (pos + 12 > view.byteLength) return null;
  const type = view.getUint32(pos, true);
  const size = view.getUint32(pos + 4, true);
  const dataStart = pos + 12;
  return { type, size, dataStart, end: dataStart + size };
}

export type RwTexture = DecodedImage & { name: string };

function decodeRaster(
  bytes: Uint8Array,
  view: DataView,
  dataPos: number,
  dataEnd: number,
  width: number,
  height: number,
  depth: number,
  rasterFormat: number,
  dxt: number,
): Uint8Array | null {
  const baseFormat = rasterFormat & 0x0f00;
  const palette = rasterFormat & 0x6000;

  // Palette (if any) precedes the mip data: PAL8 = 256 BGRA entries, PAL4 = 32.
  let palData: Uint8Array | null = null;
  let pos = dataPos;
  if (palette === PAL8) {
    palData = bytes.subarray(pos, pos + 256 * 4);
    pos += 256 * 4;
  } else if (palette === PAL4) {
    palData = bytes.subarray(pos, pos + 32 * 4);
    pos += 32 * 4;
  }

  if (pos + 4 > dataEnd) return null;
  const mipSize = view.getUint32(pos, true);
  pos += 4;
  if (mipSize <= 0 || pos + mipSize > dataEnd) return null;
  const data = bytes.subarray(pos, pos + mipSize);

  // Block-compressed rasters.
  if (dxt === 1) return decodeBC1(data, width, height, true);
  if (dxt === 3) return decodeBC2(data, width, height);
  if (dxt === 5) return decodeBC3(data, width, height);

  const out = new Uint8Array(width * height * 4);
  const px = width * height;

  if (palData) {
    // D3D palette entries are BGRA.
    for (let i = 0; i < px; i++) {
      const idx =
        depth === 4 ? (data[i >> 1]! >> ((i & 1) * 4)) & 0xf : data[i]!;
      const p = idx * 4;
      out[i * 4] = palData[p + 2] ?? 0;
      out[i * 4 + 1] = palData[p + 1] ?? 0;
      out[i * 4 + 2] = palData[p] ?? 0;
      out[i * 4 + 3] = palData[p + 3] ?? 255;
    }
    return out;
  }

  if (depth === 32) {
    // 8888 / 888 stored as BGRA / BGRX.
    const opaque = baseFormat === FMT_888;
    for (let i = 0; i < px; i++) {
      out[i * 4] = data[i * 4 + 2]!;
      out[i * 4 + 1] = data[i * 4 + 1]!;
      out[i * 4 + 2] = data[i * 4]!;
      out[i * 4 + 3] = opaque ? 255 : data[i * 4 + 3]!;
    }
    return out;
  }
  if (depth === 24) {
    for (let i = 0; i < px; i++) {
      out[i * 4] = data[i * 3 + 2]!;
      out[i * 4 + 1] = data[i * 3 + 1]!;
      out[i * 4 + 2] = data[i * 3]!;
      out[i * 4 + 3] = 255;
    }
    return out;
  }
  if (depth === 16) {
    for (let i = 0; i < px; i++) {
      const c = view.getUint16(pos + i * 2, true);
      if (baseFormat === FMT_565) {
        const [r, g, b] = rgb565(c);
        out[i * 4] = r;
        out[i * 4 + 1] = g;
        out[i * 4 + 2] = b;
        out[i * 4 + 3] = 255;
      } else if (baseFormat === FMT_1555 || baseFormat === FMT_555) {
        const r = (c >> 10) & 0x1f;
        const g = (c >> 5) & 0x1f;
        const b = c & 0x1f;
        out[i * 4] = (r << 3) | (r >> 2);
        out[i * 4 + 1] = (g << 3) | (g >> 2);
        out[i * 4 + 2] = (b << 3) | (b >> 2);
        out[i * 4 + 3] = baseFormat === FMT_1555 ? (c & 0x8000 ? 255 : 0) : 255;
      } else if (baseFormat === FMT_4444) {
        out[i * 4] = ((c >> 8) & 0xf) * 17;
        out[i * 4 + 1] = ((c >> 4) & 0xf) * 17;
        out[i * 4 + 2] = (c & 0xf) * 17;
        out[i * 4 + 3] = ((c >> 12) & 0xf) * 17;
      } else {
        return null;
      }
    }
    return out;
  }
  if (depth === 8 && baseFormat === FMT_LUM8) {
    for (let i = 0; i < px; i++) {
      const v = data[i]!;
      out[i * 4] = v;
      out[i * 4 + 1] = v;
      out[i * 4 + 2] = v;
      out[i * 4 + 3] = 255;
    }
    return out;
  }
  return null;
}

// Parse one Texture Native (0x15) chunk -> decoded RGBA image, or null.
function parseTextureNative(
  bytes: Uint8Array,
  view: DataView,
  chunk: ChunkHeader,
): RwTexture | null {
  const struct = readChunkHeader(view, chunk.dataStart);
  if (!struct || struct.type !== CHUNK_STRUCT) return null;
  let pos = struct.dataStart;
  if (pos + 88 > struct.end) return null;

  const platformId = view.getUint32(pos, true);
  pos += 4; // platform
  pos += 4; // filter + addressing
  // name[32], maskName[32]
  let nameEnd = pos;
  while (nameEnd < pos + 32 && bytes[nameEnd] !== 0) nameEnd++;
  const name = new TextDecoder().decode(bytes.subarray(pos, nameEnd));
  pos += 64;

  const rasterFormat = view.getUint32(pos, true);
  pos += 4;

  let dxt = 0;
  if (platformId === 9) {
    // D3D9: a 4-char D3DFORMAT / FourCC.
    const fcc = view.getUint32(pos, true);
    pos += 4;
    if (fcc === 0x31545844)
      dxt = 1; // 'DXT1'
    else if (fcc === 0x33545844)
      dxt = 3; // 'DXT3'
    else if (fcc === 0x35545844) dxt = 5; // 'DXT5'
  } else if (platformId === 8) {
    pos += 4; // D3D8: hasAlpha flag (compression read from the byte below)
  } else {
    return null; // PS2/Xbox/GameCube swizzled raster: unsupported
  }

  const width = view.getUint16(pos, true);
  const height = view.getUint16(pos + 2, true);
  const depth = view.getUint8(pos + 4);
  // numLevels (mips) at +5, rasterType at +6
  const flagsByte = view.getUint8(pos + 7);
  pos += 8;

  if (platformId === 8) {
    // D3D8 stores the DXT compression type directly in the flags byte.
    if (flagsByte === 1 || flagsByte === 3 || flagsByte === 5) dxt = flagsByte;
  } else if (platformId === 9 && dxt === 0 && flagsByte & 0x08) {
    // D3D9 flagged compressed but no recognised FourCC: bail rather than guess.
    return null;
  }

  if (width <= 0 || height <= 0 || width * height > MAX_PIXELS) return null;

  const rgba = decodeRaster(
    bytes,
    view,
    pos,
    struct.end,
    width,
    height,
    depth,
    rasterFormat,
    dxt,
  );
  if (!rgba) return null;
  return { name, width, height, rgba };
}

// Decode every Texture Native in a TXD buffer. `onTexture` is called per image.
export function decodeTxd(buffer: ArrayBuffer): RwTexture[] {
  const view = new DataView(buffer);
  const bytes = new Uint8Array(buffer);
  const root = readChunkHeader(view, 0);
  if (!root || root.type !== CHUNK_TEXTURE_DICTIONARY) return [];

  const out: RwTexture[] = [];
  let pos = root.dataStart;
  while (pos + 12 <= root.end) {
    const chunk = readChunkHeader(view, pos);
    if (!chunk || chunk.end > root.end + 12) break;
    if (chunk.type === CHUNK_TEXTURE_NATIVE) {
      try {
        const tex = parseTextureNative(bytes, view, chunk);
        if (tex) out.push(tex);
      } catch {
        // Skip a malformed entry, keep reading the rest.
      }
    }
    pos = chunk.end;
  }
  return out;
}

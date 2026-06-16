// Doom WAD reader (id Tech 1): the IWAD/PWAD archives of Doom, Doom II, Heretic,
// Hexen and the entire Doom-engine lineage that GoldSrc/Quake descend from.
//
// Graphics are 8-bit indexed against the PLAYPAL palette lump and come in two
// shapes: column-based "pictures" (sprites, patches, menu/HUD graphics, fonts)
// with per-column transparency, and raw 64x64 "flats" (floor/ceiling tiles).
// We decode both to RGBA, using section markers (F_/S_/P_START..END) to tell
// flats from pictures, and validate each picture's structure so non-graphic
// lumps (maps, sound, music, text) are skipped. Unity-rerelease WADs that embed
// PNG lumps directly are passed straight through.

import type { ProcessedAsset } from "./rmmv";
import type { DecodedImage } from "./tga";
import { encodePngBlob } from "./png";

const MAX_LUMPS = 32_768;
const MAX_FILE = 600 * 1024 * 1024;

type Lump = { name: string; pos: number; size: number };

function lumpName(bytes: Uint8Array, off: number): string {
  let end = off;
  while (end < off + 8 && bytes[end] !== 0) end++;
  return new TextDecoder().decode(bytes.subarray(off, end)).toUpperCase();
}

function sanitize(name: string): string {
  return name.replace(/[^a-z0-9_-]/gi, "_").toLowerCase() || "lump";
}

// Decode a Doom "picture" (patch) lump into RGBA with column transparency.
function decodePicture(
  bytes: Uint8Array,
  view: DataView,
  start: number,
  size: number,
  palette: Uint8Array,
): DecodedImage | null {
  if (size < 8) return null;
  const width = view.getInt16(start, true);
  const height = view.getInt16(start + 2, true);
  if (width <= 0 || height <= 0 || width > 4096 || height > 4096) return null;
  if (8 + width * 4 > size) return null;

  // Column offset table; each must point inside the lump past the header.
  const colOffsets: number[] = [];
  const tableEnd = 8 + width * 4;
  for (let x = 0; x < width; x++) {
    const o = view.getUint32(start + 8 + x * 4, true);
    if (o < tableEnd || o >= size) return null;
    colOffsets.push(o);
  }

  const out = new Uint8Array(width * height * 4); // alpha defaults to 0
  for (let x = 0; x < width; x++) {
    let p = start + colOffsets[x]!;
    let guard = 0;
    while (p < start + size) {
      const topDelta = bytes[p++]!;
      if (topDelta === 0xff) break;
      const len = bytes[p++]!;
      p++; // unused pad byte before pixel data
      for (let i = 0; i < len; i++) {
        const y = topDelta + i;
        const idx = bytes[p + i];
        if (idx === undefined) return null;
        if (y >= 0 && y < height) {
          const palIdx = idx * 3;
          const di = (y * width + x) * 4;
          out[di] = palette[palIdx] ?? 0;
          out[di + 1] = palette[palIdx + 1] ?? 0;
          out[di + 2] = palette[palIdx + 2] ?? 0;
          out[di + 3] = 255;
        }
      }
      p += len + 1; // pixels + trailing pad byte
      if (++guard > height + 2) return null; // malformed column
    }
  }
  return { width, height, rgba: out };
}

// Decode a raw flat (square indexed bitmap, normally 64x64).
function decodeFlat(
  bytes: Uint8Array,
  start: number,
  size: number,
  palette: Uint8Array,
): DecodedImage | null {
  // 64x64 (4096) is by far the most common; also accept other exact squares.
  const side = Math.sqrt(size);
  if (!Number.isInteger(side) || side < 8 || side > 1024) return null;
  const out = new Uint8Array(size * 4);
  for (let i = 0; i < size; i++) {
    const palIdx = bytes[start + i]! * 3;
    out[i * 4] = palette[palIdx] ?? 0;
    out[i * 4 + 1] = palette[palIdx + 1] ?? 0;
    out[i * 4 + 2] = palette[palIdx + 2] ?? 0;
    out[i * 4 + 3] = 255;
  }
  return { width: side, height: side, rgba: out };
}

function isPng(bytes: Uint8Array, off: number): boolean {
  return (
    bytes[off] === 0x89 &&
    bytes[off + 1] === 0x50 &&
    bytes[off + 2] === 0x4e &&
    bytes[off + 3] === 0x47
  );
}

export async function* processDoomWad(
  file: File,
): AsyncGenerator<ProcessedAsset> {
  if (file.size > MAX_FILE) return;
  const buffer = await file.arrayBuffer();
  const view = new DataView(buffer);
  const bytes = new Uint8Array(buffer);
  if (view.byteLength < 12) return;

  const magic = lumpName(bytes, 0).slice(0, 4);
  if (magic !== "IWAD" && magic !== "PWAD") return;

  const numLumps = view.getInt32(4, true);
  const dirOffset = view.getInt32(8, true);
  if (numLumps <= 0 || numLumps > MAX_LUMPS) return;
  if (dirOffset < 0 || dirOffset + numLumps * 16 > view.byteLength) return;

  const lumps: Lump[] = [];
  for (let i = 0; i < numLumps; i++) {
    const e = dirOffset + i * 16;
    const pos = view.getInt32(e, true);
    const size = view.getInt32(e + 4, true);
    lumps.push({ pos, size, name: lumpName(bytes, e + 8) });
  }

  // Palette: first 768 bytes of PLAYPAL.
  const playpal = lumps.find((l) => l.name === "PLAYPAL");
  let palette: Uint8Array | null = null;
  if (playpal && playpal.pos + 768 <= view.byteLength) {
    palette = bytes.subarray(playpal.pos, playpal.pos + 768);
  }

  const wadName = sanitize(file.name.replace(/\.wad$/i, ""));
  const yielded = new Set<string>();
  let inFlats = false;
  let inSprites = false;

  const emit = async (
    img: DecodedImage,
    name: string,
  ): Promise<ProcessedAsset> => {
    let stored = `${wadName}/${name}.png`;
    let n = 1;
    while (yielded.has(stored)) stored = `${wadName}/${name}_${n++}.png`;
    yielded.add(stored);
    const blob = await encodePngBlob(img.width, img.height, img.rgba);
    return { path: stored, blob, mimeType: "image/png" };
  };

  for (const lump of lumps) {
    const upper = lump.name;
    // Section markers (also F1_/F2_ etc. variants) toggle the decode mode.
    if (/^F+_START$/.test(upper) || /^F\d_START$/.test(upper)) {
      inFlats = true;
      continue;
    }
    if (/^F+_END$/.test(upper) || /^F\d_END$/.test(upper)) {
      inFlats = false;
      continue;
    }
    if (/^S+_START$/.test(upper) || /^SS_START$/.test(upper)) {
      inSprites = true;
      continue;
    }
    if (/^S+_END$/.test(upper) || /^SS_END$/.test(upper)) {
      inSprites = false;
      continue;
    }
    if (lump.size === 0 || lump.pos + lump.size > view.byteLength) continue;
    if (upper === "PLAYPAL" || upper === "COLORMAP" || upper === "ENDOOM") {
      continue;
    }

    // Unity-rerelease WADs embed PNGs directly.
    if (lump.size > 8 && isPng(bytes, lump.pos)) {
      const stored = `${wadName}/${sanitize(upper)}.png`;
      if (yielded.has(stored)) continue;
      yielded.add(stored);
      const data = bytes.slice(lump.pos, lump.pos + lump.size);
      yield {
        path: stored,
        blob: new Blob([data as unknown as BlobPart], { type: "image/png" }),
        mimeType: "image/png",
      };
      continue;
    }

    if (!palette) continue;

    let img: DecodedImage | null = null;
    if (inFlats) {
      img = decodeFlat(bytes, lump.pos, lump.size, palette);
    } else if (inSprites) {
      img = decodePicture(bytes, view, lump.pos, lump.size, palette);
    } else {
      // Top-level graphics (TITLEPIC, menu, HUD, fonts) are pictures; the strict
      // validation in decodePicture rejects non-graphic lumps.
      img = decodePicture(bytes, view, lump.pos, lump.size, palette);
    }
    if (img) yield await emit(img, sanitize(upper));
  }
}

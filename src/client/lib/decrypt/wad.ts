// GoldSrc WAD3 texture archive reader (Half-Life and its mods/total conversions
// ship the bulk of their art in halflife.wad, decals.wad, gfx.wad, ...).
//
// WAD3 is a flat directory of typed lumps: 0x43 miptex (the main game textures),
// 0x42 qpic and 0x46 font (HUD/menu graphics & fonts). Each is an 8-bit indexed
// image with an embedded palette, which we expand to RGBA and emit as PNG.

import type { ProcessedAsset } from "./rmmv";
import { decodeMiptex, decodeQpic } from "./goldsrc";
import { encodePngBlob } from "./png";

const WAD3_MAGIC = 0x33444157; // "WAD3" little-endian
const MAX_FILE = 200 * 1024 * 1024;
const MAX_LUMPS = 8000;

const LUMP_QPIC = 0x42;
const LUMP_MIPTEX = 0x43;
const LUMP_FONT = 0x46;

function sanitize(name: string): string {
  return (
    name
      .replace(/[^a-z0-9_-]/gi, "_")
      .replace(/_+/g, "_")
      .toLowerCase() || "tex"
  );
}

export async function* processWadArchive(
  file: File,
): AsyncGenerator<ProcessedAsset> {
  if (file.size > MAX_FILE) return;
  const buffer = await file.arrayBuffer();
  const view = new DataView(buffer);
  if (view.byteLength < 12 || view.getUint32(0, true) !== WAD3_MAGIC) return;

  const numLumps = view.getInt32(4, true);
  const dirOffset = view.getInt32(8, true);
  if (numLumps <= 0 || numLumps > MAX_LUMPS) return;
  if (dirOffset < 0 || dirOffset + numLumps * 32 > view.byteLength) return;

  const bytes = new Uint8Array(buffer);
  const wadName = sanitize(file.name.replace(/\.wad$/i, ""));
  const yielded = new Set<string>();

  for (let i = 0; i < numLumps; i++) {
    // Entry: filePos(0) diskSize(4) size(8) type(12) compression(13) dummy(14)
    // szName[16](16).
    const e = dirOffset + i * 32;
    const filePos = view.getInt32(e, true);
    const diskSize = view.getInt32(e + 8, true); // nSize (uncompressed)
    const type = view.getUint8(e + 12);
    const compression = view.getUint8(e + 13);

    if (compression !== 0) continue; // WAD3 lumps are virtually never compressed
    if (filePos < 0 || filePos + diskSize > view.byteLength) continue;

    let nameEnd = e + 16;
    while (nameEnd < e + 32 && bytes[nameEnd] !== 0) nameEnd++;
    const lumpName = sanitize(
      new TextDecoder().decode(bytes.subarray(e + 16, nameEnd)),
    );

    let decoded;
    if (type === LUMP_MIPTEX) {
      decoded = decodeMiptex(bytes, filePos);
    } else if (type === LUMP_QPIC || type === LUMP_FONT) {
      decoded = decodeQpic(bytes, filePos);
    } else {
      continue;
    }
    if (!decoded) continue;

    let stored = `${wadName}/${lumpName}.png`;
    let n = 1;
    while (yielded.has(stored)) stored = `${wadName}/${lumpName}_${n++}.png`;
    yielded.add(stored);

    const blob = await encodePngBlob(
      decoded.width,
      decoded.height,
      decoded.rgba,
    );
    yield { path: stored, blob, mimeType: "image/png" };
  }
}

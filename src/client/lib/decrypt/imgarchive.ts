// Grand Theft Auto IMG archive reader (the RenderWare-era GTA games pack almost
// all their art into a handful of .img archives: gta3.img, player.img, ...).
//
// Two layouts exist:
//   * Version 2 ("VER2", GTA San Andreas): a single .img file whose directory is
//     embedded at the front.
//   * Version 1 (GTA III / Vice City): a separate .dir directory + raw .img data.
//
// Directory entries address data in 2048-byte sectors. We read just the (small)
// directory, then stream each TXD entry out with File.slice(): the archives run
// to hundreds of megabytes, and decode its textures to PNG. DFF models and
// other entry types are ignored. A global cap keeps the import bounded.

import type { ProcessedAsset } from "./rmmv";
import { decodeTxd } from "./txd";
import { encodePngBlob } from "./png";

const SECTOR = 2048;
const VER2_MAGIC = 0x32524556; // "VER2" little-endian
const MAX_IMAGES = 5000; // total textures emitted across the archive
const MAX_ENTRY_BYTES = 64 * 1024 * 1024;

type ImgEntry = { offset: number; size: number; name: string };

function readName(bytes: Uint8Array, start: number, len: number): string {
  let end = start;
  while (end < start + len && bytes[end] !== 0) end++;
  return new TextDecoder().decode(bytes.subarray(start, end));
}

function sanitize(name: string): string {
  return name.replace(/[^a-z0-9_.-]/gi, "_").toLowerCase();
}

function normalizeRel(file: File): string {
  const rel = file.webkitRelativePath || file.name;
  const slash = rel.indexOf("/");
  return (slash >= 0 ? rel.slice(slash + 1) : rel).replace(/\\/g, "/");
}

// Parse a V2 ("VER2") embedded directory from the archive head.
async function readV2Directory(file: File): Promise<ImgEntry[] | null> {
  const head = await file.slice(0, 8).arrayBuffer();
  const hv = new DataView(head);
  if (hv.byteLength < 8 || hv.getUint32(0, true) !== VER2_MAGIC) return null;
  const count = hv.getUint32(4, true);
  if (count <= 0 || count > 200_000) return null;

  const dirBuf = await file.slice(8, 8 + count * 32).arrayBuffer();
  const dv = new DataView(dirBuf);
  const db = new Uint8Array(dirBuf);
  if (dv.byteLength < count * 32) return null;

  const entries: ImgEntry[] = [];
  for (let i = 0; i < count; i++) {
    const e = i * 32;
    const offset = dv.getUint32(e, true);
    const streamingSize = dv.getUint16(e + 4, true);
    const sizeInArchive = dv.getUint16(e + 6, true);
    const size = (sizeInArchive || streamingSize) * SECTOR;
    entries.push({
      offset: offset * SECTOR,
      size,
      name: readName(db, e + 8, 24),
    });
  }
  return entries;
}

// Parse a V1 directory (.dir file: 32-byte entries of offset/size/name sectors).
function parseV1Directory(dirBuf: ArrayBuffer): ImgEntry[] {
  const dv = new DataView(dirBuf);
  const db = new Uint8Array(dirBuf);
  const count = Math.floor(dv.byteLength / 32);
  const entries: ImgEntry[] = [];
  for (let i = 0; i < count; i++) {
    const e = i * 32;
    entries.push({
      offset: dv.getUint32(e, true) * SECTOR,
      size: dv.getUint32(e + 4, true) * SECTOR,
      name: readName(db, e + 8, 24),
    });
  }
  return entries;
}

// Resolve the directory + the data file for either layout.
async function resolve(
  file: File,
  allFiles: File[],
): Promise<{ entries: ImgEntry[]; data: File } | null> {
  const v2 = await readV2Directory(file);
  if (v2) return { entries: v2, data: file };

  // V1: pair the .img with its sibling .dir (or vice-versa).
  const rel = normalizeRel(file).toLowerCase();
  const isImg = rel.endsWith(".img");
  const wantRel = isImg
    ? rel.replace(/\.img$/, ".dir")
    : rel.replace(/\.dir$/, ".img");
  let dirFile: File | undefined;
  let imgFile: File | undefined;
  for (const f of allFiles) {
    if (normalizeRel(f).toLowerCase() === wantRel) {
      if (wantRel.endsWith(".dir")) dirFile = f;
      else imgFile = f;
    }
  }
  if (isImg) {
    imgFile = file;
  } else {
    dirFile = file;
  }
  if (!dirFile || !imgFile) return null;
  const entries = parseV1Directory(await dirFile.arrayBuffer());
  return entries.length ? { entries, data: imgFile } : null;
}

export async function* processImgArchive(
  file: File,
  allFiles: File[],
): AsyncGenerator<ProcessedAsset> {
  const resolved = await resolve(file, allFiles);
  if (!resolved) return;
  const { entries, data } = resolved;

  const archive = sanitize(file.name.replace(/\.(img|dir)$/i, ""));
  const yielded = new Set<string>();
  let emitted = 0;

  for (const entry of entries) {
    if (emitted >= MAX_IMAGES) break;
    if (!entry.name.toLowerCase().endsWith(".txd")) continue;
    if (entry.size <= 0 || entry.size > MAX_ENTRY_BYTES) continue;
    if (entry.offset + entry.size > data.size) continue;

    let buf: ArrayBuffer;
    try {
      buf = await data
        .slice(entry.offset, entry.offset + entry.size)
        .arrayBuffer();
    } catch {
      continue;
    }

    let textures;
    try {
      textures = decodeTxd(buf);
    } catch {
      continue;
    }

    const txdName = sanitize(entry.name.replace(/\.txd$/i, ""));
    for (const tex of textures) {
      if (emitted >= MAX_IMAGES) break;
      const texName = sanitize(tex.name) || "tex";
      let stored = `${archive}/${txdName}/${texName}.png`;
      let n = 1;
      while (yielded.has(stored)) {
        stored = `${archive}/${txdName}/${texName}_${n++}.png`;
      }
      yielded.add(stored);
      const blob = await encodePngBlob(tex.width, tex.height, tex.rgba);
      yield { path: stored, blob, mimeType: "image/png" };
      emitted++;
    }
  }
}

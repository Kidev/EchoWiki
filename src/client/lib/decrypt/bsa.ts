// Bethesda archive reader: the Creation/Gamebryo engines (Morrowind, Oblivion,
// Skyrim, Fallout 3/NV/4) package textures and meshes in BSA (.bsa) and the
// newer BA2 (.ba2) containers.
//
// We read the directory, decompress entries (zlib for BSA v103/104, LZ4 block
// for the Skyrim SE v105 variant), and turn the DDS textures inside into PNG.
// BA2 "GNRL" general archives are supported; the chunked "DX10" texture variant,
// which stores headerless DDS that must be reconstructed, is left to a future
// pass (and has no sample to validate against here).

import type { ProcessedAsset } from "./rmmv";
import { decodeDds } from "./dds";
import { encodePngBlob } from "./png";
import { inflateZlib } from "./zip";
import { lz4DecompressBlock } from "./lz4";

const BSA_MAGIC = 0x00415342; // "BSA\0"
const BTDX_MAGIC = 0x58445442; // "BTDX" (BA2)
const MAX_FILES = 60_000;
const MAX_ENTRY_BYTES = 96 * 1024 * 1024;

// Archive header flags.
const FLAG_NAMED_DIRS = 0x1;
const FLAG_NAMED_FILES = 0x2;
const FLAG_COMPRESSED = 0x4;
const FLAG_EMBED_NAMES = 0x100;
const FILE_SIZE_MASK = 0x3fffffff;
const FILE_COMPRESS_TOGGLE = 0x40000000;

type BsaFile = { folder: string; name: string; size: number; offset: number };

async function decompress(
  version: number,
  packed: Uint8Array,
  originalSize: number,
): Promise<Uint8Array | null> {
  if (version >= 105) {
    // Skyrim SE: LZ4. Block decode covers the common HC block payloads.
    try {
      return lz4DecompressBlock(packed, originalSize);
    } catch {
      return null;
    }
  }
  return inflateZlib(packed);
}

function readBzString(
  view: DataView,
  bytes: Uint8Array,
  pos: number,
): [string, number] {
  const len = view.getUint8(pos);
  const s = new TextDecoder().decode(bytes.subarray(pos + 1, pos + 1 + len));
  return [s.replace(/\0+$/, "").replace(/\\/g, "/"), pos + 1 + len];
}

async function* readBsa(buffer: ArrayBuffer): AsyncGenerator<ProcessedAsset> {
  const view = new DataView(buffer);
  const bytes = new Uint8Array(buffer);

  const version = view.getUint32(4, true);
  const folderOffset = view.getUint32(8, true);
  const flags = view.getUint32(12, true);
  const folderCount = view.getUint32(16, true);
  const fileCount = view.getUint32(20, true);
  const totalFileNameLength = view.getUint32(28, true);
  if (folderCount === 0 || fileCount === 0 || fileCount > MAX_FILES) return;

  const namedDirs = (flags & FLAG_NAMED_DIRS) !== 0;
  const namedFiles = (flags & FLAG_NAMED_FILES) !== 0;
  const defaultCompressed = (flags & FLAG_COMPRESSED) !== 0;
  const embedNames = (flags & FLAG_EMBED_NAMES) !== 0;
  const folderRecSize = version >= 105 ? 24 : 16;

  // Folder records -> the byte offset of each folder's file-record block.
  const blockOffsets: { count: number; blockOffset: number }[] = [];
  for (let i = 0; i < folderCount; i++) {
    const e = folderOffset + i * folderRecSize;
    if (e + folderRecSize > view.byteLength) return;
    const count = view.getUint32(e + 8, true);
    // The stored offset is biased by totalFileNameLength.
    const stored =
      version >= 105
        ? view.getUint32(e + 16, true)
        : view.getUint32(e + 12, true);
    blockOffsets.push({ count, blockOffset: stored - totalFileNameLength });
  }

  // Walk each folder block: optional folder name, then `count` file records.
  const files: BsaFile[] = [];
  let nameBlockStart = 0;
  for (const { count, blockOffset } of blockOffsets) {
    let p = blockOffset;
    let folderName = "";
    if (namedDirs) {
      [folderName, p] = readBzString(view, bytes, p);
    }
    for (let i = 0; i < count; i++) {
      if (p + 16 > view.byteLength) return;
      const rawSize = view.getUint32(p + 8, true);
      const offset = view.getUint32(p + 12, true);
      files.push({ folder: folderName, name: "", size: rawSize, offset });
      p += 16;
    }
    nameBlockStart = Math.max(nameBlockStart, p);
  }

  // File-name block: fileCount NUL-terminated names in global order.
  if (namedFiles) {
    let p = nameBlockStart;
    for (let i = 0; i < files.length && p < view.byteLength; i++) {
      let end = p;
      while (end < view.byteLength && bytes[end] !== 0) end++;
      files[i]!.name = new TextDecoder().decode(bytes.subarray(p, end));
      p = end + 1;
    }
  } else {
    for (let i = 0; i < files.length; i++) files[i]!.name = `file_${i}`;
  }

  const yielded = new Set<string>();
  for (const f of files) {
    const fullName = (
      f.folder ? `${f.folder}/${f.name}` : f.name
    ).toLowerCase();
    if (!fullName.endsWith(".dds")) continue;
    const compressed =
      defaultCompressed !== ((f.size & FILE_COMPRESS_TOGGLE) !== 0);
    let size = f.size & FILE_SIZE_MASK;
    if (size <= 0 || size > MAX_ENTRY_BYTES) continue;
    if (f.offset + size > view.byteLength) continue;

    let p = f.offset;
    if (embedNames) {
      const nlen = view.getUint8(p);
      p += 1 + nlen;
      size -= 1 + nlen;
    }

    let data: Uint8Array | null;
    if (compressed) {
      const originalSize = view.getUint32(p, true);
      p += 4;
      const packed = bytes.subarray(p, f.offset + (f.size & FILE_SIZE_MASK));
      data = await decompress(version, packed, originalSize);
    } else {
      data = bytes.subarray(p, p + size);
    }
    if (!data) continue;

    const dec = decodeDds(
      data.byteOffset === 0 && data.byteLength === data.buffer.byteLength
        ? data.buffer
        : (data.slice().buffer as ArrayBuffer),
    );
    if (!dec) continue;
    const stored = `${fullName.replace(/\.dds$/i, "")}.png`;
    if (yielded.has(stored)) continue;
    yielded.add(stored);
    const blob = await encodePngBlob(dec.width, dec.height, dec.rgba);
    yield { path: stored, blob, mimeType: "image/png" };
  }
}

// BA2 "GNRL" general archive: simple (hash, offset, packed/unpacked) records,
// names in a trailing name table. DDS entries are decoded; other media passes
// through. The chunked "DX10" texture variant is not handled here.
async function* readBa2(buffer: ArrayBuffer): AsyncGenerator<ProcessedAsset> {
  const view = new DataView(buffer);
  const bytes = new Uint8Array(buffer);
  const type = new TextDecoder().decode(bytes.subarray(8, 12));
  if (type !== "GNRL") return;

  const fileCount = view.getUint32(12, true);
  const nameTableOffset = Number(view.getBigUint64(16, true));
  if (fileCount === 0 || fileCount > MAX_FILES) return;

  // Names: u16 length + chars, in file order.
  const names: string[] = [];
  let np = nameTableOffset;
  for (let i = 0; i < fileCount && np + 2 <= view.byteLength; i++) {
    const len = view.getUint16(np, true);
    np += 2;
    names.push(new TextDecoder().decode(bytes.subarray(np, np + len)));
    np += len;
  }

  const yielded = new Set<string>();
  let p = 24; // after header
  for (let i = 0; i < fileCount; i++) {
    if (p + 36 > view.byteLength) break;
    const offset = Number(view.getBigUint64(p + 16, true));
    const packedSize = view.getUint32(p + 24, true);
    const unpackedSize = view.getUint32(p + 28, true);
    p += 36;

    const name = (names[i] ?? `file_${i}`).replace(/\\/g, "/").toLowerCase();
    if (!name.endsWith(".dds")) continue;
    const size = packedSize || unpackedSize;
    if (
      size <= 0 ||
      size > MAX_ENTRY_BYTES ||
      offset + size > view.byteLength
    ) {
      continue;
    }

    let data: Uint8Array | null = bytes.subarray(offset, offset + size);
    if (packedSize > 0) data = await inflateZlib(data);
    if (!data) continue;

    const dec = decodeDds(
      data.byteOffset === 0 && data.byteLength === data.buffer.byteLength
        ? data.buffer
        : (data.slice().buffer as ArrayBuffer),
    );
    if (!dec) continue;
    const stored = `${name.replace(/\.dds$/i, "")}.png`;
    if (yielded.has(stored)) continue;
    yielded.add(stored);
    const blob = await encodePngBlob(dec.width, dec.height, dec.rgba);
    yield { path: stored, blob, mimeType: "image/png" };
  }
}

export async function* processBethesdaArchive(
  file: File,
): AsyncGenerator<ProcessedAsset> {
  const buffer = await file.arrayBuffer();
  if (buffer.byteLength < 36) return;
  const magic = new DataView(buffer).getUint32(0, true);
  if (magic === BSA_MAGIC) {
    yield* readBsa(buffer);
  } else if (magic === BTDX_MAGIC) {
    yield* readBa2(buffer);
  }
}

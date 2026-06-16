// Valve Pak (VPK) archive reader: the package format of the Source engine and
// Source 2 (Half-Life 2, Portal, the Source 2 tools, ...).
//
// A VPK set is one "_dir.vpk" holding the directory tree plus a run of numbered
// "_NNN.vpk" data archives. Each directory entry points at (archiveIndex,
// offset, length); index 0x7FFF means the bytes live inline in the _dir file
// after the tree. We parse the (small) tree fully, then pull each wanted file's
// bytes with File.slice() so the multi-gigabyte data archives are never loaded
// whole. VTF textures are decoded to PNG; audio/image/video files pass through.

import type { ProcessedAsset } from "./rmmv";
import { decodeVtf } from "./vtf";
import { decodeTga } from "./tga";
import { encodePngBlob } from "./png";

const VPK_SIGNATURE = 0x55aa1234;
const INLINE_ARCHIVE = 0x7fff;
const MAX_ENTRIES = 8000; // cap stored assets so IndexedDB stays manageable
const MAX_FILE_BYTES = 96 * 1024 * 1024;

const PASSTHROUGH: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  bmp: "image/bmp",
  webp: "image/webp",
  wav: "audio/wav",
  mp3: "audio/mpeg",
  ogg: "audio/ogg",
  mp4: "video/mp4",
  webm: "video/webm",
};

type VpkEntry = {
  path: string; // full "dir/name.ext"
  ext: string;
  archiveIndex: number;
  offset: number;
  length: number;
  preload: Uint8Array;
};

function normalizeRel(file: File): string {
  const rel = file.webkitRelativePath || file.name;
  const slash = rel.indexOf("/");
  return (slash >= 0 ? rel.slice(slash + 1) : rel).replace(/\\/g, "/");
}

// Read a NUL-terminated ASCII string starting at `pos`; returns [string, next].
function readCString(bytes: Uint8Array, pos: number): [string, number] {
  let end = pos;
  while (end < bytes.length && bytes[end] !== 0) end++;
  const s = new TextDecoder().decode(bytes.subarray(pos, end));
  return [s, end + 1];
}

function parseTree(tree: Uint8Array, treeStart: number): VpkEntry[] | null {
  const entries: VpkEntry[] = [];
  const view = new DataView(tree.buffer, tree.byteOffset, tree.byteLength);
  let pos = 0;

  while (pos < tree.length) {
    const [ext, p1] = readCString(tree, pos);
    pos = p1;
    if (ext === "") break; // end of tree
    while (pos < tree.length) {
      const [dir, p2] = readCString(tree, pos);
      pos = p2;
      if (dir === "") break; // end of this extension
      while (pos < tree.length) {
        const [name, p3] = readCString(tree, pos);
        pos = p3;
        if (name === "") break; // end of this directory
        if (pos + 18 > tree.length) return entries.length ? entries : null;

        // DirectoryEntry: CRC(4) preload(2) archiveIdx(2) offset(4) length(4) term(2)
        const preloadBytes = view.getUint16(pos + 4, true);
        const archiveIndex = view.getUint16(pos + 6, true);
        const offset = view.getUint32(pos + 8, true);
        const length = view.getUint32(pos + 12, true);
        pos += 18;

        const preload = tree.subarray(pos, pos + preloadBytes);
        pos += preloadBytes;

        const folder = dir === " " ? "" : dir + "/";
        const fname = ext === " " ? name : `${name}.${ext}`;
        entries.push({
          path: `${folder}${fname}`,
          ext: ext === " " ? "" : ext.toLowerCase(),
          archiveIndex,
          offset: archiveIndex === INLINE_ARCHIVE ? treeStart + offset : offset,
          length,
          preload: preload.slice(),
        });
        if (entries.length >= MAX_ENTRIES) return entries;
      }
    }
  }
  return entries;
}

// Last path component (the engine-relative folder + filename), lowercased.
function storedPath(path: string): string {
  return path.toLowerCase();
}

// A tightly-bounded ArrayBuffer for a (possibly offset) view, as the texture
// decoders expect a buffer whose byte 0 is the file's byte 0.
function exactBuffer(u8: Uint8Array): ArrayBuffer {
  return u8.byteOffset === 0 && u8.byteLength === u8.buffer.byteLength
    ? u8.buffer
    : (u8.slice().buffer as ArrayBuffer);
}

export async function* processVpkArchive(
  dirFile: File,
  allFiles: File[],
): AsyncGenerator<ProcessedAsset> {
  const headerBuf = await dirFile.slice(0, 28).arrayBuffer();
  const hv = new DataView(headerBuf);
  if (hv.byteLength < 12 || hv.getUint32(0, true) !== VPK_SIGNATURE) return;

  const version = hv.getUint32(4, true);
  const treeSize = hv.getUint32(8, true);
  const headerSize = version === 2 ? 28 : 12;

  const treeBuf = await dirFile
    .slice(headerSize, headerSize + treeSize)
    .arrayBuffer();
  const entries = parseTree(new Uint8Array(treeBuf), headerSize + treeSize);
  if (!entries) return;

  // Resolve sibling data archives in the same folder as the _dir file.
  const dirRel = normalizeRel(dirFile);
  const lastSlash = dirRel.lastIndexOf("/");
  const folder = lastSlash >= 0 ? dirRel.slice(0, lastSlash + 1) : "";
  const prefix = dirRel.slice(lastSlash + 1).replace(/_dir\.vpk$/i, "");

  const byRel = new Map<string, File>();
  for (const f of allFiles) byRel.set(normalizeRel(f).toLowerCase(), f);

  const archiveFor = (index: number): File | undefined => {
    const padded = String(index).padStart(3, "0");
    return byRel.get(`${folder}${prefix}_${padded}.vpk`.toLowerCase());
  };

  const yielded = new Set<string>();

  for (const entry of entries) {
    const isVtf = entry.ext === "vtf";
    const isTga = entry.ext === "tga";
    const passMime = PASSTHROUGH[entry.ext];
    if (!isVtf && !isTga && !passMime) continue;

    const totalLen = entry.preload.length + entry.length;
    if (totalLen <= 0 || totalLen > MAX_FILE_BYTES) continue;

    // Assemble the file bytes from inline preload + archive slice.
    let data: Uint8Array;
    if (entry.length === 0) {
      data = entry.preload;
    } else {
      const source =
        entry.archiveIndex === INLINE_ARCHIVE
          ? dirFile
          : archiveFor(entry.archiveIndex);
      if (!source) continue;
      let slice: ArrayBuffer;
      try {
        slice = await source
          .slice(entry.offset, entry.offset + entry.length)
          .arrayBuffer();
      } catch {
        continue;
      }
      if (entry.preload.length > 0) {
        data = new Uint8Array(entry.preload.length + entry.length);
        data.set(entry.preload, 0);
        data.set(new Uint8Array(slice), entry.preload.length);
      } else {
        data = new Uint8Array(slice);
      }
    }

    try {
      if (isVtf || isTga) {
        const dec = isVtf
          ? decodeVtf(exactBuffer(data))
          : decodeTga(exactBuffer(data));
        if (!dec) continue;
        const stored = `${storedPath(entry.path).replace(/\.(vtf|tga)$/, "")}.png`;
        if (yielded.has(stored)) continue;
        yielded.add(stored);
        const blob = await encodePngBlob(dec.width, dec.height, dec.rgba);
        yield { path: stored, blob, mimeType: "image/png" };
      } else if (passMime) {
        const stored = storedPath(entry.path);
        if (yielded.has(stored)) continue;
        yielded.add(stored);
        yield {
          path: stored,
          blob: new Blob([data as unknown as BlobPart], { type: passMime }),
          mimeType: passMime,
        };
      }
    } catch {
      // Bad entry: skip quietly.
    }
  }
}

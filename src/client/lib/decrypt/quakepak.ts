// Quake / Quake II PAK ("PACK") archive reader.
//
// PAK is the flat archive that predates GoldSrc's pak/WAD split. It carries the
// engine palette (gfx/palette.lmp for Quake, pics/colormap.pcx for Quake II)
// alongside the art, so we read the palette from the archive first and then
// decode the palettized content exactly: .lmp/qpic pictures, WAD2 lumps, Quake1
// BSP miptex, and Quake II .wal textures. Modern media (TGA/DDS/PNG/JPEG/WAV/OGG)
// is routed straight out. Entries are pulled with File.slice() so large PAKs are
// not loaded whole.

import type { ProcessedAsset } from "./rmmv";
import { decodeTga } from "./tga";
import { decodeDds } from "./dds";
import { encodePngBlob } from "./png";
import {
  decodeQuakeLmp,
  decodeWal,
  decodeQuakeWad2,
  decodeQuakeBspTextures,
} from "./quake";
import { decodeModel } from "./models";

const PACK_MAGIC = 0x4b434150; // "PACK"
const MAX_ENTRIES = 20_000;
const MAX_ENTRY_BYTES = 64 * 1024 * 1024;

const PASSTHROUGH: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  bmp: "image/bmp",
  wav: "audio/wav",
  mp3: "audio/mpeg",
  ogg: "audio/ogg",
};

type PakEntry = { name: string; offset: number; size: number };

function entryName(bytes: Uint8Array): string {
  let end = 0;
  while (end < bytes.length && bytes[end] !== 0) end++;
  return new TextDecoder().decode(bytes.subarray(0, end)).replace(/\\/g, "/");
}

function extOf(name: string): string {
  const dot = name.lastIndexOf(".");
  return dot >= 0 ? name.slice(dot + 1).toLowerCase() : "";
}

function sanitize(name: string): string {
  return name.replace(/[^a-z0-9_/-]/gi, "_").toLowerCase();
}

// Extract a 768-byte RGB palette from a PCX trailer (Quake II colormap.pcx).
function paletteFromPcx(buf: Uint8Array): Uint8Array | null {
  if (buf.length < 769) return null;
  const marker = buf[buf.length - 769];
  if (marker !== 0x0c) return null;
  return buf.subarray(buf.length - 768);
}

export async function* processQuakePak(
  file: File,
): AsyncGenerator<ProcessedAsset> {
  const head = await file.slice(0, 12).arrayBuffer();
  const hv = new DataView(head);
  if (hv.byteLength < 12 || hv.getUint32(0, true) !== PACK_MAGIC) return;

  const dirOffset = hv.getInt32(4, true);
  const dirLength = hv.getInt32(8, true);
  const count = Math.floor(dirLength / 64);
  if (count <= 0 || count > MAX_ENTRIES) return;
  if (dirOffset < 0 || dirOffset + dirLength > file.size) return;

  const dirBuf = new Uint8Array(
    await file.slice(dirOffset, dirOffset + dirLength).arrayBuffer(),
  );
  const dv = new DataView(dirBuf.buffer);
  const entries: PakEntry[] = [];
  for (let i = 0; i < count; i++) {
    const e = i * 64;
    entries.push({
      name: entryName(dirBuf.subarray(e, e + 56)),
      offset: dv.getInt32(e + 56, true),
      size: dv.getInt32(e + 60, true),
    });
  }

  const read = async (entry: PakEntry): Promise<ArrayBuffer | null> => {
    if (entry.size <= 0 || entry.size > MAX_ENTRY_BYTES) return null;
    if (entry.offset < 0 || entry.offset + entry.size > file.size) return null;
    try {
      return await file
        .slice(entry.offset, entry.offset + entry.size)
        .arrayBuffer();
    } catch {
      return null;
    }
  };

  // Pass 1: locate the engine palette inside the archive.
  let palette: Uint8Array | null = null;
  for (const entry of entries) {
    const lower = entry.name.toLowerCase();
    if (lower.endsWith("palette.lmp") && entry.size >= 768) {
      const buf = await read(entry);
      if (buf) palette = new Uint8Array(buf, 0, 768);
      break;
    }
  }
  if (!palette) {
    for (const entry of entries) {
      if (entry.name.toLowerCase().endsWith("colormap.pcx")) {
        const buf = await read(entry);
        if (buf) palette = paletteFromPcx(new Uint8Array(buf));
        if (palette) break;
      }
    }
  }

  // Sibling fetcher for multi-file studio models (rare in PAK, but keeps the
  // model dispatcher uniform). Resolves by raw entry name, case-insensitively.
  const entryByName = new Map<string, PakEntry>();
  for (const e of entries) entryByName.set(e.name.toLowerCase(), e);
  const fetchSibling = async (p: string): Promise<Uint8Array | null> => {
    const e = entryByName.get(p.toLowerCase());
    if (!e) return null;
    const buf = await read(e);
    return buf ? new Uint8Array(buf) : null;
  };

  const yielded = new Set<string>();
  const emitImage = async (
    rgba: Uint8Array,
    w: number,
    h: number,
    path: string,
  ): Promise<ProcessedAsset | null> => {
    if (yielded.has(path)) return null;
    yielded.add(path);
    const blob = await encodePngBlob(w, h, rgba);
    return { path, blob, mimeType: "image/png" };
  };

  for (const entry of entries) {
    const ext = extOf(entry.name);
    const base = sanitize(entry.name.replace(/\.[^.]*$/, ""));

    if (PASSTHROUGH[ext]) {
      const buf = await read(entry);
      if (!buf) continue;
      const path = sanitize(entry.name);
      if (yielded.has(path)) continue;
      yielded.add(path);
      yield {
        path,
        blob: new Blob([buf], { type: PASSTHROUGH[ext]! }),
        mimeType: PASSTHROUGH[ext]!,
      };
      continue;
    }

    if (ext === "tga" || ext === "dds") {
      const buf = await read(entry);
      if (!buf) continue;
      const dec = ext === "tga" ? decodeTga(buf) : decodeDds(buf);
      if (!dec) continue;
      const asset = await emitImage(
        dec.rgba,
        dec.width,
        dec.height,
        `${base}.png`,
      );
      if (asset) yield asset;
      continue;
    }

    // Native models: Quake 1 .mdl (IDPO) and Quake 2 .md2 (IDP2) -> GLB. These
    // are self-contained and don't need the engine palette, so handle them here.
    if (ext === "mdl" || ext === "md2") {
      const buf = await read(entry);
      if (!buf) continue;
      let glb: Uint8Array | null = null;
      try {
        glb = await decodeModel(
          entry.name.toLowerCase(),
          new Uint8Array(buf),
          fetchSibling,
        );
      } catch {
        glb = null;
      }
      if (!glb) continue;
      const stored = `${base}.glb`;
      if (yielded.has(stored)) continue;
      yielded.add(stored);
      yield {
        path: stored,
        blob: new Blob([glb as unknown as BlobPart], {
          type: "model/gltf-binary",
        }),
        mimeType: "model/gltf-binary",
      };
      continue;
    }

    if (!palette) continue; // palettized formats below need the engine palette

    if (ext === "lmp") {
      if (/palette|colormap/.test(entry.name.toLowerCase())) continue;
      const buf = await read(entry);
      if (!buf) continue;
      const u8 = new Uint8Array(buf);
      const dec = decodeQuakeLmp(u8, 0, u8.length, palette);
      if (!dec) continue;
      const asset = await emitImage(
        dec.rgba,
        dec.width,
        dec.height,
        `${base}.png`,
      );
      if (asset) yield asset;
    } else if (ext === "wal") {
      const buf = await read(entry);
      if (!buf) continue;
      const dec = decodeWal(buf, palette);
      if (!dec) continue;
      const asset = await emitImage(
        dec.rgba,
        dec.width,
        dec.height,
        `${base}.png`,
      );
      if (asset) yield asset;
    } else if (ext === "wad") {
      const buf = await read(entry);
      if (!buf) continue;
      for (const tex of decodeQuakeWad2(buf, palette)) {
        const asset = await emitImage(
          tex.rgba,
          tex.width,
          tex.height,
          `${base}/${sanitize(tex.name)}.png`,
        );
        if (asset) yield asset;
      }
    } else if (ext === "bsp") {
      const buf = await read(entry);
      if (!buf) continue;
      for (const tex of decodeQuakeBspTextures(buf, palette)) {
        const asset = await emitImage(
          tex.rgba,
          tex.width,
          tex.height,
          `${base}/${sanitize(tex.name)}.png`,
        );
        if (asset) yield asset;
      }
    }
  }
}

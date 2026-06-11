import { BinaryReader } from "../binary";
import type { ProcessedAsset } from "./rmmv";

const GDPC_MAGIC = 0x43504447; // "GDPC" LE

const MIME_MAP: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".bmp": "image/bmp",
  ".gif": "image/gif",
  ".svg": "image/svg+xml",
  ".ogg": "audio/ogg",
  ".mp3": "audio/mpeg",
  ".wav": "audio/wav",
  ".opus": "audio/opus",
  ".flac": "audio/flac",
  ".ogv": "video/ogg",
  ".webm": "video/webm",
  ".mp4": "video/mp4",
};

const MEDIA_EXTS = new Set(Object.keys(MIME_MAP));

function getExt(path: string): string {
  const dot = path.lastIndexOf(".");
  return dot >= 0 ? path.slice(dot).toLowerCase() : "";
}

function getMime(path: string): string {
  return MIME_MAP[getExt(path)] ?? "application/octet-stream";
}

function isMedia(path: string): boolean {
  return MEDIA_EXTS.has(getExt(path));
}

function stripResPrefix(path: string): string {
  if (path.startsWith("res://")) return path.slice(6);
  if (path.startsWith("user://")) return path.slice(7);
  return path;
}

// Read null-terminated UTF-8 string from a fixed-length buffer
function readPaddedString(bytes: Uint8Array, length: number): string {
  const slice = bytes.subarray(0, length);
  let end = 0;
  while (end < slice.length && slice[end] !== 0) end++;
  return new TextDecoder().decode(slice.subarray(0, end));
}

export async function* processGodotPck(
  file: File,
): AsyncGenerator<ProcessedAsset> {
  const buf = await file.arrayBuffer();
  const reader = new BinaryReader(buf);

  if (reader.length < 8) return;

  const magic = reader.readUint32LE();
  if (magic !== GDPC_MAGIC) return;

  const packVersion = reader.readUint32LE();
  // ver_major, ver_minor, ver_patch
  reader.skip(12);
  // reserved[16]
  reader.skip(64);

  let fileBaseOffset = 0;

  if (packVersion === 2) {
    // Godot 4: extra flags (uint32) and file_base_offset (uint64)
    if (reader.remaining < 12 + 4) return;
    const flags = reader.readUint32LE();
    if (flags & 1) return; // whole-pack encryption: can't handle
    // Read uint64 as two uint32s (files are <4GB in practice)
    const baseLo = reader.readUint32LE();
    const baseHi = reader.readUint32LE();
    fileBaseOffset = baseHi * 0x100000000 + baseLo;
  } else if (packVersion !== 1) {
    return; // Unknown format
  }

  if (reader.remaining < 4) return;
  const fileCount = reader.readUint32LE();

  const bytes = new Uint8Array(buf);

  for (let i = 0; i < fileCount; i++) {
    if (reader.remaining < 4) break;
    const pathLen = reader.readUint32LE();

    if (reader.remaining < pathLen) break;
    const pathBytes = bytes.subarray(reader.offset, reader.offset + pathLen);
    const rawPath = readPaddedString(pathBytes, pathLen);
    reader.skip(pathLen);

    if (reader.remaining < 32) break; // 8 offset + 8 size + 16 md5
    // offset: uint64
    const offsetLo = reader.readUint32LE();
    const offsetHi = reader.readUint32LE();
    // size: uint64
    const sizeLo = reader.readUint32LE();
    const sizeHi = reader.readUint32LE();
    // md5: 16 bytes
    reader.skip(16);

    if (packVersion === 2) {
      if (reader.remaining < 4) break;
      const entryFlags = reader.readUint32LE();
      if (entryFlags & 1) continue; // encrypted entry: skip
    }

    const fileOffset = fileBaseOffset + (offsetHi * 0x100000000 + offsetLo);
    const fileSize = sizeHi * 0x100000000 + sizeLo;

    const strippedPath = stripResPrefix(rawPath).replace(/\\/g, "/");
    if (!isMedia(strippedPath)) continue;
    if (fileOffset + fileSize > buf.byteLength) continue;

    const data = buf.slice(fileOffset, fileOffset + fileSize);
    const mime = getMime(strippedPath);

    yield {
      path: strippedPath.toLowerCase(),
      blob: new Blob([data], { type: mime }),
      mimeType: mime,
    };
  }
}

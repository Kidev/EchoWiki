import { BinaryReader } from "../binary";
import type { ProcessedAsset } from "./rmmv";

const FORM_MAGIC = 0x4d524f46; // "FORM" LE
const PNG_SIG_0 = 0x89;
const PNG_SIG_1 = 0x50; // 'P'

function chunkTag(buf: ArrayBuffer, pos: number): string {
  const b = new Uint8Array(buf, pos, 4);
  return String.fromCharCode(b[0]!, b[1]!, b[2]!, b[3]!);
}

function detectAudioType(
  buf: ArrayBuffer,
  offset: number,
): { mime: string; ext: string } {
  if (offset + 4 > buf.byteLength) return { mime: "audio/ogg", ext: ".ogg" };
  const b = new Uint8Array(buf, offset, Math.min(4, buf.byteLength - offset));
  // OGG: "OggS"
  if (b[0] === 0x4f && b[1] === 0x67 && b[2] === 0x67 && b[3] === 0x53)
    return { mime: "audio/ogg", ext: ".ogg" };
  // RIFF (WAV)
  if (b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46)
    return { mime: "audio/wav", ext: ".wav" };
  // ID3 (MP3)
  if (b[0] === 0x49 && b[1] === 0x44 && b[2] === 0x33)
    return { mime: "audio/mpeg", ext: ".mp3" };
  // MP3 sync
  if (b[0] === 0xff && b[1] !== undefined && (b[1] & 0xe0) === 0xe0)
    return { mime: "audio/mpeg", ext: ".mp3" };
  return { mime: "audio/ogg", ext: ".ogg" };
}

// Walk PNG chunks to find IEND, returning the complete PNG slice
function extractPng(buf: ArrayBuffer, startOffset: number): ArrayBuffer | null {
  if (startOffset + 8 > buf.byteLength) return null;

  const view = new DataView(buf);
  // Check PNG signature
  const sig = new Uint8Array(buf, startOffset, 2);
  if (sig[0] !== PNG_SIG_0 || sig[1] !== PNG_SIG_1) return null;

  let pos = startOffset + 8; // skip 8-byte PNG signature
  const end = buf.byteLength;

  while (pos + 12 <= end) {
    const chunkLen = view.getUint32(pos, false); // big-endian
    if (chunkLen > 64 * 1024 * 1024) break; // sanity cap
    const typeBytes = new Uint8Array(buf, pos + 4, 4);
    const type = String.fromCharCode(
      typeBytes[0]!,
      typeBytes[1]!,
      typeBytes[2]!,
      typeBytes[3]!,
    );
    pos += 12 + chunkLen; // length(4) + type(4) + data + crc(4)
    if (type === "IEND") {
      return buf.slice(startOffset, pos);
    }
  }
  return null;
}

export async function* processGameMakerData(
  file: File,
): AsyncGenerator<ProcessedAsset> {
  const buf = await file.arrayBuffer();
  const view = new DataView(buf);

  if (buf.byteLength < 8) return;
  if (view.getUint32(0, true) !== FORM_MAGIC) return;

  const formEnd = Math.min(8 + view.getUint32(4, true), buf.byteLength);
  let pos = 8;

  while (pos + 8 <= formEnd) {
    const id = chunkTag(buf, pos);
    const chunkLen = view.getUint32(pos + 4, true);
    const chunkStart = pos + 8;
    pos = chunkStart + chunkLen;

    if (pos > formEnd) break;

    if (id === "TXTR") {
      // Texture pages: each has a pointer to PNG data somewhere in the file
      if (chunkStart + 4 > buf.byteLength) continue;
      const reader = new BinaryReader(buf);
      reader.seek(chunkStart);
      const count = reader.readUint32LE();

      for (let i = 0; i < count; i++) {
        const offsetsBase = chunkStart + 4;
        if (offsetsBase + (i + 1) * 4 > buf.byteLength) break;
        const itemOffset = view.getUint32(offsetsBase + i * 4, true);

        // Each item: unknown(4) + pngDataAbsoluteOffset(4)
        if (itemOffset + 8 > buf.byteLength) continue;
        view.getUint32(itemOffset, true); // unknown field
        const pngOffset = view.getUint32(itemOffset + 4, true);

        const pngData = extractPng(buf, pngOffset);
        if (!pngData) continue;

        yield {
          path: `textures/texture_${i}.png`,
          blob: new Blob([pngData], { type: "image/png" }),
          mimeType: "image/png",
        };
      }
    } else if (id === "AUDO") {
      // Audio blobs: each offset points to (size: uint32, data: size bytes)
      if (chunkStart + 4 > buf.byteLength) continue;
      const count = view.getUint32(chunkStart, true);

      for (let i = 0; i < count; i++) {
        const offsetsBase = chunkStart + 4;
        if (offsetsBase + (i + 1) * 4 > buf.byteLength) break;
        const itemOffset = view.getUint32(offsetsBase + i * 4, true);

        if (itemOffset + 4 > buf.byteLength) continue;
        const audioSize = view.getUint32(itemOffset, true);
        const audioStart = itemOffset + 4;

        if (audioStart + audioSize > buf.byteLength || audioSize === 0)
          continue;
        const audioData = buf.slice(audioStart, audioStart + audioSize);
        const { mime, ext } = detectAudioType(buf, audioStart);

        yield {
          path: `audio/audio_${i}${ext}`,
          blob: new Blob([audioData], { type: mime }),
          mimeType: mime,
        };
      }
    }
  }
}

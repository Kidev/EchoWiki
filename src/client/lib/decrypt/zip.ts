import type { ProcessedAsset } from "./rmmv";

// ZIP reader driven by the central directory, with DEFLATE support.
//
// The central directory (rather than streaming local headers) gives reliable
// sizes even for archives written with data descriptors, and method-8 entries
// are inflated via the browser's DecompressionStream("deflate-raw"). This is
// what makes the ZIP-based game containers (Quake/RtCW .pk3, Doom 3 .pk4, Call
// of Duty .iwd, CryEngine .pak, Source BSP pakfiles) actually unpack: their
// payloads are almost entirely deflate-compressed.

const EOCD_SIG = 0x06054b50; // PK\x05\x06
const CEN_SIG = 0x02014b50; // PK\x01\x02

const MIME_MAP: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".bmp": "image/bmp",
  ".webp": "image/webp",
  ".ogg": "audio/ogg",
  ".mid": "audio/midi",
  ".midi": "audio/midi",
  ".wav": "audio/wav",
  ".mp3": "audio/mpeg",
  ".wma": "audio/x-ms-wma",
  ".txt": "text/plain",
};

function getMimeType(filename: string): string {
  const dotIdx = filename.lastIndexOf(".");
  if (dotIdx < 0) return "application/octet-stream";
  return (
    MIME_MAP[filename.slice(dotIdx).toLowerCase()] ?? "application/octet-stream"
  );
}

async function inflateWith(
  format: "deflate-raw" | "deflate",
  data: Uint8Array,
): Promise<Uint8Array | null> {
  if (typeof DecompressionStream === "undefined") return null;
  try {
    const ds = new DecompressionStream(format);
    const writer = ds.writable.getWriter();
    void writer.write(data);
    void writer.close();
    const buf = await new Response(ds.readable).arrayBuffer();
    return new Uint8Array(buf);
  } catch {
    return null;
  }
}

// Inflate a raw DEFLATE stream (ZIP method 8) using the platform decompressor.
export function inflateRaw(data: Uint8Array): Promise<Uint8Array | null> {
  return inflateWith("deflate-raw", data);
}

// Inflate a zlib-wrapped DEFLATE stream (header + adler32), used by BSA archives.
export function inflateZlib(data: Uint8Array): Promise<Uint8Array | null> {
  return inflateWith("deflate", data);
}

type CentralEntry = {
  name: string;
  method: number;
  compSize: number;
  localOffset: number;
};

// Locate and parse the End Of Central Directory, then the central directory.
function readCentralDirectory(
  view: DataView,
  bytes: Uint8Array,
): CentralEntry[] {
  const len = view.byteLength;
  // EOCD lies within the last 22 + up to 65535 comment bytes; scan backwards.
  const scanFrom = Math.max(0, len - 22 - 0xffff);
  let eocd = -1;
  for (let i = len - 22; i >= scanFrom; i--) {
    if (view.getUint32(i, true) === EOCD_SIG) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) return [];

  const total = view.getUint16(eocd + 10, true);
  let pos = view.getUint32(eocd + 16, true);
  const entries: CentralEntry[] = [];

  for (let i = 0; i < total; i++) {
    if (pos + 46 > len || view.getUint32(pos, true) !== CEN_SIG) break;
    const method = view.getUint16(pos + 10, true);
    const compSize = view.getUint32(pos + 20, true);
    const nameLen = view.getUint16(pos + 28, true);
    const extraLen = view.getUint16(pos + 30, true);
    const commentLen = view.getUint16(pos + 32, true);
    const localOffset = view.getUint32(pos + 42, true);
    const name = new TextDecoder().decode(
      bytes.subarray(pos + 46, pos + 46 + nameLen),
    );
    entries.push({ name, method, compSize, localOffset });
    pos += 46 + nameLen + extraLen + commentLen;
  }
  return entries;
}

export async function* processZipArchive(
  archiveFile: File,
): AsyncGenerator<ProcessedAsset> {
  const buffer = await archiveFile.arrayBuffer();
  const view = new DataView(buffer);
  const bytes = new Uint8Array(buffer);
  if (view.byteLength < 22) return;

  const entries = readCentralDirectory(view, bytes);
  if (entries.length === 0) return;

  for (const entry of entries) {
    if (entry.name.endsWith("/") || entry.compSize === 0) continue;
    if (entry.method !== 0 && entry.method !== 8) continue;

    // Resolve the data start from the local header (its name/extra lengths can
    // differ from the central record).
    const lo = entry.localOffset;
    if (lo + 30 > view.byteLength) continue;
    const lNameLen = view.getUint16(lo + 26, true);
    const lExtraLen = view.getUint16(lo + 28, true);
    const dataStart = lo + 30 + lNameLen + lExtraLen;
    if (dataStart + entry.compSize > view.byteLength) continue;

    const raw = bytes.subarray(dataStart, dataStart + entry.compSize);
    let data: Uint8Array | null;
    if (entry.method === 0) {
      data = raw;
    } else {
      data = await inflateRaw(raw);
      if (!data) continue;
    }

    const path = entry.name.replace(/\\/g, "/").toLowerCase();
    const mime = getMimeType(entry.name);
    yield {
      path,
      blob: new Blob([data as unknown as BlobPart], { type: mime }),
      mimeType: mime,
    };
  }
}

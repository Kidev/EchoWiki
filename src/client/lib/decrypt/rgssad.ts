import { BinaryReader } from "../binary";
import type { ProcessedAsset } from "./rmmv";

const INITIAL_KEY = 0xdeadcafe;

const MIME_MAP: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".bmp": "image/bmp",
  ".ogg": "audio/ogg",
  ".mid": "audio/midi",
  ".midi": "audio/midi",
  ".wav": "audio/wav",
  ".mp3": "audio/mpeg",
  ".wma": "audio/x-ms-wma",
  ".txt": "text/plain",
  ".rb": "text/plain",
};

function getMimeType(filename: string): string {
  const dotIdx = filename.lastIndexOf(".");
  if (dotIdx < 0) return "application/octet-stream";
  const ext = filename.slice(dotIdx).toLowerCase();
  return MIME_MAP[ext] ?? "application/octet-stream";
}

function advanceKey(key: number): number {
  return Math.imul(key, 7) + 3;
}

function decryptInt(reader: BinaryReader, key: number): { value: number; nextKey: number } {
  const encrypted = reader.readUint32LE();
  const value = (encrypted ^ key) >>> 0;
  const nextKey = advanceKey(key);
  return { value, nextKey };
}

type ArchiveEntry = {
  filename: string;
  size: number;
  offset: number;
  key: number;
};

function readDirectory(reader: BinaryReader): ArchiveEntry[] {
  reader.seek(8);

  const entries: ArchiveEntry[] = [];
  let key = INITIAL_KEY;

  while (reader.offset < reader.length) {
    const nameLenResult = decryptInt(reader, key);
    const nameLen = nameLenResult.value;
    key = nameLenResult.nextKey;

    if (nameLen === 0 || nameLen > 10000) break;

    const nameBytes = new Uint8Array(nameLen);
    for (let i = 0; i < nameLen; i++) {
      const encrypted = reader.readUint8();
      nameBytes[i] = (encrypted ^ (key & 0xff)) & 0xff;
      key = advanceKey(key);
    }
    const filename = new TextDecoder().decode(nameBytes);

    const sizeResult = decryptInt(reader, key);
    const size = sizeResult.value;
    key = sizeResult.nextKey;

    const offset = reader.offset;
    const fileKey = key;

    reader.skip(size);

    entries.push({ filename, size, offset, key: fileKey });
  }

  return entries;
}

function decryptFileData(reader: BinaryReader, entry: ArchiveEntry): Uint8Array {
  reader.seek(entry.offset);
  const encrypted = reader.readBytes(entry.size);
  const result = new Uint8Array(entry.size);

  let key = entry.key;
  const keyBytes = new Uint8Array(4);

  for (let i = 0; i < entry.size; ) {
    keyBytes[0] = key & 0xff;
    keyBytes[1] = (key >>> 8) & 0xff;
    keyBytes[2] = (key >>> 16) & 0xff;
    keyBytes[3] = (key >>> 24) & 0xff;

    for (let j = 0; j < 4 && i < entry.size; j++, i++) {
      result[i] = (encrypted[i]! ^ keyBytes[j]!) & 0xff;
    }

    key = advanceKey(key);
  }

  return result;
}

export async function* processRgssadArchive(archiveFile: File): AsyncGenerator<ProcessedAsset> {
  const buffer = await archiveFile.arrayBuffer();
  const reader = new BinaryReader(buffer);

  const header = reader.peekString(7);
  if (header !== "RGSSAD\0") {
    throw new Error("Not a valid RGSSAD archive");
  }

  const entries = readDirectory(reader);

  for (const entry of entries) {
    const data = decryptFileData(reader, entry);
    const path = entry.filename.replace(/\\/g, "/").toLowerCase();
    const mime = getMimeType(entry.filename);
    yield {
      path,
      blob: new Blob([data], { type: mime }),
      mimeType: mime,
    };
  }
}

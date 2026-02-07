import { BinaryReader } from '../binary';
import type { ProcessedAsset } from './rmmv';

const MIME_MAP: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.bmp': 'image/bmp',
  '.ogg': 'audio/ogg',
  '.mid': 'audio/midi',
  '.midi': 'audio/midi',
  '.wav': 'audio/wav',
  '.mp3': 'audio/mpeg',
  '.wma': 'audio/x-ms-wma',
  '.txt': 'text/plain',
  '.rb': 'text/plain',
  '.rvdata2': 'application/octet-stream',
};

function getMimeType(filename: string): string {
  const dotIdx = filename.lastIndexOf('.');
  if (dotIdx < 0) return 'application/octet-stream';
  const ext = filename.slice(dotIdx).toLowerCase();
  return MIME_MAP[ext] ?? 'application/octet-stream';
}

function advanceKey(key: number): number {
  return Math.imul(key, 7) + 3;
}

type ArchiveEntry = {
  filename: string;
  size: number;
  offset: number;
  key: number;
};

function readDirectory(reader: BinaryReader): ArchiveEntry[] {
  reader.seek(8);

  const rawKey = reader.readUint32LE();
  const masterKey = (Math.imul(rawKey, 9) + 3) >>> 0;

  const entries: ArchiveEntry[] = [];

  while (reader.offset < reader.length) {
    const encOffset = reader.readUint32LE();
    const fileOffset = (encOffset ^ masterKey) >>> 0;

    if (fileOffset === 0) break;

    const encSize = reader.readUint32LE();
    const fileSize = (encSize ^ masterKey) >>> 0;

    const encFileKey = reader.readUint32LE();
    const fileKey = (encFileKey ^ masterKey) >>> 0;

    const encNameLen = reader.readUint32LE();
    const nameLen = (encNameLen ^ masterKey) >>> 0;

    if (nameLen === 0 || nameLen > 10000) break;

    const nameBytes = new Uint8Array(nameLen);
    const keyBytes = new Uint8Array(4);
    keyBytes[0] = masterKey & 0xff;
    keyBytes[1] = (masterKey >>> 8) & 0xff;
    keyBytes[2] = (masterKey >>> 16) & 0xff;
    keyBytes[3] = (masterKey >>> 24) & 0xff;

    for (let i = 0; i < nameLen; i++) {
      const encrypted = reader.readUint8();
      nameBytes[i] = (encrypted ^ keyBytes[i % 4]!) & 0xff;
    }
    const filename = new TextDecoder().decode(nameBytes);

    entries.push({ filename, size: fileSize, offset: fileOffset, key: fileKey });
  }

  return entries;
}

function decryptFileData(reader: BinaryReader, entry: ArchiveEntry): Uint8Array {
  reader.seek(entry.offset);
  const encrypted = reader.readBytes(entry.size);
  const result = new Uint8Array(entry.size);

  let key = entry.key;
  const keyBuf = new Uint8Array(4);

  for (let i = 0; i < entry.size; ) {
    keyBuf[0] = key & 0xff;
    keyBuf[1] = (key >>> 8) & 0xff;
    keyBuf[2] = (key >>> 16) & 0xff;
    keyBuf[3] = (key >>> 24) & 0xff;

    for (let j = 0; j < 4 && i < entry.size; j++, i++) {
      result[i] = (encrypted[i]! ^ keyBuf[j]!) & 0xff;
    }

    key = advanceKey(key);
  }

  return result;
}

export async function* processRgss3aArchive(archiveFile: File): AsyncGenerator<ProcessedAsset> {
  const buffer = await archiveFile.arrayBuffer();
  const reader = new BinaryReader(buffer);

  const header = reader.peekString(7);
  if (header !== 'RGSSAD\0') {
    throw new Error('Not a valid RGSS3A archive');
  }

  reader.seek(7);
  const version = reader.readUint8();
  if (version !== 3) {
    throw new Error(`Expected RGSSAD v3, got v${version}`);
  }

  const entries = readDirectory(reader);

  for (const entry of entries) {
    const data = decryptFileData(reader, entry);
    const path = entry.filename.replace(/\\/g, '/').toLowerCase();
    const mime = getMimeType(entry.filename);
    yield {
      path,
      blob: new Blob([data], { type: mime }),
      mimeType: mime,
    };
  }
}

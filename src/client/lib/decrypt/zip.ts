import { BinaryReader } from '../binary';
import type { ProcessedAsset } from './rmmv';

const LOCAL_FILE_HEADER_SIG = 0x04034b50;

const MIME_MAP: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.bmp': 'image/bmp',
  '.ogg': 'audio/ogg',
  '.mid': 'audio/midi',
  '.midi': 'audio/midi',
  '.wav': 'audio/wav',
  '.mp3': 'audio/mpeg',
  '.wma': 'audio/x-ms-wma',
  '.txt': 'text/plain',
};

function getMimeType(filename: string): string {
  const dotIdx = filename.lastIndexOf('.');
  if (dotIdx < 0) return 'application/octet-stream';
  const ext = filename.slice(dotIdx).toLowerCase();
  return MIME_MAP[ext] ?? 'application/octet-stream';
}

export async function* processZipArchive(archiveFile: File): AsyncGenerator<ProcessedAsset> {
  const buffer = await archiveFile.arrayBuffer();
  const reader = new BinaryReader(buffer);

  while (reader.remaining >= 30) {
    const sig = reader.readUint32LE();
    if (sig !== LOCAL_FILE_HEADER_SIG) break;

    reader.skip(2);
    reader.skip(2);
    const compressionMethod = reader.readUint16LE();
    reader.skip(2);
    reader.skip(2);
    reader.skip(4);
    const compressedSize = reader.readUint32LE();
    reader.skip(4);
    const fileNameLen = reader.readUint16LE();
    const extraFieldLen = reader.readUint16LE();

    const fileName = reader.readString(fileNameLen);
    reader.skip(extraFieldLen);

    if (compressedSize === 0 || fileName.endsWith('/')) {
      reader.skip(compressedSize);
      continue;
    }

    if (compressionMethod !== 0) {
      reader.skip(compressedSize);
      continue;
    }

    const data = reader.readBytes(compressedSize);
    const path = fileName.replace(/\\/g, '/').toLowerCase();
    const mime = getMimeType(fileName);

    yield {
      path,
      blob: new Blob([data], { type: mime }),
      mimeType: mime,
    };
  }
}

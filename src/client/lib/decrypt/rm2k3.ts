import { BinaryReader } from '../binary';
import type { ProcessedAsset } from './rmmv';

const MIME_MAP: Record<string, string> = {
  '.png': 'image/png',
  '.bmp': 'image/bmp',
  '.xyz': 'image/png',
  '.wav': 'audio/wav',
  '.mid': 'audio/midi',
  '.midi': 'audio/midi',
  '.mp3': 'audio/mpeg',
  '.ogg': 'audio/ogg',
};

function getMimeType(ext: string): string {
  return MIME_MAP[ext.toLowerCase()] ?? 'application/octet-stream';
}

async function convertXyzToPng(buffer: ArrayBuffer): Promise<Blob> {
  const reader = new BinaryReader(buffer);
  const magic = reader.readString(4);
  if (magic !== 'XYZ1') {
    throw new Error('Not an XYZ file');
  }

  const width = reader.readUint16LE();
  const height = reader.readUint16LE();

  const compressed = reader.readBytes(reader.remaining);

  const ds = new DecompressionStream('deflate');
  const writer = ds.writable.getWriter();
  const writePromise = writer.write(compressed).then(() => writer.close());

  const chunks: Uint8Array[] = [];
  const readableReader = ds.readable.getReader();
  for (;;) {
    const { done, value } = await readableReader.read();
    if (done) break;
    chunks.push(value as Uint8Array);
  }
  await writePromise;

  const totalLen = chunks.reduce((sum, c) => sum + c.length, 0);
  const decompressed = new Uint8Array(totalLen);
  let offset = 0;
  for (const chunk of chunks) {
    decompressed.set(chunk, offset);
    offset += chunk.length;
  }

  const palette = decompressed.subarray(0, 768);
  const pixels = decompressed.subarray(768);

  const canvas = new OffscreenCanvas(width, height);
  const ctx = canvas.getContext('2d')!;
  const imageData = ctx.createImageData(width, height);
  const data = imageData.data;

  for (let i = 0; i < width * height; i++) {
    const palIdx = pixels[i]! * 3;
    const outIdx = i * 4;
    data[outIdx] = palette[palIdx]!;
    data[outIdx + 1] = palette[palIdx + 1]!;
    data[outIdx + 2] = palette[palIdx + 2]!;
    data[outIdx + 3] = 255;
  }

  ctx.putImageData(imageData, 0, 0);
  return await canvas.convertToBlob({ type: 'image/png' });
}

const ASSET_DIRS = new Set([
  'backdrop',
  'battle',
  'battle2',
  'battlecharset',
  'battleweapon',
  'charset',
  'chipset',
  'faceset',
  'frame',
  'gameover',
  'monster',
  'movie',
  'music',
  'panorama',
  'picture',
  'sound',
  'system',
  'system2',
  'title',
]);

function isAssetFile(path: string): boolean {
  const parts = path.split('/');
  if (parts.length < 2) return false;
  return ASSET_DIRS.has(parts[0]!);
}

export async function* processRm2k3Files(files: File[]): AsyncGenerator<ProcessedAsset> {
  for (const file of files) {
    const rel = file.webkitRelativePath;
    const slashIdx = rel.indexOf('/');
    const relativePath = slashIdx >= 0 ? rel.slice(slashIdx + 1) : rel;
    const canonical = relativePath.toLowerCase();

    if (
      !isAssetFile(canonical) &&
      !canonical.startsWith('data/') &&
      !canonical.endsWith('.ldb') &&
      !canonical.endsWith('.lmt') &&
      !canonical.endsWith('.lmu')
    ) {
      continue;
    }

    const ext = canonical.slice(canonical.lastIndexOf('.'));

    if (ext === '.xyz') {
      try {
        const buf = await file.arrayBuffer();
        const pngBlob = await convertXyzToPng(buf);
        const path = canonical.slice(0, canonical.lastIndexOf('.')) + '.png';
        yield { path, blob: pngBlob, mimeType: 'image/png' };
      } catch {}
    } else {
      const mime = getMimeType(ext);
      yield {
        path: canonical,
        blob: new Blob([await file.arrayBuffer()], { type: mime }),
        mimeType: mime,
      };
    }
  }
}

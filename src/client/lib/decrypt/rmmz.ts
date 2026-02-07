import { getFileByNormalizedPath } from '../detect';
import { decryptMvBuffer, parseHexKey, recoverKeyFromPng } from './rmmv';
import type { ProcessedAsset } from './rmmv';

const EXT_MAP: Record<string, string> = {
  '.png_': '.png',
  '.ogg_': '.ogg',
  '.m4a_': '.m4a',
};

const MIME_MAP: Record<string, string> = {
  '.png': 'image/png',
  '.ogg': 'audio/ogg',
  '.m4a': 'audio/mp4',
};

function getMzDecryptedExtension(filename: string): string {
  const lower = filename.toLowerCase();
  for (const [enc, dec] of Object.entries(EXT_MAP)) {
    if (lower.endsWith(enc)) return dec;
  }
  return '';
}

function getMimeType(ext: string): string {
  return MIME_MAP[ext] ?? 'application/octet-stream';
}

function isEncryptedMzFile(filename: string): boolean {
  const lower = filename.toLowerCase();
  return lower.endsWith('.png_') || lower.endsWith('.ogg_') || lower.endsWith('.m4a_');
}

async function extractKeyFromSystem(files: File[]): Promise<string | null> {
  const systemFile = getFileByNormalizedPath(files, 'data/System.json');
  if (!systemFile) return null;

  try {
    const text = await systemFile.text();
    const json = JSON.parse(text) as { encryptionKey?: string };
    return json.encryptionKey ?? null;
  } catch {
    return null;
  }
}

export async function* processMzFiles(
  files: File[],
  keyOverride?: string
): AsyncGenerator<ProcessedAsset> {
  let key: Uint8Array | null = null;

  if (keyOverride) {
    key = parseHexKey(keyOverride);
  } else {
    const hexKey = await extractKeyFromSystem(files);
    if (hexKey) {
      key = parseHexKey(hexKey);
    }
  }

  for (const file of files) {
    const rel = file.webkitRelativePath;
    const slashIdx = rel.indexOf('/');
    const relativePath = slashIdx >= 0 ? rel.slice(slashIdx + 1) : rel;
    const canonical = relativePath.toLowerCase();

    if (isEncryptedMzFile(file.name)) {
      if (!key) {
        if (file.name.toLowerCase().endsWith('.png_')) {
          const buf = await file.arrayBuffer();
          key = recoverKeyFromPng(buf);
          if (key) {
            const decExt = getMzDecryptedExtension(file.name);
            const mime = getMimeType(decExt);
            const decrypted = decryptMvBuffer(buf, key);
            const extIdx = canonical.lastIndexOf('.');
            const path = extIdx >= 0 ? canonical.slice(0, extIdx) + decExt : canonical;
            yield { path, blob: new Blob([decrypted], { type: mime }), mimeType: mime };
            continue;
          }
        }
        continue;
      }

      const buf = await file.arrayBuffer();
      const decExt = getMzDecryptedExtension(file.name);
      const mime = getMimeType(decExt);
      const decrypted = decryptMvBuffer(buf, key);
      const extIdx = canonical.lastIndexOf('.');
      const path = extIdx >= 0 ? canonical.slice(0, extIdx) + decExt : canonical;
      yield { path, blob: new Blob([decrypted], { type: mime }), mimeType: mime };
    } else {
      const ext = canonical.slice(canonical.lastIndexOf('.'));
      const mime = getMimeType(ext);
      yield {
        path: canonical,
        blob: new Blob([await file.arrayBuffer()], { type: mime }),
        mimeType: mime,
      };
    }
  }
}

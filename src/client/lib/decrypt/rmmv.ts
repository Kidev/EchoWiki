import { getFileByNormalizedPath } from '../detect';

const RPGMV_HEADER_LEN = 16;

const EXT_MAP: Record<string, string> = {
  '.rpgmvp': '.png',
  '.rpgmvo': '.ogg',
  '.rpgmvm': '.m4a',
};

const MIME_MAP: Record<string, string> = {
  '.png': 'image/png',
  '.ogg': 'audio/ogg',
  '.m4a': 'audio/mp4',
};

const PNG_HEADER = new Uint8Array([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
]);

export function parseHexKey(hexKey: string): Uint8Array {
  const key = new Uint8Array(16);
  for (let i = 0; i < 16; i++) {
    key[i] = parseInt(hexKey.substring(i * 2, i * 2 + 2), 16);
  }
  return key;
}

export function decryptMvBuffer(encrypted: ArrayBuffer, key: Uint8Array): ArrayBuffer {
  const src = new Uint8Array(encrypted);
  const result = new Uint8Array(src.length - RPGMV_HEADER_LEN);

  result.set(src.subarray(RPGMV_HEADER_LEN));

  for (let i = 0; i < key.length && i < result.length; i++) {
    result[i] = (result[i]! ^ key[i]!) & 0xff;
  }

  return result.buffer as ArrayBuffer;
}

export function recoverKeyFromPng(encryptedBuffer: ArrayBuffer): Uint8Array | null {
  const src = new Uint8Array(encryptedBuffer);
  if (src.length < RPGMV_HEADER_LEN + 16) return null;

  const key = new Uint8Array(16);
  for (let i = 0; i < 16; i++) {
    key[i] = src[RPGMV_HEADER_LEN + i]! ^ PNG_HEADER[i]!;
  }
  return key;
}

export async function extractKeyFromSystem(
  files: File[],
  dataRoot: string
): Promise<string | null> {
  const systemFile = getFileByNormalizedPath(files, `${dataRoot}data/System.json`);
  if (!systemFile) return null;

  try {
    const text = await systemFile.text();
    const json = JSON.parse(text) as { encryptionKey?: string };
    return json.encryptionKey ?? null;
  } catch {
    return null;
  }
}

export function getMvDecryptedExtension(filename: string): string {
  const lower = filename.toLowerCase();
  for (const [enc, dec] of Object.entries(EXT_MAP)) {
    if (lower.endsWith(enc)) return dec;
  }
  return '';
}

export function getMimeType(ext: string): string {
  return MIME_MAP[ext] ?? 'application/octet-stream';
}

export function isEncryptedMvFile(filename: string): boolean {
  const lower = filename.toLowerCase();
  return lower.endsWith('.rpgmvp') || lower.endsWith('.rpgmvo') || lower.endsWith('.rpgmvm');
}

export type ProcessedAsset = {
  path: string;
  blob: Blob;
  mimeType: string;
};

export async function* processMvFiles(
  files: File[],
  dataRoot: string,
  keyOverride?: string
): AsyncGenerator<ProcessedAsset> {
  let key: Uint8Array | null = null;

  if (keyOverride) {
    key = parseHexKey(keyOverride);
  } else {
    const hexKey = await extractKeyFromSystem(files, dataRoot);
    if (hexKey) {
      key = parseHexKey(hexKey);
    }
  }

  for (const file of files) {
    const rel = file.webkitRelativePath;
    const slashIdx = rel.indexOf('/');
    const relativePath = slashIdx >= 0 ? rel.slice(slashIdx + 1) : rel;

    let canonical = relativePath;
    if (dataRoot && canonical.toLowerCase().startsWith(dataRoot.toLowerCase())) {
      canonical = canonical.slice(dataRoot.length);
    }
    canonical = canonical.toLowerCase();

    if (isEncryptedMvFile(file.name)) {
      if (!key) {
        if (file.name.toLowerCase().endsWith('.rpgmvp')) {
          const buf = await file.arrayBuffer();
          key = recoverKeyFromPng(buf);
          if (key) {
            const decExt = getMvDecryptedExtension(file.name);
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
      const decExt = getMvDecryptedExtension(file.name);
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

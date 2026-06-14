import type { ProcessedAsset } from "./rmmv";

const SIGNATURE = "TCOAAL";
const SIGNATURE_BYTES = new Uint8Array([0x54, 0x43, 0x4f, 0x41, 0x41, 0x4c]);

const TCOAAL_ASSET_DIRS = [
  "data",
  "audio/bgm",
  "audio/bgs",
  "audio/me",
  "audio/se",
  "img/characters",
  "img/faces",
  "img/parallaxes",
  "img/pictures",
  "img/system",
  "img/tilesets",
  "img/titles1",
];

const MIME_MAP: Record<string, string> = {
  ".json": "application/json",
  ".ogg": "audio/ogg",
  ".png": "image/png",
};

// 3D model formats the asset browser / ModelViewer can render (mirrors
// isModelPath in assetUtils.ts). TCOAAL is a 2D RPG Maker MV game, so its
// `www/models/` and `www/textures/` directories aren't part of the standard
// asset set and are only scanned on the dev subreddit (see the includeDevAssets
// gate in processTcoaalFiles). Files there may be plain or wrapped in the
// TCOAAL container; both are handled.
const MODEL_MIME_MAP: Record<string, string> = {
  ".glb": "model/gltf-binary",
  ".gltf": "model/gltf+json",
  ".obj": "text/plain",
  ".stl": "model/stl",
  ".ply": "application/octet-stream",
  ".fbx": "application/octet-stream",
  ".dae": "model/vnd.collada+xml",
  ".3mf": "application/octet-stream",
};

// Image formats the asset browser treats as images (mirrors isImagePath in
// assetUtils.ts), used to type `www/textures/` entries. PNG is the assumed
// default when a texture ships without a recognizable extension.
const IMAGE_MIME_MAP: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".bmp": "image/bmp",
  ".webp": "image/webp",
};

// Returns the extension from `mimeMap` carried by an on-disk path, looking past
// an optional `.k9a` container suffix (e.g. `models/king.glb.k9a` -> `.glb`).
// Empty string when the path doesn't end in one of the known extensions.
function getKnownExtension(
  lowerInner: string,
  mimeMap: Record<string, string>,
): string {
  const base = lowerInner.endsWith(".k9a")
    ? lowerInner.slice(0, -4)
    : lowerInner;
  for (const ext of Object.keys(mimeMap)) {
    if (base.endsWith(ext)) return ext;
  }
  return "";
}

// Drops a trailing `.k9a` container suffix from a TCOAAL on-disk path.
function stripContainerSuffix(lowerInner: string): string {
  return lowerInner.endsWith(".k9a") ? lowerInner.slice(0, -4) : lowerInner;
}

function getExtensionForPath(relativePath: string): string {
  const topDir = relativePath.split("/")[0]!.toLowerCase();
  switch (topDir) {
    case "data":
      return ".json";
    case "audio":
      return ".ogg";
    case "img":
      return ".png";
    default:
      return "";
  }
}

function isInAssetDir(relativePath: string): boolean {
  const lower = relativePath.toLowerCase();
  for (const dir of TCOAAL_ASSET_DIRS) {
    if (lower.startsWith(dir + "/")) return true;
  }
  return false;
}

function getMask(idFilePath: string): number {
  let mask = 0;
  const parts = idFilePath.split("/");
  const basename = parts[parts.length - 1]!.toUpperCase();
  for (let i = 0; i < basename.length; i++) {
    mask = (mask * 2) ^ basename.charCodeAt(i);
  }
  return mask;
}

function hasTcoaalSignature(data: Uint8Array): boolean {
  if (data.length < SIGNATURE.length + 1) return false;
  for (let i = 0; i < SIGNATURE_BYTES.length; i++) {
    if (data[i] !== SIGNATURE_BYTES[i]) return false;
  }
  return true;
}

function decryptTcoaal(rawBytes: Uint8Array, idFilePath: string): Uint8Array {
  const sigLen = SIGNATURE.length;

  const encryptedData = rawBytes.subarray(sigLen + 1);

  let encryptOffset = rawBytes[sigLen]!;
  if (encryptOffset === 0) {
    encryptOffset = encryptedData.length;
  }

  let mask = (getMask(idFilePath) + 1) % 256;
  const decrypted = new Uint8Array(encryptedData.length);

  decrypted.set(encryptedData);

  for (let i = 0; i < encryptOffset && i < decrypted.length; i++) {
    const originalByte = encryptedData[i]!;
    decrypted[i] = (originalByte ^ mask) & 0xff;
    mask = ((mask << 1) ^ originalByte) & 0xff;
  }

  return decrypted;
}

export async function* processTcoaalFiles(
  files: File[],
  dataRoot: string,
  includeDevAssets = false,
): AsyncGenerator<ProcessedAsset> {
  const hasK9a = files.some((f) => f.name.toLowerCase().endsWith(".k9a"));
  if (hasK9a && !dataRoot) {
    return;
  }

  for (const file of files) {
    const rel = file.webkitRelativePath;
    const slashIdx = rel.indexOf("/");
    const relativePath = slashIdx >= 0 ? rel.slice(slashIdx + 1) : rel;

    let inner = relativePath;
    if (dataRoot && inner.toLowerCase().startsWith(dataRoot.toLowerCase())) {
      inner = inner.slice(dataRoot.length);
    } else {
      continue;
    }

    const lowerInner = inner.toLowerCase();

    // Dev-subreddit only: surface 3D models shipped under www/models/. Unlike
    // the fixed-extension asset dirs below, model files keep their own format
    // (.glb/.obj/...) and may be stored plain or in the TCOAAL container, so we
    // derive the extension from the name and only decrypt when the signature
    // is present.
    if (lowerInner.startsWith("models/")) {
      if (!includeDevAssets) continue;

      const modelExt = getKnownExtension(lowerInner, MODEL_MIME_MAP);
      if (!modelExt) continue;

      const rawBytes = new Uint8Array(await file.arrayBuffer());
      const data = hasTcoaalSignature(rawBytes)
        ? decryptTcoaal(rawBytes, inner)
        : rawBytes;

      const mime = MODEL_MIME_MAP[modelExt] ?? "application/octet-stream";
      const canonical = stripContainerSuffix(lowerInner);

      yield {
        path: canonical,
        blob: new Blob([data], { type: mime }),
        mimeType: mime,
      };
      continue;
    }

    // Dev-subreddit only: surface model textures shipped under www/textures/ as
    // images. Everything in this dir is treated as an image; the extension is
    // taken from the name when recognizable, otherwise defaulting to .png. Plain
    // and TCOAAL-wrapped files are both handled.
    if (lowerInner.startsWith("textures/")) {
      if (!includeDevAssets) continue;

      const rawBytes = new Uint8Array(await file.arrayBuffer());
      const data = hasTcoaalSignature(rawBytes)
        ? decryptTcoaal(rawBytes, inner)
        : rawBytes;

      const base = stripContainerSuffix(lowerInner);
      const detectedExt = getKnownExtension(base, IMAGE_MIME_MAP);
      const ext = detectedExt || ".png";
      const mime = IMAGE_MIME_MAP[ext] ?? "image/png";
      const canonical = detectedExt ? base : base + ".png";

      yield {
        path: canonical,
        blob: new Blob([data], { type: mime }),
        mimeType: mime,
      };
      continue;
    }

    if (!isInAssetDir(inner)) continue;

    const extension = getExtensionForPath(inner);
    if (!extension) continue;

    const rawBytes = new Uint8Array(await file.arrayBuffer());

    if (!hasTcoaalSignature(rawBytes)) continue;

    const decrypted = decryptTcoaal(rawBytes, inner);

    const mime = MIME_MAP[extension] ?? "application/octet-stream";
    const canonical = (inner + extension).toLowerCase();

    yield {
      path: canonical,
      blob: new Blob([decrypted], { type: mime }),
      mimeType: mime,
    };
  }
}

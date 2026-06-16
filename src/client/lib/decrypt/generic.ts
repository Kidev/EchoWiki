import type { ProcessedAsset } from "./rmmv";
import { processZipArchive } from "./zip";
import { processRpaArchive } from "./rpa";
import { processGodotPck } from "./godotpck";
import { processGameMakerData } from "./gamemaker";
import { looksLikeUnity, processUnityFiles } from "./unity";
import { processUnrealPak } from "./unrealpak";
import { carveMediaFromFile } from "./mediacarve";
import { processVpkArchive } from "./vpk";
import { processImgArchive } from "./imgarchive";
import { processWadArchive } from "./wad";
import { processSprFile } from "./spr";
import { processBsp } from "./bsp";
import { decodeTxd } from "./txd";
import { decodeVtf } from "./vtf";
import { decodeDds } from "./dds";
import { decodeTga, type DecodedImage } from "./tga";
import { encodePngBlob } from "./png";

// Sniff the first bytes of an unknown file (e.g. .bin) to determine its true format,
// then dispatch to the appropriate parser.
type BinFormat = "zip" | "rpa" | "godotpck" | "gamemaker" | "unknown";

async function sniffFormat(file: File): Promise<BinFormat> {
  const header = new Uint8Array(await file.slice(0, 12).arrayBuffer());

  // ZIP: PK\x03\x04
  if (
    header[0] === 0x50 &&
    header[1] === 0x4b &&
    header[2] === 0x03 &&
    header[3] === 0x04
  )
    return "zip";
  // RPA-2.0 / RPA-3.0: starts with "RPA-"
  if (
    header[0] === 0x52 &&
    header[1] === 0x50 &&
    header[2] === 0x41 &&
    header[3] === 0x2d
  )
    return "rpa";
  // Godot PCK: "GDPC" LE = 0x43504447
  if (
    header[0] === 0x47 &&
    header[1] === 0x44 &&
    header[2] === 0x50 &&
    header[3] === 0x43
  )
    return "godotpck";
  // GameMaker FORM: "FORM" LE = 0x4d524f46
  if (
    header[0] === 0x46 &&
    header[1] === 0x4f &&
    header[2] === 0x52 &&
    header[3] === 0x4d
  )
    return "gamemaker";

  return "unknown";
}

const IMAGE_EXTS = new Set([".png", ".jpg", ".jpeg", ".gif", ".bmp", ".webp"]);
const AUDIO_EXTS = new Set([
  ".ogg",
  ".mp3",
  ".m4a",
  ".wav",
  ".mid",
  ".midi",
  ".opus",
  ".flac",
]);
const VIDEO_EXTS = new Set([".mp4", ".webm", ".ogv"]);
const MODEL_EXTS = new Set([
  ".glb",
  ".gltf",
  ".obj",
  ".stl",
  ".ply",
  ".fbx",
  ".dae",
  ".3mf",
]);

const MIME_MAP: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".bmp": "image/bmp",
  ".webp": "image/webp",
  ".ogg": "audio/ogg",
  ".mp3": "audio/mpeg",
  ".m4a": "audio/mp4",
  ".wav": "audio/wav",
  ".mid": "audio/midi",
  ".midi": "audio/midi",
  ".opus": "audio/opus",
  ".flac": "audio/flac",
  ".mp4": "video/mp4",
  ".webm": "video/webm",
  ".ogv": "video/ogg",
  ".glb": "model/gltf-binary",
  ".gltf": "model/gltf+json",
  ".obj": "model/obj",
  ".stl": "model/stl",
  ".ply": "model/ply",
  ".fbx": "application/octet-stream",
  ".dae": "model/vnd.collada+xml",
  ".3mf": "model/3mf",
};

function getExtLower(name: string): string {
  const dot = name.lastIndexOf(".");
  return dot >= 0 ? name.slice(dot).toLowerCase() : "";
}

function getMimeType(name: string): string {
  return MIME_MAP[getExtLower(name)] ?? "application/octet-stream";
}

function isMediaFile(name: string): boolean {
  const ext = getExtLower(name);
  return (
    IMAGE_EXTS.has(ext) ||
    AUDIO_EXTS.has(ext) ||
    VIDEO_EXTS.has(ext) ||
    MODEL_EXTS.has(ext)
  );
}

// Wrap a decoded RGBA image (from a GPU-texture format) as a PNG asset.
async function decodedToPngAsset(
  storedPath: string,
  img: DecodedImage,
): Promise<ProcessedAsset> {
  const blob = await encodePngBlob(img.width, img.height, img.rgba);
  return { path: storedPath, blob, mimeType: "image/png" };
}

// Replace a file's extension with .png for storing decoded textures.
function withPngExt(path: string): string {
  const dot = path.lastIndexOf(".");
  return `${dot >= 0 ? path.slice(0, dot) : path}.png`;
}

// Derive a stored path using the immediate parent folder as category.
// e.g. "images/characters/hero.png" -> "characters/hero.png"
// e.g. "hero.png" (root level)      -> "hero.png"
function deriveStoredPath(relativePath: string): string {
  const lower = relativePath.toLowerCase().replace(/\\/g, "/");
  const parts = lower.split("/").filter((p) => p.length > 0);
  if (parts.length === 0) return lower;
  if (parts.length === 1) return parts[0]!;
  return `${parts[parts.length - 2]}/${parts[parts.length - 1]}`;
}

export async function* processGenericFiles(
  files: File[],
): AsyncGenerator<ProcessedAsset> {
  const yielded = new Set<string>();

  // Unity builds: extract Texture2D objects from bundles / serialized files.
  if (looksLikeUnity(files)) {
    for await (const asset of processUnityFiles(files)) {
      if (yielded.has(asset.path)) continue;
      yielded.add(asset.path);
      yield asset;
    }
  }

  for (const file of files) {
    const rel = file.webkitRelativePath;
    const slashIdx = rel.indexOf("/");
    // Strip the root folder prefix added by the browser
    const relativePath = slashIdx >= 0 ? rel.slice(slashIdx + 1) : rel;
    const ext = getExtLower(file.name);

    // Extract from ZIP archives (including .nw which is NW.js app = zip)
    if (ext === ".zip" || ext === ".nw") {
      try {
        for await (const asset of processZipArchive(file)) {
          if (!isMediaFile(asset.path)) continue;
          const stored = deriveStoredPath(asset.path);
          if (!yielded.has(stored)) {
            yielded.add(stored);
            yield { ...asset, path: stored };
          }
        }
      } catch {
        // Corrupted or unsupported archive: skip
      }
      continue;
    }

    // Extract from RenPy RPA archives
    if (ext === ".rpa") {
      try {
        for await (const asset of processRpaArchive(file)) {
          if (!isMediaFile(asset.path)) continue;
          const stored = deriveStoredPath(asset.path);
          if (!yielded.has(stored)) {
            yielded.add(stored);
            yield { ...asset, path: stored };
          }
        }
      } catch {
        // Corrupted or unsupported archive: skip
      }
      continue;
    }

    // Carve embedded media out of Unreal Engine pak archives (.pak)
    if (ext === ".pak") {
      try {
        for await (const asset of processUnrealPak(file)) {
          if (!yielded.has(asset.path)) {
            yielded.add(asset.path);
            yield asset;
          }
        }
      } catch {
        // Encrypted / Oodle-compressed / corrupt pak: skip
      }
      continue;
    }

    // Opaque containers carved by raw signature scan (the slow path): UE4.25+/UE5
    // IoStore data (.ucas), legacy UE3 packages (.upk), and Frostbite cas/sb
    // bundles. The .utoc/.toc index files carry no media, so they're skipped.
    if (ext === ".ucas" || ext === ".upk" || ext === ".cas" || ext === ".sb") {
      const folder =
        ext === ".ucas" ? "iostore" : ext === ".upk" ? "upk" : "frostbite";
      try {
        for await (const asset of carveMediaFromFile(file, { folder })) {
          if (!yielded.has(asset.path)) {
            yielded.add(asset.path);
            yield asset;
          }
        }
      } catch {
        // Unreadable container: skip
      }
      continue;
    }

    // Source / Source 2 VPK package set (process only the directory archive,
    // which references the sibling numbered _NNN.vpk data files).
    if (ext === ".vpk") {
      if (file.name.toLowerCase().endsWith("_dir.vpk")) {
        try {
          for await (const asset of processVpkArchive(file, files)) {
            if (!yielded.has(asset.path)) {
              yielded.add(asset.path);
              yield asset;
            }
          }
        } catch {
          // Corrupt / unsupported VPK: skip
        }
      }
      continue;
    }

    // Grand Theft Auto IMG archives (.img, or a .dir+.img V1 pair).
    if (ext === ".img" || ext === ".dir") {
      // Avoid double-processing a V1 pair: only the .img drives extraction.
      if (ext === ".dir") continue;
      try {
        for await (const asset of processImgArchive(file, files)) {
          if (!yielded.has(asset.path)) {
            yielded.add(asset.path);
            yield asset;
          }
        }
      } catch {
        // Not a GTA archive (e.g. a Steam .img disc image): skip
      }
      continue;
    }

    // GoldSrc WAD3 texture archive.
    if (ext === ".wad") {
      try {
        for await (const asset of processWadArchive(file)) {
          if (!yielded.has(asset.path)) {
            yielded.add(asset.path);
            yield asset;
          }
        }
      } catch {
        // Not a WAD3 (e.g. a Doom IWAD): skip
      }
      continue;
    }

    // GoldSrc / Quake sprite.
    if (ext === ".spr") {
      try {
        for await (const asset of processSprFile(file)) {
          if (!yielded.has(asset.path)) {
            yielded.add(asset.path);
            yield asset;
          }
        }
      } catch {
        // Skip
      }
      continue;
    }

    // BSP map: GoldSrc embedded miptex or Source pakfile (zip) content.
    if (ext === ".bsp") {
      try {
        for await (const asset of processBsp(file)) {
          if (!yielded.has(asset.path)) {
            yielded.add(asset.path);
            yield asset;
          }
        }
      } catch {
        // Skip
      }
      continue;
    }

    // Single-file GPU texture formats decoded to PNG.
    if (ext === ".vtf" || ext === ".dds" || ext === ".tga" || ext === ".txd") {
      try {
        const buf = await file.arrayBuffer();
        if (ext === ".txd") {
          const txdName = deriveStoredPath(relativePath).replace(/\.txd$/i, "");
          for (const tex of decodeTxd(buf)) {
            const texName =
              tex.name.replace(/[^a-z0-9_-]/gi, "_").toLowerCase() || "tex";
            let stored = `${txdName}/${texName}.png`;
            let n = 1;
            while (yielded.has(stored))
              stored = `${txdName}/${texName}_${n++}.png`;
            yielded.add(stored);
            yield await decodedToPngAsset(stored, tex);
          }
        } else {
          const decoded =
            ext === ".vtf"
              ? decodeVtf(buf)
              : ext === ".dds"
                ? decodeDds(buf)
                : decodeTga(buf);
          if (decoded) {
            const stored = withPngExt(deriveStoredPath(relativePath));
            if (!yielded.has(stored)) {
              yielded.add(stored);
              yield await decodedToPngAsset(stored, decoded);
            }
          }
        }
      } catch {
        // Unsupported pixel format / corrupt file: skip
      }
      continue;
    }

    // Extract from Godot PCK archives (.pck)
    if (ext === ".pck") {
      try {
        for await (const asset of processGodotPck(file)) {
          if (!isMediaFile(asset.path)) continue;
          const stored = deriveStoredPath(asset.path);
          if (!yielded.has(stored)) {
            yielded.add(stored);
            yield { ...asset, path: stored };
          }
        }
      } catch {
        // Corrupted or unsupported PCK: skip
      }
      continue;
    }

    // Extract from GameMaker data files (data.win, game.ios, game.unx)
    const baseName = file.name.toLowerCase();
    if (
      baseName === "data.win" ||
      baseName === "game.ios" ||
      baseName === "game.unx"
    ) {
      try {
        for await (const asset of processGameMakerData(file)) {
          if (!yielded.has(asset.path)) {
            yielded.add(asset.path);
            yield asset;
          }
        }
      } catch {
        // Not a valid GameMaker data file: skip
      }
      continue;
    }

    // .bin files can be any archive format in disguise: sniff by magic bytes
    if (ext === ".bin") {
      const format = await sniffFormat(file);
      if (format !== "unknown") {
        try {
          const gen =
            format === "zip"
              ? processZipArchive(file)
              : format === "rpa"
                ? processRpaArchive(file)
                : format === "godotpck"
                  ? processGodotPck(file)
                  : processGameMakerData(file);

          for await (const asset of gen) {
            if (!isMediaFile(asset.path) && format !== "gamemaker") continue;
            const stored =
              format === "gamemaker"
                ? asset.path
                : deriveStoredPath(asset.path);
            if (!yielded.has(stored)) {
              yielded.add(stored);
              yield { ...asset, path: stored };
            }
          }
        } catch {
          // Corrupted archive: skip
        }
      }
      continue;
    }

    if (!isMediaFile(file.name)) continue;

    const stored = deriveStoredPath(relativePath);
    if (yielded.has(stored)) continue;
    yielded.add(stored);

    const mime = getMimeType(file.name);
    yield {
      path: stored,
      blob: new Blob([await file.arrayBuffer()], { type: mime }),
      mimeType: mime,
    };
  }
}

// ZIP-based game archive handler for the id Tech 3/4 lineage and relatives:
// Quake III / Return to Castle Wolfenstein / Jedi Knight .pk3, Doom 3 .pk4,
// Call of Duty .iwd, and CryEngine .pak: all of which are ordinary ZIPs.
//
// It unpacks the archive (DEFLATE included) and turns the textures inside into
// viewable assets: TGA and DDS are decoded to PNG, while already-viewable media
// (PNG/JPEG/GIF/BMP/WebP and OGG/WAV/MP3/MP4) passes straight through. Engine
// script/model/shader lumps are ignored.

import type { ProcessedAsset } from "./rmmv";
import { processZipArchive } from "./zip";
import { decodeTga } from "./tga";
import { decodeDds } from "./dds";
import { encodePngBlob } from "./png";

const PASSTHROUGH = new Set([
  "png",
  "jpg",
  "jpeg",
  "gif",
  "bmp",
  "webp",
  "ogg",
  "wav",
  "mp3",
  "mp4",
  "webm",
]);

function extOf(path: string): string {
  const dot = path.lastIndexOf(".");
  return dot >= 0 ? path.slice(dot + 1).toLowerCase() : "";
}

export async function* processZipGameArchive(
  file: File,
): AsyncGenerator<ProcessedAsset> {
  const yielded = new Set<string>();

  for await (const entry of processZipArchive(file)) {
    const ext = extOf(entry.path);

    if (ext === "tga" || ext === "dds") {
      try {
        const buf = await entry.blob.arrayBuffer();
        const dec = ext === "tga" ? decodeTga(buf) : decodeDds(buf);
        if (!dec) continue;
        const stored = `${entry.path.replace(/\.[^.]*$/, "")}.png`;
        if (yielded.has(stored)) continue;
        yielded.add(stored);
        const blob = await encodePngBlob(dec.width, dec.height, dec.rgba);
        yield { path: stored, blob, mimeType: "image/png" };
      } catch {
        // Unsupported pixel format: skip
      }
      continue;
    }

    if (PASSTHROUGH.has(ext)) {
      if (yielded.has(entry.path)) continue;
      yielded.add(entry.path);
      yield entry;
    }
  }
}

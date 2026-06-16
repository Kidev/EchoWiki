// BSP map reader.
//
// Two unrelated map formats share the .bsp extension:
//   * GoldSrc (version 29/30): the texture lump holds embedded miptex, the
//     map-specific textures that aren't in a shared WAD. We decode those.
//   * Source ("VBSP"): textures are VTF referenced from VPKs, but custom map
//     content is bundled in the LUMP_PAKFILE (a plain ZIP). We unpack that zip
//     and decode the VTFs / pass through the media inside it.

import type { ProcessedAsset } from "./rmmv";
import { decodeMiptex } from "./goldsrc";
import { decodeVtf } from "./vtf";
import { encodePngBlob } from "./png";
import { processZipArchive } from "./zip";

const VBSP_IDENT = 0x50534256; // "VBSP"
const GOLDSRC_TEXTURE_LUMP = 2;
const SOURCE_PAKFILE_LUMP = 40;
const MAX_MIPTEX = 4096;

function baseName(file: File): string {
  return (
    file.name
      .replace(/\.bsp$/i, "")
      .replace(/[^a-z0-9_-]/gi, "_")
      .toLowerCase() || "map"
  );
}

const PASSTHROUGH: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  wav: "audio/wav",
  mp3: "audio/mpeg",
  ogg: "audio/ogg",
};

async function* goldsrcTextures(
  file: File,
  buffer: ArrayBuffer,
): AsyncGenerator<ProcessedAsset> {
  const view = new DataView(buffer);
  const bytes = new Uint8Array(buffer);
  const name = baseName(file);

  // Lump directory: version(4) then 15 * (offset(4), length(4)).
  const lumpEntry = 4 + GOLDSRC_TEXTURE_LUMP * 8;
  const texOffset = view.getInt32(lumpEntry, true);
  const texLength = view.getInt32(lumpEntry + 4, true);
  if (texOffset <= 0 || texOffset + texLength > view.byteLength) return;
  if (texOffset + 4 > view.byteLength) return;

  const numMiptex = view.getInt32(texOffset, true);
  if (numMiptex <= 0 || numMiptex > MAX_MIPTEX) return;
  if (texOffset + 4 + numMiptex * 4 > view.byteLength) return;

  const yielded = new Set<string>();
  for (let i = 0; i < numMiptex; i++) {
    const rel = view.getInt32(texOffset + 4 + i * 4, true);
    if (rel < 0) continue;
    const decoded = decodeMiptex(bytes, texOffset + rel);
    if (!decoded) continue;
    let stored = `${name}/tex_${i}.png`;
    if (yielded.has(stored)) stored = `${name}/tex_${i}_${yielded.size}.png`;
    yielded.add(stored);
    const blob = await encodePngBlob(
      decoded.width,
      decoded.height,
      decoded.rgba,
    );
    yield { path: stored, blob, mimeType: "image/png" };
  }
}

async function* sourcePakfile(
  buffer: ArrayBuffer,
): AsyncGenerator<ProcessedAsset> {
  const view = new DataView(buffer);
  // Header: ident(4) version(4) then 64 * (fileofs(4), filelen(4), version(4), fourCC(4)).
  const lumpBase = 8 + SOURCE_PAKFILE_LUMP * 16;
  if (lumpBase + 8 > view.byteLength) return;
  const ofs = view.getInt32(lumpBase, true);
  const len = view.getInt32(lumpBase + 4, true);
  if (ofs <= 0 || len <= 0 || ofs + len > view.byteLength) return;

  const zipFile = new File([buffer.slice(ofs, ofs + len)], "pakfile.zip");
  const yielded = new Set<string>();

  for await (const entry of processZipArchive(zipFile)) {
    const ext = entry.path.slice(entry.path.lastIndexOf(".") + 1).toLowerCase();
    if (ext === "vtf") {
      try {
        const dec = decodeVtf(await entry.blob.arrayBuffer());
        if (!dec) continue;
        const stored = `${entry.path.replace(/\.vtf$/, "")}.png`;
        if (yielded.has(stored)) continue;
        yielded.add(stored);
        const blob = await encodePngBlob(dec.width, dec.height, dec.rgba);
        yield { path: stored, blob, mimeType: "image/png" };
      } catch {
        // skip
      }
    } else if (PASSTHROUGH[ext]) {
      if (yielded.has(entry.path)) continue;
      yielded.add(entry.path);
      yield entry;
    }
  }
}

export async function* processBsp(file: File): AsyncGenerator<ProcessedAsset> {
  const buffer = await file.arrayBuffer();
  if (buffer.byteLength < 8) return;
  const view = new DataView(buffer);
  const ident = view.getUint32(0, true);

  if (ident === VBSP_IDENT) {
    yield* sourcePakfile(buffer);
  } else if (ident === 30 || ident === 29) {
    yield* goldsrcTextures(file, buffer);
  }
}

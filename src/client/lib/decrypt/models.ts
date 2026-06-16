// Game-engine 3D model dispatcher. Given a model file (by path + bytes) and a way
// to fetch sibling files from the same source, sniff the format and route to the
// matching decoder, returning a self-contained GLB the ModelViewer can display.
//
// Single-file formats (MD2/MD3/Quake MDL) decode from `data` alone. The studio
// formats need siblings: GoldSrc keeps its skins in "<name>T.mdl"; Source splits
// geometry across "<name>.vvd" + "<name>.dx90.vtx". `fetchSibling` resolves those
// by path (implementations should match case-insensitively).

import { decodeMd3 } from "./md3";
import { decodeMd2 } from "./md2";
import { decodeQuakeMdl } from "./mdl-quake";
import { decodeGoldSrcMdl } from "./mdl-goldsrc";
import { decodeSourceMdl } from "./mdl-source";

// Extensions we attempt to turn into GLB. `.vvd`/`.vtx` are consumed as siblings
// of a `.mdl`, never on their own.
export const MODEL_EXTS = new Set([".md3", ".md2", ".mdl"]);

export function isModelPath(path: string): boolean {
  const dot = path.lastIndexOf(".");
  return dot >= 0 && MODEL_EXTS.has(path.slice(dot).toLowerCase());
}

export type SiblingFetcher = (path: string) => Promise<Uint8Array | null>;

function magic4(b: Uint8Array): number {
  if (b.length < 4) return 0;
  return (b[0]! | (b[1]! << 8) | (b[2]! << 16) | (b[3]! << 24)) >>> 0;
}

function exactBuffer(u8: Uint8Array): ArrayBuffer {
  return u8.byteOffset === 0 && u8.byteLength === u8.buffer.byteLength
    ? (u8.buffer as ArrayBuffer)
    : (u8.slice().buffer as ArrayBuffer);
}

const IDST = 0x54534449; // "IDST" studio model (GoldSrc v10 / Source v44+)
const IDPO = 0x4f504449; // "IDPO" Quake 1 MDL
const IDP2 = 0x32504449; // "IDP2" Quake 2 MD2
const IDP3 = 0x33504449; // "IDP3" Quake 3 MD3

// Build the path of a sibling that shares the model's stem (e.g. swap ".mdl"
// for ".vvd"). Preserves the directory so the fetcher can resolve relatively.
function withStem(path: string, suffix: string): string {
  const dot = path.lastIndexOf(".");
  return `${dot >= 0 ? path.slice(0, dot) : path}${suffix}`;
}

export async function decodeModel(
  path: string,
  data: Uint8Array,
  fetchSibling: SiblingFetcher,
): Promise<Uint8Array | null> {
  const dot = path.lastIndexOf(".");
  const ext = dot >= 0 ? path.slice(dot).toLowerCase() : "";
  if (!MODEL_EXTS.has(ext)) return null;

  const buf = exactBuffer(data);
  const magic = magic4(data);

  if (ext === ".md3" || magic === IDP3) return decodeMd3(buf);
  if (ext === ".md2" || magic === IDP2) return decodeMd2(buf);

  if (ext === ".mdl") {
    if (magic === IDPO) return decodeQuakeMdl(buf);
    if (magic === IDST) {
      const view = new DataView(buf);
      if (view.byteLength < 8) return null;
      const version = view.getInt32(4, true);
      if (version === 10) {
        // GoldSrc: skins may live in a sibling "<stem>T.mdl".
        let texBuf: ArrayBuffer | undefined;
        const t = await fetchSibling(withStem(path, "t.mdl"));
        if (t) texBuf = exactBuffer(t);
        return decodeGoldSrcMdl(buf, texBuf);
      }
      if (version >= 44 && version <= 49) {
        // Source: gather the vertex + index siblings.
        const vvd = await fetchSibling(withStem(path, ".vvd"));
        if (!vvd) return null;
        let vtx: Uint8Array | null = null;
        for (const suffix of [".dx90.vtx", ".dx80.vtx", ".sw.vtx", ".vtx"]) {
          vtx = await fetchSibling(withStem(path, suffix));
          if (vtx) break;
        }
        if (!vtx) return null;
        return decodeSourceMdl({
          mdl: buf,
          vvd: exactBuffer(vvd),
          vtx: exactBuffer(vtx),
        });
      }
    }
  }
  return null;
}

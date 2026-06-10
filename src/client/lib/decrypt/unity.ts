// Unity asset extraction.
//
// Reads Unity's container formats directly in the browser and pulls out
// Texture2D objects as PNGs:
//   - UnityFS asset bundles (.bundle / .unity3d / extensionless), including
//     LZ4 / LZ4HC compressed block tables and data blocks
//   - raw SerializedFiles (resources.assets, sharedassets*.assets,
//     globalgamemanagers, levelN)
//
// Texture pixel data may be inline or streamed from a sibling .resS / .resource
// file (StreamingInfo); both are resolved. LZMA-compressed bundles and GPU
// formats without a browser decoder (BC7/ETC/ASTC, crunched) are skipped.
//
// The SerializedFile / Texture2D field layouts follow the well-documented
// AssetStudio / UnityPy reference implementations, gated on the file's reported
// Unity version. Everything is best-effort: any parse failure skips the object
// or file rather than aborting the import.

import type { ProcessedAsset } from "./rmmv";
import { lz4DecompressBlock } from "./lz4";
import { decodeTexture } from "./unity-texture";
import { encodePng } from "./png";
import { CLASS_MESH, extractMeshGlb } from "./unity-mesh";

const CLASS_TEXTURE2D = 28;

type StreamingInfo = { offset: number; size: number; path: string };

type TextureDescriptor = {
  name: string;
  width: number;
  height: number;
  format: number;
  imageDataSize: number;
  inlineData: Uint8Array | null;
  streamData: StreamingInfo | null;
};

type CompanionResolver = (name: string) => Promise<Uint8Array | null>;

// Endian-aware binary reader

export class UnityReader {
  private view: DataView;
  private bytes: Uint8Array;
  pos = 0;
  little: boolean;

  constructor(data: Uint8Array, little: boolean) {
    this.view = new DataView(data.buffer, data.byteOffset, data.byteLength);
    this.bytes = data;
    this.little = little;
  }

  get length(): number {
    return this.view.byteLength;
  }
  get remaining(): number {
    return this.length - this.pos;
  }

  align(n = 4): void {
    this.pos = Math.ceil(this.pos / n) * n;
  }

  u8(): number {
    const v = this.view.getUint8(this.pos);
    this.pos += 1;
    return v;
  }
  i16(): number {
    const v = this.view.getInt16(this.pos, this.little);
    this.pos += 2;
    return v;
  }
  u16(): number {
    const v = this.view.getUint16(this.pos, this.little);
    this.pos += 2;
    return v;
  }
  i32(): number {
    const v = this.view.getInt32(this.pos, this.little);
    this.pos += 4;
    return v;
  }
  u32(): number {
    const v = this.view.getUint32(this.pos, this.little);
    this.pos += 4;
    return v;
  }
  f32(): number {
    const v = this.view.getFloat32(this.pos, this.little);
    this.pos += 4;
    return v;
  }
  i64(): number {
    const lo = this.view.getUint32(this.pos, this.little);
    const hi = this.view.getUint32(this.pos + 4, this.little);
    this.pos += 8;
    return this.little ? hi * 0x100000000 + lo : lo * 0x100000000 + hi;
  }
  bool(): boolean {
    return this.u8() !== 0;
  }

  bytesN(n: number): Uint8Array {
    const slice = this.bytes.subarray(this.pos, this.pos + n);
    this.pos += n;
    return slice;
  }

  stringToNull(): string {
    const start = this.pos;
    while (this.pos < this.length && this.view.getUint8(this.pos) !== 0) this.pos++;
    const s = new TextDecoder().decode(this.bytes.subarray(start, this.pos));
    this.pos++; // consume terminator
    return s;
  }

  alignedString(): string {
    const len = this.i32();
    if (len < 0 || len > this.remaining) throw new RangeError("bad string length");
    const s = new TextDecoder().decode(this.bytesN(len));
    this.align(4);
    return s;
  }
}

// Helpers

function baseName(path: string): string {
  const norm = path.replace(/\\/g, "/");
  const idx = norm.lastIndexOf("/");
  return idx >= 0 ? norm.slice(idx + 1) : norm;
}

function parseUnityVersion(s: string): number[] {
  const nums = (s.match(/\d+/g) ?? []).map(Number);
  return [nums[0] ?? 0, nums[1] ?? 0, nums[2] ?? 0];
}

export function versionGte(uv: number[], target: number[]): boolean {
  for (let i = 0; i < target.length; i++) {
    const a = uv[i] ?? 0;
    const b = target[i]!;
    if (a > b) return true;
    if (a < b) return false;
  }
  return true;
}

function versionLte(uv: number[], target: number[]): boolean {
  for (let i = 0; i < target.length; i++) {
    const a = uv[i] ?? 0;
    const b = target[i]!;
    if (a < b) return true;
    if (a > b) return false;
  }
  return true;
}

function sanitizeName(name: string): string {
  const cleaned = name.replace(/[^a-zA-Z0-9._-]/g, "_").replace(/^_+|_+$/g, "");
  return cleaned.length > 0 ? cleaned : "texture";
}

// UnityFS bundle parsing

type BundleNode = { path: string; data: Uint8Array };

function decompressBlock(
  data: Uint8Array,
  uncompressedSize: number,
  compression: number,
): Uint8Array {
  if (compression === 0) return data;
  if (compression === 2 || compression === 3) return lz4DecompressBlock(data, uncompressedSize);
  // 1 = LZMA: requires a heavy dedicated decoder, not supported.
  throw new Error(`unsupported bundle compression ${compression}`);
}

function parseBundle(bytes: Uint8Array): BundleNode[] {
  const reader = new UnityReader(bytes, false); // header is big-endian

  const signature = reader.stringToNull();
  if (signature !== "UnityFS") throw new Error("not a UnityFS bundle");

  const version = reader.u32();
  reader.stringToNull(); // unity version (min player)
  reader.stringToNull(); // unity revision
  reader.i64(); // total size
  const compressedInfoSize = reader.u32();
  const uncompressedInfoSize = reader.u32();
  const flags = reader.u32();

  if (version >= 7) reader.align(16);

  const headerEnd = reader.pos;
  let infoBytes: Uint8Array;
  if (flags & 0x80) {
    // Block info stored at the end of the file.
    const start = bytes.length - compressedInfoSize;
    infoBytes = bytes.subarray(start, start + compressedInfoSize);
    reader.pos = headerEnd;
  } else {
    infoBytes = reader.bytesN(compressedInfoSize);
  }

  const infoRaw = decompressBlock(infoBytes, uncompressedInfoSize, flags & 0x3f);
  const info = new UnityReader(infoRaw, false); // big-endian
  info.bytesN(16); // uncompressed data hash

  const blockCount = info.i32();
  const blocks: { uncompressedSize: number; compressedSize: number; flags: number }[] = [];
  for (let i = 0; i < blockCount; i++) {
    const uncompressedSize = info.u32();
    const compressedSize = info.u32();
    const blockFlags = info.u16();
    blocks.push({ uncompressedSize, compressedSize, flags: blockFlags });
  }

  const nodeCount = info.i32();
  const nodeInfos: { offset: number; size: number; path: string }[] = [];
  for (let i = 0; i < nodeCount; i++) {
    const offset = info.i64();
    const size = info.i64();
    info.u32(); // flags
    const path = info.stringToNull();
    nodeInfos.push({ offset, size, path });
  }

  // Data blocks follow the header (optionally padded to 16 bytes).
  reader.pos = headerEnd;
  if (flags & 0x200) reader.align(16);

  const totalUncompressed = blocks.reduce((sum, b) => sum + b.uncompressedSize, 0);
  const blockData = new Uint8Array(totalUncompressed);
  let writePos = 0;
  for (const block of blocks) {
    const comp = reader.bytesN(block.compressedSize);
    const out = decompressBlock(comp, block.uncompressedSize, block.flags & 0x3f);
    blockData.set(out.subarray(0, block.uncompressedSize), writePos);
    writePos += block.uncompressedSize;
  }

  return nodeInfos.map((n) => ({
    path: n.path,
    data: blockData.subarray(n.offset, n.offset + n.size),
  }));
}

// SerializedFile parsing

type ObjectInfo = { classID: number; pathID: number; byteStart: number; byteSize: number };

type SerializedFile = {
  little: boolean;
  unityVersion: number[];
  formatVersion: number;
  objects: ObjectInfo[];
  // External file dependencies (raw pathNames). PPtr.fileID indexes this list
  // 1-based; fileID 0 means the current file. Used for cross-file PPtr resolution.
  externals: string[];
};

function parseSerializedFile(bytes: Uint8Array): SerializedFile | null {
  const reader = new UnityReader(bytes, false); // header is big-endian
  if (reader.length < 16) return null;

  reader.u32(); // metadataSize (legacy)
  let fileSize = reader.u32();
  const version = reader.u32();
  let dataOffset = reader.u32();

  if (version < 9 || version > 100) return null; // sanity / unsupported legacy

  const endianFlag = reader.u8();
  reader.bytesN(3); // reserved

  if (version >= 22) {
    reader.u32(); // metadataSize
    fileSize = reader.i64();
    dataOffset = reader.i64();
    reader.i64(); // unknown
  }
  if (fileSize > 0 && fileSize > bytes.length + 16) return null;

  reader.little = endianFlag === 0;

  const unityVersionStr = reader.stringToNull();
  const unityVersion = parseUnityVersion(unityVersionStr);
  if (version >= 8) reader.i32(); // target platform

  const enableTypeTree = version >= 13 ? reader.bool() : false;

  const typeCount = reader.i32();
  if (typeCount < 0 || typeCount > 100000) return null;
  const types: number[] = [];
  for (let i = 0; i < typeCount; i++) {
    const classID = reader.i32();
    if (version >= 16) reader.bool(); // isStrippedType
    if (version >= 17) reader.i16(); // scriptTypeIndex
    if (version >= 13) {
      if ((version < 16 && classID < 0) || (version >= 16 && classID === 114)) {
        reader.bytesN(16); // script type hash
      }
      reader.bytesN(16); // old type hash
    }
    if (enableTypeTree) {
      // Only the blob type-tree format (version 10 / >=12) is skippable here.
      if (version >= 12 || version === 10) {
        const nodeCount = reader.i32();
        const stringBufferSize = reader.i32();
        const nodeSize = version >= 19 ? 32 : 24;
        reader.bytesN(nodeCount * nodeSize);
        reader.bytesN(stringBufferSize);
        if (version >= 21) {
          const depCount = reader.i32();
          reader.bytesN(depCount * 4);
        }
      } else {
        return null; // recursive old type tree: unsupported
      }
    }
    types.push(classID);
  }

  let bigIDEnabled = 0;
  if (version >= 7 && version < 14) bigIDEnabled = reader.i32();

  const objectCount = reader.i32();
  if (objectCount < 0 || objectCount > 5_000_000) return null;

  const objects: ObjectInfo[] = [];
  for (let i = 0; i < objectCount; i++) {
    let pathID = 0;
    if (bigIDEnabled !== 0) {
      pathID = reader.i64();
    } else if (version < 14) {
      pathID = reader.i32();
    } else {
      reader.align(4);
      pathID = reader.i64();
    }

    const byteStart = (version >= 22 ? reader.i64() : reader.u32()) + dataOffset;
    const byteSize = reader.u32();
    const typeID = reader.i32();

    let classID: number;
    if (version < 16) {
      classID = reader.u16();
    } else {
      classID = types[typeID] ?? -1;
    }
    if (version < 11) reader.u16(); // isDestroyed
    if (version >= 11 && version < 17) reader.i16(); // scriptTypeIndex
    if (version === 15 || version === 16) reader.u8(); // stripped

    objects.push({ classID, pathID, byteStart, byteSize });
  }

  // Script types table (version >= 11) then the external dependency list. PPtr
  // cross-file references index `externals` 1-based. Best-effort: a truncated or
  // unexpected tail just yields fewer externals, degrading linking to same-file.
  const externals: string[] = [];
  try {
    if (version >= 11) {
      const scriptCount = reader.i32();
      if (scriptCount >= 0 && scriptCount < 1_000_000) {
        for (let i = 0; i < scriptCount; i++) {
          reader.i32(); // localSerializedFileIndex
          if (version < 14) {
            reader.i32(); // localIdentifierInFile
          } else {
            reader.align(4);
            reader.i64(); // localIdentifierInFile
          }
        }
      }
    }
    const externalCount = reader.i32();
    if (externalCount >= 0 && externalCount < 1_000_000) {
      for (let i = 0; i < externalCount; i++) {
        if (version >= 6) reader.stringToNull(); // tempEmpty
        if (version >= 5) {
          reader.bytesN(16); // guid
          reader.i32(); // type
        }
        externals.push(reader.stringToNull()); // pathName
      }
    }
  } catch {
    // Leave externals as parsed so far.
  }

  return { little: reader.little, unityVersion, formatVersion: version, objects, externals };
}

// Scene-graph parsing: just enough to link Mesh -> Material -> Texture2D.
//
// In a shipped build EditorExtension reads nothing (prefab pointers exist only
// when the file targets the editor), so Component-derived objects start at
// m_GameObject and NamedObjects start at m_Name. PPtr is { fileID:i32, pathID }
// where pathID is i64 for SerializedFile format >= 14 (all modern builds).

const CLASS_MESH_RENDERER = 23;
const CLASS_MESH_FILTER = 33;
const CLASS_MATERIAL = 21;
const CLASS_SKINNED_MESH_RENDERER = 137;

type PPtr = { fileID: number; pathID: number };

function readPPtr(r: UnityReader, formatVersion: number): PPtr {
  const fileID = r.i32();
  const pathID = formatVersion >= 14 ? r.i64() : r.i32();
  return { fileID, pathID };
}

function skipStringArray(r: UnityReader): void {
  const n = r.i32();
  for (let i = 0; i < n; i++) r.alignedString();
}

// Reads the variable-length Renderer fields up to and including m_Materials,
// returning the owning GameObject pathID and the material PPtrs. The reader is
// left positioned right after the materials array (the trailing Renderer fields
// are only needed when a SkinnedMeshRenderer continues past them).
function readRendererThroughMaterials(
  r: UnityReader,
  uv: number[],
  fv: number,
): { gameObject: number; materials: PPtr[] } {
  const gameObject = readPPtr(r, fv).pathID; // Component.m_GameObject

  // Renderer (5.0+ / 5.4+ layout; older builds are rare for 3D content).
  if (versionGte(uv, [5, 4])) {
    r.bool(); // m_Enabled
    r.u8(); // m_CastShadows
    r.u8(); // m_ReceiveShadows
    if (versionGte(uv, [2017, 2])) r.u8(); // m_DynamicOccludee
    if (versionGte(uv, [2021])) r.u8(); // m_StaticShadowCaster
    r.u8(); // m_MotionVectors
    r.u8(); // m_LightProbeUsage
    r.u8(); // m_ReflectionProbeUsage
    if (versionGte(uv, [2019, 3])) r.u8(); // m_RayTracingMode
    if (versionGte(uv, [2020])) r.u8(); // m_RayTraceProcedural
    r.align(4);
    if (versionGte(uv, [2018])) r.u32(); // m_RenderingLayerMask
    if (versionGte(uv, [2018, 3])) r.i32(); // m_RendererPriority
    r.u16(); // m_LightmapIndex
    r.u16(); // m_LightmapIndexDynamic
  } else {
    r.bool(); // m_Enabled
    r.align(4);
    r.u8(); // m_CastShadows
    r.bool(); // m_ReceiveShadows
    r.align(4);
  }
  if (versionGte(uv, [3, 0])) r.bytesN(16); // m_LightmapTilingOffset (Vector4)
  if (versionGte(uv, [5, 0])) r.bytesN(16); // m_LightmapTilingOffsetDynamic

  const matCount = r.i32();
  const materials: PPtr[] = [];
  if (matCount < 0 || matCount > 100000) return { gameObject, materials };
  for (let i = 0; i < matCount; i++) materials.push(readPPtr(r, fv));
  return { gameObject, materials };
}

// Finish the trailing Renderer fields a SkinnedMeshRenderer reads before its
// own data. Mirrors AssetStudio's Renderer tail for 5.4+ builds.
function skipRendererTail(r: UnityReader, uv: number[], fv: number): void {
  if (versionGte(uv, [5, 5]))
    r.bytesN(4); // StaticBatchInfo
  else skipU32ArrayLocal(r); // m_SubsetIndices
  readPPtr(r, fv); // m_StaticBatchRoot
  if (versionGte(uv, [5, 4])) {
    readPPtr(r, fv); // m_ProbeAnchor
    readPPtr(r, fv); // m_LightProbeVolumeOverride
  }
  r.u32(); // m_SortingLayerID (>=5.6 is uint)
  r.i16(); // m_SortingOrder
  r.align(4);
}

function skipU32ArrayLocal(r: UnityReader): void {
  const n = r.i32();
  r.bytesN(n * 4);
}

function readSkinnedMeshRenderer(
  r: UnityReader,
  uv: number[],
  fv: number,
): { mesh: PPtr; materials: PPtr[] } {
  const { materials } = readRendererThroughMaterials(r, uv, fv);
  skipRendererTail(r, uv, fv);
  r.i32(); // m_Quality
  r.bool(); // m_UpdateWhenOffscreen
  r.bool(); // m_SkinNormals
  r.align(4);
  const mesh = readPPtr(r, fv); // m_Mesh (may be cross-file)
  return { mesh, materials };
}

function readMeshFilter(r: UnityReader, fv: number): { gameObject: number; mesh: PPtr } {
  const gameObject = readPPtr(r, fv).pathID; // Component.m_GameObject
  const mesh = readPPtr(r, fv); // m_Mesh (may be cross-file)
  return { gameObject, mesh };
}

// Reads a Material far enough to recover its main texture PPtr. The PPtr may be
// cross-file (fileID != 0); the caller resolves it via the owning file's
// external dependency list. Null when the material binds no usable texture.
function readMaterialMainTexture(r: UnityReader, uv: number[], fv: number): PPtr | null {
  r.alignedString(); // m_Name
  readPPtr(r, fv); // m_Shader
  if (versionGte(uv, [2021, 3])) {
    skipStringArray(r); // m_ValidKeywords
    skipStringArray(r); // m_InvalidKeywords
  } else if (versionGte(uv, [5, 0])) {
    r.alignedString(); // m_ShaderKeywords
  }
  if (versionGte(uv, [5, 0])) r.u32(); // m_LightmapFlags
  if (versionGte(uv, [5, 6])) {
    r.bool(); // m_EnableInstancingVariants
    r.align(4);
  }
  if (versionGte(uv, [4, 3])) r.i32(); // m_CustomRenderQueue
  if (versionGte(uv, [5, 1])) {
    const tagCount = r.i32();
    for (let i = 0; i < tagCount; i++) {
      r.alignedString();
      r.alignedString();
    }
  }
  if (versionGte(uv, [5, 6])) skipStringArray(r); // disabledShaderPasses

  // UnityPropertySheet.m_TexEnvs
  const texCount = r.i32();
  if (texCount < 0 || texCount > 100000) return null;
  let first: PPtr | null = null;
  let preferred: PPtr | null = null;
  for (let i = 0; i < texCount; i++) {
    const key = r.alignedString();
    const tex = readPPtr(r, fv); // m_Texture
    r.bytesN(16); // m_Scale (Vector2) + m_Offset (Vector2)
    if (tex.pathID === 0) continue; // unbound texture slot
    if (first === null) first = tex;
    const k = key.toLowerCase();
    if (preferred === null && (k === "_maintex" || k === "_basemap" || k === "_basecolormap")) {
      preferred = tex;
    }
  }
  return preferred ?? first;
}

// Texture2D field reading

function readTexture2D(reader: UnityReader, uv: number[]): TextureDescriptor | null {
  const name = reader.alignedString();

  // Texture base
  if (versionGte(uv, [2017, 3])) {
    reader.i32(); // forcedFallbackFormat
    reader.bool(); // downscaleFallback
    if (versionGte(uv, [2020, 2])) reader.bool(); // isAlphaChannelOptional
    reader.align(4);
  }

  const width = reader.i32();
  const height = reader.i32();
  reader.i32(); // completeImageSize
  if (versionGte(uv, [2020, 1])) reader.i32(); // mipsStripped
  const format = reader.i32();

  if (versionLte(uv, [5, 1])) {
    reader.bool(); // mipMap
  } else {
    reader.i32(); // mipCount
  }

  if (versionGte(uv, [2, 6])) reader.bool(); // isReadable
  if (versionGte(uv, [2020, 1])) reader.bool(); // isPreProcessed
  if (versionGte(uv, [2019, 3])) reader.bool(); // ignoreMasterTextureLimit
  if (versionGte(uv, [3, 0]) && versionLte(uv, [5, 4])) reader.bool(); // readAllowed
  if (versionGte(uv, [2018, 2])) reader.bool(); // streamingMipmaps
  reader.align(4);
  if (versionGte(uv, [2018, 2])) reader.i32(); // streamingMipmapsPriority

  reader.i32(); // imageCount
  reader.i32(); // textureDimension

  // GLTextureSettings
  reader.i32(); // filterMode
  reader.i32(); // aniso
  reader.f32(); // mipBias
  if (versionGte(uv, [2017, 1])) {
    reader.i32(); // wrapU
    reader.i32(); // wrapV
    reader.i32(); // wrapW
  } else {
    reader.i32(); // wrapMode
  }

  if (versionGte(uv, [3, 0])) reader.i32(); // lightmapFormat
  if (versionGte(uv, [3, 5])) reader.i32(); // colorSpace
  if (versionGte(uv, [2020, 2])) {
    const blobSize = reader.i32(); // platformBlob
    reader.bytesN(blobSize);
    reader.align(4);
  }

  const imageDataSize = reader.i32();

  let inlineData: Uint8Array | null = null;
  let streamData: StreamingInfo | null = null;

  if (imageDataSize === 0 && versionGte(uv, [5, 3])) {
    const offset = versionGte(uv, [2020, 1]) ? reader.i64() : reader.u32();
    const size = reader.u32();
    const path = reader.alignedString();
    streamData = { offset, size, path };
  } else {
    inlineData = reader.bytesN(imageDataSize).slice();
  }

  if (width <= 0 || height <= 0) return null;
  return { name, width, height, format, imageDataSize, inlineData, streamData };
}

// Extraction pipeline
//
// Unity spreads a single renderable across several serialized files: the Mesh
// lives in one file (e.g. resources.assets) while its Material + Texture2D
// usually live in another (sharedassetsN.assets). PPtr.fileID indexes the owning
// file's external dependency list, so linking Mesh -> Material -> Texture2D has
// to resolve across files. The pipeline therefore runs in three passes:
//   1. parse + index every serialized file (objects, externals, scene-graph
//      joins) into a shared registry;
//   2. emit every Texture2D as a PNG asset, recording where each one landed;
//   3. emit every Mesh as a GLB, resolving its texture across files and
//      referencing the already-emitted texture asset by path.

// A parsed serialized file plus a lazy loader for its full bytes (needed again
// in passes 2 and 3 to read texture/mesh/material records on demand).
type FileEntry = {
  key: string; // lowercased basename, the registry key
  little: boolean;
  unityVersion: number[];
  formatVersion: number;
  byPath: Map<number, ObjectInfo>;
  externals: string[]; // dependency basenames (lowercased); PPtr.fileID is 1-based into this
  texObjs: ObjectInfo[];
  meshObjs: ObjectInfo[];
  getBytes: () => Promise<Uint8Array | null>;
  resolve: CompanionResolver; // resolves this file's streamed .resS / .resource siblings
};

type ObjRef = { fileKey: string; pathID: number };

// Composite key for the global object maps. pathID is i64 but, like the rest of
// this reader, is carried as a number: consistent with the existing same-file code.
const objKey = (fileKey: string, pathID: number): string => `${fileKey} ${pathID}`;

// Entry points

function isUnityCandidate(name: string): boolean {
  const lower = name.toLowerCase();
  return (
    lower.endsWith(".assets") ||
    lower.endsWith(".bundle") ||
    lower.endsWith(".unity3d") ||
    lower.endsWith(".assetbundle") ||
    lower === "globalgamemanagers" ||
    /^level\d+$/.test(lower)
  );
}

// True if the file set looks like a Unity build worth scanning.
export function looksLikeUnity(files: File[]): boolean {
  for (const file of files) {
    if (isUnityCandidate(baseName(file.webkitRelativePath || file.name))) return true;
  }
  return false;
}

export async function* processUnityFiles(files: File[]): AsyncGenerator<ProcessedAsset> {
  // Index every file by basename so streamed texture data (.resS / .resource)
  // and bundle siblings can be resolved on demand.
  const onDisk = new Map<string, File>();
  for (const file of files) {
    onDisk.set(baseName(file.webkitRelativePath || file.name).toLowerCase(), file);
  }

  const cache = new Map<string, Uint8Array | null>();
  const usedNames = new Set<string>();

  const makeResolver =
    (nodeMap: Map<string, Uint8Array> | null): CompanionResolver =>
    async (wanted: string) => {
      const key = baseName(wanted).toLowerCase();
      const node = nodeMap?.get(key);
      if (node) return node;
      if (cache.has(key)) return cache.get(key) ?? null;
      const file = onDisk.get(key);
      if (!file) {
        cache.set(key, null);
        return null;
      }
      try {
        const data = new Uint8Array(await file.arrayBuffer());
        cache.set(key, data);
        return data;
      } catch {
        cache.set(key, null);
        return null;
      }
    };
  const diskResolver = makeResolver(null);

  // Shared cross-file state.
  const registry = new Map<string, FileEntry>();
  // Mesh (globally keyed) -> the materials bound to it, plus the file those
  // material PPtrs are expressed relative to.
  const meshToMats = new Map<string, { srcKey: string; materials: PPtr[] }>();
  // Texture2D (globally keyed) -> the asset path it was emitted at.
  const texAsset = new Map<string, string>();
  // Material (globally keyed) -> its main texture PPtr, memoised (shared
  // materials are referenced by many meshes).
  const materialTex = new Map<string, PPtr | null>();

  // Resolve a PPtr expressed in `srcKey`'s space to a concrete (file, pathID).
  const deref = (srcKey: string, ptr: PPtr): ObjRef | null => {
    if (ptr.pathID === 0) return null;
    if (ptr.fileID === 0) return { fileKey: srcKey, pathID: ptr.pathID };
    const dep = registry.get(srcKey)?.externals[ptr.fileID - 1];
    if (!dep) return null;
    return { fileKey: dep, pathID: ptr.pathID };
  };

  const claimName = (folder: string, stem: string, extn: string): string => {
    let path = `${folder}/${stem}.${extn}`.toLowerCase();
    let suffix = 1;
    while (usedNames.has(path)) path = `${folder}/${stem}_${suffix++}.${extn}`.toLowerCase();
    usedNames.add(path);
    return path;
  };

  // Pass 1 helper: parse one serialized unit, index its objects + scene-graph
  // joins, and register it. `bytes` is in hand here; `getBytes` reloads later.
  const indexUnit = (
    key: string,
    bytes: Uint8Array,
    resolver: CompanionResolver,
    getBytes: () => Promise<Uint8Array | null>,
  ): void => {
    let sf: SerializedFile | null;
    try {
      sf = parseSerializedFile(bytes);
    } catch {
      return;
    }
    if (!sf || registry.has(key)) return;

    const fv = sf.formatVersion;
    const uv = sf.unityVersion;
    const externals = sf.externals.map((p) => baseName(p).toLowerCase());
    const inBounds = (o: ObjectInfo) => o.byteStart >= 0 && o.byteStart + o.byteSize <= bytes.length;
    const bytesOf = (o: ObjectInfo) => bytes.subarray(o.byteStart, o.byteStart + o.byteSize);

    const byPath = new Map<number, ObjectInfo>();
    const texObjs: ObjectInfo[] = [];
    const meshObjs: ObjectInfo[] = [];

    // PPtr resolution local to this file (registry doesn't have `key` yet).
    const derefLocal = (ptr: PPtr): ObjRef | null => {
      if (ptr.pathID === 0) return null;
      if (ptr.fileID === 0) return { fileKey: key, pathID: ptr.pathID };
      const dep = externals[ptr.fileID - 1];
      return dep ? { fileKey: dep, pathID: ptr.pathID } : null;
    };

    // GameObject pathID -> mesh / materials (components share a GameObject and
    // are always co-located, so these joins are keyed by local pathID).
    const goToMesh = new Map<number, ObjRef>();
    const goToMats = new Map<number, PPtr[]>();

    for (const obj of sf.objects) {
      if (!inBounds(obj)) continue;
      byPath.set(obj.pathID, obj);
      try {
        switch (obj.classID) {
          case CLASS_TEXTURE2D:
            texObjs.push(obj);
            break;
          case CLASS_MESH:
            meshObjs.push(obj);
            break;
          case CLASS_MESH_FILTER: {
            const mf = readMeshFilter(new UnityReader(bytesOf(obj), sf.little), fv);
            const ref = derefLocal(mf.mesh);
            if (ref) goToMesh.set(mf.gameObject, ref);
            break;
          }
          case CLASS_MESH_RENDERER: {
            const mr = readRendererThroughMaterials(new UnityReader(bytesOf(obj), sf.little), uv, fv);
            if (mr.materials.length > 0) goToMats.set(mr.gameObject, mr.materials);
            break;
          }
          case CLASS_SKINNED_MESH_RENDERER: {
            const smr = readSkinnedMeshRenderer(new UnityReader(bytesOf(obj), sf.little), uv, fv);
            const ref = derefLocal(smr.mesh);
            if (ref && smr.materials.length > 0) {
              meshToMats.set(objKey(ref.fileKey, ref.pathID), { srcKey: key, materials: smr.materials });
            }
            break;
          }
          default:
            break;
        }
      } catch {
        // Malformed object: ignore for linking purposes.
      }
    }

    // Join static meshes (MeshFilter + MeshRenderer share a GameObject).
    for (const [go, ref] of goToMesh) {
      const mk = objKey(ref.fileKey, ref.pathID);
      if (meshToMats.has(mk)) continue; // a SkinnedMeshRenderer already bound it
      const mats = goToMats.get(go);
      if (mats) meshToMats.set(mk, { srcKey: key, materials: mats });
    }

    registry.set(key, {
      key,
      little: sf.little,
      unityVersion: uv,
      formatVersion: fv,
      byPath,
      externals,
      texObjs,
      meshObjs,
      getBytes,
      resolve: resolver,
    });
  };

  for (const file of files) {
    const name = baseName(file.webkitRelativePath || file.name);
    if (!isUnityCandidate(name)) continue;

    let bytes: Uint8Array;
    try {
      bytes = new Uint8Array(await file.arrayBuffer());
    } catch {
      continue;
    }

    // UnityFS bundle?
    const isBundle =
      bytes.length >= 7 &&
      bytes[0] === 0x55 &&
      bytes[1] === 0x6e &&
      bytes[2] === 0x69 &&
      bytes[3] === 0x74 &&
      bytes[4] === 0x79 &&
      bytes[5] === 0x46 &&
      bytes[6] === 0x53;

    if (isBundle) {
      let nodes: BundleNode[];
      try {
        nodes = parseBundle(bytes);
      } catch {
        continue; // LZMA / unsupported / corrupt bundle
      }
      const nodeMap = new Map<string, Uint8Array>();
      for (const node of nodes) nodeMap.set(baseName(node.path).toLowerCase(), node.data);
      const resolver = makeResolver(nodeMap);
      for (const node of nodes) {
        const nkey = baseName(node.path).toLowerCase();
        const data = node.data; // resident in the decompressed bundle
        indexUnit(nkey, data, resolver, async () => data);
      }
    } else {
      const key = name.toLowerCase();
      cache.set(key, bytes); // keep resident so passes 2/3 reuse it without re-reading
      indexUnit(key, bytes, diskResolver, () => diskResolver(key));
    }
  }

  // Decode one Texture2D object to a PNG (inline or streamed pixel data).
  const decodeTexObj = async (
    entry: FileEntry,
    info: ObjectInfo,
  ): Promise<{ png: Uint8Array; name: string } | null> => {
    const bytes = await entry.getBytes();
    if (!bytes || info.byteStart < 0 || info.byteStart + info.byteSize > bytes.length) return null;
    const desc = readTexture2D(
      new UnityReader(bytes.subarray(info.byteStart, info.byteStart + info.byteSize), entry.little),
      entry.unityVersion,
    );
    if (!desc) return null;
    let imageData = desc.inlineData;
    if ((!imageData || imageData.length === 0) && desc.streamData) {
      const res = await entry.resolve(desc.streamData.path);
      const { offset, size } = desc.streamData;
      if (res && offset >= 0 && offset + size <= res.length) imageData = res.subarray(offset, offset + size);
    }
    if (!imageData || imageData.length === 0) return null;
    const rgba = decodeTexture(imageData, desc.width, desc.height, desc.format);
    if (!rgba) return null;
    const png = await encodePng(desc.width, desc.height, rgba);
    return { png, name: desc.name };
  };

  for (const entry of registry.values()) {
    for (const info of entry.texObjs) {
      let dec: { png: Uint8Array; name: string } | null;
      try {
        dec = await decodeTexObj(entry, info);
      } catch {
        dec = null;
      }
      if (!dec) continue;
      const assetPath = claimName("textures", sanitizeName(dec.name), "png");
      texAsset.set(objKey(entry.key, info.pathID), assetPath);
      yield {
        path: assetPath,
        blob: new Blob([dec.png], { type: "image/png" }),
        mimeType: "image/png",
      };
    }
  }

  // Read (and memoise) a material's main texture PPtr, resolving cross-file.
  const materialTexture = async (ref: ObjRef): Promise<PPtr | null> => {
    const mk = objKey(ref.fileKey, ref.pathID);
    const cached = materialTex.get(mk);
    if (cached !== undefined) return cached;
    let result: PPtr | null = null;
    const entry = registry.get(ref.fileKey);
    const info = entry?.byPath.get(ref.pathID);
    if (entry && info && info.classID === CLASS_MATERIAL) {
      const bytes = await entry.getBytes();
      if (bytes && info.byteStart >= 0 && info.byteStart + info.byteSize <= bytes.length) {
        try {
          result = readMaterialMainTexture(
            new UnityReader(bytes.subarray(info.byteStart, info.byteStart + info.byteSize), entry.little),
            entry.unityVersion,
            entry.formatVersion,
          );
        } catch {
          result = null;
        }
      }
    }
    materialTex.set(mk, result);
    return result;
  };

  // Resolve a mesh's texture asset path through Mesh -> Material -> Texture2D,
  // following PPtrs across files. Returns null when nothing links cleanly.
  const meshTextureRef = async (meshKey: string): Promise<string | null> => {
    const link = meshToMats.get(meshKey);
    if (!link) return null;
    for (const matPtr of link.materials) {
      const matRef = deref(link.srcKey, matPtr);
      if (!matRef) continue;
      const texPtr = await materialTexture(matRef);
      if (!texPtr) continue;
      const texRef = deref(matRef.fileKey, texPtr);
      if (!texRef) continue;
      const assetPath = texAsset.get(objKey(texRef.fileKey, texRef.pathID));
      if (assetPath) return assetPath;
    }
    return null;
  };

  for (const entry of registry.values()) {
    if (entry.meshObjs.length === 0) continue;
    const bytes = await entry.getBytes();
    if (!bytes) continue;
    for (const info of entry.meshObjs) {
      if (info.byteStart < 0 || info.byteStart + info.byteSize > bytes.length) continue;
      const textureRef = await meshTextureRef(objKey(entry.key, info.pathID));

      let extracted: { name: string; data: Uint8Array } | null;
      try {
        extracted = await extractMeshGlb(
          bytes.subarray(info.byteStart, info.byteStart + info.byteSize),
          entry.little,
          entry.unityVersion,
          (name) => entry.resolve(name),
          textureRef,
        );
      } catch {
        continue; // malformed / unsupported mesh: skip
      }
      if (!extracted) continue;

      yield {
        path: claimName("meshes", sanitizeName(extracted.name), "glb"),
        blob: new Blob([extracted.data], { type: "model/gltf-binary" }),
        mimeType: "model/gltf-binary",
      };
    }
  }
}

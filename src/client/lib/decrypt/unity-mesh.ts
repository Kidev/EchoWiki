// Unity Mesh (class ID 43) extraction.
//
// Unity does not ship .fbx/.obj in a build; at build time every model is baked
// into an internal `Mesh` object inside the serialized asset files, with the
// vertex/index buffers usually streamed from a sibling .resS / .resource. This
// module parses that `Mesh` object, decodes its interleaved vertex streams and
// index buffer, and re-emits a self-contained binary glTF (GLB) so the existing
// ModelViewer (GLTFLoader) can display it.
//
// The field layout and vertex-format handling follow the AssetStudio reference
// implementation, version-gated for Unity 2017.4 -> 2022.x (modern builds). Skin
// weights, blend shapes and compressed (PackedBitVector) meshes are parsed only
// far enough to keep the reader aligned; we export static geometry (positions,
// normals, UV0, triangles). Anything unexpected throws and the object is skipped
// by the caller rather than aborting the import.

import { UnityReader, versionGte } from "./unity";

export const CLASS_MESH = 43;

type StreamingInfo = { offset: number; size: number; path: string };

type ChannelInfo = {
  stream: number;
  offset: number;
  format: number;
  dimension: number;
};
type StreamInfo = { channelMask: number; offset: number; stride: number };
type SubMesh = {
  firstByte: number;
  indexCount: number;
  topology: number;
  baseVertex: number;
  firstVertex: number;
  vertexCount: number;
};

type ParsedMesh = {
  name: string;
  use16BitIndices: boolean;
  indexBytes: Uint8Array;
  subMeshes: SubMesh[];
  vertexCount: number;
  channels: ChannelInfo[];
  streams: StreamInfo[];
  inlineVertexData: Uint8Array;
  streamData: StreamingInfo | null;
};

type Geometry = {
  positions: Float32Array;
  normals: Float32Array | null;
  uv: Float32Array | null;
  indices: Uint32Array;
};

// VertexFormat enum (Unity 2019+ numbering). Older builds use a remap (below).
const enum VF {
  Float = 0,
  Float16 = 1,
  UNorm8 = 2,
  SNorm8 = 3,
  UNorm16 = 4,
  SNorm16 = 5,
  UInt8 = 6,
  SInt8 = 7,
  UInt16 = 8,
  SInt16 = 9,
  UInt32 = 10,
  SInt32 = 11,
}

function toVertexFormat(format: number, uv: number[]): number {
  if ((uv[0] ?? 0) >= 2019) return format;
  // 2017-2018 VertexFormat2017: Float,Float16,Color,UNorm8,SNorm8,UNorm16,
  // SNorm16,UInt8,SInt8,UInt16,SInt16,UInt32,SInt32
  const map2017: Record<number, number> = {
    0: VF.Float,
    1: VF.Float16,
    2: VF.UNorm8, // Color
    3: VF.UNorm8,
    4: VF.SNorm8,
    5: VF.UNorm16,
    6: VF.SNorm16,
    7: VF.UInt8,
    8: VF.SInt8,
    9: VF.UInt16,
    10: VF.SInt16,
    11: VF.UInt32,
    12: VF.SInt32,
  };
  if ((uv[0] ?? 0) >= 2017) return map2017[format] ?? VF.Float;
  // < 2017 channel format: 0=Float,1=Float16,2=Color(UNorm8),3=Byte(UInt8)
  if (format === 1) return VF.Float16;
  if (format === 2 || format === 3) return VF.UNorm8;
  return VF.Float;
}

function formatSize(vf: number): number {
  switch (vf) {
    case VF.Float:
    case VF.UInt32:
    case VF.SInt32:
      return 4;
    case VF.Float16:
    case VF.UNorm16:
    case VF.SNorm16:
    case VF.UInt16:
    case VF.SInt16:
      return 2;
    default:
      return 1;
  }
}

function halfToFloat(h: number): number {
  const s = (h & 0x8000) >> 15;
  const e = (h & 0x7c00) >> 10;
  const f = h & 0x03ff;
  if (e === 0) return (s ? -1 : 1) * Math.pow(2, -14) * (f / 1024);
  if (e === 0x1f) return f ? NaN : (s ? -1 : 1) * Infinity;
  return (s ? -1 : 1) * Math.pow(2, e - 15) * (1 + f / 1024);
}

function decodeComponent(
  view: DataView,
  off: number,
  vf: number,
  little: boolean,
): number {
  switch (vf) {
    case VF.Float:
      return view.getFloat32(off, little);
    case VF.Float16:
      return halfToFloat(view.getUint16(off, little));
    case VF.UNorm8:
      return view.getUint8(off) / 255;
    case VF.SNorm8:
      return Math.max(view.getInt8(off) / 127, -1);
    case VF.UNorm16:
      return view.getUint16(off, little) / 65535;
    case VF.SNorm16:
      return Math.max(view.getInt16(off, little) / 32767, -1);
    case VF.UInt8:
      return view.getUint8(off);
    case VF.SInt8:
      return view.getInt8(off);
    case VF.UInt16:
      return view.getUint16(off, little);
    case VF.SInt16:
      return view.getInt16(off, little);
    case VF.UInt32:
      return view.getUint32(off, little);
    case VF.SInt32:
      return view.getInt32(off, little);
    default:
      return 0;
  }
}

function sanitize(name: string): string {
  const c = name.replace(/[^a-zA-Z0-9._-]/g, "_").replace(/^_+|_+$/g, "");
  return c.length > 0 ? c : "mesh";
}

// Array helpers mirroring AssetStudio's ObjectReader.
function skipBytes(r: UnityReader, n: number): void {
  r.bytesN(n);
}
function readU8Array(r: UnityReader): Uint8Array {
  const n = r.i32();
  if (n < 0 || n > r.remaining) throw new RangeError("bad array length");
  return r.bytesN(n).slice();
}
function skipMatrixArray(r: UnityReader): void {
  const n = r.i32();
  skipBytes(r, n * 64);
}
function skipU32Array(r: UnityReader): void {
  const n = r.i32();
  skipBytes(r, n * 4);
}
function skipSingleArray(r: UnityReader): void {
  const n = r.i32();
  skipBytes(r, n * 4);
}

// PackedBitVector variants: parsed only to advance the reader.
function skipPackedFloat(r: UnityReader): void {
  r.u32(); // m_NumItems
  r.f32(); // m_Range
  r.f32(); // m_Start
  skipBytes(r, r.i32()); // m_Data
  r.align(4);
  r.u8(); // m_BitSize
  r.align(4);
}
function skipPackedInt(r: UnityReader): void {
  r.u32(); // m_NumItems
  skipBytes(r, r.i32()); // m_Data
  r.align(4);
  r.u8(); // m_BitSize
  r.align(4);
}

function skipCompressedMesh(r: UnityReader, uv: number[]): void {
  skipPackedFloat(r); // m_Vertices
  skipPackedFloat(r); // m_UV
  // version < 5 has m_BindPoses here; our target is >= 2017
  skipPackedFloat(r); // m_Normals
  skipPackedFloat(r); // m_Tangents
  skipPackedInt(r); // m_Weights
  skipPackedInt(r); // m_NormalSigns
  skipPackedInt(r); // m_TangentSigns
  skipPackedFloat(r); // m_FloatColors (>= 5)
  skipPackedInt(r); // m_BoneIndices
  skipPackedInt(r); // m_Triangles
  r.u32(); // m_UVInfo (>= 5)
  void uv;
}

function skipBlendShapeData(r: UnityReader): void {
  // >= 4.3 layout (our target is >= 2017)
  const numVerts = r.i32();
  skipBytes(r, numVerts * 40); // BlendShapeVertex: vec3+vec3+vec3+uint = 40
  const numShapes = r.i32();
  // MeshBlendShape (>= 4.3): firstVertex u32, vertexCount u32, hasNormals bool,
  // hasTangents bool, AlignStream
  for (let i = 0; i < numShapes; i++) {
    r.u32();
    r.u32();
    r.u8();
    r.u8();
    r.align(4);
  }
  const numChannels = r.i32();
  for (let i = 0; i < numChannels; i++) {
    r.alignedString(); // name
    r.u32(); // nameHash
    r.i32(); // frameIndex
    r.i32(); // frameCount
  }
  skipSingleArray(r); // fullWeights
}

// GetStreams (Unity 5.0+): derive per-stream stride/offset from the channels.
function computeStreams(
  channels: ChannelInfo[],
  vertexCount: number,
  uv: number[],
): StreamInfo[] {
  let streamCount = 0;
  for (const c of channels) streamCount = Math.max(streamCount, c.stream + 1);
  const streams: StreamInfo[] = [];
  let offset = 0;
  for (let s = 0; s < streamCount; s++) {
    let chnMask = 0;
    let stride = 0;
    for (let chn = 0; chn < channels.length; chn++) {
      const c = channels[chn]!;
      if (c.stream === s && c.dimension > 0) {
        chnMask |= 1 << chn;
        stride += c.dimension * formatSize(toVertexFormat(c.format, uv));
      }
    }
    streams.push({ channelMask: chnMask, offset, stride });
    offset += vertexCount * stride;
    offset = (offset + 15) & ~15; // align stream to 16 bytes
  }
  return streams;
}

function parseMesh(r: UnityReader, uv: number[]): ParsedMesh | null {
  const name = r.alignedString();

  // m_SubMeshes
  const subCount = r.i32();
  if (subCount < 0 || subCount > 100000) return null;
  const subMeshes: SubMesh[] = [];
  for (let i = 0; i < subCount; i++) {
    const firstByte = r.u32();
    const indexCount = r.u32();
    const topology = r.i32();
    const baseVertex = versionGte(uv, [2017, 3]) ? r.u32() : 0;
    let firstVertex = 0;
    let vertexCount = 0;
    if (versionGte(uv, [3, 0])) {
      firstVertex = r.u32();
      vertexCount = r.u32();
      skipBytes(r, 24); // localAABB: center vec3 + extent vec3
    }
    subMeshes.push({
      firstByte,
      indexCount,
      topology,
      baseVertex,
      firstVertex,
      vertexCount,
    });
  }

  skipBlendShapeData(r); // m_Shapes (>= 4.1)

  // m_BindPose / m_BoneNameHashes / m_RootBoneNameHash (>= 4.3)
  skipMatrixArray(r);
  skipU32Array(r);
  r.u32(); // m_RootBoneNameHash

  // m_BonesAABB (>= 2019) + m_VariableBoneCountWeights
  if (versionGte(uv, [2019])) {
    const aabbCount = r.i32();
    skipBytes(r, aabbCount * 24); // MinMaxAABB: vec3 min + vec3 max
    skipU32Array(r); // m_VariableBoneCountWeights (packed uint array)
  }

  r.u8(); // m_MeshCompression
  // >= 4: (>=5 drops m_StreamCompression) IsReadable/KeepVertices/KeepIndices
  r.u8(); // m_IsReadable
  r.u8(); // m_KeepVertices
  r.u8(); // m_KeepIndices
  r.align(4);

  // m_IndexFormat (>= 2017.4 for our target)
  let use16BitIndices = true;
  if (versionGte(uv, [2017, 4])) {
    use16BitIndices = r.i32() === 0;
  }

  const indexBufferSize = r.i32();
  if (indexBufferSize < 0 || indexBufferSize > r.remaining) return null;
  const indexBytes = r.bytesN(indexBufferSize).slice();
  r.align(4);

  // m_VertexData
  if (!versionGte(uv, [2018])) r.u32(); // m_CurrentChannels (< 2018)
  const vertexCount = r.u32();
  const channelCount = r.i32();
  if (channelCount < 0 || channelCount > 256) return null;
  const channels: ChannelInfo[] = [];
  for (let i = 0; i < channelCount; i++) {
    const stream = r.u8();
    const offset = r.u8();
    const format = r.u8();
    const dimension = r.u8() & 0x0f;
    channels.push({ stream, offset, format, dimension });
  }
  const streams = computeStreams(channels, vertexCount, uv);
  const inlineVertexData = readU8Array(r);
  r.align(4);

  // m_CompressedMesh, m_LocalAABB, then the streaming descriptor.
  skipCompressedMesh(r, uv);
  skipBytes(r, 24); // m_LocalAABB

  r.i32(); // m_MeshUsageFlags
  if (versionGte(uv, [2022, 1])) r.i32(); // m_CookingOptions

  // m_BakedConvexCollisionMesh / m_BakedTriangleCollisionMesh (>= 5)
  readU8Array(r);
  r.align(4);
  readU8Array(r);
  r.align(4);

  if (versionGte(uv, [2018, 2])) {
    r.f32(); // m_MeshMetrics[0]
    r.f32(); // m_MeshMetrics[1]
  }

  let streamData: StreamingInfo | null = null;
  if (versionGte(uv, [2018, 3])) {
    r.align(4);
    const offset = versionGte(uv, [2020, 1]) ? r.i64() : r.u32();
    const size = r.u32();
    const path = r.alignedString();
    if (path) streamData = { offset, size, path };
  }

  return {
    name,
    use16BitIndices,
    indexBytes,
    subMeshes,
    vertexCount,
    channels,
    streams,
    inlineVertexData,
    streamData,
  };
}

// 2018+ channel index -> semantic. We only consume position/normal/uv0.
const CHN_POSITION = 0;
const CHN_NORMAL = 1;
const CHN_UV0 = 4;

function decodeChannel(
  mesh: ParsedMesh,
  vertexBytes: Uint8Array,
  chn: number,
  little: boolean,
  uv: number[],
): Float32Array | null {
  const channel = mesh.channels[chn];
  if (!channel || channel.dimension === 0) return null;
  const stream = mesh.streams[channel.stream];
  if (!stream || stream.stride === 0) return null;

  const vf = toVertexFormat(channel.format, uv);
  const compSize = formatSize(vf);
  const dim = channel.dimension;
  const out = new Float32Array(mesh.vertexCount * dim);
  const view = new DataView(
    vertexBytes.buffer,
    vertexBytes.byteOffset,
    vertexBytes.byteLength,
  );

  for (let v = 0; v < mesh.vertexCount; v++) {
    const base = stream.offset + channel.offset + stream.stride * v;
    for (let d = 0; d < dim; d++) {
      const off = base + compSize * d;
      if (off + compSize > vertexBytes.length) return out; // truncated: best-effort
      out[v * dim + d] = decodeComponent(view, off, vf, little);
    }
  }
  return out;
}

function buildIndices(mesh: ParsedMesh): Uint32Array {
  const view = new DataView(
    mesh.indexBytes.buffer,
    mesh.indexBytes.byteOffset,
    mesh.indexBytes.byteLength,
  );
  const read = (i: number): number =>
    mesh.use16BitIndices
      ? view.getUint16(i * 2, true)
      : view.getUint32(i * 4, true);
  const total = mesh.use16BitIndices
    ? (mesh.indexBytes.length / 2) | 0
    : (mesh.indexBytes.length / 4) | 0;

  const out: number[] = [];
  for (const sm of mesh.subMeshes) {
    // firstByte indexes the 16-bit buffer; halve again for 32-bit indices.
    let firstIndex = (sm.firstByte / 2) | 0;
    if (!mesh.use16BitIndices) firstIndex = (firstIndex / 2) | 0;
    const count = sm.indexCount;

    if (sm.topology === 0) {
      // Triangles
      for (let i = 0; i + 2 < count; i += 3) {
        const a = firstIndex + i;
        if (a + 2 >= total) break;
        out.push(
          read(a) + sm.baseVertex,
          read(a + 1) + sm.baseVertex,
          read(a + 2) + sm.baseVertex,
        );
      }
    } else if (sm.topology === 1) {
      // Triangle strip: de-stripify with winding flip-flop.
      for (let i = 0; i + 2 < count; i++) {
        const a = read(firstIndex + i) + sm.baseVertex;
        const b = read(firstIndex + i + 1) + sm.baseVertex;
        const c = read(firstIndex + i + 2) + sm.baseVertex;
        if (a === b || a === c || b === c) continue;
        if (i & 1) out.push(b, a, c);
        else out.push(a, b, c);
      }
    } else if (sm.topology === 2) {
      // Quads
      for (let q = 0; q + 3 < count; q += 4) {
        const i0 = read(firstIndex + q) + sm.baseVertex;
        const i1 = read(firstIndex + q + 1) + sm.baseVertex;
        const i2 = read(firstIndex + q + 2) + sm.baseVertex;
        const i3 = read(firstIndex + q + 3) + sm.baseVertex;
        out.push(i0, i1, i2, i0, i2, i3);
      }
    }
    // lines / points: ignored
  }
  return Uint32Array.from(out);
}

function computeNormals(
  positions: Float32Array,
  indices: Uint32Array,
): Float32Array {
  const normals = new Float32Array(positions.length);
  for (let i = 0; i + 2 < indices.length; i += 3) {
    const a = indices[i]! * 3;
    const b = indices[i + 1]! * 3;
    const c = indices[i + 2]! * 3;
    const ax = positions[a]!,
      ay = positions[a + 1]!,
      az = positions[a + 2]!;
    const bx = positions[b]!,
      by = positions[b + 1]!,
      bz = positions[b + 2]!;
    const cx = positions[c]!,
      cy = positions[c + 1]!,
      cz = positions[c + 2]!;
    const e1x = bx - ax,
      e1y = by - ay,
      e1z = bz - az;
    const e2x = cx - ax,
      e2y = cy - ay,
      e2z = cz - az;
    const nx = e1y * e2z - e1z * e2y;
    const ny = e1z * e2x - e1x * e2z;
    const nz = e1x * e2y - e1y * e2x;
    for (const idx of [a, b, c]) {
      normals[idx]! += nx;
      normals[idx + 1]! += ny;
      normals[idx + 2]! += nz;
    }
  }
  for (let i = 0; i < normals.length; i += 3) {
    const x = normals[i]!,
      y = normals[i + 1]!,
      z = normals[i + 2]!;
    const len = Math.hypot(x, y, z) || 1;
    normals[i] = x / len;
    normals[i + 1] = y / len;
    normals[i + 2] = z / len;
  }
  return normals;
}

// Minimal GLB (binary glTF 2.0) writer for a single triangle mesh. The texture
// is NOT embedded: when `textureRef` is set (and UVs exist) the material carries
// an `extras.echoTex` pointer to a separate echo asset, which ModelViewer loads
// and applies lazily at view time. This avoids duplicating a shared texture in
// every mesh GLB and lets the geometry render before the texture is ready.
function encodeGlb(geo: Geometry, textureRef: string | null): Uint8Array {
  const { positions, normals, uv, indices } = geo;
  const hasTexture = Boolean(textureRef && uv);

  // Pad each section to 4 bytes inside the BIN chunk.
  const pad4 = (n: number) => (n + 3) & ~3;
  const idxBytes = indices.length * 4;
  const posBytes = positions.length * 4;
  const nrmBytes = normals ? normals.length * 4 : 0;
  const uvBytes = uv ? uv.length * 4 : 0;

  const idxOff = 0;
  const posOff = pad4(idxOff + idxBytes);
  const nrmOff = pad4(posOff + posBytes);
  const uvOff = pad4(nrmOff + nrmBytes);
  const binLen = pad4(uvOff + uvBytes);

  const bin = new ArrayBuffer(binLen);
  new Uint32Array(bin, idxOff, indices.length).set(indices);
  new Float32Array(bin, posOff, positions.length).set(positions);
  if (normals) new Float32Array(bin, nrmOff, normals.length).set(normals);
  if (uv) new Float32Array(bin, uvOff, uv.length).set(uv);

  // POSITION accessor requires min/max.
  let minx = Infinity,
    miny = Infinity,
    minz = Infinity,
    maxx = -Infinity,
    maxy = -Infinity,
    maxz = -Infinity;
  for (let i = 0; i < positions.length; i += 3) {
    const x = positions[i]!,
      y = positions[i + 1]!,
      z = positions[i + 2]!;
    if (x < minx) minx = x;
    if (y < miny) miny = y;
    if (z < minz) minz = z;
    if (x > maxx) maxx = x;
    if (y > maxy) maxy = y;
    if (z > maxz) maxz = z;
  }
  const vertCount = positions.length / 3;

  const bufferViews: unknown[] = [
    { buffer: 0, byteOffset: idxOff, byteLength: idxBytes, target: 34963 },
    { buffer: 0, byteOffset: posOff, byteLength: posBytes, target: 34962 },
  ];
  const accessors: unknown[] = [
    {
      bufferView: 0,
      componentType: 5125,
      count: indices.length,
      type: "SCALAR",
    }, // UNSIGNED_INT
    {
      bufferView: 1,
      componentType: 5126,
      count: vertCount,
      type: "VEC3",
      min: [minx, miny, minz],
      max: [maxx, maxy, maxz],
    },
  ];
  const attributes: Record<string, number> = { POSITION: 1 };
  if (normals) {
    attributes["NORMAL"] = accessors.length;
    bufferViews.push({
      buffer: 0,
      byteOffset: nrmOff,
      byteLength: nrmBytes,
      target: 34962,
    });
    accessors.push({
      bufferView: bufferViews.length - 1,
      componentType: 5126,
      count: vertCount,
      type: "VEC3",
    });
  }
  if (uv) {
    attributes["TEXCOORD_0"] = accessors.length;
    bufferViews.push({
      buffer: 0,
      byteOffset: uvOff,
      byteLength: uvBytes,
      target: 34962,
    });
    accessors.push({
      bufferView: bufferViews.length - 1,
      componentType: 5126,
      count: vertCount,
      type: "VEC2",
    });
  }

  // White base colour when a texture will be applied (so it shows true colours);
  // a neutral grey otherwise. The texture reference rides in material.extras.
  const material: Record<string, unknown> = {
    pbrMetallicRoughness: hasTexture
      ? {
          baseColorFactor: [1, 1, 1, 1],
          metallicFactor: 0.0,
          roughnessFactor: 0.9,
        }
      : {
          baseColorFactor: [0.75, 0.76, 0.8, 1],
          metallicFactor: 0.05,
          roughnessFactor: 0.8,
        },
    doubleSided: true,
  };
  if (hasTexture) material["extras"] = { echoTex: textureRef };

  const gltf: Record<string, unknown> = {
    asset: { version: "2.0", generator: "EchoWiki UnityMesh" },
    scene: 0,
    scenes: [{ nodes: [0] }],
    nodes: [{ mesh: 0 }],
    meshes: [
      { primitives: [{ attributes, indices: 0, mode: 4, material: 0 }] },
    ],
    materials: [material],
    bufferViews,
    accessors,
    buffers: [{ byteLength: binLen }],
  };

  const jsonStr = JSON.stringify(gltf);
  const jsonBuf = new TextEncoder().encode(jsonStr);
  const jsonPad = pad4(jsonBuf.length);
  const jsonChunk = new Uint8Array(jsonPad);
  jsonChunk.set(jsonBuf);
  jsonChunk.fill(0x20, jsonBuf.length); // pad JSON with spaces

  const totalLen = 12 + 8 + jsonPad + 8 + binLen;
  const out = new Uint8Array(totalLen);
  const dv = new DataView(out.buffer);
  let p = 0;
  dv.setUint32(p, 0x46546c67, true); // 'glTF'
  dv.setUint32(p + 4, 2, true); // version
  dv.setUint32(p + 8, totalLen, true);
  p = 12;
  dv.setUint32(p, jsonPad, true);
  dv.setUint32(p + 4, 0x4e4f534a, true); // 'JSON'
  out.set(jsonChunk, p + 8);
  p += 8 + jsonPad;
  dv.setUint32(p, binLen, true);
  dv.setUint32(p + 4, 0x004e4942, true); // 'BIN\0'
  out.set(new Uint8Array(bin), p + 8);

  return out;
}

export type ExtractedMesh = { name: string; data: Uint8Array };

// Parse a Mesh object and return a GLB. `resolve` fetches a streamed buffer
// (.resS / .resource) by name. Returns null for compressed / empty / unsupported
// meshes (caller skips them).
export async function extractMeshGlb(
  objBytes: Uint8Array,
  little: boolean,
  uv: number[],
  resolve: (name: string) => Promise<Uint8Array | null>,
  textureRef?: string | null,
): Promise<ExtractedMesh | null> {
  const mesh = parseMesh(new UnityReader(objBytes, little), uv);
  if (!mesh || mesh.vertexCount === 0 || mesh.subMeshes.length === 0)
    return null;

  // Resolve the vertex buffer (streamed in modern builds, inline otherwise).
  let vertexBytes = mesh.inlineVertexData;
  if (mesh.streamData && mesh.vertexCount > 0) {
    const res = await resolve(mesh.streamData.path);
    if (!res) return null;
    const { offset, size } = mesh.streamData;
    if (offset < 0 || offset + size > res.length) return null;
    vertexBytes = res.subarray(offset, offset + size);
  }
  if (!vertexBytes || vertexBytes.length === 0) return null; // likely PackedBitVector-compressed

  const rawPos = decodeChannel(mesh, vertexBytes, CHN_POSITION, little, uv);
  if (!rawPos || rawPos.length === 0) return null;
  const rawNrm = decodeChannel(mesh, vertexBytes, CHN_NORMAL, little, uv);
  const rawUv = decodeChannel(mesh, vertexBytes, CHN_UV0, little, uv);

  let indices = buildIndices(mesh);
  if (indices.length === 0) return null;

  // Drop any index that overruns the vertex range (defensive against misparses).
  const vcount = rawPos.length / 3;
  for (let i = 0; i < indices.length; i++) {
    if (indices[i]! >= vcount) {
      indices = indices.subarray(0, i - (i % 3));
      break;
    }
  }
  if (indices.length === 0) return null;

  // Unity is left-handed (Y-up); glTF is right-handed. Negate X and flip the
  // triangle winding so faces stay outward and the model isn't mirrored.
  const positions = new Float32Array(rawPos.length);
  for (let i = 0; i < rawPos.length; i += 3) {
    positions[i] = -rawPos[i]!;
    positions[i + 1] = rawPos[i + 1]!;
    positions[i + 2] = rawPos[i + 2]!;
  }
  let normals: Float32Array | null = null;
  if (rawNrm && rawNrm.length === positions.length) {
    normals = new Float32Array(rawNrm.length);
    for (let i = 0; i < rawNrm.length; i += 3) {
      normals[i] = -rawNrm[i]!;
      normals[i + 1] = rawNrm[i + 1]!;
      normals[i + 2] = rawNrm[i + 2]!;
    }
  }
  let uv0: Float32Array | null = null;
  if (rawUv && rawUv.length === vcount * 2) {
    uv0 = new Float32Array(rawUv.length);
    for (let i = 0; i < rawUv.length; i += 2) {
      uv0[i] = rawUv[i]!;
      uv0[i + 1] = 1 - rawUv[i + 1]!; // Unity V is bottom-up
    }
  }
  // Flip winding (swap 2nd/3rd index of every triangle).
  for (let i = 0; i + 2 < indices.length; i += 3) {
    const t = indices[i + 1]!;
    indices[i + 1] = indices[i + 2]!;
    indices[i + 2] = t;
  }

  if (!normals) normals = computeNormals(positions, indices);

  const data = encodeGlb(
    { positions, normals, uv: uv0, indices },
    textureRef ?? null,
  );
  return { name: sanitize(mesh.name), data };
}

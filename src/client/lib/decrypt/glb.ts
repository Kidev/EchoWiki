// Minimal multi-surface binary glTF (GLB 2.0) writer shared by the game-engine
// model decoders (MD2/MD3/Quake MDL/GoldSrc MDL/Source MDL). Unlike the
// single-primitive writer baked into unity-mesh.ts, this one supports several
// surfaces, per-surface materials, and embedded PNG textures so a self-contained
// model (one whose skins live inside the model file) renders with its texture
// straight away. Materials may instead carry an `echoTex` pointer to a separately
// stored texture asset, which ModelViewer resolves and applies lazily.
//
// All geometry must already be in glTF space: right-handed, Y-up, with outward
// (CCW) winding. Each decoder converts from its engine's convention first.

export type GlbSurface = {
  positions: Float32Array; // xyz triples
  normals?: Float32Array | null; // xyz triples (computed if absent)
  uv?: Float32Array | null; // uv pairs
  indices: Uint32Array; // triangle list
  material: number; // index into the materials array
};

export type GlbMaterial = {
  // Embedded texture (index into the textures array) takes priority; otherwise an
  // echoTex pointer is stored in material.extras for lazy loading; otherwise the
  // baseColor (or a neutral grey) is used flat.
  texture?: number | null;
  echoTex?: string | null;
  baseColor?: [number, number, number, number] | undefined;
};

const pad4 = (n: number): number => (n + 3) & ~3;

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
    const e1x = positions[b]! - ax,
      e1y = positions[b + 1]! - ay,
      e1z = positions[b + 2]! - az;
    const e2x = positions[c]! - ax,
      e2y = positions[c + 1]! - ay,
      e2z = positions[c + 2]! - az;
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

// Build a self-contained GLB from a set of surfaces, materials and embedded
// PNG images. Returns null if no surface carries any geometry.
export function encodeGlbScene(
  surfaces: GlbSurface[],
  materials: GlbMaterial[],
  images: Uint8Array[],
): Uint8Array | null {
  const usable = surfaces.filter(
    (s) => s.positions.length >= 9 && s.indices.length >= 3,
  );
  if (usable.length === 0) return null;

  const bufferViews: Record<string, unknown>[] = [];
  const accessors: Record<string, unknown>[] = [];
  const chunks: Uint8Array[] = [];
  let binLen = 0;

  // Append a typed-array section to the BIN chunk and return its bufferView index.
  const addView = (arr: Uint8Array, target?: number): number => {
    const byteOffset = binLen;
    chunks.push(arr);
    const view: Record<string, unknown> = {
      buffer: 0,
      byteOffset,
      byteLength: arr.byteLength,
    };
    if (target !== undefined) view["target"] = target;
    bufferViews.push(view);
    binLen = pad4(binLen + arr.byteLength);
    return bufferViews.length - 1;
  };

  const meshPrimitives: Record<string, unknown>[] = [];

  for (const s of usable) {
    const normals =
      s.normals && s.normals.length === s.positions.length
        ? s.normals
        : computeNormals(s.positions, s.indices);
    const vertCount = s.positions.length / 3;

    const idxView = addView(
      new Uint8Array(
        s.indices.buffer,
        s.indices.byteOffset,
        s.indices.byteLength,
      ),
      34963,
    );
    const idxAccessor = accessors.length;
    accessors.push({
      bufferView: idxView,
      componentType: 5125, // UNSIGNED_INT
      count: s.indices.length,
      type: "SCALAR",
    });

    let minx = Infinity,
      miny = Infinity,
      minz = Infinity,
      maxx = -Infinity,
      maxy = -Infinity,
      maxz = -Infinity;
    for (let i = 0; i < s.positions.length; i += 3) {
      const x = s.positions[i]!,
        y = s.positions[i + 1]!,
        z = s.positions[i + 2]!;
      if (x < minx) minx = x;
      if (y < miny) miny = y;
      if (z < minz) minz = z;
      if (x > maxx) maxx = x;
      if (y > maxy) maxy = y;
      if (z > maxz) maxz = z;
    }

    const posView = addView(
      new Uint8Array(
        s.positions.buffer,
        s.positions.byteOffset,
        s.positions.byteLength,
      ),
      34962,
    );
    const posAccessor = accessors.length;
    accessors.push({
      bufferView: posView,
      componentType: 5126,
      count: vertCount,
      type: "VEC3",
      min: [minx, miny, minz],
      max: [maxx, maxy, maxz],
    });

    const attributes: Record<string, number> = { POSITION: posAccessor };

    const nrmView = addView(
      new Uint8Array(normals.buffer, normals.byteOffset, normals.byteLength),
      34962,
    );
    attributes["NORMAL"] = accessors.length;
    accessors.push({
      bufferView: nrmView,
      componentType: 5126,
      count: vertCount,
      type: "VEC3",
    });

    if (s.uv && s.uv.length === vertCount * 2) {
      const uvView = addView(
        new Uint8Array(s.uv.buffer, s.uv.byteOffset, s.uv.byteLength),
        34962,
      );
      attributes["TEXCOORD_0"] = accessors.length;
      accessors.push({
        bufferView: uvView,
        componentType: 5126,
        count: vertCount,
        type: "VEC2",
      });
    }

    meshPrimitives.push({
      attributes,
      indices: idxAccessor,
      mode: 4,
      material: s.material,
    });
  }

  // Embedded images -> bufferView-backed glTF images + textures.
  const gltfImages: Record<string, unknown>[] = [];
  const gltfTextures: Record<string, unknown>[] = [];
  for (const png of images) {
    const view = addView(png);
    gltfImages.push({ bufferView: view, mimeType: "image/png" });
    gltfTextures.push({ source: gltfImages.length - 1, sampler: 0 });
  }

  const gltfMaterials = materials.map((m) => {
    const hasTex = m.texture != null && m.texture >= 0;
    const pbr: Record<string, unknown> = {
      baseColorFactor: hasTex
        ? [1, 1, 1, 1]
        : (m.baseColor ?? [0.75, 0.76, 0.8, 1]),
      metallicFactor: 0.0,
      roughnessFactor: 0.85,
    };
    if (hasTex) pbr["baseColorTexture"] = { index: m.texture };
    const mat: Record<string, unknown> = {
      pbrMetallicRoughness: pbr,
      doubleSided: true,
    };
    if (!hasTex && m.echoTex) mat["extras"] = { echoTex: m.echoTex };
    return mat;
  });

  const gltf: Record<string, unknown> = {
    asset: { version: "2.0", generator: "EchoWiki model" },
    scene: 0,
    scenes: [{ nodes: [0] }],
    nodes: [{ mesh: 0 }],
    meshes: [{ primitives: meshPrimitives }],
    materials:
      gltfMaterials.length > 0 ? gltfMaterials : [{ doubleSided: true }],
    bufferViews,
    accessors,
    buffers: [{ byteLength: binLen }],
  };
  if (gltfImages.length > 0) {
    gltf["images"] = gltfImages;
    gltf["textures"] = gltfTextures;
    gltf["samplers"] = [{ wrapS: 10497, wrapT: 10497 }];
  }

  // Assemble the BIN chunk (sections padded to 4 bytes).
  const bin = new Uint8Array(binLen);
  {
    let p = 0;
    for (const c of chunks) {
      bin.set(c, p);
      p = pad4(p + c.byteLength);
    }
  }

  const jsonBuf = new TextEncoder().encode(JSON.stringify(gltf));
  const jsonPad = pad4(jsonBuf.length);
  const jsonChunk = new Uint8Array(jsonPad);
  jsonChunk.set(jsonBuf);
  jsonChunk.fill(0x20, jsonBuf.length);

  const totalLen = 12 + 8 + jsonPad + 8 + binLen;
  const out = new Uint8Array(totalLen);
  const dv = new DataView(out.buffer);
  let p = 0;
  dv.setUint32(p, 0x46546c67, true); // 'glTF'
  dv.setUint32(p + 4, 2, true);
  dv.setUint32(p + 8, totalLen, true);
  p = 12;
  dv.setUint32(p, jsonPad, true);
  dv.setUint32(p + 4, 0x4e4f534a, true); // 'JSON'
  out.set(jsonChunk, p + 8);
  p += 8 + jsonPad;
  dv.setUint32(p, binLen, true);
  dv.setUint32(p + 4, 0x004e4942, true); // 'BIN\0'
  out.set(bin, p + 8);

  return out;
}

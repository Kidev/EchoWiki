// GoldSrc studio model (.mdl) decoder: Half-Life 1, Counter-Strike 1.6, Day of
// Defeat and the rest of the GoldSrc lineage. Magic "IDST", version 10.
//
// A GoldSrc model stores its vertices in *bone space*: each vertex is relative to
// the bone it is weighted to, so the bind pose must be reconstructed (walk the
// bone tree, build each bone's world transform from its local position + Euler
// rotation, then transform every vertex by its bone) before the mesh makes sense.
// Triangles arrive as D3D-style strip/fan command lists. Textures are 8-bit
// palettised and embedded in the same file (unless split into a sibling "T.mdl",
// in which case geometry still renders, untextured). We export the reference pose
// as a GLB with embedded PNG skins.

import { encodeGlbScene, type GlbSurface, type GlbMaterial } from "./glb";
import { encodePng } from "./png";

const IDST = 0x54534449; // "IDST"

// 3x4 row-major transform (rotation 3x3 + translation in column 3).
type Mat = Float32Array;

function quatPosToMat(q: [number, number, number, number], pos: number[]): Mat {
  const [x, y, z, w] = q;
  const m = new Float32Array(12);
  m[0] = 1 - 2 * y * y - 2 * z * z;
  m[1] = 2 * x * y - 2 * w * z;
  m[2] = 2 * x * z + 2 * w * y;
  m[3] = pos[0]!;
  m[4] = 2 * x * y + 2 * w * z;
  m[5] = 1 - 2 * x * x - 2 * z * z;
  m[6] = 2 * y * z - 2 * w * x;
  m[7] = pos[1]!;
  m[8] = 2 * x * z - 2 * w * y;
  m[9] = 2 * y * z + 2 * w * x;
  m[10] = 1 - 2 * x * x - 2 * y * y;
  m[11] = pos[2]!;
  return m;
}

// HL SDK AngleQuaternion: angles are rotations about X, Y, Z (radians).
function angleQuat(
  ax: number,
  ay: number,
  az: number,
): [number, number, number, number] {
  const sy = Math.sin(az * 0.5),
    cy = Math.cos(az * 0.5);
  const sp = Math.sin(ay * 0.5),
    cp = Math.cos(ay * 0.5);
  const sr = Math.sin(ax * 0.5),
    cr = Math.cos(ax * 0.5);
  return [
    sr * cp * cy - cr * sp * sy,
    cr * sp * cy + sr * cp * sy,
    cr * cp * sy - sr * sp * cy,
    cr * cp * cy + sr * sp * sy,
  ];
}

// world = parent * local (HL ConcatTransforms).
function concat(a: Mat, b: Mat): Mat {
  const o = new Float32Array(12);
  for (let r = 0; r < 3; r++) {
    const ar = r * 4;
    for (let c = 0; c < 3; c++) {
      o[ar + c] =
        a[ar]! * b[c]! + a[ar + 1]! * b[4 + c]! + a[ar + 2]! * b[8 + c]!;
    }
    o[ar + 3] =
      a[ar]! * b[3]! + a[ar + 1]! * b[7]! + a[ar + 2]! * b[11]! + a[ar + 3]!;
  }
  return o;
}

function transform(
  m: Mat,
  x: number,
  y: number,
  z: number,
): [number, number, number] {
  return [
    m[0]! * x + m[1]! * y + m[2]! * z + m[3]!,
    m[4]! * x + m[5]! * y + m[6]! * z + m[7]!,
    m[8]! * x + m[9]! * y + m[10]! * z + m[11]!,
  ];
}

type Texture = { width: number; height: number; rgba: Uint8Array };

function decodeTexture(
  v: DataView,
  bytes: Uint8Array,
  texOff: number,
): Texture | null {
  const width = v.getInt32(texOff + 68, true);
  const height = v.getInt32(texOff + 72, true);
  const dataOff = v.getInt32(texOff + 76, true);
  if (width <= 0 || height <= 0 || width > 4096 || height > 4096) return null;
  const n = width * height;
  if (dataOff <= 0 || dataOff + n + 768 > bytes.length) return null;
  const pal = dataOff + n;
  const rgba = new Uint8Array(n * 4);
  for (let i = 0; i < n; i++) {
    const idx = bytes[dataOff + i]!;
    const p = pal + idx * 3;
    rgba[i * 4] = bytes[p]!;
    rgba[i * 4 + 1] = bytes[p + 1]!;
    rgba[i * 4 + 2] = bytes[p + 2]!;
    rgba[i * 4 + 3] = 255;
  }
  return { width, height, rgba };
}

export async function decodeGoldSrcMdl(
  buf: ArrayBuffer,
  textureBuf?: ArrayBuffer | undefined,
): Promise<Uint8Array | null> {
  const v = new DataView(buf);
  const bytes = new Uint8Array(buf);
  if (v.byteLength < 244) return null;
  if (v.getUint32(0, true) !== IDST) return null;
  const version = v.getInt32(4, true);
  if (version !== 10) return null; // 44+ is Source (handled elsewhere)

  const numbones = v.getInt32(140, true);
  const boneindex = v.getInt32(144, true);
  const numbodyparts = v.getInt32(204, true);
  const bodypartindex = v.getInt32(208, true);

  // Textures and the skin table live either in this file or, very commonly for
  // GoldSrc, in a sibling "<name>T.mdl". Use whichever has them.
  let texView = v;
  let texBytes = bytes;
  let numtextures = v.getInt32(180, true);
  let textureindex = v.getInt32(184, true);
  let numskinref = v.getInt32(192, true);
  let skinindex = v.getInt32(200, true);
  if (numtextures === 0 && textureBuf && textureBuf.byteLength >= 244) {
    const tv = new DataView(textureBuf);
    if (tv.getUint32(0, true) === IDST) {
      texView = tv;
      texBytes = new Uint8Array(textureBuf);
      numtextures = tv.getInt32(180, true);
      textureindex = tv.getInt32(184, true);
      numskinref = tv.getInt32(192, true);
      skinindex = tv.getInt32(200, true);
    }
  }

  if (numbones <= 0 || numbones > 4096 || numbodyparts <= 0) return null;

  // Bone bind-pose world transforms.
  const BONE_SIZE = 112;
  const boneWorld: Mat[] = [];
  for (let i = 0; i < numbones; i++) {
    const b = boneindex + i * BONE_SIZE;
    if (b + BONE_SIZE > bytes.length) return null;
    const parent = v.getInt32(b + 32, true);
    const px = v.getFloat32(b + 64, true);
    const py = v.getFloat32(b + 68, true);
    const pz = v.getFloat32(b + 72, true);
    const rx = v.getFloat32(b + 76, true);
    const ry = v.getFloat32(b + 80, true);
    const rz = v.getFloat32(b + 84, true);
    const local = quatPosToMat(angleQuat(rx, ry, rz), [px, py, pz]);
    boneWorld[i] =
      parent >= 0 && boneWorld[parent]
        ? concat(boneWorld[parent]!, local)
        : local;
  }

  // Skin table (family 0): skinref -> texture index.
  const skinFamily0: number[] = [];
  if (numskinref > 0 && skinindex > 0) {
    for (let i = 0; i < numskinref; i++) {
      skinFamily0[i] = texView.getInt16(skinindex + i * 2, true);
    }
  }

  // Decode textures (lazily wrapped to PNG only for those a surface references).
  const decodeTex = (texIdx: number): Texture | null => {
    if (texIdx < 0 || texIdx >= numtextures) return null;
    return decodeTexture(texView, texBytes, textureindex + texIdx * 80);
  };

  const surfaces: GlbSurface[] = [];
  const materials: GlbMaterial[] = [];
  const images: Uint8Array[] = [];
  const imageCache = new Map<number, number>(); // texIdx -> image array slot

  const BODYPART_SIZE = 76;
  for (let bp = 0; bp < numbodyparts; bp++) {
    const bpOff = bodypartindex + bp * BODYPART_SIZE;
    if (bpOff + BODYPART_SIZE > bytes.length) break;
    const nummodels = v.getInt32(bpOff + 64, true);
    const modelindex = v.getInt32(bpOff + 72, true);
    if (nummodels <= 0 || nummodels > 1024) continue;

    // Only the first submodel of each body part (the default body variant).
    const MODEL_SIZE = 112;
    const mOff = modelindex; // first model
    if (mOff + MODEL_SIZE > bytes.length) continue;
    const nummesh = v.getInt32(mOff + 72, true);
    const meshindex = v.getInt32(mOff + 76, true);
    const numverts = v.getInt32(mOff + 80, true);
    const vertinfoindex = v.getInt32(mOff + 84, true);
    const vertindex = v.getInt32(mOff + 88, true);
    if (numverts <= 0 || numverts > 1 << 20 || nummesh <= 0) continue;
    if (vertindex + numverts * 12 > bytes.length) continue;
    if (vertinfoindex + numverts > bytes.length) continue;

    // Pre-transform every vertex into the reference pose.
    const worldVerts = new Float32Array(numverts * 3);
    for (let i = 0; i < numverts; i++) {
      const bone = bytes[vertinfoindex + i]!;
      const m = boneWorld[bone] ?? boneWorld[0]!;
      const vx = v.getFloat32(vertindex + i * 12, true);
      const vy = v.getFloat32(vertindex + i * 12 + 4, true);
      const vz = v.getFloat32(vertindex + i * 12 + 8, true);
      const [wx, wy, wz] = transform(m, vx, vy, vz);
      worldVerts[i * 3] = wx;
      worldVerts[i * 3 + 1] = wy;
      worldVerts[i * 3 + 2] = wz;
    }

    const MESH_SIZE = 20;
    for (let mi = 0; mi < nummesh; mi++) {
      const meshOff = meshindex + mi * MESH_SIZE;
      if (meshOff + MESH_SIZE > bytes.length) break;
      const numtris = v.getInt32(meshOff, true);
      const triindex = v.getInt32(meshOff + 4, true);
      const skinref = v.getInt32(meshOff + 8, true);
      if (numtris <= 0 || triindex <= 0) continue;

      const texIdx = skinFamily0[skinref] ?? skinref;
      const tex = decodeTex(texIdx);
      const tw = tex ? tex.width : 1;
      const th = tex ? tex.height : 1;

      let material = imageCache.get(texIdx);
      if (material === undefined) {
        if (tex) {
          const png = await encodePng(tex.width, tex.height, tex.rgba);
          images.push(png);
          materials.push({ texture: images.length - 1 });
        } else {
          materials.push({});
        }
        material = materials.length - 1;
        imageCache.set(texIdx, material);
      }

      // Walk the strip/fan command list, emitting an indexed triangle list. We
      // re-emit vertices per command-vertex (duplicating shared positions) so UVs
      // stay per-corner; positions come from the pre-transformed worldVerts.
      const pos: number[] = [];
      const uv: number[] = [];
      const idx: number[] = [];
      let p = triindex;
      const pushVert = (vi: number, s: number, t: number): number => {
        const base = vi * 3;
        pos.push(
          worldVerts[base]!,
          worldVerts[base + 1]!,
          worldVerts[base + 2]!,
        );
        uv.push(s / tw, t / th);
        return pos.length / 3 - 1;
      };
      // Guard against runaway parsing.
      const maxCmds = numtris * 4 + 16;
      let cmds = 0;
      while (p + 2 <= bytes.length && cmds++ < maxCmds) {
        let count = v.getInt16(p, true);
        p += 2;
        if (count === 0) break;
        const isFan = count < 0;
        if (isFan) count = -count;
        if (p + count * 8 > bytes.length) break;
        const ring: number[] = [];
        for (let i = 0; i < count; i++) {
          const vi = v.getUint16(p, true);
          const s = v.getInt16(p + 4, true);
          const t = v.getInt16(p + 6, true);
          p += 8;
          ring.push(pushVert(vi, s, t));
        }
        if (isFan) {
          for (let i = 1; i + 1 < count; i++) {
            idx.push(ring[0]!, ring[i + 1]!, ring[i]!);
          }
        } else {
          for (let i = 0; i + 2 < count; i++) {
            if (i & 1) idx.push(ring[i]!, ring[i + 1]!, ring[i + 2]!);
            else idx.push(ring[i]!, ring[i + 2]!, ring[i + 1]!);
          }
        }
      }
      if (idx.length < 3) continue;

      // GoldSrc space (Z-up) -> glTF (x, z, -y).
      const positions = new Float32Array(pos.length);
      for (let i = 0; i < pos.length; i += 3) {
        positions[i] = pos[i]!;
        positions[i + 1] = pos[i + 2]!;
        positions[i + 2] = -pos[i + 1]!;
      }
      surfaces.push({
        positions,
        uv: Float32Array.from(uv),
        indices: Uint32Array.from(idx),
        material,
      });
    }
  }

  return encodeGlbScene(surfaces, materials, images);
}

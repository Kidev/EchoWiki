// Quake / Quake-engine model (.mdl, magic "IDPO", version 6) decoder: the
// original id Tech 1 alias model used by Quake, Hexen II and relatives. One mesh
// with a stack of keyframe poses; we export the first frame as static geometry.
//
// Skins are embedded as 8-bit palette-indexed bitmaps. We export geometry (with
// UVs) and a neutral material rather than decoding the skin, so the model always
// displays correctly even where the engine palette isn't available.

import { encodeGlbScene, type GlbSurface, type GlbMaterial } from "./glb";

const MDL_IDENT = 0x4f504449; // "IDPO"

export function decodeQuakeMdl(buf: ArrayBuffer): Uint8Array | null {
  const v = new DataView(buf);
  if (v.byteLength < 84 || v.getUint32(0, true) !== MDL_IDENT) return null;

  const scaleX = v.getFloat32(8, true);
  const scaleY = v.getFloat32(12, true);
  const scaleZ = v.getFloat32(16, true);
  const originX = v.getFloat32(20, true);
  const originY = v.getFloat32(24, true);
  const originZ = v.getFloat32(28, true);
  const numSkins = v.getInt32(48, true);
  const skinWidth = v.getInt32(52, true) || 1;
  const skinHeight = v.getInt32(56, true) || 1;
  const numVerts = v.getInt32(60, true);
  const numTris = v.getInt32(64, true);
  const numFrames = v.getInt32(68, true);

  if (
    numVerts <= 0 ||
    numVerts > 1 << 20 ||
    numTris <= 0 ||
    numTris > 1 << 21 ||
    numFrames <= 0 ||
    numSkins < 0 ||
    numSkins > 4096
  )
    return null;

  // Skip the skin block (variable: single or grouped) to reach the texcoords.
  let p = 84;
  const skinPixels = skinWidth * skinHeight;
  for (let i = 0; i < numSkins; i++) {
    if (p + 4 > v.byteLength) return null;
    const group = v.getInt32(p, true);
    p += 4;
    if (group === 0) {
      p += skinPixels;
    } else {
      const nb = v.getInt32(p, true);
      p += 4 + nb * 4 + nb * skinPixels;
    }
  }

  // stverts: { int onseam; int s; int t; } per vertex.
  const stvertBase = p;
  if (stvertBase + numVerts * 12 > v.byteLength) return null;
  const onseam = new Uint8Array(numVerts);
  const sCoord = new Int32Array(numVerts);
  const tCoord = new Int32Array(numVerts);
  for (let i = 0; i < numVerts; i++) {
    const o = stvertBase + i * 12;
    onseam[i] = v.getInt32(o, true) & 0x20 ? 1 : 0;
    sCoord[i] = v.getInt32(o + 4, true);
    tCoord[i] = v.getInt32(o + 8, true);
  }
  p = stvertBase + numVerts * 12;

  // triangles: { int facesfront; int vertindex[3]; }
  const triBase = p;
  if (triBase + numTris * 16 > v.byteLength) return null;
  type Tri = { front: number; a: number; b: number; c: number };
  const tris: Tri[] = [];
  for (let i = 0; i < numTris; i++) {
    const o = triBase + i * 16;
    tris.push({
      front: v.getInt32(o, true),
      a: v.getInt32(o + 4, true),
      b: v.getInt32(o + 8, true),
      c: v.getInt32(o + 12, true),
    });
  }
  p = triBase + numTris * 16;

  // Frame 0. type==0: single frame -> bbox min/max (4 bytes each), name[16],
  // then numVerts packed verts (x,y,z,normalIndex). type!=0: group, skip to
  // first sub-frame's verts.
  let framePtr = p;
  if (framePtr + 4 > v.byteLength) return null;
  const frameType = v.getInt32(framePtr, true);
  framePtr += 4;
  if (frameType !== 0) {
    // group: int nb, bbox min(4), bbox max(4), nb*float intervals, then frames
    const nb = v.getInt32(framePtr, true);
    framePtr += 4 + 4 + 4 + nb * 4;
  }
  // single frame header: bbox min(4) + bbox max(4) + name(16)
  framePtr += 4 + 4 + 16;
  if (framePtr + numVerts * 4 > v.byteLength) return null;

  const baseVerts = new Float32Array(numVerts * 3);
  for (let i = 0; i < numVerts; i++) {
    const o = framePtr + i * 4;
    const px = v.getUint8(o) * scaleX + originX;
    const py = v.getUint8(o + 1) * scaleY + originY;
    const pz = v.getUint8(o + 2) * scaleZ + originZ;
    // Z-up -> glTF (x, z, -y).
    baseVerts[i * 3] = px;
    baseVerts[i * 3 + 1] = pz;
    baseVerts[i * 3 + 2] = -py;
  }

  // Build corners: a seam vertex used by a back-facing triangle shifts s by half
  // the skin width, so such corners need distinct UVs (hence per-(vert,back) key).
  const pos: number[] = [];
  const uv: number[] = [];
  const indices: number[] = [];
  const merged = new Map<number, number>();
  const corner = (vi: number, back: boolean): number => {
    const key = vi * 2 + (back ? 1 : 0);
    let local = merged.get(key);
    if (local === undefined) {
      local = pos.length / 3;
      merged.set(key, local);
      pos.push(
        baseVerts[vi * 3]!,
        baseVerts[vi * 3 + 1]!,
        baseVerts[vi * 3 + 2]!,
      );
      let s = sCoord[vi]!;
      if (back && onseam[vi]) s += skinWidth >> 1;
      uv.push((s + 0.5) / skinWidth, (tCoord[vi]! + 0.5) / skinHeight);
    }
    return local;
  };

  for (const tri of tris) {
    const back = tri.front === 0;
    if (
      tri.a >= numVerts ||
      tri.b >= numVerts ||
      tri.c >= numVerts ||
      tri.a < 0 ||
      tri.b < 0 ||
      tri.c < 0
    )
      continue;
    const a = corner(tri.a, back);
    const b = corner(tri.b, back);
    const c = corner(tri.c, back);
    indices.push(a, c, b); // winding flip for handedness change
  }
  if (indices.length < 3) return null;

  const materials: GlbMaterial[] = [{}];
  const surfaces: GlbSurface[] = [
    {
      positions: Float32Array.from(pos),
      uv: Float32Array.from(uv),
      indices: Uint32Array.from(indices),
      material: 0,
    },
  ];
  return encodeGlbScene(surfaces, materials, []);
}

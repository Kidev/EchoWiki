// Quake II model (.md2) decoder. A single self-contained file: one mesh, with
// separate position and texcoord index lists per triangle and a stack of keyframe
// poses. We export the first frame as static geometry. Skins are external image
// files referenced by name, so the skin name becomes an `echoTex` pointer.

import { encodeGlbScene, type GlbSurface, type GlbMaterial } from "./glb";

const MD2_IDENT = 0x32504449; // "IDP2"

function readCName(v: DataView, off: number, len: number): string {
  let s = "";
  for (let i = 0; i < len; i++) {
    const c = v.getUint8(off + i);
    if (c === 0) break;
    s += String.fromCharCode(c);
  }
  return s;
}

export function decodeMd2(buf: ArrayBuffer): Uint8Array | null {
  const v = new DataView(buf);
  if (v.byteLength < 68 || v.getUint32(0, true) !== MD2_IDENT) return null;

  const skinWidth = v.getInt32(8, true) || 1;
  const skinHeight = v.getInt32(12, true) || 1;
  const numSkins = v.getInt32(20, true);
  const numXyz = v.getInt32(24, true);
  const numSt = v.getInt32(28, true);
  const numTris = v.getInt32(32, true);
  const ofsSkins = v.getInt32(44, true);
  const ofsSt = v.getInt32(48, true);
  const ofsTris = v.getInt32(52, true);
  const ofsFrames = v.getInt32(56, true);

  if (
    numXyz <= 0 ||
    numXyz > 1 << 20 ||
    numTris <= 0 ||
    numTris > 1 << 21 ||
    numSt <= 0
  )
    return null;

  // Frame 0: scale[3], translate[3], name[16], then numXyz packed vertices.
  const frameBase = ofsFrames;
  const sx = v.getFloat32(frameBase, true);
  const sy = v.getFloat32(frameBase + 4, true);
  const sz = v.getFloat32(frameBase + 8, true);
  const tx = v.getFloat32(frameBase + 12, true);
  const ty = v.getFloat32(frameBase + 16, true);
  const tz = v.getFloat32(frameBase + 20, true);
  const vertsBase = frameBase + 40;
  if (vertsBase + numXyz * 4 > v.byteLength) return null;

  const xyz = new Float32Array(numXyz * 3);
  for (let i = 0; i < numXyz; i++) {
    const o = vertsBase + i * 4;
    const px = v.getUint8(o) * sx + tx;
    const py = v.getUint8(o + 1) * sy + ty;
    const pz = v.getUint8(o + 2) * sz + tz;
    // Quake space (Z-up) -> glTF (x, z, -y).
    xyz[i * 3] = px;
    xyz[i * 3 + 1] = pz;
    xyz[i * 3 + 2] = -py;
  }

  // Texcoords (short s, t).
  const st = new Float32Array(numSt * 2);
  for (let i = 0; i < numSt; i++) {
    const o = ofsSt + i * 4;
    st[i * 2] = v.getInt16(o, true) / skinWidth;
    st[i * 2 + 1] = v.getInt16(o + 2, true) / skinHeight;
  }

  // Triangles reference xyz and st by separate indices: build merged corners.
  const pos: number[] = [];
  const uv: number[] = [];
  const indices: number[] = [];
  const merged = new Map<number, number>();
  const corner = (xi: number, si: number): number => {
    const key = xi * numSt + si;
    let local = merged.get(key);
    if (local === undefined) {
      local = pos.length / 3;
      merged.set(key, local);
      pos.push(xyz[xi * 3]!, xyz[xi * 3 + 1]!, xyz[xi * 3 + 2]!);
      uv.push(st[si * 2]!, st[si * 2 + 1]!);
    }
    return local;
  };

  for (let i = 0; i < numTris; i++) {
    const o = ofsTris + i * 12;
    if (o + 12 > v.byteLength) break;
    const x0 = v.getUint16(o, true);
    const x1 = v.getUint16(o + 2, true);
    const x2 = v.getUint16(o + 4, true);
    const s0 = v.getUint16(o + 6, true);
    const s1 = v.getUint16(o + 8, true);
    const s2 = v.getUint16(o + 10, true);
    if (x0 >= numXyz || x1 >= numXyz || x2 >= numXyz) continue;
    if (s0 >= numSt || s1 >= numSt || s2 >= numSt) continue;
    const a = corner(x0, s0);
    const b = corner(x1, s1);
    const c = corner(x2, s2);
    // Flip winding for the handedness change.
    indices.push(a, c, b);
  }
  if (indices.length < 3) return null;

  let echoTex: string | null = null;
  if (numSkins > 0 && ofsSkins > 0) {
    const skin = readCName(v, ofsSkins, 64)
      .replace(/\\/g, "/")
      .trim()
      .toLowerCase();
    if (skin) echoTex = `${skin.replace(/\.[a-z0-9]+$/, "")}.png`;
  }

  const materials: GlbMaterial[] = [{ echoTex }];
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

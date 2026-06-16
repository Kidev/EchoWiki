// id Tech 3 model (.md3) decoder: Quake III Arena, Return to Castle Wolfenstein,
// Jedi Knight, Elite Force and relatives. A single self-contained file holding
// one or more surfaces, each with its own triangle list, texture coordinates and
// per-frame vertex positions. We export the first frame as static geometry in a
// GLB; the surface's shader name becomes an `echoTex` pointer so a matching
// texture extracted from the same archive is applied lazily by ModelViewer.

import { encodeGlbScene, type GlbSurface, type GlbMaterial } from "./glb";

const MD3_IDENT = 0x33504449; // "IDP3"
const XYZ_SCALE = 1 / 64;

// Quake space is right-handed, Z-up (X forward, Y left, Z up). glTF is Y-up
// right-handed: (x, y, z) -> (x, z, -y).
function toGltf(x: number, y: number, z: number): [number, number, number] {
  return [x, z, -y];
}

function readCName(view: DataView, off: number, len: number): string {
  let s = "";
  for (let i = 0; i < len; i++) {
    const c = view.getUint8(off + i);
    if (c === 0) break;
    s += String.fromCharCode(c);
  }
  return s;
}

// Turn an MD3 shader reference into a candidate echo texture path: drop any
// extension and normalise slashes/case so it lines up with how the archive
// readers store decoded textures (engine-relative path, lowercase, .png).
function shaderToEchoTex(name: string): string | null {
  const cleaned = name.replace(/\\/g, "/").trim().toLowerCase();
  if (!cleaned) return null;
  const noExt = cleaned.replace(/\.[a-z0-9]+$/, "");
  return `${noExt}.png`;
}

export function decodeMd3(buf: ArrayBuffer): Uint8Array | null {
  const view = new DataView(buf);
  if (view.byteLength < 108) return null;
  if (view.getUint32(0, true) !== MD3_IDENT) return null;

  const numSurfaces = view.getInt32(84, true);
  let ofsSurfaces = view.getInt32(100, true);
  if (numSurfaces <= 0 || numSurfaces > 4096) return null;

  const surfaces: GlbSurface[] = [];
  const materials: GlbMaterial[] = [];

  for (let s = 0; s < numSurfaces; s++) {
    if (ofsSurfaces < 0 || ofsSurfaces + 108 > view.byteLength) break;
    const base = ofsSurfaces;
    if (view.getUint32(base, true) !== MD3_IDENT) break;

    const numShaders = view.getInt32(base + 76, true);
    const numVerts = view.getInt32(base + 80, true);
    const numTris = view.getInt32(base + 84, true);
    const ofsTris = view.getInt32(base + 88, true);
    const ofsShaders = view.getInt32(base + 92, true);
    const ofsST = view.getInt32(base + 96, true);
    const ofsXyz = view.getInt32(base + 100, true);
    const ofsEnd = view.getInt32(base + 104, true);

    if (
      numVerts <= 0 ||
      numVerts > 1 << 20 ||
      numTris <= 0 ||
      numTris > 1 << 21
    ) {
      ofsSurfaces = base + (ofsEnd > 0 ? ofsEnd : 108);
      continue;
    }

    // Triangles.
    const indices = new Uint32Array(numTris * 3);
    {
      let p = base + ofsTris;
      for (let i = 0; i < numTris; i++) {
        const a = view.getInt32(p, true);
        const b = view.getInt32(p + 4, true);
        const c = view.getInt32(p + 8, true);
        p += 12;
        // Flip winding to compensate for the handedness change in toGltf.
        indices[i * 3] = a;
        indices[i * 3 + 1] = c;
        indices[i * 3 + 2] = b;
      }
    }

    // Texcoords.
    const uv = new Float32Array(numVerts * 2);
    {
      let p = base + ofsST;
      for (let i = 0; i < numVerts; i++) {
        uv[i * 2] = view.getFloat32(p, true);
        uv[i * 2 + 1] = view.getFloat32(p + 4, true);
        p += 8;
      }
    }

    // Frame 0 vertex positions (skip the 2-byte encoded normal per vertex).
    const positions = new Float32Array(numVerts * 3);
    {
      let p = base + ofsXyz;
      for (let i = 0; i < numVerts; i++) {
        const x = view.getInt16(p, true) * XYZ_SCALE;
        const y = view.getInt16(p + 2, true) * XYZ_SCALE;
        const z = view.getInt16(p + 4, true) * XYZ_SCALE;
        p += 8;
        const [gx, gy, gz] = toGltf(x, y, z);
        positions[i * 3] = gx;
        positions[i * 3 + 1] = gy;
        positions[i * 3 + 2] = gz;
      }
    }

    let echoTex: string | null = null;
    if (numShaders > 0 && ofsShaders > 0) {
      const shaderName = readCName(view, base + ofsShaders, 64);
      echoTex = shaderToEchoTex(shaderName);
    }

    materials.push({ echoTex });
    surfaces.push({ positions, uv, indices, material: materials.length - 1 });

    ofsSurfaces = base + (ofsEnd > 0 ? ofsEnd : 108);
  }

  return encodeGlbScene(surfaces, materials, []);
}

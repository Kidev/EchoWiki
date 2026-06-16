// Source engine studio model decoder: Half-Life 2, Portal, Team Fortress 2,
// Garry's Mod and the rest of the Source lineage. Unlike GoldSrc, a Source model
// is split across three files that must be combined:
//   .mdl  - header, bodyparts/models/meshes, material names
//   .vvd  - the bind-pose vertex buffer (positions/normals/UVs, already posed)
//   .vtx  - the hardware-optimised mesh (strip/index buffers that reference vvd)
// (.dx90.vtx is the variant we prefer; .dx80/.sw.vtx are fallbacks.)
//
// Materials are external VMT/VTF, so we attach an `echoTex` pointer built from the
// model's material name + cdmaterials dir; a matching texture extracted from the
// same VPK is applied lazily by ModelViewer. Geometry renders regardless.

import { encodeGlbScene, type GlbSurface, type GlbMaterial } from "./glb";

const IDST = 0x54534449; // "IDST"
const IDSV = 0x56534449; // "IDSV" (vvd)
const VVD_VERTEX_SIZE = 48;

type SourceModelFiles = {
  mdl: ArrayBuffer;
  vvd: ArrayBuffer;
  vtx: ArrayBuffer;
};

function readCStr(bytes: Uint8Array, off: number): string {
  let end = off;
  while (end < bytes.length && bytes[end] !== 0) end++;
  let s = "";
  for (let i = off; i < end; i++) s += String.fromCharCode(bytes[i]!);
  return s;
}

// Build the LOD0 vertex array from the .vvd, applying the fixup table if present.
type VvdVerts = { pos: Float32Array; uv: Float32Array; count: number };

function readVvd(buf: ArrayBuffer): VvdVerts | null {
  const v = new DataView(buf);
  if (v.byteLength < 64 || v.getUint32(0, true) !== IDSV) return null;
  const numLODs = v.getInt32(12, true);
  if (numLODs <= 0) return null;
  const numLOD0 = v.getInt32(16, true); // numLODVertexes[0]
  const numFixups = v.getInt32(48, true);
  const fixupTableStart = v.getInt32(52, true);
  const vertexDataStart = v.getInt32(56, true);
  if (numLOD0 <= 0 || numLOD0 > 1 << 22) return null;

  const readVert = (i: number): [number, number, number, number, number] => {
    const o = vertexDataStart + i * VVD_VERTEX_SIZE;
    // skip 16-byte boneweight; pos at +16, normal at +28, texcoord at +40
    return [
      v.getFloat32(o + 16, true),
      v.getFloat32(o + 20, true),
      v.getFloat32(o + 24, true),
      v.getFloat32(o + 40, true),
      v.getFloat32(o + 44, true),
    ];
  };

  // Source vertices need fixups to land in the LOD0 ordering used by the .vtx.
  const out: number[] = [];
  const outUv: number[] = [];
  const pushVert = (i: number) => {
    const [x, y, z, s, t] = readVert(i);
    // Z-up -> glTF Y-up.
    out.push(x, z, -y);
    outUv.push(s, t);
  };

  if (numFixups > 0 && fixupTableStart > 0) {
    for (let f = 0; f < numFixups; f++) {
      const fo = fixupTableStart + f * 12;
      if (fo + 12 > v.byteLength) break;
      const lod = v.getInt32(fo, true);
      const sourceVertexID = v.getInt32(fo + 4, true);
      const numVertexes = v.getInt32(fo + 8, true);
      if (lod < 0) continue; // applies to LOD0 only when lod >= 0
      for (let i = 0; i < numVertexes; i++) pushVert(sourceVertexID + i);
    }
  } else {
    for (let i = 0; i < numLOD0; i++) pushVert(i);
  }

  return {
    pos: Float32Array.from(out),
    uv: Float32Array.from(outUv),
    count: out.length / 3,
  };
}

// .mdl: per-model and per-mesh vertex bookkeeping plus material names.
type MdlMesh = { material: number; vertexoffset: number; numvertices: number };
type MdlModel = { vertexIndexBase: number; meshes: MdlMesh[] };
type MdlInfo = {
  models: MdlModel[]; // flattened across bodyparts, in vtx traversal order
  bodyparts: { models: MdlModel[] }[];
  materials: string[]; // echoTex paths per material index
};

function readMdl(buf: ArrayBuffer): MdlInfo | null {
  const v = new DataView(buf);
  const bytes = new Uint8Array(buf);
  if (v.byteLength < 244 || v.getUint32(0, true) !== IDST) return null;
  const version = v.getInt32(4, true);
  if (version < 44 || version > 49) return null;

  const numtextures = v.getInt32(204, true);
  const textureindex = v.getInt32(208, true);
  const numcdtextures = v.getInt32(212, true);
  const cdtextureindex = v.getInt32(216, true);
  const numbodyparts = v.getInt32(232, true);
  const bodypartindex = v.getInt32(236, true);
  if (numbodyparts <= 0 || numbodyparts > 4096) return null;

  // Material (texture) names + cdmaterials dirs -> echoTex candidate paths.
  const cdDirs: string[] = [];
  for (let i = 0; i < numcdtextures; i++) {
    const off = v.getInt32(cdtextureindex + i * 4, true);
    if (off > 0 && off < bytes.length) cdDirs.push(readCStr(bytes, off));
  }
  const materials: string[] = [];
  for (let i = 0; i < numtextures; i++) {
    const tBase = textureindex + i * 64;
    if (tBase + 4 > bytes.length) {
      materials.push("");
      continue;
    }
    const nameOff = v.getInt32(tBase, true); // sznameindex, relative to tBase
    const name = readCStr(bytes, tBase + nameOff)
      .replace(/\\/g, "/")
      .toLowerCase();
    const dir = (cdDirs[0] ?? "").replace(/\\/g, "/").toLowerCase();
    const full = `materials/${dir}${name}.png`.replace(/\/+/g, "/");
    materials.push(full);
  }

  const bodyparts: { models: MdlModel[] }[] = [];
  for (let bp = 0; bp < numbodyparts; bp++) {
    const bpBase = bodypartindex + bp * 16;
    if (bpBase + 16 > bytes.length) break;
    const nummodels = v.getInt32(bpBase + 4, true);
    const modelindex = v.getInt32(bpBase + 12, true); // relative to bpBase
    const models: MdlModel[] = [];
    for (let m = 0; m < nummodels; m++) {
      const mBase = bpBase + modelindex + m * 148;
      if (mBase + 148 > bytes.length) break;
      const nummeshes = v.getInt32(mBase + 72, true);
      const meshindex = v.getInt32(mBase + 76, true); // relative to mBase
      const vertexindex = v.getInt32(mBase + 84, true); // byte offset into vvd
      const meshes: MdlMesh[] = [];
      for (let me = 0; me < nummeshes; me++) {
        const meBase = mBase + meshindex + me * 116;
        if (meBase + 116 > bytes.length) break;
        meshes.push({
          material: v.getInt32(meBase, true),
          numvertices: v.getInt32(meBase + 8, true),
          vertexoffset: v.getInt32(meBase + 12, true),
        });
      }
      models.push({
        vertexIndexBase: (vertexindex / VVD_VERTEX_SIZE) | 0,
        meshes,
      });
    }
    bodyparts.push({ models });
  }

  return { models: [], bodyparts, materials };
}

export function decodeSourceMdl(files: SourceModelFiles): Uint8Array | null {
  const mdl = readMdl(files.mdl);
  if (!mdl) return null;
  const vvd = readVvd(files.vvd);
  if (!vvd) return null;

  const vtx = new DataView(files.vtx);
  if (vtx.byteLength < 36) return null;
  // FileHeader_t: numBodyParts @28, bodyPartOffset @32
  const vtxNumBodyParts = vtx.getInt32(28, true);
  const vtxBodyPartOffset = vtx.getInt32(32, true);
  if (vtxNumBodyParts <= 0) return null;

  const materials: GlbMaterial[] = [];
  const matSlot = new Map<number, number>();
  const vcount = vvd.count;

  // Triangle indices (into the full vvd vertex array) accumulated per material;
  // compacted into a per-material vertex subset at the end so the GLB embeds each
  // shared vertex once instead of once per surface.
  const idxByMat = new Map<number, number[]>();

  const getMaterial = (mdlMat: number): number => {
    let slot = matSlot.get(mdlMat);
    if (slot === undefined) {
      const echoTex = mdl.materials[mdlMat] ?? null;
      materials.push({ echoTex });
      slot = materials.length - 1;
      matSlot.set(mdlMat, slot);
      idxByMat.set(slot, []);
    }
    return slot;
  };

  const nBodyParts = Math.min(vtxNumBodyParts, mdl.bodyparts.length);
  for (let bp = 0; bp < nBodyParts; bp++) {
    const bpBase = vtxBodyPartOffset + bp * 8;
    if (bpBase + 8 > vtx.byteLength) break;
    const numModels = vtx.getInt32(bpBase, true);
    const modelOffset = vtx.getInt32(bpBase + 4, true);
    const mdlModels = mdl.bodyparts[bp]!.models;

    const nModels = Math.min(numModels, mdlModels.length);
    for (let m = 0; m < nModels; m++) {
      const mBase = bpBase + modelOffset + m * 8;
      if (mBase + 8 > vtx.byteLength) break;
      const numLODs = vtx.getInt32(mBase, true);
      const lodOffset = vtx.getInt32(mBase + 4, true);
      if (numLODs <= 0) continue;
      const mdlModel = mdlModels[m]!;

      // LOD 0 only.
      const lodBase = mBase + lodOffset;
      if (lodBase + 12 > vtx.byteLength) continue;
      const numMeshes = vtx.getInt32(lodBase, true);
      const meshOffset = vtx.getInt32(lodBase + 4, true);

      const nMeshes = Math.min(numMeshes, mdlModel.meshes.length);
      for (let me = 0; me < nMeshes; me++) {
        const meBase = lodBase + meshOffset + me * 9;
        if (meBase + 9 > vtx.byteLength) break;
        const numStripGroups = vtx.getInt32(meBase, true);
        const stripGroupOffset = vtx.getInt32(meBase + 4, true);
        const mdlMesh = mdlModel.meshes[me]!;
        const meshVertBase = mdlModel.vertexIndexBase + mdlMesh.vertexoffset;

        const idx: number[] = [];

        for (let sg = 0; sg < numStripGroups; sg++) {
          const sgBase = meBase + stripGroupOffset + sg * 25;
          if (sgBase + 25 > vtx.byteLength) break;
          const sgNumVerts = vtx.getInt32(sgBase, true);
          const sgVertOffset = vtx.getInt32(sgBase + 4, true);
          const sgNumIndices = vtx.getInt32(sgBase + 8, true);
          const sgIndexOffset = vtx.getInt32(sgBase + 12, true);
          const sgNumStrips = vtx.getInt32(sgBase + 16, true);
          const sgStripOffset = vtx.getInt32(sgBase + 20, true);

          const vertsAt = sgBase + sgVertOffset;
          const indicesAt = sgBase + sgIndexOffset;
          if (
            vertsAt + sgNumVerts * 9 > vtx.byteLength ||
            indicesAt + sgNumIndices * 2 > vtx.byteLength
          )
            continue;

          // Vertex_t.origMeshVertID is at byte +4 within each 9-byte record.
          const origId = (vtxLocal: number): number =>
            vtx.getUint16(vertsAt + vtxLocal * 9 + 4, true);

          // stripgroup-local index -> global vvd index.
          const toGlobal = (localIdx: number): number => {
            if (localIdx >= sgNumVerts) return -1;
            const g = meshVertBase + origId(localIdx);
            return g >= 0 && g < vcount ? g : -1;
          };

          for (let st = 0; st < sgNumStrips; st++) {
            const stBase = sgBase + sgStripOffset + st * 27;
            if (stBase + 27 > vtx.byteLength) break;
            const stNumIndices = vtx.getInt32(stBase, true);
            const stIndexOffset = vtx.getInt32(stBase + 4, true);
            const stFlags = vtx.getUint8(stBase + 16);
            const isTriList = (stFlags & 0x01) !== 0;
            const isTriStrip = (stFlags & 0x02) !== 0;
            const indexBase = indicesAt + stIndexOffset * 2;

            const readIdx = (k: number): number =>
              vtx.getUint16(indexBase + k * 2, true);

            if (isTriStrip && !isTriList) {
              for (let k = 0; k + 2 < stNumIndices; k++) {
                const a = toGlobal(readIdx(k));
                const b = toGlobal(readIdx(k + 1));
                const c = toGlobal(readIdx(k + 2));
                if (a < 0 || b < 0 || c < 0 || a === b || b === c || a === c)
                  continue;
                // winding flip for handedness + strip parity
                if (k & 1) idx.push(a, b, c);
                else idx.push(a, c, b);
              }
            } else {
              for (let k = 0; k + 2 < stNumIndices; k += 3) {
                const a = toGlobal(readIdx(k));
                const b = toGlobal(readIdx(k + 1));
                const c = toGlobal(readIdx(k + 2));
                if (a < 0 || b < 0 || c < 0) continue;
                idx.push(a, c, b); // flip winding for Z-up -> Y-up
              }
            }
          }
        }

        if (idx.length < 3) continue;
        const slot = getMaterial(mdlMesh.material);
        const acc = idxByMat.get(slot)!;
        for (const g of idx) acc.push(g);
      }
    }
  }

  // Compact each material's triangle set into its own vertex subset.
  const surfaces: GlbSurface[] = [];
  for (const [slot, globalIdx] of idxByMat) {
    if (globalIdx.length < 3) continue;
    const remap = new Map<number, number>();
    const pos: number[] = [];
    const uv: number[] = [];
    const indices = new Uint32Array(globalIdx.length);
    for (let i = 0; i < globalIdx.length; i++) {
      const g = globalIdx[i]!;
      let local = remap.get(g);
      if (local === undefined) {
        local = pos.length / 3;
        remap.set(g, local);
        pos.push(vvd.pos[g * 3]!, vvd.pos[g * 3 + 1]!, vvd.pos[g * 3 + 2]!);
        uv.push(vvd.uv[g * 2]!, vvd.uv[g * 2 + 1]!);
      }
      indices[i] = local;
    }
    surfaces.push({
      positions: Float32Array.from(pos),
      uv: Float32Array.from(uv),
      indices,
      material: slot,
    });
  }

  return encodeGlbScene(surfaces, materials, []);
}

export type { SourceModelFiles };

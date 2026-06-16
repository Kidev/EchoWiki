// Decoders for the Unity `TextureFormat` values that can be turned into an RGBA
// buffer entirely in the browser. Covers the uncompressed layouts plus the
// BC/DXT block-compression family that dominates desktop builds.
//
// The BCn block math lives in the shared `texture-blocks` module (Source VTF,
// RenderWare TXD and DDS reuse the same code); this file only maps Unity's
// format enum onto it and adds the Unity-specific raw pixel layouts.
//
// Block-compressed GPU formats that need large dedicated decoders (BC6H/BC7,
// ETC/EAC, PVRTC, ASTC) and crunch-compressed variants are intentionally
// unsupported: `decodeTexture` returns null for those so the caller skips them.

import {
  rgb565,
  decodeBC1,
  decodeBC3,
  decodeBC4,
  decodeBC5,
  flipVerticalRGBA,
} from "./texture-blocks";

// Subset of UnityEngine.TextureFormat we know how to handle.
export const enum TextureFormat {
  Alpha8 = 1,
  ARGB4444 = 2,
  RGB24 = 3,
  RGBA32 = 4,
  ARGB32 = 5,
  RGB565 = 7,
  R16 = 9,
  DXT1 = 10,
  DXT5 = 12,
  RGBA4444 = 13,
  BGRA32 = 14,
  BC4 = 26,
  BC5 = 27,
  R8 = 63,
}

function decodeUncompressed(
  view: DataView,
  width: number,
  height: number,
  format: TextureFormat,
): Uint8Array | null {
  const out = new Uint8Array(width * height * 4);
  const px = width * height;

  const need = (bytesPerPixel: number): boolean =>
    view.byteLength >= px * bytesPerPixel;

  switch (format) {
    case TextureFormat.RGBA32:
      if (!need(4)) return null;
      for (let i = 0; i < px; i++) {
        out[i * 4] = view.getUint8(i * 4);
        out[i * 4 + 1] = view.getUint8(i * 4 + 1);
        out[i * 4 + 2] = view.getUint8(i * 4 + 2);
        out[i * 4 + 3] = view.getUint8(i * 4 + 3);
      }
      return out;
    case TextureFormat.ARGB32:
      if (!need(4)) return null;
      for (let i = 0; i < px; i++) {
        out[i * 4 + 3] = view.getUint8(i * 4);
        out[i * 4] = view.getUint8(i * 4 + 1);
        out[i * 4 + 1] = view.getUint8(i * 4 + 2);
        out[i * 4 + 2] = view.getUint8(i * 4 + 3);
      }
      return out;
    case TextureFormat.BGRA32:
      if (!need(4)) return null;
      for (let i = 0; i < px; i++) {
        out[i * 4 + 2] = view.getUint8(i * 4);
        out[i * 4 + 1] = view.getUint8(i * 4 + 1);
        out[i * 4] = view.getUint8(i * 4 + 2);
        out[i * 4 + 3] = view.getUint8(i * 4 + 3);
      }
      return out;
    case TextureFormat.RGB24:
      if (!need(3)) return null;
      for (let i = 0; i < px; i++) {
        out[i * 4] = view.getUint8(i * 3);
        out[i * 4 + 1] = view.getUint8(i * 3 + 1);
        out[i * 4 + 2] = view.getUint8(i * 3 + 2);
        out[i * 4 + 3] = 255;
      }
      return out;
    case TextureFormat.RGB565:
      if (!need(2)) return null;
      for (let i = 0; i < px; i++) {
        const [r, g, b] = rgb565(view.getUint16(i * 2, true));
        out[i * 4] = r;
        out[i * 4 + 1] = g;
        out[i * 4 + 2] = b;
        out[i * 4 + 3] = 255;
      }
      return out;
    case TextureFormat.ARGB4444:
      if (!need(2)) return null;
      for (let i = 0; i < px; i++) {
        const v = view.getUint16(i * 2, true);
        out[i * 4 + 3] = ((v >> 12) & 0xf) * 17;
        out[i * 4] = ((v >> 8) & 0xf) * 17;
        out[i * 4 + 1] = ((v >> 4) & 0xf) * 17;
        out[i * 4 + 2] = (v & 0xf) * 17;
      }
      return out;
    case TextureFormat.RGBA4444:
      if (!need(2)) return null;
      for (let i = 0; i < px; i++) {
        const v = view.getUint16(i * 2, true);
        out[i * 4] = ((v >> 12) & 0xf) * 17;
        out[i * 4 + 1] = ((v >> 8) & 0xf) * 17;
        out[i * 4 + 2] = ((v >> 4) & 0xf) * 17;
        out[i * 4 + 3] = (v & 0xf) * 17;
      }
      return out;
    case TextureFormat.Alpha8:
      if (!need(1)) return null;
      for (let i = 0; i < px; i++) {
        const v = view.getUint8(i);
        out[i * 4] = v;
        out[i * 4 + 1] = v;
        out[i * 4 + 2] = v;
        out[i * 4 + 3] = 255;
      }
      return out;
    case TextureFormat.R8:
      if (!need(1)) return null;
      for (let i = 0; i < px; i++) {
        const v = view.getUint8(i);
        out[i * 4] = v;
        out[i * 4 + 1] = v;
        out[i * 4 + 2] = v;
        out[i * 4 + 3] = 255;
      }
      return out;
    case TextureFormat.R16:
      if (!need(2)) return null;
      for (let i = 0; i < px; i++) {
        const v = view.getUint16(i * 2, true) >> 8;
        out[i * 4] = v;
        out[i * 4 + 1] = v;
        out[i * 4 + 2] = v;
        out[i * 4 + 3] = 255;
      }
      return out;
    default:
      return null;
  }
}

// Decode the largest mip of a Texture2D into a top-down RGBA8 buffer, or null
// if the format isn't supported. `data` must start at the mip-0 pixel data.
export function decodeTexture(
  data: Uint8Array,
  width: number,
  height: number,
  format: number,
): Uint8Array | null {
  if (width <= 0 || height <= 0 || width * height > 33_554_432) return null;

  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  let rgba: Uint8Array | null;

  switch (format) {
    case TextureFormat.DXT1:
      rgba = decodeBC1(data, width, height, true);
      break;
    case TextureFormat.DXT5:
      rgba = decodeBC3(data, width, height);
      break;
    case TextureFormat.BC4:
      rgba = decodeBC4(data, width, height);
      break;
    case TextureFormat.BC5:
      rgba = decodeBC5(data, width, height);
      break;
    default:
      rgba = decodeUncompressed(view, width, height, format as TextureFormat);
  }

  if (!rgba) return null;

  // Unity stores texture rows bottom-to-top (OpenGL convention); flip to top-down.
  return flipVerticalRGBA(rgba, width, height);
}

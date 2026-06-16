// Valve Texture Format (VTF) decoder: the texture format of the Source engine
// (Half-Life 2, Portal, TF2, Source 2 legacy assets, ...).
//
// VTF stores every mip from smallest to largest, so the full-resolution image
// (mip 0) is the *last* image block in the high-res section. For an ordinary 2D
// texture that block sits at the very end of the file, which lets us grab it
// without walking the whole mip chain: we compute mip-0's byte size for the
// declared image format and decode the trailing bytes. Animated/cubemap/volume
// textures simply yield their last frame/face: still a valid preview.
//
// VTF rows are top-down (D3D convention), so no vertical flip is needed.

import {
  decodeBC1,
  decodeBC2,
  decodeBC3,
  rgb565,
  bcnByteSize,
} from "./texture-blocks";
import type { DecodedImage } from "./tga";

const VTF_SIGNATURE = 0x00465456; // "VTF\0" little-endian
const MAX_PIXELS = 67_108_864;

// IMAGE_FORMAT enum values we can turn into RGBA.
const enum VtfFormat {
  RGBA8888 = 0,
  ABGR8888 = 1,
  RGB888 = 2,
  BGR888 = 3,
  RGB565 = 4,
  I8 = 5,
  IA88 = 6,
  A8 = 8,
  ARGB8888 = 11,
  BGRA8888 = 12,
  DXT1 = 13,
  DXT3 = 14,
  DXT5 = 15,
  BGRX8888 = 16,
  BGR565 = 17,
  BGRA4444 = 19,
  DXT1_ONEBITALPHA = 20,
}

function formatBlockSize(
  format: number,
  width: number,
  height: number,
): number {
  switch (format) {
    case VtfFormat.DXT1:
    case VtfFormat.DXT1_ONEBITALPHA:
      return bcnByteSize(width, height, 8);
    case VtfFormat.DXT3:
    case VtfFormat.DXT5:
      return bcnByteSize(width, height, 16);
    case VtfFormat.RGBA8888:
    case VtfFormat.ABGR8888:
    case VtfFormat.ARGB8888:
    case VtfFormat.BGRA8888:
    case VtfFormat.BGRX8888:
      return width * height * 4;
    case VtfFormat.RGB888:
    case VtfFormat.BGR888:
      return width * height * 3;
    case VtfFormat.RGB565:
    case VtfFormat.BGR565:
    case VtfFormat.IA88:
    case VtfFormat.BGRA4444:
      return width * height * 2;
    case VtfFormat.I8:
    case VtfFormat.A8:
      return width * height;
    default:
      return -1; // unsupported (HDR float, UV, P8, ...)
  }
}

function decodeMip0(
  data: Uint8Array,
  width: number,
  height: number,
  format: number,
): Uint8Array | null {
  const px = width * height;
  const out = new Uint8Array(px * 4);
  const v = new DataView(data.buffer, data.byteOffset, data.byteLength);

  switch (format) {
    case VtfFormat.DXT1:
    case VtfFormat.DXT1_ONEBITALPHA:
      return decodeBC1(data, width, height, true);
    case VtfFormat.DXT3:
      return decodeBC2(data, width, height);
    case VtfFormat.DXT5:
      return decodeBC3(data, width, height);
    case VtfFormat.RGBA8888:
      for (let i = 0; i < px; i++) {
        out[i * 4] = data[i * 4]!;
        out[i * 4 + 1] = data[i * 4 + 1]!;
        out[i * 4 + 2] = data[i * 4 + 2]!;
        out[i * 4 + 3] = data[i * 4 + 3]!;
      }
      return out;
    case VtfFormat.ABGR8888:
      for (let i = 0; i < px; i++) {
        out[i * 4 + 3] = data[i * 4]!;
        out[i * 4 + 2] = data[i * 4 + 1]!;
        out[i * 4 + 1] = data[i * 4 + 2]!;
        out[i * 4] = data[i * 4 + 3]!;
      }
      return out;
    case VtfFormat.ARGB8888:
      for (let i = 0; i < px; i++) {
        out[i * 4 + 3] = data[i * 4]!;
        out[i * 4] = data[i * 4 + 1]!;
        out[i * 4 + 1] = data[i * 4 + 2]!;
        out[i * 4 + 2] = data[i * 4 + 3]!;
      }
      return out;
    case VtfFormat.BGRA8888:
    case VtfFormat.BGRX8888:
      for (let i = 0; i < px; i++) {
        out[i * 4] = data[i * 4 + 2]!;
        out[i * 4 + 1] = data[i * 4 + 1]!;
        out[i * 4 + 2] = data[i * 4]!;
        out[i * 4 + 3] = format === VtfFormat.BGRX8888 ? 255 : data[i * 4 + 3]!;
      }
      return out;
    case VtfFormat.RGB888:
      for (let i = 0; i < px; i++) {
        out[i * 4] = data[i * 3]!;
        out[i * 4 + 1] = data[i * 3 + 1]!;
        out[i * 4 + 2] = data[i * 3 + 2]!;
        out[i * 4 + 3] = 255;
      }
      return out;
    case VtfFormat.BGR888:
      for (let i = 0; i < px; i++) {
        out[i * 4] = data[i * 3 + 2]!;
        out[i * 4 + 1] = data[i * 3 + 1]!;
        out[i * 4 + 2] = data[i * 3]!;
        out[i * 4 + 3] = 255;
      }
      return out;
    case VtfFormat.RGB565:
    case VtfFormat.BGR565:
      for (let i = 0; i < px; i++) {
        const [r, g, b] = rgb565(v.getUint16(i * 2, true));
        if (format === VtfFormat.BGR565) {
          out[i * 4] = b;
          out[i * 4 + 2] = r;
        } else {
          out[i * 4] = r;
          out[i * 4 + 2] = b;
        }
        out[i * 4 + 1] = g;
        out[i * 4 + 3] = 255;
      }
      return out;
    case VtfFormat.BGRA4444:
      for (let i = 0; i < px; i++) {
        const c = v.getUint16(i * 2, true);
        out[i * 4] = ((c >> 8) & 0xf) * 17;
        out[i * 4 + 1] = ((c >> 4) & 0xf) * 17;
        out[i * 4 + 2] = (c & 0xf) * 17;
        out[i * 4 + 3] = ((c >> 12) & 0xf) * 17;
      }
      return out;
    case VtfFormat.IA88:
      for (let i = 0; i < px; i++) {
        const l = data[i * 2]!;
        out[i * 4] = l;
        out[i * 4 + 1] = l;
        out[i * 4 + 2] = l;
        out[i * 4 + 3] = data[i * 2 + 1]!;
      }
      return out;
    case VtfFormat.I8:
      for (let i = 0; i < px; i++) {
        const l = data[i]!;
        out[i * 4] = l;
        out[i * 4 + 1] = l;
        out[i * 4 + 2] = l;
        out[i * 4 + 3] = 255;
      }
      return out;
    case VtfFormat.A8:
      for (let i = 0; i < px; i++) {
        out[i * 4] = 0;
        out[i * 4 + 1] = 0;
        out[i * 4 + 2] = 0;
        out[i * 4 + 3] = data[i]!;
      }
      return out;
    default:
      return null;
  }
}

export function decodeVtf(buffer: ArrayBuffer): DecodedImage | null {
  const view = new DataView(buffer);
  if (view.byteLength < 80 || view.getUint32(0, true) !== VTF_SIGNATURE) {
    return null;
  }

  const headerSize = view.getUint32(12, true);
  const width = view.getUint16(16, true);
  const height = view.getUint16(18, true);
  const frames = view.getUint16(24, true);
  // reflectivity (12) + padding (4) + bumpScale (4) bring us to the format field.
  const highResFormat = view.getInt32(52, true);
  const mipCount = view.getUint8(56);
  const lowResFormat = view.getInt32(57, true);
  const lowResW = view.getUint8(61);
  const lowResH = view.getUint8(62);

  if (width <= 0 || height <= 0 || width * height > MAX_PIXELS) return null;
  if (frames <= 0 || mipCount <= 0) return null;

  const mip0Size = formatBlockSize(highResFormat, width, height);
  if (mip0Size < 0) return null;

  // The largest mip is the final image block. For 7.3+ the high-res image is the
  // last resource and still ends the file, so reading the trailing mip0Size bytes
  // works across versions without parsing the resource directory. We only need to
  // skip the optional low-res thumbnail when computing a lower bound.
  let lowResSize = 0;
  if (lowResFormat >= 0 && lowResW > 0 && lowResH > 0) {
    const s = formatBlockSize(lowResFormat, lowResW, lowResH);
    if (s > 0) lowResSize = s;
  }

  const minStart = headerSize + lowResSize;
  const start = view.byteLength - mip0Size;
  if (start < minStart || start < 0) return null;

  const data = new Uint8Array(buffer, start, mip0Size);
  const rgba = decodeMip0(data, width, height, highResFormat);
  if (!rgba) return null;
  return { width, height, rgba };
}

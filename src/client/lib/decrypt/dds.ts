// DirectDraw Surface (DDS) decoder.
//
// DDS is the standard on-disk container for desktop GPU textures and shows up
// loose in many engines (and is what cooked Source/Unreal textures decompress
// to). We read the header, decode the top mip of the most common pixel formats:
// DXT1/3/5 (BC1/2/3), ATI1/ATI2 (BC4/5), the DX10 BC1-5 codes, and the
// uncompressed BGRA8/BGRX8/RGBA8 layouts: into top-down RGBA. Cube maps,
// volume textures and GPU-only formats (BC6H/BC7, R16F, etc.) return null.

import {
  decodeBC1,
  decodeBC2,
  decodeBC3,
  decodeBC4,
  decodeBC5,
  bcnByteSize,
} from "./texture-blocks";
import type { DecodedImage } from "./tga";

const DDS_MAGIC = 0x20534444; // "DDS "
const MAX_PIXELS = 67_108_864;

const FOURCC = (s: string): number =>
  s.charCodeAt(0) |
  (s.charCodeAt(1) << 8) |
  (s.charCodeAt(2) << 16) |
  (s.charCodeAt(3) << 24);

function fourCcDecoder(
  cc: number,
): ((d: Uint8Array, w: number, h: number) => Uint8Array) | null {
  switch (cc) {
    case FOURCC("DXT1"):
      return (d, w, h) => decodeBC1(d, w, h, true);
    case FOURCC("DXT2"):
    case FOURCC("DXT3"):
      return decodeBC2;
    case FOURCC("DXT4"):
    case FOURCC("DXT5"):
      return decodeBC3;
    case FOURCC("ATI1"):
    case FOURCC("BC4U"):
      return decodeBC4;
    case FOURCC("ATI2"):
    case FOURCC("BC5U"):
      return decodeBC5;
    default:
      return null;
  }
}

// DXGI_FORMAT subset (DX10 extended header).
function dxgiDecoder(
  fmt: number,
): ((d: Uint8Array, w: number, h: number) => Uint8Array) | null {
  switch (fmt) {
    case 70:
    case 71:
    case 72:
      return (d, w, h) => decodeBC1(d, w, h, true); // BC1_TYPELESS/UNORM/SRGB
    case 73:
    case 74:
    case 75:
      return decodeBC2; // BC2
    case 76:
    case 77:
    case 78:
      return decodeBC3; // BC3
    case 79:
    case 80:
      return decodeBC4; // BC4
    case 82:
    case 83:
      return decodeBC5; // BC5
    default:
      return null;
  }
}

function decodeUncompressedRgb(
  data: Uint8Array,
  width: number,
  height: number,
  rgbBitCount: number,
  rMask: number,
  gMask: number,
  bMask: number,
  aMask: number,
): Uint8Array | null {
  const bpp = rgbBitCount >> 3;
  if (bpp < 3 || bpp > 4) return null;
  if (data.length < width * height * bpp) return null;

  const shiftOf = (mask: number): number => {
    if (mask === 0) return 0;
    let s = 0;
    while (((mask >> s) & 1) === 0) s++;
    return s;
  };
  const rs = shiftOf(rMask);
  const gs = shiftOf(gMask);
  const bs = shiftOf(bMask);
  const as = shiftOf(aMask);

  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const out = new Uint8Array(width * height * 4);
  for (let i = 0; i < width * height; i++) {
    const px =
      bpp === 4
        ? view.getUint32(i * 4, true)
        : data[i * 3]! | (data[i * 3 + 1]! << 8) | (data[i * 3 + 2]! << 16);
    out[i * 4] = (px & rMask) >>> rs;
    out[i * 4 + 1] = (px & gMask) >>> gs;
    out[i * 4 + 2] = (px & bMask) >>> bs;
    out[i * 4 + 3] = aMask ? (px & aMask) >>> as : 255;
  }
  return out;
}

export function decodeDds(buffer: ArrayBuffer): DecodedImage | null {
  const view = new DataView(buffer);
  if (view.byteLength < 128 || view.getUint32(0, true) !== DDS_MAGIC) {
    return null;
  }

  const height = view.getUint32(12, true);
  const width = view.getUint32(16, true);
  if (width <= 0 || height <= 0 || width * height > MAX_PIXELS) return null;

  // DDS_PIXELFORMAT begins at offset 76.
  const pfFlags = view.getUint32(80, true);
  const fourCc = view.getUint32(84, true);
  const rgbBitCount = view.getUint32(88, true);
  const rMask = view.getUint32(92, true);
  const gMask = view.getUint32(96, true);
  const bMask = view.getUint32(100, true);
  const aMask = view.getUint32(104, true);

  let dataOffset = 128;
  let blockDecoder:
    | ((d: Uint8Array, w: number, h: number) => Uint8Array)
    | null = null;
  let bytesPerBlock = 0;

  const FOURCC_FLAG = 0x4;
  const RGB_FLAG = 0x40;

  if (pfFlags & FOURCC_FLAG) {
    if (fourCc === FOURCC("DX10")) {
      // DX10 header (20 bytes) follows the legacy header.
      if (view.byteLength < 148) return null;
      const dxgiFormat = view.getUint32(128, true);
      dataOffset = 148;
      blockDecoder = dxgiDecoder(dxgiFormat);
      bytesPerBlock = dxgiFormat >= 70 && dxgiFormat <= 72 ? 8 : 16;
      if (dxgiFormat === 79 || dxgiFormat === 80) bytesPerBlock = 8; // BC4
      if (blockDecoder === null) return null;
    } else {
      blockDecoder = fourCcDecoder(fourCc);
      if (blockDecoder === null) return null;
      bytesPerBlock =
        fourCc === FOURCC("DXT1") ||
        fourCc === FOURCC("ATI1") ||
        fourCc === FOURCC("BC4U")
          ? 8
          : 16;
    }
  }

  if (blockDecoder) {
    const need = bcnByteSize(width, height, bytesPerBlock);
    const data = new Uint8Array(buffer, dataOffset);
    if (data.length < need) return null;
    return { width, height, rgba: blockDecoder(data, width, height) };
  }

  if (pfFlags & RGB_FLAG) {
    const data = new Uint8Array(buffer, dataOffset);
    const rgba = decodeUncompressedRgb(
      data,
      width,
      height,
      rgbBitCount,
      rMask,
      gMask,
      bMask,
      aMask,
    );
    if (rgba) return { width, height, rgba };
  }

  return null;
}

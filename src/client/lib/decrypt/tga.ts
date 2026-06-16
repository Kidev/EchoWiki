// Truevision TGA decoder.
//
// TGA is the de-facto loose-texture format across older engines (GoldSrc and
// Source ship hundreds of UI/HUD .tga files) but browsers can't render it
// natively. We decode the layouts that actually appear in game data:
// uncompressed and RLE, 8-bit color-mapped, 24/32-bit true-color, and 8-bit
// grayscale: into RGBA, honouring the image-origin bit so the result is always
// top-down. Exotic variants (16-bit, planar) return null and are skipped.

export type DecodedImage = { width: number; height: number; rgba: Uint8Array };

const MAX_PIXELS = 67_108_864; // 8192*8192 guard against absurd headers

export function decodeTga(buffer: ArrayBuffer): DecodedImage | null {
  const bytes = new Uint8Array(buffer);
  if (bytes.length < 18) return null;
  const view = new DataView(buffer);

  const idLength = bytes[0]!;
  const colorMapType = bytes[1]!;
  const imageType = bytes[2]!;
  const colorMapFirst = view.getUint16(3, true);
  const colorMapLength = view.getUint16(5, true);
  const colorMapEntrySize = bytes[7]!;
  const width = view.getUint16(12, true);
  const height = view.getUint16(14, true);
  const pixelDepth = bytes[16]!;
  const descriptor = bytes[17]!;

  if (width <= 0 || height <= 0 || width * height > MAX_PIXELS) return null;

  // imageType: 1/9 color-mapped, 2/10 true-color, 3/11 grayscale (+8 = RLE).
  const rle = imageType >= 9 && imageType <= 11;
  const baseType = rle ? imageType - 8 : imageType;
  if (baseType !== 1 && baseType !== 2 && baseType !== 3) return null;

  let pos = 18 + idLength;

  let palette: Uint8Array | null = null;
  let paletteStride = 0;
  if (colorMapType === 1) {
    paletteStride = colorMapEntrySize >> 3;
    if (paletteStride < 3 || paletteStride > 4) return null;
    palette = bytes.subarray(pos, pos + colorMapLength * paletteStride);
    pos += colorMapLength * paletteStride;
  } else if (baseType === 1) {
    return null; // color-mapped image without a color map
  }

  const bpp = pixelDepth >> 3;
  if (baseType === 1 && bpp !== 1) return null;
  if (baseType === 2 && bpp !== 3 && bpp !== 4) return null;
  if (baseType === 3 && bpp !== 1) return null;

  const total = width * height;

  // Decode pixels in source order; orientation is applied afterwards because RLE
  // runs ignore scanline boundaries.
  const linear = new Uint8Array(total * 4);

  const writePixel = (di: number, si: number): void => {
    if (baseType === 1) {
      const idx = (bytes[si]! - colorMapFirst) * paletteStride;
      const pal = palette!;
      linear[di] = pal[idx + 2] ?? 0;
      linear[di + 1] = pal[idx + 1] ?? 0;
      linear[di + 2] = pal[idx] ?? 0;
      linear[di + 3] = paletteStride === 4 ? (pal[idx + 3] ?? 255) : 255;
    } else if (baseType === 3) {
      const v = bytes[si]!;
      linear[di] = v;
      linear[di + 1] = v;
      linear[di + 2] = v;
      linear[di + 3] = 255;
    } else {
      linear[di] = bytes[si + 2]!; // stored BGR(A)
      linear[di + 1] = bytes[si + 1]!;
      linear[di + 2] = bytes[si]!;
      linear[di + 3] = bpp === 4 ? bytes[si + 3]! : 255;
    }
  };

  if (rle) {
    let di = 0;
    let p = pos;
    while (di < total * 4 && p < bytes.length) {
      const packet = bytes[p++]!;
      const count = (packet & 0x7f) + 1;
      if (packet & 0x80) {
        for (let i = 0; i < count && di < total * 4; i++) {
          writePixel(di, p);
          di += 4;
        }
        p += bpp;
      } else {
        for (let i = 0; i < count && di < total * 4; i++) {
          writePixel(di, p);
          di += 4;
          p += bpp;
        }
      }
    }
  } else {
    if (pos + total * bpp > bytes.length) return null;
    for (let i = 0; i < total; i++) writePixel(i * 4, pos + i * bpp);
  }

  // Origin bit (descriptor bit 5): set => first row is the top. TGA defaults to
  // bottom-up, so flip unless the top-left bit is present.
  const topDown = (descriptor & 0x20) !== 0;
  if (topDown) return { width, height, rgba: linear };

  const rowBytes = width * 4;
  const out = new Uint8Array(linear.length);
  for (let y = 0; y < height; y++) {
    out.set(
      linear.subarray((height - 1 - y) * rowBytes, (height - y) * rowBytes),
      y * rowBytes,
    );
  }
  return { width, height, rgba: out };
}

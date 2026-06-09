// Decoders for the Unity `TextureFormat` values that can be turned into an RGBA
// buffer entirely in the browser. Covers the uncompressed layouts plus the
// BC/DXT block-compression family that dominates desktop builds.
//
// Block-compressed GPU formats that need large dedicated decoders (BC6H/BC7,
// ETC/EAC, PVRTC, ASTC) and crunch-compressed variants are intentionally
// unsupported: `decodeTexture` returns null for those so the caller skips them.

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

function expand5(v: number): number {
  return (v << 3) | (v >> 2);
}
function expand6(v: number): number {
  return (v << 2) | (v >> 4);
}

// Decode a 16-bit 5:6:5 color into [r,g,b].
function rgb565(c: number): [number, number, number] {
  return [expand5((c >> 11) & 0x1f), expand6((c >> 5) & 0x3f), expand5(c & 0x1f)];
}

// BC1/BC2/BC3 color block (8 bytes) -> writes RGB(A) into out
function decodeColorBlock(
  view: DataView,
  blockOffset: number,
  out: Uint8Array,
  width: number,
  height: number,
  bx: number,
  by: number,
  bc1Alpha: boolean,
): void {
  const c0 = view.getUint16(blockOffset, true);
  const c1 = view.getUint16(blockOffset + 2, true);
  const [r0, g0, b0] = rgb565(c0);
  const [r1, g1, b1] = rgb565(c1);

  const colors: [number, number, number, number][] = [
    [r0, g0, b0, 255],
    [r1, g1, b1, 255],
    [0, 0, 0, 255],
    [0, 0, 0, 255],
  ];

  if (c0 > c1 || !bc1Alpha) {
    colors[2] = [(2 * r0 + r1) / 3, (2 * g0 + g1) / 3, (2 * b0 + b1) / 3, 255];
    colors[3] = [(r0 + 2 * r1) / 3, (g0 + 2 * g1) / 3, (b0 + 2 * b1) / 3, 255];
  } else {
    colors[2] = [(r0 + r1) / 2, (g0 + g1) / 2, (b0 + b1) / 2, 255];
    colors[3] = [0, 0, 0, 0]; // 1-bit transparency (BC1 only)
  }

  const bits = view.getUint32(blockOffset + 4, true);
  for (let py = 0; py < 4; py++) {
    for (let px = 0; px < 4; px++) {
      const x = bx * 4 + px;
      const y = by * 4 + py;
      if (x >= width || y >= height) continue;
      const idx = (bits >> (2 * (py * 4 + px))) & 3;
      const col = colors[idx]!;
      const o = (y * width + x) * 4;
      out[o] = col[0];
      out[o + 1] = col[1];
      out[o + 2] = col[2];
      out[o + 3] = col[3];
    }
  }
}

// BC3/BC4/BC5 single-channel block (8 bytes) -> 16 values 0..255
function decodeAlphaBlock(view: DataView, blockOffset: number, dst: Uint8Array): void {
  const a0 = view.getUint8(blockOffset);
  const a1 = view.getUint8(blockOffset + 1);
  const a: number[] = [a0, a1, 0, 0, 0, 0, 0, 0];
  if (a0 > a1) {
    for (let i = 1; i <= 6; i++) a[i + 1] = ((7 - i) * a0 + i * a1) / 7;
  } else {
    for (let i = 1; i <= 4; i++) a[i + 1] = ((5 - i) * a0 + i * a1) / 5;
    a[6] = 0;
    a[7] = 255;
  }

  // 16 three-bit indices packed into the trailing 6 bytes (little-endian).
  let lo = 0;
  for (let i = 0; i < 3; i++) lo |= view.getUint8(blockOffset + 2 + i) << (8 * i);
  let hi = 0;
  for (let i = 0; i < 3; i++) hi |= view.getUint8(blockOffset + 5 + i) << (8 * i);

  for (let i = 0; i < 8; i++) dst[i] = a[(lo >> (3 * i)) & 7]!;
  for (let i = 0; i < 8; i++) dst[8 + i] = a[(hi >> (3 * i)) & 7]!;
}

function writeChannelBlock(
  values: Uint8Array,
  out: Uint8Array,
  width: number,
  height: number,
  bx: number,
  by: number,
  channel: number,
): void {
  for (let py = 0; py < 4; py++) {
    for (let px = 0; px < 4; px++) {
      const x = bx * 4 + px;
      const y = by * 4 + py;
      if (x >= width || y >= height) continue;
      out[(y * width + x) * 4 + channel] = values[py * 4 + px]!;
    }
  }
}

function decodeDXT(view: DataView, width: number, height: number, withAlpha: boolean): Uint8Array {
  const out = new Uint8Array(width * height * 4);
  const bw = Math.ceil(width / 4);
  const bh = Math.ceil(height / 4);
  const alpha = new Uint8Array(16);
  let off = 0;
  for (let by = 0; by < bh; by++) {
    for (let bx = 0; bx < bw; bx++) {
      if (withAlpha) {
        decodeAlphaBlock(view, off, alpha);
        decodeColorBlock(view, off + 8, out, width, height, bx, by, false);
        writeChannelBlock(alpha, out, width, height, bx, by, 3);
        off += 16;
      } else {
        decodeColorBlock(view, off, out, width, height, bx, by, true);
        off += 8;
      }
    }
  }
  return out;
}

function decodeBC4(view: DataView, width: number, height: number): Uint8Array {
  const out = new Uint8Array(width * height * 4);
  const bw = Math.ceil(width / 4);
  const bh = Math.ceil(height / 4);
  const ch = new Uint8Array(16);
  let off = 0;
  for (let by = 0; by < bh; by++) {
    for (let bx = 0; bx < bw; bx++) {
      decodeAlphaBlock(view, off, ch);
      writeChannelBlock(ch, out, width, height, bx, by, 0);
      writeChannelBlock(ch, out, width, height, bx, by, 1);
      writeChannelBlock(ch, out, width, height, bx, by, 2);
      // alpha = opaque
      for (let py = 0; py < 4; py++) {
        for (let px = 0; px < 4; px++) {
          const x = bx * 4 + px;
          const y = by * 4 + py;
          if (x < width && y < height) out[(y * width + x) * 4 + 3] = 255;
        }
      }
      off += 8;
    }
  }
  return out;
}

function decodeBC5(view: DataView, width: number, height: number): Uint8Array {
  const out = new Uint8Array(width * height * 4);
  const bw = Math.ceil(width / 4);
  const bh = Math.ceil(height / 4);
  const r = new Uint8Array(16);
  const g = new Uint8Array(16);
  let off = 0;
  for (let by = 0; by < bh; by++) {
    for (let bx = 0; bx < bw; bx++) {
      decodeAlphaBlock(view, off, r);
      decodeAlphaBlock(view, off + 8, g);
      writeChannelBlock(r, out, width, height, bx, by, 0);
      writeChannelBlock(g, out, width, height, bx, by, 1);
      for (let py = 0; py < 4; py++) {
        for (let px = 0; px < 4; px++) {
          const x = bx * 4 + px;
          const y = by * 4 + py;
          if (x < width && y < height) {
            const o = (y * width + x) * 4;
            out[o + 2] = 255;
            out[o + 3] = 255;
          }
        }
      }
      off += 16;
    }
  }
  return out;
}

function decodeUncompressed(
  view: DataView,
  width: number,
  height: number,
  format: TextureFormat,
): Uint8Array | null {
  const out = new Uint8Array(width * height * 4);
  const px = width * height;

  const need = (bytesPerPixel: number): boolean => view.byteLength >= px * bytesPerPixel;

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
      rgba = decodeDXT(view, width, height, false);
      break;
    case TextureFormat.DXT5:
      rgba = decodeDXT(view, width, height, true);
      break;
    case TextureFormat.BC4:
      rgba = decodeBC4(view, width, height);
      break;
    case TextureFormat.BC5:
      rgba = decodeBC5(view, width, height);
      break;
    default:
      rgba = decodeUncompressed(view, width, height, format as TextureFormat);
  }

  if (!rgba) return null;

  // Unity stores texture rows bottom-to-top (OpenGL convention); flip to top-down.
  const stride = width * 4;
  const flipped = new Uint8Array(rgba.length);
  for (let y = 0; y < height; y++) {
    flipped.set(rgba.subarray(y * stride, y * stride + stride), (height - 1 - y) * stride);
  }
  return flipped;
}

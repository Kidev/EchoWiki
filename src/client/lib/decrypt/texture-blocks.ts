// Shared GPU-texture block/pixel decoders.
//
// Desktop game engines overwhelmingly ship textures in the BCn (a.k.a. DXT/S3TC)
// block-compression family or in a handful of fixed raw pixel layouts. The same
// math decodes them whether they arrive inside a Unity bundle, a Source VTF, a
// RenderWare TXD, a standalone DDS, or a cooked Unreal asset. This module is the
// single, format-agnostic implementation those callers share.
//
// Every decoder returns a top-down RGBA8 buffer (row 0 = top). Callers whose
// container stores rows bottom-up (Unity / OpenGL convention) flip afterwards
// with `flipVerticalRGBA`. Decoders intentionally cover only what can be turned
// into RGBA without a GPU or proprietary library; BC6H/BC7, ASTC, ETC/EAC,
// PVRTC and crunch-compressed payloads are out of scope and handled by callers
// returning null.

function expand5(v: number): number {
  return (v << 3) | (v >> 2);
}
function expand6(v: number): number {
  return (v << 2) | (v >> 4);
}

// Decode a 16-bit 5:6:5 color into [r,g,b] (each 0..255).
export function rgb565(c: number): [number, number, number] {
  return [
    expand5((c >> 11) & 0x1f),
    expand6((c >> 5) & 0x3f),
    expand5(c & 0x1f),
  ];
}

// BC1/BC2/BC3 color block (8 bytes) -> writes RGB(A) into `out`.
// `oneBitAlpha` enables BC1's punch-through transparency (c0 <= c1 path); BC2/BC3
// always interpolate four opaque colors because they carry alpha separately.
function decodeColorBlock(
  view: DataView,
  blockOffset: number,
  out: Uint8Array,
  width: number,
  height: number,
  bx: number,
  by: number,
  oneBitAlpha: boolean,
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

  if (c0 > c1 || !oneBitAlpha) {
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

// BC3/BC4/BC5 single-channel block (8 bytes) -> 16 interpolated values 0..255.
function decodeInterpolatedBlock(
  view: DataView,
  blockOffset: number,
  dst: Uint8Array,
): void {
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
  for (let i = 0; i < 3; i++)
    lo |= view.getUint8(blockOffset + 2 + i) << (8 * i);
  let hi = 0;
  for (let i = 0; i < 3; i++)
    hi |= view.getUint8(blockOffset + 5 + i) << (8 * i);

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

function makeView(data: Uint8Array): DataView {
  return new DataView(data.buffer, data.byteOffset, data.byteLength);
}

// Number of bytes a BCn surface of the given size occupies (4x4 blocks).
export function bcnByteSize(
  width: number,
  height: number,
  bytesPerBlock: number,
): number {
  return Math.ceil(width / 4) * Math.ceil(height / 4) * bytesPerBlock;
}

/** BC1 / DXT1 (8 bytes/block). `oneBitAlpha` enables punch-through transparency. */
export function decodeBC1(
  data: Uint8Array,
  width: number,
  height: number,
  oneBitAlpha = true,
): Uint8Array {
  const view = makeView(data);
  const out = new Uint8Array(width * height * 4);
  const bw = Math.ceil(width / 4);
  const bh = Math.ceil(height / 4);
  let off = 0;
  for (let by = 0; by < bh; by++) {
    for (let bx = 0; bx < bw; bx++) {
      decodeColorBlock(view, off, out, width, height, bx, by, oneBitAlpha);
      off += 8;
    }
  }
  return out;
}

/** BC2 / DXT3 (16 bytes/block): explicit 4-bit alpha + BC1-style color. */
export function decodeBC2(
  data: Uint8Array,
  width: number,
  height: number,
): Uint8Array {
  const view = makeView(data);
  const out = new Uint8Array(width * height * 4);
  const bw = Math.ceil(width / 4);
  const bh = Math.ceil(height / 4);
  let off = 0;
  for (let by = 0; by < bh; by++) {
    for (let bx = 0; bx < bw; bx++) {
      decodeColorBlock(view, off + 8, out, width, height, bx, by, false);
      // 16 explicit 4-bit alpha nibbles in the first 8 bytes.
      for (let py = 0; py < 4; py++) {
        const row = view.getUint16(off + py * 2, true);
        for (let px = 0; px < 4; px++) {
          const x = bx * 4 + px;
          const y = by * 4 + py;
          if (x >= width || y >= height) continue;
          out[(y * width + x) * 4 + 3] = ((row >> (px * 4)) & 0xf) * 17;
        }
      }
      off += 16;
    }
  }
  return out;
}

/** BC3 / DXT5 (16 bytes/block): interpolated alpha + BC1-style color. */
export function decodeBC3(
  data: Uint8Array,
  width: number,
  height: number,
): Uint8Array {
  const view = makeView(data);
  const out = new Uint8Array(width * height * 4);
  const bw = Math.ceil(width / 4);
  const bh = Math.ceil(height / 4);
  const alpha = new Uint8Array(16);
  let off = 0;
  for (let by = 0; by < bh; by++) {
    for (let bx = 0; bx < bw; bx++) {
      decodeInterpolatedBlock(view, off, alpha);
      decodeColorBlock(view, off + 8, out, width, height, bx, by, false);
      writeChannelBlock(alpha, out, width, height, bx, by, 3);
      off += 16;
    }
  }
  return out;
}

/** BC4 / ATI1 (8 bytes/block): single channel replicated to RGB, opaque alpha. */
export function decodeBC4(
  data: Uint8Array,
  width: number,
  height: number,
): Uint8Array {
  const view = makeView(data);
  const out = new Uint8Array(width * height * 4);
  const bw = Math.ceil(width / 4);
  const bh = Math.ceil(height / 4);
  const ch = new Uint8Array(16);
  let off = 0;
  for (let by = 0; by < bh; by++) {
    for (let bx = 0; bx < bw; bx++) {
      decodeInterpolatedBlock(view, off, ch);
      writeChannelBlock(ch, out, width, height, bx, by, 0);
      writeChannelBlock(ch, out, width, height, bx, by, 1);
      writeChannelBlock(ch, out, width, height, bx, by, 2);
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

/** BC5 / ATI2 (16 bytes/block): two channels -> R,G with B/A forced opaque. */
export function decodeBC5(
  data: Uint8Array,
  width: number,
  height: number,
): Uint8Array {
  const view = makeView(data);
  const out = new Uint8Array(width * height * 4);
  const bw = Math.ceil(width / 4);
  const bh = Math.ceil(height / 4);
  const r = new Uint8Array(16);
  const g = new Uint8Array(16);
  let off = 0;
  for (let by = 0; by < bh; by++) {
    for (let bx = 0; bx < bw; bx++) {
      decodeInterpolatedBlock(view, off, r);
      decodeInterpolatedBlock(view, off + 8, g);
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

// Flip an RGBA8 buffer vertically in place-style (returns a new buffer).
export function flipVerticalRGBA(
  rgba: Uint8Array,
  width: number,
  height: number,
): Uint8Array {
  const stride = width * 4;
  const flipped = new Uint8Array(rgba.length);
  for (let y = 0; y < height; y++) {
    flipped.set(
      rgba.subarray(y * stride, y * stride + stride),
      (height - 1 - y) * stride,
    );
  }
  return flipped;
}

// LZ4 block-format decompression (not the framed format). UnityFS asset bundles
// store their block table and data blocks with LZ4 / LZ4HC, both of which decode
// with this single routine since they share the on-disk block layout.

export function lz4DecompressBlock(src: Uint8Array, decompressedSize: number): Uint8Array {
  const dst = new Uint8Array(decompressedSize);
  let s = 0;
  let d = 0;

  while (s < src.length) {
    const token = src[s++]!;

    // Literals
    let literalLength = token >> 4;
    if (literalLength === 0xf) {
      let add: number;
      do {
        add = src[s++]!;
        literalLength += add;
      } while (add === 0xff);
    }
    for (let i = 0; i < literalLength; i++) {
      if (s >= src.length || d >= dst.length) return dst;
      dst[d++] = src[s++]!;
    }

    if (s >= src.length) break;

    // Match
    const offset = src[s++]! | (src[s++]! << 8);
    if (offset === 0) break; // invalid
    let matchLength = token & 0xf;
    if (matchLength === 0xf) {
      let add: number;
      do {
        add = src[s++]!;
        matchLength += add;
      } while (add === 0xff);
    }
    matchLength += 4; // minmatch

    let matchPos = d - offset;
    if (matchPos < 0) break;
    for (let i = 0; i < matchLength; i++) {
      if (d >= dst.length) return dst;
      dst[d++] = dst[matchPos++]!;
    }
  }

  return dst;
}

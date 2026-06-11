// Minimal PNG encoder for raw RGBA pixel buffers.
//
// Used by the Unity extractor to turn decoded textures (which live in GPU
// formats inside the game files) into viewable PNGs. Deflate is delegated to
// the browser's CompressionStream when available, with a "stored" (uncompressed)
// zlib fallback so encoding never depends on a bundled compressor.

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) {
    crc = CRC_TABLE[(crc ^ bytes[i]!) & 0xff]! ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function adler32(bytes: Uint8Array): number {
  let a = 1;
  let b = 0;
  for (let i = 0; i < bytes.length; i++) {
    a = (a + bytes[i]!) % 65521;
    b = (b + a) % 65521;
  }
  return ((b << 16) | a) >>> 0;
}

// Wrap raw bytes in an uncompressed zlib stream (deflate "stored" blocks).
// Produces valid, if larger, IDAT payloads when CompressionStream is missing.
function storedDeflate(data: Uint8Array): Uint8Array {
  const blocks: number[] = [0x78, 0x01]; // zlib header (CM=8, no preset dict)
  let pos = 0;
  while (pos < data.length || (pos === 0 && data.length === 0)) {
    const chunk = Math.min(0xffff, data.length - pos);
    const final = pos + chunk >= data.length ? 1 : 0;
    blocks.push(
      final,
      chunk & 0xff,
      (chunk >> 8) & 0xff,
      ~chunk & 0xff,
      (~chunk >> 8) & 0xff,
    );
    for (let i = 0; i < chunk; i++) blocks.push(data[pos + i]!);
    pos += chunk;
    if (chunk === 0) break;
  }
  const checksum = adler32(data);
  blocks.push(
    (checksum >>> 24) & 0xff,
    (checksum >>> 16) & 0xff,
    (checksum >>> 8) & 0xff,
    checksum & 0xff,
  );
  return new Uint8Array(blocks);
}

async function deflate(data: Uint8Array): Promise<Uint8Array> {
  if (typeof CompressionStream !== "undefined") {
    try {
      const cs = new CompressionStream("deflate"); // zlib-wrapped, matches PNG IDAT
      const writer = cs.writable.getWriter();
      void writer.write(data);
      void writer.close();
      const buf = await new Response(cs.readable).arrayBuffer();
      return new Uint8Array(buf);
    } catch {
      // Fall through to the dependency-free path.
    }
  }
  return storedDeflate(data);
}

function chunk(type: string, data: Uint8Array): Uint8Array {
  const typeBytes = new Uint8Array(4);
  for (let i = 0; i < 4; i++) typeBytes[i] = type.charCodeAt(i);

  const out = new Uint8Array(12 + data.length);
  const view = new DataView(out.buffer);
  view.setUint32(0, data.length, false);
  out.set(typeBytes, 4);
  out.set(data, 8);

  const crcInput = new Uint8Array(4 + data.length);
  crcInput.set(typeBytes, 0);
  crcInput.set(data, 4);
  view.setUint32(8 + data.length, crc32(crcInput), false);

  return out;
}

// Encode an RGBA8 pixel buffer (length === width*height*4) as a PNG blob.
export async function encodePng(
  width: number,
  height: number,
  rgba: Uint8Array,
): Promise<Uint8Array> {
  // Prepend the per-scanline filter byte (0 = none) required by the format.
  const stride = width * 4;
  const raw = new Uint8Array(height * (stride + 1));
  for (let y = 0; y < height; y++) {
    raw[y * (stride + 1)] = 0;
    raw.set(
      rgba.subarray(y * stride, y * stride + stride),
      y * (stride + 1) + 1,
    );
  }

  const idatData = await deflate(raw);

  const ihdr = new Uint8Array(13);
  const ihdrView = new DataView(ihdr.buffer);
  ihdrView.setUint32(0, width, false);
  ihdrView.setUint32(4, height, false);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // color type: RGBA
  ihdr[10] = 0; // compression
  ihdr[11] = 0; // filter
  ihdr[12] = 0; // interlace

  const signature = new Uint8Array([
    0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
  ]);
  const ihdrChunk = chunk("IHDR", ihdr);
  const idatChunk = chunk("IDAT", idatData);
  const iendChunk = chunk("IEND", new Uint8Array(0));

  const total =
    signature.length + ihdrChunk.length + idatChunk.length + iendChunk.length;
  const png = new Uint8Array(total);
  let off = 0;
  for (const part of [signature, ihdrChunk, idatChunk, iendChunk]) {
    png.set(part, off);
    off += part.length;
  }
  return png;
}

// Unreal Engine .pak media carver.
//
// A full UE pak/asset reader is not feasible in the browser: shipping titles
// almost always Oodle-compress their pak index and store textures in cooked,
// platform-specific GPU formats (and many encrypt the index). None of that can
// be decoded without proprietary libraries.
//
// What *is* reliable is carving self-contained media that sits uncompressed
// inside the pak: Unreal stores plenty of audio/video/loose images as ordinary
// OGG/WAV/PNG/JPEG byte streams. We scan the raw bytes for those signatures and
// reconstruct each file from its own internal length fields. Compressed or
// cooked data is simply never matched, so this fails quietly rather than
// producing garbage.
//
// Pak files routinely exceed the ~2 GB ArrayBuffer limit (the sample title here
// ships an 8 GB pak), so scanning is streamed through File.slice() windows
// rather than loading the whole file at once.

import type { ProcessedAsset } from "./rmmv";

type Carved = { ext: string; mime: string; data: Uint8Array };

const WINDOW = 32 * 1024 * 1024; // scan window size
const OVERLAP = 16; // ≥ longest signature, so boundary-straddling sigs are caught next window
const MAX_MEDIA = 64 * 1024 * 1024; // cap a single carved file

// Walk PNG chunks from a signature to IEND; returns total length or -1.
function pngLength(view: DataView, start: number, end: number): number {
  if (start + 8 > end) return -1;
  let pos = start + 8; // skip 8-byte signature
  while (pos + 12 <= end) {
    const chunkLen = view.getUint32(pos, false);
    if (chunkLen > 64 * 1024 * 1024) return -1;
    const t0 = view.getUint8(pos + 4);
    const t1 = view.getUint8(pos + 5);
    const t2 = view.getUint8(pos + 6);
    const t3 = view.getUint8(pos + 7);
    pos += 12 + chunkLen;
    // "IEND"
    if (t0 === 0x49 && t1 === 0x45 && t2 === 0x4e && t3 === 0x44) {
      return pos <= end ? pos - start : -1;
    }
  }
  return -1;
}

// RIFF/WAVE container: total length from the RIFF size field.
function wavLength(view: DataView, start: number, end: number): number {
  if (start + 12 > end) return -1;
  // "WAVE" at start+8
  if (
    view.getUint8(start + 8) !== 0x57 ||
    view.getUint8(start + 9) !== 0x41 ||
    view.getUint8(start + 10) !== 0x56 ||
    view.getUint8(start + 11) !== 0x45
  ) {
    return -1;
  }
  const total = 8 + view.getUint32(start + 4, true);
  return total >= 44 && start + total <= end ? total : -1;
}

// Walk consecutive Ogg pages of one bitstream until the end-of-stream page.
function oggLength(view: DataView, start: number, end: number): number {
  let pos = start;
  let serial: number | null = null;
  while (pos + 27 <= end) {
    // "OggS"
    if (
      view.getUint8(pos) !== 0x4f ||
      view.getUint8(pos + 1) !== 0x67 ||
      view.getUint8(pos + 2) !== 0x67 ||
      view.getUint8(pos + 3) !== 0x53
    ) {
      break;
    }
    const headerType = view.getUint8(pos + 5);
    const pageSerial = view.getUint32(pos + 14, true);
    if (serial === null) serial = pageSerial;
    else if (pageSerial !== serial) break;

    const segCount = view.getUint8(pos + 26);
    if (pos + 27 + segCount > end) break;
    let dataLen = 0;
    for (let i = 0; i < segCount; i++) dataLen += view.getUint8(pos + 27 + i);

    pos += 27 + segCount + dataLen;
    if (headerType & 0x04) return pos - start; // end-of-stream page
  }
  return -1;
}

// JPEG: walk the segment markers from SOI to EOI. Validating each segment's
// structure (rather than scanning for the first 0xFFD9) rejects the random
// "FF D8 FF" byte sequences that litter compressed/cooked pak data.
function jpegLength(view: DataView, start: number, end: number): number {
  const limit = Math.min(end, start + MAX_MEDIA);
  let p = start + 2; // past SOI (FF D8)

  // The first real marker must be a segment marker (>= 0xC0).
  if (
    p + 1 >= limit ||
    view.getUint8(p) !== 0xff ||
    view.getUint8(p + 1) < 0xc0
  )
    return -1;

  while (p + 1 < limit) {
    if (view.getUint8(p) !== 0xff) return -1; // markers must be byte-aligned
    // Skip any fill 0xFF bytes preceding the marker code.
    while (p + 1 < limit && view.getUint8(p + 1) === 0xff) p++;
    if (p + 1 >= limit) return -1;
    const marker = view.getUint8(p + 1);
    p += 2;

    if (marker === 0xd9) return p - start; // EOI
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) continue; // standalone

    if (p + 2 > limit) return -1;
    const segLen = view.getUint16(p, false);
    if (segLen < 2) return -1;
    p += segLen;

    if (marker === 0xda) {
      // Start of scan: entropy-coded data runs until the next real marker.
      while (p + 1 < limit) {
        if (view.getUint8(p) === 0xff) {
          const m2 = view.getUint8(p + 1);
          if (m2 === 0x00 || (m2 >= 0xd0 && m2 <= 0xd7)) {
            p += 2; // stuffed 0xFF00 or restart marker
            continue;
          }
          break; // real marker reached
        }
        p++;
      }
    }
  }
  return -1;
}

// Cheap pre-filter: does a known signature begin at window[i]?
function signatureAt(window: Uint8Array, i: number): boolean {
  const b = window[i]!;
  const len = window.length;
  // PNG: 89 50 4E 47
  if (b === 0x89)
    return (
      i + 4 <= len &&
      window[i + 1] === 0x50 &&
      window[i + 2] === 0x4e &&
      window[i + 3] === 0x47
    );
  // OGG: "OggS"
  if (b === 0x4f)
    return (
      i + 4 <= len &&
      window[i + 1] === 0x67 &&
      window[i + 2] === 0x67 &&
      window[i + 3] === 0x53
    );
  // RIFF: "RIFF"
  if (b === 0x52)
    return (
      i + 4 <= len &&
      window[i + 1] === 0x49 &&
      window[i + 2] === 0x46 &&
      window[i + 3] === 0x46
    );
  // JPEG: FF D8 FF
  if (b === 0xff)
    return i + 3 <= len && window[i + 1] === 0xd8 && window[i + 2] === 0xff;
  return false;
}

export async function* processUnrealPak(
  file: File,
): AsyncGenerator<ProcessedAsset> {
  const size = file.size;

  const readSlice = async (
    start: number,
    end: number,
  ): Promise<Uint8Array | null> => {
    try {
      const buf = await file.slice(start, Math.min(end, size)).arrayBuffer();
      return new Uint8Array(buf);
    } catch {
      return null;
    }
  };

  // Load the full media at an absolute offset and identify its length.
  const carveAt = async (absStart: number): Promise<Carved | null> => {
    const buf = await readSlice(absStart, absStart + MAX_MEDIA);
    if (!buf) return null;
    const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
    const b = buf[0]!;

    if (b === 0x89) {
      const n = pngLength(view, 0, buf.length);
      if (n >= 67)
        return { ext: "png", mime: "image/png", data: buf.slice(0, n) };
    } else if (b === 0x4f) {
      const n = oggLength(view, 0, buf.length);
      if (n >= 58)
        return { ext: "ogg", mime: "audio/ogg", data: buf.slice(0, n) };
    } else if (b === 0x52) {
      const n = wavLength(view, 0, buf.length);
      if (n > 0)
        return { ext: "wav", mime: "audio/wav", data: buf.slice(0, n) };
    } else if (b === 0xff) {
      const n = jpegLength(view, 0, buf.length);
      if (n >= 125)
        return { ext: "jpg", mime: "image/jpeg", data: buf.slice(0, n) };
    }
    return null;
  };

  let imageIdx = 0;
  let audioIdx = 0;
  let pos = 0;

  while (pos < size) {
    const winEnd = Math.min(pos + WINDOW, size);
    const window = await readSlice(pos, winEnd);
    if (!window) return; // can't read this window: give up
    // Leave an overlap at the tail (unless final window) so a signature that
    // straddles the boundary is re-scanned at the start of the next window.
    const limit = winEnd >= size ? window.length : window.length - OVERLAP;

    let i = 0;
    while (i < limit) {
      const b = window[i]!;
      if (
        (b === 0x89 || b === 0x4f || b === 0x52 || b === 0xff) &&
        signatureAt(window, i)
      ) {
        const carved = await carveAt(pos + i);
        if (carved) {
          const isAudio = carved.mime.startsWith("audio/");
          const folder = isAudio ? "audio" : "textures";
          const idx = isAudio ? audioIdx++ : imageIdx++;
          yield {
            path: `${folder}/pak_${idx}.${carved.ext}`,
            blob: new Blob([carved.data], { type: carved.mime }),
            mimeType: carved.mime,
          };
          i += carved.data.length;
          continue;
        }
      }
      i++;
    }

    // Advance by however far we got (carves may push past the overlap).
    pos += Math.max(i, limit);
  }
}

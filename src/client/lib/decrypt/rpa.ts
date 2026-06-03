import type { ProcessedAsset } from "./rmmv";

// ─────────────────────────────────────────────────────────────────────────────
// Minimal Python pickle parser: handles the subset used by RenPy for RPA
// ─────────────────────────────────────────────────────────────────────────────

type PickleVal = string | number | Uint8Array | PickleVal[] | PickleMap | null;
type PickleMap = { [key: string]: PickleVal };

class PickleParser {
  private buf: ArrayBuffer;
  private view: DataView;
  private pos = 0;
  private stack: PickleVal[] = [];
  private marks: number[] = [];
  private memo = new Map<number, PickleVal>();

  constructor(buf: ArrayBuffer) {
    this.buf = buf;
    this.view = new DataView(buf);
  }

  private u8(): number {
    return this.view.getUint8(this.pos++);
  }
  private u16le(): number {
    const v = this.view.getUint16(this.pos, true);
    this.pos += 2;
    return v;
  }
  private i32le(): number {
    const v = this.view.getInt32(this.pos, true);
    this.pos += 4;
    return v;
  }
  private u32le(): number {
    const v = this.view.getUint32(this.pos, true);
    this.pos += 4;
    return v;
  }
  private line(): string {
    let s = "";
    while (this.pos < this.view.byteLength) {
      const c = this.u8();
      if (c === 0x0a) break;
      s += String.fromCharCode(c);
    }
    return s;
  }
  private str(n: number): string {
    const bytes = new Uint8Array(this.buf, this.pos, n);
    this.pos += n;
    return new TextDecoder().decode(bytes);
  }
  private bytes(n: number): Uint8Array {
    const out = new Uint8Array(n);
    out.set(new Uint8Array(this.buf, this.pos, n));
    this.pos += n;
    return out;
  }

  private top(): PickleVal {
    return this.stack.length > 0 ? (this.stack[this.stack.length - 1] ?? null) : null;
  }

  private memoize(idx: number): void {
    this.memo.set(idx, this.top());
  }

  private setItems(mark: number): void {
    const items = this.stack.splice(mark);
    const d = this.top();
    if (d !== null && typeof d === "object" && !Array.isArray(d) && !(d instanceof Uint8Array)) {
      for (let i = 0; i + 1 < items.length; i += 2) {
        (d as PickleMap)[String(items[i])] = items[i + 1] ?? null;
      }
    }
  }

  private appendItems(mark: number): void {
    const items = this.stack.splice(mark);
    const lst = this.top();
    if (Array.isArray(lst)) lst.push(...items);
  }

  parse(): PickleVal {
    const len = this.view.byteLength;
    while (this.pos < len) {
      const op = this.u8();
      switch (op) {
        // ── Protocol headers ───────────────────────────────────────────────
        case 0x80:
          this.u8();
          break; // PROTO: skip version
        case 0x95:
          this.pos += 8;
          break; // FRAME: skip 8-byte length

        // ── Terminal ───────────────────────────────────────────────────────
        case 0x2e:
          return this.stack.pop() ?? null; // STOP

        // ── Stack manipulation ─────────────────────────────────────────────
        case 0x28:
          this.marks.push(this.stack.length);
          break; // MARK
        case 0x30:
          this.stack.pop();
          break; // POP
        case 0x31: {
          const m = this.marks.pop() ?? 0;
          this.stack.splice(m);
          break;
        } // POP_MARK
        case 0x32:
          this.stack.push(this.top());
          break; // DUP

        // ── Memo ──────────────────────────────────────────────────────────
        case 0x70:
          this.memoize(parseInt(this.line(), 10));
          break; // PUT
        case 0x71:
          this.memoize(this.u8());
          break; // BINPUT
        case 0x72:
          this.memoize(this.u32le());
          break; // LONG_BINPUT
        case 0x94:
          this.memoize(this.memo.size);
          break; // MEMOIZE
        case 0x67:
          this.stack.push(this.memo.get(parseInt(this.line(), 10)) ?? null);
          break; // GET
        case 0x68:
          this.stack.push(this.memo.get(this.u8()) ?? null);
          break; // BINGET
        case 0x6a:
          this.stack.push(this.memo.get(this.u32le()) ?? null);
          break; // LONG_BINGET

        // ── Primitives ─────────────────────────────────────────────────────
        case 0x4e:
          this.stack.push(null);
          break; // NONE
        case 0x88:
          this.stack.push(1);
          break; // NEWTRUE
        case 0x89:
          this.stack.push(0);
          break; // NEWFALSE
        case 0x4b:
          this.stack.push(this.u8());
          break; // BININT1
        case 0x4d:
          this.stack.push(this.u16le());
          break; // BININT2
        case 0x4a:
          this.stack.push(this.i32le());
          break; // BININT
        case 0x49:
          this.stack.push(parseInt(this.line(), 10));
          break; // INT
        case 0x46:
          this.stack.push(parseFloat(this.line()));
          break; // FLOAT
        case 0x47:
          this.pos += 8;
          this.stack.push(0);
          break; // BINFLOAT (skip)
        case 0x4c:
          this.stack.push(parseInt(this.line().replace("L", ""), 10));
          break; // LONG
        case 0x8a: {
          // LONG1
          const n = this.u8();
          let val = 0;
          for (let i = 0; i < n && i < 4; i++) val |= this.u8() << (i * 8);
          if (n > 4) this.pos += n - 4;
          this.stack.push(val);
          break;
        }
        case 0x8b: {
          // LONG4
          const n = this.u32le();
          let val = 0;
          const safe = Math.min(n, 4);
          for (let i = 0; i < safe; i++) val |= this.u8() << (i * 8);
          if (n > 4) this.pos += n - 4;
          this.stack.push(val);
          break;
        }

        // ── Strings ────────────────────────────────────────────────────────
        case 0x53: {
          // STRING (quoted ascii line)
          const raw = this.line();
          // Strip surrounding quotes
          if (
            (raw.startsWith("'") && raw.endsWith("'")) ||
            (raw.startsWith('"') && raw.endsWith('"'))
          ) {
            this.stack.push(raw.slice(1, -1));
          } else {
            this.stack.push(raw);
          }
          break;
        }
        case 0x55:
          this.stack.push(this.str(this.u8()));
          break; // SHORT_BINSTRING
        case 0x54:
          this.stack.push(this.str(this.u32le()));
          break; // BINSTRING
        case 0x58:
          this.stack.push(this.str(this.u32le()));
          break; // BINUNICODE
        case 0x8c:
          this.stack.push(this.str(this.u8()));
          break; // SHORT_BINUNICODE
        case 0x8d: {
          // BINUNICODE8
          const lo = this.u32le();
          this.pos += 4; // skip high 32 bits
          this.stack.push(this.str(lo));
          break;
        }

        // ── Bytes ──────────────────────────────────────────────────────────
        case 0x43:
          this.stack.push(this.bytes(this.u8()));
          break; // SHORT_BINBYTES
        case 0x42:
          this.stack.push(this.bytes(this.u32le()));
          break; // BINBYTES
        case 0x8e: {
          // BINBYTES8
          const lo = this.u32le();
          this.pos += 4;
          this.stack.push(this.bytes(lo));
          break;
        }

        // ── Collections ────────────────────────────────────────────────────
        case 0x7d:
          this.stack.push({});
          break; // EMPTY_DICT
        case 0x5d:
          this.stack.push([]);
          break; // EMPTY_LIST
        case 0x29:
          this.stack.push([]);
          break; // EMPTY_TUPLE
        case 0x64: {
          // DICT (mark + pairs -> dict)
          const m = this.marks.pop() ?? 0;
          const items = this.stack.splice(m);
          const d: PickleMap = {};
          for (let i = 0; i + 1 < items.length; i += 2) d[String(items[i])] = items[i + 1] ?? null;
          this.stack.push(d);
          break;
        }
        case 0x6c: {
          // LIST (mark + items -> list)
          const m = this.marks.pop() ?? 0;
          this.stack.push(this.stack.splice(m));
          break;
        }
        case 0x74: {
          // TUPLE (mark + items -> tuple stored as list)
          const m = this.marks.pop() ?? 0;
          this.stack.push(this.stack.splice(m));
          break;
        }
        case 0x85: {
          // TUPLE1
          const a = this.stack.pop() ?? null;
          this.stack.push([a]);
          break;
        }
        case 0x86: {
          // TUPLE2
          const b = this.stack.pop() ?? null;
          const a = this.stack.pop() ?? null;
          this.stack.push([a, b]);
          break;
        }
        case 0x87: {
          // TUPLE3
          const c = this.stack.pop() ?? null;
          const b = this.stack.pop() ?? null;
          const a = this.stack.pop() ?? null;
          this.stack.push([a, b, c]);
          break;
        }
        case 0x61: {
          // APPEND
          const v = this.stack.pop() ?? null;
          const lst = this.top();
          if (Array.isArray(lst)) lst.push(v);
          break;
        }
        case 0x65: {
          // APPENDS
          const m = this.marks.pop() ?? 0;
          this.appendItems(m);
          break;
        }
        case 0x73: {
          // SETITEM
          const v = this.stack.pop() ?? null;
          const k = this.stack.pop();
          const d = this.top();
          if (
            d !== null &&
            typeof d === "object" &&
            !Array.isArray(d) &&
            !(d instanceof Uint8Array)
          ) {
            (d as PickleMap)[String(k)] = v;
          }
          break;
        }
        case 0x75: {
          // SETITEMS
          const m = this.marks.pop() ?? 0;
          this.setItems(m);
          break;
        }

        // ── Object construction ────────────────────────────────────────────
        case 0x63: {
          // GLOBAL (module\nname\n)
          const mod = this.line();
          const name = this.line();
          this.stack.push({ __class__: `${mod}.${name}` });
          break;
        }
        case 0x93: {
          // STACK_GLOBAL (proto 4)
          const name = String(this.stack.pop() ?? "");
          const mod = String(this.stack.pop() ?? "");
          this.stack.push({ __class__: `${mod}.${name}` });
          break;
        }
        case 0x52: {
          // REDUCE (fn(*args))
          const args = this.stack.pop();
          const fn = this.stack.pop();
          if (
            fn !== null &&
            typeof fn === "object" &&
            !Array.isArray(fn) &&
            !(fn instanceof Uint8Array) &&
            (fn as PickleMap)["__class__"] === "collections.OrderedDict"
          ) {
            // OrderedDict constructor called with list of (k,v) pairs
            const d: PickleMap = {};
            if (Array.isArray(args) && args.length > 0 && Array.isArray(args[0])) {
              for (const pair of args[0] as PickleVal[]) {
                if (Array.isArray(pair) && pair.length >= 2) {
                  d[String(pair[0])] = pair[1] ?? null;
                }
              }
            }
            this.stack.push(d);
          } else {
            this.stack.push({});
          }
          break;
        }
        case 0x81: {
          // NEWOBJ (cls.__new__(cls, *args))
          this.stack.pop(); // args
          const cls = this.stack.pop();
          if (
            cls !== null &&
            typeof cls === "object" &&
            !Array.isArray(cls) &&
            !(cls instanceof Uint8Array) &&
            (cls as PickleMap)["__class__"] === "collections.OrderedDict"
          ) {
            this.stack.push({});
          } else {
            this.stack.push({});
          }
          break;
        }
        case 0x82: {
          // NEWOBJ_EX (proto 4)
          this.stack.pop(); // kwargs
          this.stack.pop(); // args
          this.stack.pop(); // cls
          this.stack.push({});
          break;
        }
        case 0x62: {
          // BUILD (obj.__setstate__ or update)
          const state = this.stack.pop();
          const obj = this.top();
          if (
            obj !== null &&
            typeof obj === "object" &&
            !Array.isArray(obj) &&
            !(obj instanceof Uint8Array) &&
            state !== null &&
            typeof state === "object" &&
            !Array.isArray(state) &&
            !(state instanceof Uint8Array)
          ) {
            Object.assign(obj as PickleMap, state as PickleMap);
          }
          break;
        }

        default:
          // Unknown opcode: best-effort, skip
          break;
      }
    }
    return this.stack.pop() ?? null;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// RPA archive parser
// ─────────────────────────────────────────────────────────────────────────────

const MIME_MAP: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".bmp": "image/bmp",
  ".webp": "image/webp",
  ".ogg": "audio/ogg",
  ".mp3": "audio/mpeg",
  ".m4a": "audio/mp4",
  ".wav": "audio/wav",
  ".opus": "audio/opus",
  ".flac": "audio/flac",
  ".mp4": "video/mp4",
  ".webm": "video/webm",
};

function getMimeType(filename: string): string {
  const dot = filename.lastIndexOf(".");
  const ext = dot >= 0 ? filename.slice(dot).toLowerCase() : "";
  return MIME_MAP[ext] ?? "application/octet-stream";
}

async function decompress(data: Uint8Array): Promise<ArrayBuffer> {
  const ds = new DecompressionStream("deflate");
  const writer = ds.writable.getWriter();
  void writer.write(data).then(() => writer.close());

  const chunks: Uint8Array[] = [];
  const reader = ds.readable.getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value as Uint8Array);
  }

  const total = chunks.reduce((s, c) => s + c.length, 0);
  const out = new Uint8Array(total);
  let off = 0;
  for (const chunk of chunks) {
    out.set(chunk, off);
    off += chunk.length;
  }
  return out.buffer as ArrayBuffer;
}

type RpaHeader = { indexOffset: number; key: number };

async function readRpaHeader(file: File): Promise<RpaHeader | null> {
  const headerBuf = await file.slice(0, 128).arrayBuffer();
  const headerText = new TextDecoder("ascii", { fatal: false }).decode(headerBuf);
  const firstLine = (headerText.split("\n")[0] ?? "").trim();

  const v3 = /^RPA-3\.0 ([0-9a-f]{16}) ([0-9a-f]{8})$/i.exec(firstLine);
  if (v3) {
    return { indexOffset: parseInt(v3[1]!, 16), key: parseInt(v3[2]!, 16) };
  }

  const v2 = /^RPA-2\.0 ([0-9a-f]{16})$/i.exec(firstLine);
  if (v2) {
    return { indexOffset: parseInt(v2[1]!, 16), key: 0 };
  }

  return null;
}

type RpaEntry = { offset: number; length: number; prefix: Uint8Array };

function parseIndex(pickleVal: PickleVal): Map<string, RpaEntry> {
  const index = new Map<string, RpaEntry>();
  if (
    pickleVal === null ||
    typeof pickleVal !== "object" ||
    Array.isArray(pickleVal) ||
    pickleVal instanceof Uint8Array
  ) {
    return index;
  }

  for (const [filename, value] of Object.entries(pickleVal as PickleMap)) {
    if (!Array.isArray(value) || value.length === 0) continue;
    const first = value[0];
    if (!Array.isArray(first) || first.length < 2) continue;

    const rawOffset = first[0];
    const rawLength = first[1];
    const rawPrefix = first[2];

    if (typeof rawOffset !== "number" || typeof rawLength !== "number") continue;

    const prefix =
      rawPrefix instanceof Uint8Array
        ? rawPrefix
        : typeof rawPrefix === "string"
          ? new TextEncoder().encode(rawPrefix)
          : new Uint8Array(0);

    index.set(filename, { offset: rawOffset, length: rawLength, prefix });
  }
  return index;
}

export async function* processRpaArchive(archiveFile: File): AsyncGenerator<ProcessedAsset> {
  const header = await readRpaHeader(archiveFile);
  if (!header) throw new Error("Not a valid RPA archive");

  const { indexOffset, key } = header;
  const fileSize = archiveFile.size;
  if (indexOffset >= fileSize) throw new Error("RPA index offset out of bounds");

  // Read and decompress the pickle index
  const indexCompressed = new Uint8Array(await archiveFile.slice(indexOffset).arrayBuffer());
  const indexBuf = await decompress(indexCompressed);
  const pickleVal = new PickleParser(indexBuf).parse();

  const entries = parseIndex(pickleVal);

  for (const [filename, entry] of entries) {
    // XOR stored offset/length with the key (RPA-3.0); key=0 for RPA-2.0
    const actualOffset = (entry.offset ^ key) >>> 0;
    const actualLength = (entry.length ^ key) >>> 0;

    if (actualOffset + actualLength > fileSize) continue;

    const mime = getMimeType(filename);
    const rawData = new Uint8Array(
      await archiveFile.slice(actualOffset, actualOffset + actualLength).arrayBuffer(),
    );

    let data: Uint8Array;
    if (entry.prefix.length > 0) {
      data = new Uint8Array(entry.prefix.length + rawData.length);
      data.set(entry.prefix);
      data.set(rawData, entry.prefix.length);
    } else {
      data = rawData;
    }

    const path = filename.replace(/\\/g, "/").toLowerCase();
    yield {
      path,
      blob: new Blob([data], { type: mime }),
      mimeType: mime,
    };
  }
}

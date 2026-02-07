export class BinaryReader {
  private view: DataView;
  private bytes: Uint8Array;
  private pos: number;

  constructor(buffer: ArrayBuffer) {
    this.view = new DataView(buffer);
    this.bytes = new Uint8Array(buffer);
    this.pos = 0;
  }

  get offset(): number {
    return this.pos;
  }

  get length(): number {
    return this.view.byteLength;
  }

  get remaining(): number {
    return this.length - this.pos;
  }

  seek(offset: number): void {
    this.pos = offset;
  }

  skip(count: number): void {
    this.pos += count;
  }

  readUint8(): number {
    const val = this.view.getUint8(this.pos);
    this.pos += 1;
    return val;
  }

  readUint16LE(): number {
    const val = this.view.getUint16(this.pos, true);
    this.pos += 2;
    return val;
  }

  readUint32LE(): number {
    const val = this.view.getUint32(this.pos, true);
    this.pos += 4;
    return val;
  }

  readBytes(count: number): Uint8Array {
    const slice = this.bytes.slice(this.pos, this.pos + count);
    this.pos += count;
    return slice;
  }

  readString(length: number): string {
    const bytes = this.readBytes(length);
    return new TextDecoder().decode(bytes);
  }

  slice(offset: number, length: number): ArrayBuffer {
    return this.bytes.buffer.slice(offset, offset + length);
  }

  peekString(length: number): string {
    const bytes = this.bytes.slice(this.pos, this.pos + length);
    return new TextDecoder().decode(bytes);
  }
}

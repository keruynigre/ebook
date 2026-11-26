/**
 * A tiny zip writer that works one file at a time, so a big library can be
 * backed up without holding the whole archive in memory. Pure (no Expo), so
 * it can be tested with Node.
 */
import { deflateRaw } from 'pako';

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

export function crc32(data: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < data.length; i++) c = CRC_TABLE[(c ^ data[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/** Already-compressed files are stored as they are; squeezing them again only costs time. */
const STORED = /\.(jpe?g|png|webp|gif|mp3|m4a|aac|zip)$/i;

interface Entry {
  name: Uint8Array;
  crc: number;
  size: number;
  csize: number;
  method: number;
  offset: number;
}

function dosTime(d: Date): { time: number; date: number } {
  return {
    time: (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1),
    date: (Math.max(0, d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate(),
  };
}

/** Builds a zip as a sequence of byte chunks; `add` returns the chunk(s) to write for one file. */
export class ZipWriter {
  private entries: Entry[] = [];
  private offset = 0;
  private stamp = dosTime(new Date());

  /** Bytes written so far. */
  get size() {
    return this.offset;
  }

  add(path: string, data: Uint8Array, level = 1): Uint8Array[] {
    const name = new TextEncoder().encode(path);
    const store = STORED.test(path) || data.length < 64;
    const body = store ? data : deflateRaw(data, { level });
    const method = store ? 0 : 8;
    const e: Entry = { name, crc: crc32(data), size: data.length, csize: body.length, method, offset: this.offset };
    const h = new DataView(new ArrayBuffer(30));
    h.setUint32(0, 0x04034b50, true);
    h.setUint16(4, 20, true);
    h.setUint16(6, 0x0800, true); // names are UTF-8
    h.setUint16(8, method, true);
    h.setUint16(10, this.stamp.time, true);
    h.setUint16(12, this.stamp.date, true);
    h.setUint32(14, e.crc, true);
    h.setUint32(18, e.csize, true);
    h.setUint32(22, e.size, true);
    h.setUint16(26, name.length, true);
    h.setUint16(28, 0, true);
    this.entries.push(e);
    this.offset += 30 + name.length + body.length;
    return [new Uint8Array(h.buffer), name, body];
  }

  /** The central directory and end record; write these last. */
  finish(): Uint8Array {
    const dirSize = this.entries.reduce((a, e) => a + 46 + e.name.length, 0);
    const out = new Uint8Array(dirSize + 22);
    const v = new DataView(out.buffer);
    let p = 0;
    for (const e of this.entries) {
      v.setUint32(p, 0x02014b50, true);
      v.setUint16(p + 4, 20, true);
      v.setUint16(p + 6, 20, true);
      v.setUint16(p + 8, 0x0800, true);
      v.setUint16(p + 10, e.method, true);
      v.setUint16(p + 12, this.stamp.time, true);
      v.setUint16(p + 14, this.stamp.date, true);
      v.setUint32(p + 16, e.crc, true);
      v.setUint32(p + 20, e.csize, true);
      v.setUint32(p + 24, e.size, true);
      v.setUint16(p + 28, e.name.length, true);
      // extra, comment, disk, internal attrs, external attrs: 0
      v.setUint32(p + 42, e.offset, true);
      out.set(e.name, p + 46);
      p += 46 + e.name.length;
    }
    v.setUint32(p, 0x06054b50, true);
    v.setUint16(p + 8, this.entries.length, true);
    v.setUint16(p + 10, this.entries.length, true);
    v.setUint32(p + 12, dirSize, true);
    v.setUint32(p + 16, this.offset, true);
    return out;
  }
}

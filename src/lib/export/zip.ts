/**
 * Minimal ZIP writer (STORE only, no ZIP64) for bundling WAV stems. Audio
 * barely compresses with deflate, so storing keeps it fast and dependency free.
 */

export interface ZipEntry {
  name: string;
  data: Uint8Array;
}

let crcTable: Uint32Array | undefined;

function getCrcTable(): Uint32Array {
  if (crcTable) return crcTable;
  crcTable = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    crcTable[n] = c >>> 0;
  }
  return crcTable;
}

/** CRC-32 (IEEE 802.3), as used by ZIP and PNG. */
export function crc32(data: Uint8Array): number {
  const table = getCrcTable();
  let crc = 0xffffffff;
  for (let i = 0; i < data.length; i++) crc = table[(crc ^ data[i]) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

/** MS-DOS date/time as stored in ZIP headers (local time, 2 second resolution). */
function dosDateTime(date: Date): { time: number; date: number } {
  const year = Math.min(2107, Math.max(1980, date.getFullYear()));
  return {
    time: (date.getHours() << 11) | (date.getMinutes() << 5) | (date.getSeconds() >> 1),
    date: ((year - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate(),
  };
}

const LOCAL_HEADER = 0x04034b50;
const CENTRAL_HEADER = 0x02014b50;
const END_OF_CENTRAL_DIR = 0x06054b50;
const VERSION = 20; // 2.0
const FLAG_UTF8 = 0x0800;
const METHOD_STORE = 0;

export function createZip(files: ZipEntry[], date: Date = new Date()): Uint8Array<ArrayBuffer> {
  if (files.length > 0xffff) throw new RangeError('createZip: too many files (ZIP64 unsupported)');
  const encoder = new TextEncoder();
  const stamp = dosDateTime(date);
  const entries = files.map((file) => ({
    name: encoder.encode(file.name),
    data: file.data,
    crc: crc32(file.data),
    offset: 0,
  }));

  const localSize = entries.reduce((sum, e) => sum + 30 + e.name.length + e.data.length, 0);
  const centralSize = entries.reduce((sum, e) => sum + 46 + e.name.length, 0);
  const total = localSize + centralSize + 22;
  if (localSize + centralSize > 0xffffffff) {
    throw new RangeError('createZip: archive larger than 4 GB (ZIP64 unsupported)');
  }

  const bytes = new Uint8Array(total);
  const view = new DataView(bytes.buffer);
  let o = 0;

  const writeCommon = (e: (typeof entries)[number]) => {
    view.setUint16(o, VERSION, true);
    view.setUint16(o + 2, FLAG_UTF8, true);
    view.setUint16(o + 4, METHOD_STORE, true);
    view.setUint16(o + 6, stamp.time, true);
    view.setUint16(o + 8, stamp.date, true);
    view.setUint32(o + 10, e.crc, true);
    view.setUint32(o + 14, e.data.length, true); // compressed size
    view.setUint32(o + 18, e.data.length, true); // uncompressed size
    view.setUint16(o + 22, e.name.length, true);
    view.setUint16(o + 24, 0, true); // extra field length
    o += 26;
  };

  for (const e of entries) {
    e.offset = o;
    view.setUint32(o, LOCAL_HEADER, true);
    o += 4;
    writeCommon(e);
    bytes.set(e.name, o);
    o += e.name.length;
    bytes.set(e.data, o);
    o += e.data.length;
  }

  const centralOffset = o;
  for (const e of entries) {
    view.setUint32(o, CENTRAL_HEADER, true);
    view.setUint16(o + 4, VERSION, true); // version made by
    o += 6;
    writeCommon(e);
    view.setUint16(o, 0, true); // comment length
    view.setUint16(o + 2, 0, true); // disk number start
    view.setUint16(o + 4, 0, true); // internal attributes
    view.setUint32(o + 6, 0, true); // external attributes
    view.setUint32(o + 10, e.offset, true);
    o += 14;
    bytes.set(e.name, o);
    o += e.name.length;
  }

  view.setUint32(o, END_OF_CENTRAL_DIR, true);
  view.setUint16(o + 4, 0, true); // this disk
  view.setUint16(o + 6, 0, true); // disk with central directory
  view.setUint16(o + 8, entries.length, true);
  view.setUint16(o + 10, entries.length, true);
  view.setUint32(o + 12, centralSize, true);
  view.setUint32(o + 16, centralOffset, true);
  view.setUint16(o + 20, 0, true); // comment length
  return bytes;
}

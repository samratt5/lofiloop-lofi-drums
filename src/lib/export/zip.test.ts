import { describe, expect, it } from 'vitest';
import { crc32, createZip } from './zip';

const enc = new TextEncoder();

describe('crc32', () => {
  it('matches the standard check value', () => {
    expect(crc32(enc.encode('123456789'))).toBe(0xcbf43926);
    expect(crc32(new Uint8Array())).toBe(0);
  });
});

describe('createZip', () => {
  const files = [
    { name: 'drums.wav', data: enc.encode('kick kick snare') },
    { name: 'stems/keys é.wav', data: new Uint8Array([0, 1, 2, 255]) },
  ];
  const date = new Date(2024, 4, 17, 13, 45, 30);
  const zip = createZip(files, date);
  const v = new DataView(zip.buffer, zip.byteOffset, zip.byteLength);

  it('ends with an end-of-central-directory record', () => {
    const eocd = zip.length - 22;
    expect(v.getUint32(eocd, true)).toBe(0x06054b50);
    expect(v.getUint16(eocd + 8, true)).toBe(2);
    expect(v.getUint16(eocd + 10, true)).toBe(2);
    const cdSize = v.getUint32(eocd + 12, true);
    const cdOffset = v.getUint32(eocd + 16, true);
    expect(cdOffset + cdSize).toBe(eocd);
    expect(v.getUint32(cdOffset, true)).toBe(0x02014b50);
  });

  it('stores each file uncompressed with matching local and central headers', () => {
    const eocd = zip.length - 22;
    let cd = v.getUint32(eocd + 16, true);

    for (const file of files) {
      expect(v.getUint32(cd, true)).toBe(0x02014b50);
      expect(v.getUint16(cd + 8, true) & 0x0800).toBe(0x0800); // UTF-8 names
      expect(v.getUint16(cd + 10, true)).toBe(0); // STORE
      expect(v.getUint32(cd + 16, true)).toBe(crc32(file.data));
      const nameLen = v.getUint16(cd + 28, true);
      const name = new TextDecoder().decode(zip.subarray(cd + 46, cd + 46 + nameLen));
      expect(name).toBe(file.name);
      const local = v.getUint32(cd + 42, true);

      expect(v.getUint32(local, true)).toBe(0x04034b50);
      expect(v.getUint16(local + 6, true) & 0x0800).toBe(0x0800);
      expect(v.getUint16(local + 8, true)).toBe(0);
      expect(v.getUint32(local + 14, true)).toBe(crc32(file.data));
      expect(v.getUint32(local + 18, true)).toBe(file.data.length);
      expect(v.getUint32(local + 22, true)).toBe(file.data.length);
      expect(v.getUint16(local + 26, true)).toBe(nameLen);
      const start = local + 30 + nameLen + v.getUint16(local + 28, true);
      expect(Array.from(zip.subarray(start, start + file.data.length))).toEqual(Array.from(file.data));

      cd += 46 + nameLen + v.getUint16(cd + 30, true) + v.getUint16(cd + 32, true);
    }
  });

  it('encodes the modification time as MS-DOS date/time', () => {
    expect(v.getUint16(10, true)).toBe((13 << 11) | (45 << 5) | 15);
    expect(v.getUint16(12, true)).toBe(((2024 - 1980) << 9) | (5 << 5) | 17);
  });

  it('produces a valid empty archive', () => {
    const empty = createZip([]);
    expect(empty.length).toBe(22);
    expect(new DataView(empty.buffer).getUint32(0, true)).toBe(0x06054b50);
  });
});

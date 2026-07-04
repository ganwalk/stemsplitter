/* ============================================================
   StemSplitter — minimal client-side ZIP writer (STORE method, no
   compression). Good enough for bundling a handful of WAV files;
   avoids pulling in a compression library for what is already
   incompressible PCM data.
   ============================================================ */

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(bytes) {
  let crc = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) {
    crc = CRC_TABLE[(crc ^ bytes[i]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function writeStr(view, offset, str) {
  for (let i = 0; i < str.length; i++) view.setUint8(offset + i, str.charCodeAt(i));
  return offset + str.length;
}

/** Build a .zip Blob (STORE/no compression) from [{name, blob}] entries. */
export async function makeZip(entries) {
  const parts = [];
  const central = [];
  let offset = 0;

  for (const { name, blob } of entries) {
    const data = new Uint8Array(await blob.arrayBuffer());
    const crc = crc32(data);
    const nameBytes = name.length;

    const lfh = new ArrayBuffer(30 + nameBytes);
    const lv = new DataView(lfh);
    lv.setUint32(0, 0x04034b50, true);
    lv.setUint16(4, 20, true);      // version needed
    lv.setUint16(6, 0, true);       // flags
    lv.setUint16(8, 0, true);       // method: store
    lv.setUint16(10, 0, true);      // mod time
    lv.setUint16(12, 0x21, true);   // mod date (arbitrary valid date)
    lv.setUint32(14, crc, true);
    lv.setUint32(18, data.length, true); // compressed size
    lv.setUint32(22, data.length, true); // uncompressed size
    lv.setUint16(26, nameBytes, true);
    lv.setUint16(28, 0, true);      // extra field length
    writeStr(lv, 30, name);

    parts.push(new Uint8Array(lfh), data);

    central.push({ name, crc, size: data.length, offset });
    offset += lfh.byteLength + data.length;
  }

  const cdStart = offset;
  for (const e of central) {
    const nameBytes = e.name.length;
    const cdh = new ArrayBuffer(46 + nameBytes);
    const cv = new DataView(cdh);
    cv.setUint32(0, 0x02014b50, true);
    cv.setUint16(4, 20, true);   // version made by
    cv.setUint16(6, 20, true);   // version needed
    cv.setUint16(8, 0, true);    // flags
    cv.setUint16(10, 0, true);   // method: store
    cv.setUint16(12, 0, true);   // mod time
    cv.setUint16(14, 0x21, true); // mod date
    cv.setUint32(16, e.crc, true);
    cv.setUint32(20, e.size, true);
    cv.setUint32(24, e.size, true);
    cv.setUint16(28, nameBytes, true);
    cv.setUint16(30, 0, true);   // extra length
    cv.setUint16(32, 0, true);   // comment length
    cv.setUint16(34, 0, true);   // disk number start
    cv.setUint16(36, 0, true);   // internal attrs
    cv.setUint32(38, 0, true);   // external attrs
    cv.setUint32(42, e.offset, true);
    writeStr(cv, 46, e.name);
    parts.push(new Uint8Array(cdh));
    offset += cdh.byteLength;
  }
  const cdSize = offset - cdStart;

  const eocd = new ArrayBuffer(22);
  const ev = new DataView(eocd);
  ev.setUint32(0, 0x06054b50, true);
  ev.setUint16(4, 0, true);
  ev.setUint16(6, 0, true);
  ev.setUint16(8, central.length, true);
  ev.setUint16(10, central.length, true);
  ev.setUint32(12, cdSize, true);
  ev.setUint32(16, cdStart, true);
  ev.setUint16(20, 0, true);
  parts.push(new Uint8Array(eocd));

  return new Blob(parts, { type: "application/zip" });
}

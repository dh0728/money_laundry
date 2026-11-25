export function printWorkspace(workspace) {
  const scrollAreas = new Set();
  for (const element of workspace.querySelectorAll('*')) {
    if (!(element instanceof HTMLElement)) continue;
    const { overflowX, overflowY } = getComputedStyle(element);
    if ([overflowX, overflowY].every(overflow => overflow !== 'auto' && overflow !== 'scroll')) continue;
    // A bounded parent can otherwise keep a now-visible scroller at screen height.
    for (let current = element; current !== workspace; current = current.parentElement) scrollAreas.add(current);
  }
  const finish = () => {
    window.removeEventListener('afterprint', finish);
    workspace.removeAttribute('data-page-print');
    scrollAreas.forEach(element => element.removeAttribute('data-page-print-scroll'));
  };
  scrollAreas.forEach(element => element.setAttribute('data-page-print-scroll', ''));
  workspace.setAttribute('data-page-print', '');
  window.addEventListener('afterprint', finish, { once: true });
  try {
    window.print();
  } catch (error) {
    finish();
    throw error;
  }
}

const crcTable = Uint32Array.from({ length: 256 }, (_, index) => {
  let value = index;
  for (let bit = 0; bit < 8; bit++) value = (value >>> 1) ^ (value & 1 ? 0xedb88320 : 0);
  return value;
});

function crc32(bytes) {
  let checksum = 0xffffffff;
  for (const byte of bytes) checksum = crcTable[(checksum ^ byte) & 0xff] ^ (checksum >>> 8);
  return (checksum ^ 0xffffffff) >>> 0;
}

function zipRecord(size, signature) {
  const buffer = new DataView(new ArrayBuffer(size));
  buffer.setUint32(0, signature, true);
  return buffer;
}

// Store UTF-8 CSV files without compressing their data. ZIP headers follow PKWARE APPNOTE §4.3.
export function createPageCsvZip(files) {
  const encoder = new TextEncoder();
  const names = new Set();
  const exported = new Map();
  const entries = [];
  const directory = [];
  let entrySize = 0;
  let directorySize = 0;

  for (const { filename, content } of files) {
    const stem = filename.replace(/[\\/:*?"<>|]/g, '-').replace(/\.csv$/i, '');
    const key = stem.toLowerCase();
    if (!exported.has(key)) exported.set(key, new Set());
    if (exported.get(key).has(content)) continue;
    exported.get(key).add(content);

    let name = `${stem}.csv`;
    for (let suffix = 2; names.has(name.toLowerCase()); suffix++) name = `${stem}-${suffix}.csv`;
    names.add(name.toLowerCase());
    const encodedName = encoder.encode(name);
    const bytes = encoder.encode(content);
    const local = zipRecord(30, 0x04034b50);
    const central = zipRecord(46, 0x02014b50);
    if (names.size >= 0xffff || encodedName.length > 0xffff
      || entrySize + directorySize + local.byteLength + central.byteLength + 2 * encodedName.length + bytes.length >= 0xffffffff) {
      throw new Error('페이지의 CSV 파일 묶음이 너무 큽니다. 필요한 표만 개별 다운로드해 주세요.');
    }

    local.setUint16(4, 20, true);
    local.setUint16(6, 0x0800, true); // UTF-8 file names.
    local.setUint16(12, 0x0021, true); // ZIP calendar epoch, 1980-01-01.
    local.setUint32(14, crc32(bytes), true);
    local.setUint32(18, bytes.length, true);
    local.setUint32(22, bytes.length, true);
    local.setUint16(26, encodedName.length, true);

    central.setUint16(4, 20, true);
    new Uint8Array(central.buffer).set(new Uint8Array(local.buffer, 4), 6);
    central.setUint32(42, entrySize, true);
    entries.push(local.buffer, encodedName, bytes);
    directory.push(central.buffer, encodedName);
    entrySize += local.byteLength + encodedName.length + bytes.length;
    directorySize += central.byteLength + encodedName.length;
  }

  const end = zipRecord(22, 0x06054b50);
  end.setUint16(8, names.size, true);
  end.setUint16(10, names.size, true);
  end.setUint32(12, directorySize, true);
  end.setUint32(16, entrySize, true);
  return new Blob([...entries, ...directory, end.buffer], { type: 'application/zip' });
}

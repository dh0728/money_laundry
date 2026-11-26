import { crc32 } from 'node:zlib';
import { expect, test } from 'vitest';
import { createPageCsvZip } from './page-export';

test('packages distinct versions of one CSV with unique names and keeps their UTF-8 data', async () => {
  const archive = createPageCsvZip([
    { filename: '룰.csv', content: '조건\r\n첫 거래\r\n' },
    { filename: '룰.csv', content: '조건\r\n첫 거래\r\n' },
    { filename: '룰.csv', content: '조건\r\n반복 거래\r\n' },
  ]);
  expect(archive.type).toBe('application/zip');
  const contents = await new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error);
    reader.readAsArrayBuffer(archive);
  });
  const bytes = Buffer.from(contents);
  const end = bytes.length - 22;
  expect(bytes.readUInt32LE(end)).toBe(0x06054b50);
  expect(bytes.readUInt16LE(end + 10)).toBe(2);

  let directory = bytes.readUInt32LE(end + 16);
  const files = [];
  for (let file = 0; file < 2; file++) {
    expect(bytes.readUInt32LE(directory)).toBe(0x02014b50);
    expect(bytes.readUInt16LE(directory + 8)).toBe(0x0800);
    const local = bytes.readUInt32LE(directory + 42);
    expect(bytes.readUInt32LE(local)).toBe(0x04034b50);
    const nameLength = bytes.readUInt16LE(local + 26);
    const nameEnd = local + 30 + nameLength;
    const contents = bytes.subarray(nameEnd, nameEnd + bytes.readUInt32LE(local + 18));
    expect(bytes.readUInt32LE(local + 14)).toBe(crc32(contents));
    files.push([bytes.toString('utf8', local + 30, nameEnd), contents.toString()]);
    directory += 46 + nameLength;
  }
  expect(files).toEqual([['룰.csv', '조건\r\n첫 거래\r\n'], ['룰-2.csv', '조건\r\n반복 거래\r\n']]);
});

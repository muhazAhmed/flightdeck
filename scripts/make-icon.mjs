/**
 * Wrap the logo PNGs in an `.ico`, for the Windows shortcut.
 *
 * A `.lnk` icon must be an `.ico`; a PNG is ignored. Since Vista an ICO entry may hold PNG bytes verbatim, so this
 * needs no image encoding at all — just the 6-byte header, one 16-byte directory entry per size, and the PNG files
 * appended. No dependency, and nothing is re-encoded, so the icon is exactly the artwork that is already committed.
 *
 * Run by `make-shortcut.mjs`; also available as `npm run icon`.
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

const root = fileURLToPath(new URL('..', import.meta.url));
const publicDir = join(root, 'public');

/**
 * Sizes to include, largest last.
 *
 * Windows picks per context: 32 in a list, 64 on the taskbar, 180 where it wants something big. A 256 entry would be
 * ideal but the source is 512 and downscaling it here would mean re-encoding, which this file exists to avoid.
 */
const SOURCES = [
  { file: 'favicon.png', size: 32 },
  { file: 'logo-64.png', size: 64 },
  { file: 'apple-touch-icon.png', size: 180 }
];

const entries = [];
for (const { file, size } of SOURCES) {
  const path = join(publicDir, file);
  if (!existsSync(path)) {
    console.warn(`skipping ${file} — not found`);
    continue;
  }
  entries.push({ size, data: readFileSync(path) });
}

if (entries.length === 0) {
  console.error('No logo PNGs found in public/. Nothing to build.');
  process.exit(1);
}

const HEADER = 6;
const DIRECTORY_ENTRY = 16;
const header = Buffer.alloc(HEADER);
header.writeUInt16LE(0, 0); // reserved
header.writeUInt16LE(1, 2); // 1 = icon
header.writeUInt16LE(entries.length, 4);

const directory = Buffer.alloc(DIRECTORY_ENTRY * entries.length);
let offset = HEADER + directory.length;

entries.forEach((entry, index) => {
  const at = index * DIRECTORY_ENTRY;
  // 0 means 256 in this field, which is the only reason it is a single byte.
  directory[at] = entry.size >= 256 ? 0 : entry.size;
  directory[at + 1] = entry.size >= 256 ? 0 : entry.size;
  directory[at + 2] = 0; // palette size: 0 for truecolour
  directory[at + 3] = 0; // reserved
  directory.writeUInt16LE(1, at + 4); // colour planes
  directory.writeUInt16LE(32, at + 6); // bits per pixel
  directory.writeUInt32LE(entry.data.length, at + 8);
  directory.writeUInt32LE(offset, at + 12);
  offset += entry.data.length;
});

const ico = Buffer.concat([header, directory, ...entries.map((entry) => entry.data)]);
const out = join(publicDir, 'favicon.ico');
writeFileSync(out, ico);

console.log(`${out}: ${entries.map((entry) => entry.size).join(', ')} px, ${(ico.length / 1024).toFixed(1)} kB`);

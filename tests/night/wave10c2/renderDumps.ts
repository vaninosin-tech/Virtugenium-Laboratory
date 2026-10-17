import { readFileSync, readdirSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { deflateSync } from "node:zlib";
import { renderSilverDump, type SilverFineDump, type SilverOpticsMode } from "../../../src/scenes/laboratory/lib/night/render/silverOpticsReference";

const input = "docs/night/wave10shared", output = "docs/night/wave10c2";
mkdirSync(output, { recursive: true });
const names = readdirSync(input).filter(x => /^field_state_\d+ms\.json$/.test(x))
  .sort((a, b) => Number(a.match(/\d+/)![0]) - Number(b.match(/\d+/)![0]));
const panels: Uint8Array[][] = [[], [], [], []];
const width = 80, height = 200;
for (const name of names) {
  const data = JSON.parse(readFileSync(join(input, name), "utf8")) as SilverFineDump;
  const stamp = name.match(/\d+ms/)![0];
  for (const mode of [0, 1, 2, 3] as SilverOpticsMode[]) {
    const ppm = renderSilverDump(data, mode, width, height);
    writeFileSync(join(output, `${stamp}-mode${mode}.ppm`), ppm);
    panels[mode].push(ppm.slice(ppm.indexOf(10, ppm.indexOf(10, ppm.indexOf(10) + 1) + 1) + 1));
  }
  console.log(stamp, "four modes rendered");
}

function crc32(bytes: Uint8Array): number {
  let crc = -1;
  for (const byte of bytes) {
    crc ^= byte;
    for (let i = 0; i < 8; i++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
  }
  return (crc ^ -1) >>> 0;
}
function chunk(type: string, data: Uint8Array): Buffer {
  const name = Buffer.from(type), size = Buffer.alloc(4), check = Buffer.alloc(4);
  size.writeUInt32BE(data.length); check.writeUInt32BE(crc32(Buffer.concat([name, data])));
  return Buffer.concat([size, name, data, check]);
}
for (let mode = 0; mode < 4; mode++) {
  const sheetWidth = width * names.length;
  const pixels = Buffer.alloc(sheetWidth * height * 3);
  for (let panel = 0; panel < names.length; panel++) for (let y = 0; y < height; y++)
    pixels.set(panels[mode][panel].slice(y * width * 3, (y + 1) * width * 3),
      (y * sheetWidth + panel * width) * 3);
  const ppmHeader = Buffer.from(`P6\n${sheetWidth} ${height}\n255\n`);
  writeFileSync(join(output, `sheet-mode${mode}.ppm`), Buffer.concat([ppmHeader, pixels]));
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(sheetWidth, 0); ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; ihdr[9] = 2;
  const rows = Buffer.alloc(height * (sheetWidth * 3 + 1));
  for (let y = 0; y < height; y++) pixels.copy(rows, y * (sheetWidth * 3 + 1) + 1,
    y * sheetWidth * 3, (y + 1) * sheetWidth * 3);
  writeFileSync(join(output, `sheet-mode${mode}.png`), Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(rows)), chunk("IEND", Buffer.alloc(0)),
  ]));
}

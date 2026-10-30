// Packs integrations/harvey into public/downloads/gexart-harvey-windows.zip (served by the CRM).
// Run after changing the app: node scripts/harvey-kit.mjs
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { crc32, deflateRawSync } from "node:zlib";

const FILES = ["Gexart Harvey.cmd", "GexartHarvey.ps1", "Install Harvey.cmd", "Install-Harvey.ps1", "crm_sync.py", "harvey_config.py", "gexart.ico", "gexart-mark.png", "README.md"];
const ROOT = "Gexart Harvey/";
const local = [];
const central = [];
let offset = 0;
// Fixed timestamp so rebuilding unchanged files gives an identical zip.
const DOS_TIME = 0, DOS_DATE = ((2026 - 1980) << 9) | (11 << 5) | 1;

for (const f of FILES) {
  const data = readFileSync(`integrations/harvey/${f}`);
  const packed = deflateRawSync(data, { level: 9 });
  const name = Buffer.from(ROOT + f, "utf8");
  const crc = crc32(data) >>> 0;
  const h = Buffer.alloc(30);
  h.writeUInt32LE(0x04034b50, 0); h.writeUInt16LE(20, 4); h.writeUInt16LE(0x0800, 6); h.writeUInt16LE(8, 8);
  h.writeUInt16LE(DOS_TIME, 10); h.writeUInt16LE(DOS_DATE, 12); h.writeUInt32LE(crc, 14);
  h.writeUInt32LE(packed.length, 18); h.writeUInt32LE(data.length, 22); h.writeUInt16LE(name.length, 26); h.writeUInt16LE(0, 28);
  local.push(h, name, packed);
  const c = Buffer.alloc(46);
  c.writeUInt32LE(0x02014b50, 0); c.writeUInt16LE(20, 4); c.writeUInt16LE(20, 6); c.writeUInt16LE(0x0800, 8); c.writeUInt16LE(8, 10);
  c.writeUInt16LE(DOS_TIME, 12); c.writeUInt16LE(DOS_DATE, 14); c.writeUInt32LE(crc, 16); c.writeUInt32LE(packed.length, 20);
  c.writeUInt32LE(data.length, 24); c.writeUInt16LE(name.length, 28); c.writeUInt32LE(offset, 42);
  central.push(c, name);
  offset += h.length + name.length + packed.length;
}
const cd = Buffer.concat(central);
const end = Buffer.alloc(22);
end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(FILES.length, 8); end.writeUInt16LE(FILES.length, 10);
end.writeUInt32LE(cd.length, 12); end.writeUInt32LE(offset, 16);
mkdirSync("public/downloads", { recursive: true });
writeFileSync("public/downloads/gexart-harvey-windows.zip", Buffer.concat([...local, cd, end]));
console.log(`public/downloads/gexart-harvey-windows.zip (${FILES.length} files)`);

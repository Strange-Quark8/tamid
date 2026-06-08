// Generates the Tamid pixel-coin app icons (no external deps — pure Node + zlib).
// Run: node scripts/generate-icons.cjs
const fs = require("fs");
const path = require("path");
const zlib = require("zlib");

// ── coin pixel-map (must match the in-app PixelCoin component) ──
const N = 21;
function coinMap(N, { outline = "K", rInFactor = 0.62 } = {}) {
  const c = (N - 1) / 2;
  const R = N / 2 - 0.6;
  const rIn = R * rInFactor;
  const grid = [];
  for (let y = 0; y < N; y++) {
    let row = "";
    for (let x = 0; x < N; x++) {
      const dx = x - c, dy = y - c, d = Math.hypot(dx, dy);
      if (d > R) { row += "."; continue; }
      if (R - d < 1.0) { row += outline; continue; }
      if (Math.abs(d - rIn) < 0.55) { row += "D"; continue; }
      if (R - d < 2.1) {
        if (dx < 0 && dy < 0) { row += "L"; continue; }
        if (dx > 0 && dy > 0) { row += "S"; continue; }
      }
      row += "G";
    }
    grid.push(row);
  }
  const g = Math.round(c - R * 0.42);
  const set = (x, y) => { const r = grid[y].split(""); if (r[x] !== "." && r[x] !== outline) { r[x] = "L"; grid[y] = r.join(""); } };
  set(g, g); set(g + 1, g); set(g, g + 1);
  return grid;
}

const COL = { K: [17, 17, 17], D: [110, 78, 15], G: [255, 204, 42], L: [255, 233, 138], S: [217, 154, 31] };
const BEIGE = [244, 237, 224];
const MAP = coinMap(N);

function buildRGBA(size) {
  const cell = Math.floor((size * 0.76) / N);
  const coin = N * cell;
  const off = Math.floor((size - coin) / 2);
  const buf = Buffer.alloc(size * size * 4);
  for (let i = 0; i < size * size; i++) { buf[i * 4] = BEIGE[0]; buf[i * 4 + 1] = BEIGE[1]; buf[i * 4 + 2] = BEIGE[2]; buf[i * 4 + 3] = 255; }
  for (let cy = 0; cy < N; cy++) for (let cx = 0; cx < N; cx++) {
    const ch = MAP[cy][cx]; if (ch === ".") continue;
    const col = COL[ch];
    for (let yy = 0; yy < cell; yy++) for (let xx = 0; xx < cell; xx++) {
      const px = off + cx * cell + xx, py = off + cy * cell + yy, idx = (py * size + px) * 4;
      buf[idx] = col[0]; buf[idx + 1] = col[1]; buf[idx + 2] = col[2]; buf[idx + 3] = 255;
    }
  }
  return buf;
}

// ── minimal PNG encoder ──
const CRC = (() => { const t = []; for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
function crc32(buf) { let c = 0xffffffff; for (let i = 0; i < buf.length; i++) c = CRC[(c ^ buf[i]) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; }
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length, 0);
  const tb = Buffer.from(type, "ascii");
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(Buffer.concat([tb, data])), 0);
  return Buffer.concat([len, tb, data, crc]);
}
function encodePNG(size, rgba) {
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4); ihdr[8] = 8; ihdr[9] = 6;
  const raw = Buffer.alloc(size * (1 + size * 4));
  for (let y = 0; y < size; y++) { raw[y * (1 + size * 4)] = 0; rgba.copy(raw, y * (1 + size * 4) + 1, y * size * 4, (y + 1) * size * 4); }
  const idat = zlib.deflateSync(raw, { level: 9 });
  return Buffer.concat([sig, chunk("IHDR", ihdr), chunk("IDAT", idat), chunk("IEND", Buffer.alloc(0))]);
}

const out = path.join(__dirname, "..", "public");
const targets = [["icon-512.png", 512], ["icon-192.png", 192], ["apple-touch-icon.png", 180]];
for (const [name, size] of targets) {
  fs.writeFileSync(path.join(out, name), encodePNG(size, buildRGBA(size)));
  console.log(`wrote public/${name} (${size}x${size})`);
}

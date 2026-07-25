#!/usr/bin/env node
/**
 * gen-icons.mjs — the PWA / home-screen icon set from the same identity as
 * public/favicon.svg: a winding dark road down a warm paper page, with three
 * bright waypoints. No native deps (sharp/canvas break CI): this plots pixels
 * into an RGBA buffer and emits the PNG itself. Deterministic across machines.
 *
 *   node scripts/gen-icons.mjs
 *
 * Outputs (public/icons/): icon-192.png, icon-512.png (any-purpose, transparent
 * corners), icon-512-maskable.png (art in the centre-80% safe zone, bg to every
 * edge), apple-touch-icon.png (180x180, FULLY OPAQUE — iOS composites on black).
 */

import { deflateSync } from 'node:zlib';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const OUT_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'public', 'icons');

// palette — must match public/favicon.svg AND src/palette.ts
const PAPER = [0xef, 0xe3, 0xc8];
const ROAD = [0x26, 0x22, 0x1b];
const SEA = [0x5b, 0xb8, 0xe6];
const MARKET = [0xf4, 0xc0, 0x20];
const INN = [0xff, 0x8a, 0x5c];

// ── PNG encoding ────────────────────────────────────────────────────────────
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();
function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body), 0);
  return Buffer.concat([len, body, crc]);
}
function encodePng(rgba, size) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  const stride = size * 4;
  const raw = Buffer.alloc((stride + 1) * size);
  for (let y = 0; y < size; y++) {
    raw[y * (stride + 1)] = 0;
    rgba.copy(raw, y * (stride + 1) + 1, y * stride, y * stride + stride);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

// ── drawing (authored in 64x64 space, sampled per pixel, AA via SDF) ─────────
const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);

function sdRoundRect(px, py, x, y, w, h, r) {
  const cx = x + w / 2;
  const cy = y + h / 2;
  const qx = Math.abs(px - cx) - (w / 2 - r);
  const qy = Math.abs(py - cy) - (h / 2 - r);
  const ax = Math.max(qx, 0);
  const ay = Math.max(qy, 0);
  return Math.sqrt(ax * ax + ay * ay) + Math.min(Math.max(qx, qy), 0) - r;
}

/** The winding road as a polyline in 64-space, top to bottom. */
const PATH = [];
for (let k = 0; k <= 40; k++) {
  const t = k / 40;
  PATH.push([32 + 13 * Math.sin(t * Math.PI * 1.5), 8 + t * 48]);
}
const WAYPOINTS = [
  [0.1, SEA],
  [0.5, MARKET],
  [0.88, INN],
];

function sdPolyline(px, py) {
  let best = Infinity;
  for (let i = 1; i < PATH.length; i++) {
    const [ax, ay] = PATH[i - 1];
    const [bx, by] = PATH[i];
    const dx = bx - ax;
    const dy = by - ay;
    const t = clamp01(((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy));
    const qx = ax + t * dx - px;
    const qy = ay + t * dy - py;
    best = Math.min(best, Math.hypot(qx, qy));
  }
  return best;
}

function makeCanvas(size) {
  const buf = Buffer.alloc(size * size * 4);
  return {
    size,
    buf,
    blend(i, [r, g, b], a) {
      if (a <= 0) return;
      const dr = buf[i];
      const dg = buf[i + 1];
      const db = buf[i + 2];
      const da = buf[i + 3] / 255;
      const outA = a + da * (1 - a);
      if (outA <= 0) return;
      buf[i] = Math.round((r * a + dr * da * (1 - a)) / outA);
      buf[i + 1] = Math.round((g * a + dg * da * (1 - a)) / outA);
      buf[i + 2] = Math.round((b * a + db * da * (1 - a)) / outA);
      buf[i + 3] = Math.round(outA * 255);
    },
  };
}

function render(size, opts = {}) {
  const { maskable = false, opaque = false } = opts;
  const canvas = makeCanvas(size);
  const scale = maskable ? 0.76 : 1;
  const toArt = (p) => (((p + 0.5) / size - 0.5) * 64) / scale + 32;
  const pxPerUnit = (size * scale) / 64;
  const cover = (d) => clamp01(0.5 - d * pxPerUnit);
  const bleed = maskable || opaque;

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = (y * size + x) * 4;
      const u = toArt(x);
      const v = toArt(y);

      // 1. Paper page.
      if (bleed) canvas.blend(i, PAPER, 1);
      else canvas.blend(i, PAPER, cover(sdRoundRect(u, v, 0, 0, 64, 64, 14)));

      // 2. The road (a thick dark stroke), clipped to the tile.
      const clip = bleed ? -1 : sdRoundRect(u, v, 0, 0, 64, 64, 14);
      if (clip < 0.5) {
        canvas.blend(i, ROAD, cover(sdPolyline(u, v) - 4.4) * (bleed ? 1 : cover(clip)));
      }

      // 3. Three bright waypoints along the road.
      for (const [t, col] of WAYPOINTS) {
        const [wx, wy] = PATH[Math.round(t * (PATH.length - 1))];
        const d = Math.hypot(u - wx, v - wy);
        canvas.blend(i, ROAD, cover(d - 5.4)); // dark rim
        canvas.blend(i, col, cover(d - 4.0));
      }
    }
  }
  return encodePng(canvas.buf, size);
}

mkdirSync(OUT_DIR, { recursive: true });
const jobs = [
  ['icon-192.png', 192, {}],
  ['icon-512.png', 512, {}],
  ['icon-512-maskable.png', 512, { maskable: true }],
  ['apple-touch-icon.png', 180, { opaque: true }],
];
for (const [name, size, opts] of jobs) {
  writeFileSync(join(OUT_DIR, name), render(size, opts));
  // eslint-disable-next-line no-console
  console.log(`wrote ${name} (${size}x${size})`);
}

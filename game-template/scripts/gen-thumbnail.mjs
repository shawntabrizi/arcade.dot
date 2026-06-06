// SPEC §10.3 step 3 / §6.4: generate a simple 640×360 (16:9) PNG thumbnail for
// the Snake game — no native deps, pure Node (zlib for the PNG stream). Writes
// to arcade.config.json's "thumbnail" path. Re-run to regenerate; an agent
// building a real game would replace this with its own art.

import { deflateSync } from "node:zlib";
import { writeFileSync, mkdirSync } from "node:fs";
import { resolve, dirname } from "node:path";

import { CONFIG_PATH } from "./lib/chain.mjs";
import { loadConfig } from "./lib/config.mjs";

const W = 640;
const H = 360;
const GRID = 20; // cell size — board is 32×18 cells

function crc32(buf) {
  let c = ~0;
  for (let i = 0; i < buf.length; i++) {
    c ^= buf[i];
    for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
  }
  return (~c) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const typeBuf = Buffer.from(type, "ascii");
  const body = Buffer.concat([typeBuf, data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body), 0);
  return Buffer.concat([len, body, crc]);
}

function encodePng(rgba, width, height) {
  // Add a filter byte (0 = none) at the start of each scanline.
  const stride = width * 4;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (stride + 1)] = 0;
    rgba.copy(raw, y * (stride + 1) + 1, y * stride, y * stride + stride);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // color type RGBA
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  return Buffer.concat([
    sig,
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

function makeImage() {
  const buf = Buffer.alloc(W * H * 4);
  const px = (x, y, r, g, b) => {
    if (x < 0 || y < 0 || x >= W || y >= H) return;
    const i = (y * W + x) * 4;
    buf[i] = r;
    buf[i + 1] = g;
    buf[i + 2] = b;
    buf[i + 3] = 255;
  };

  // Dark Polkadot-ish background with a subtle vertical gradient.
  for (let y = 0; y < H; y++) {
    const t = y / H;
    const r = Math.round(16 + 10 * t);
    const g = Math.round(14 + 6 * t);
    const b = Math.round(22 + 14 * t);
    for (let x = 0; x < W; x++) px(x, y, r, g, b);
  }

  // Faint grid.
  for (let y = 0; y < H; y += GRID) for (let x = 0; x < W; x++) px(x, y, 30, 28, 40);
  for (let x = 0; x < W; x += GRID) for (let y = 0; y < H; y++) px(x, y, 30, 28, 40);

  const cell = (cx, cy, r, g, b) => {
    for (let dy = 2; dy < GRID - 1; dy++)
      for (let dx = 2; dx < GRID - 1; dx++) px(cx * GRID + dx, cy * GRID + dy, r, g, b);
  };

  // A snake: a path of body segments (Polkadot pink) and a head, plus an apple.
  const body = [
    [6, 9], [7, 9], [8, 9], [9, 9], [10, 9], [11, 9], [11, 8], [11, 7],
    [12, 7], [13, 7], [14, 7], [15, 7], [16, 7], [17, 7], [18, 7], [18, 8], [18, 9],
  ];
  body.forEach(([cx, cy], i) => {
    const t = i / body.length;
    cell(cx, cy, Math.round(230 - 40 * t), Math.round(0 + 30 * t), Math.round(122 - 20 * t));
  });
  const [hx, hy] = body[body.length - 1];
  cell(hx, hy + 1, 255, 60, 150); // head, just below the last segment
  // apple
  cell(24, 5, 80, 220, 120);

  return buf;
}

const { config } = loadConfig(CONFIG_PATH);
const out = resolve(dirname(CONFIG_PATH), config.thumbnail);
mkdirSync(dirname(out), { recursive: true });
const png = encodePng(makeImage(), W, H);
writeFileSync(out, png);
console.log(`Wrote ${out} (${W}×${H}, ${(png.length / 1024).toFixed(1)} KiB)`);

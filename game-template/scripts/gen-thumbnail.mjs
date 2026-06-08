// SPEC §10.3 step 3 / §6.4: generate a UNIQUE per-game 640×360 (16:9) PNG
// thumbnail derived from arcade.config.json — no native deps, pure Node (zlib
// for the PNG stream). The background hue is seeded from config.name and the
// game name is rendered as large centered text (with config.gameType as a small
// subtitle), so distinct games produce visibly distinct images → distinct CIDs.
// Snake is special-cased to keep its hand-drawn art. Writes to config.thumbnail;
// re-run to regenerate. An agent building a real game may replace this with its
// own art.

import { deflateSync } from "node:zlib";
import { writeFileSync, mkdirSync } from "node:fs";
import { resolve, dirname } from "node:path";

import { CONFIG_PATH } from "./lib/chain.mjs";
import { loadConfig } from "./lib/config.mjs";

const W = 640;
const H = 360;
const GRID = 20; // Snake board: cell size — board is 32×18 cells

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

// ---------------------------------------------------------------------------
// A tiny canvas helper shared by both render paths.
// ---------------------------------------------------------------------------
function newCanvas() {
  const buf = Buffer.alloc(W * H * 4);
  const px = (x, y, r, g, b) => {
    x |= 0;
    y |= 0;
    if (x < 0 || y < 0 || x >= W || y >= H) return;
    const i = (y * W + x) * 4;
    buf[i] = r;
    buf[i + 1] = g;
    buf[i + 2] = b;
    buf[i + 3] = 255;
  };
  return { buf, px };
}

// ---------------------------------------------------------------------------
// 5×7 bitmap font: A–Z, 0–9, space, hyphen. Each glyph is 7 strings of 5 chars
// ("#"=on). Names are uppercased; unknown chars render as a blank cell.
// ---------------------------------------------------------------------------
const FONT = {
  A: ["01110", "10001", "10001", "11111", "10001", "10001", "10001"],
  B: ["11110", "10001", "10001", "11110", "10001", "10001", "11110"],
  C: ["01110", "10001", "10000", "10000", "10000", "10001", "01110"],
  D: ["11100", "10010", "10001", "10001", "10001", "10010", "11100"],
  E: ["11111", "10000", "10000", "11110", "10000", "10000", "11111"],
  F: ["11111", "10000", "10000", "11110", "10000", "10000", "10000"],
  G: ["01110", "10001", "10000", "10111", "10001", "10001", "01111"],
  H: ["10001", "10001", "10001", "11111", "10001", "10001", "10001"],
  I: ["01110", "00100", "00100", "00100", "00100", "00100", "01110"],
  J: ["00111", "00010", "00010", "00010", "00010", "10010", "01100"],
  K: ["10001", "10010", "10100", "11000", "10100", "10010", "10001"],
  L: ["10000", "10000", "10000", "10000", "10000", "10000", "11111"],
  M: ["10001", "11011", "10101", "10101", "10001", "10001", "10001"],
  N: ["10001", "11001", "10101", "10011", "10001", "10001", "10001"],
  O: ["01110", "10001", "10001", "10001", "10001", "10001", "01110"],
  P: ["11110", "10001", "10001", "11110", "10000", "10000", "10000"],
  Q: ["01110", "10001", "10001", "10001", "10101", "10010", "01101"],
  R: ["11110", "10001", "10001", "11110", "10100", "10010", "10001"],
  S: ["01111", "10000", "10000", "01110", "00001", "00001", "11110"],
  T: ["11111", "00100", "00100", "00100", "00100", "00100", "00100"],
  U: ["10001", "10001", "10001", "10001", "10001", "10001", "01110"],
  V: ["10001", "10001", "10001", "10001", "10001", "01010", "00100"],
  W: ["10001", "10001", "10001", "10101", "10101", "11011", "10001"],
  X: ["10001", "10001", "01010", "00100", "01010", "10001", "10001"],
  Y: ["10001", "10001", "01010", "00100", "00100", "00100", "00100"],
  Z: ["11111", "00001", "00010", "00100", "01000", "10000", "11111"],
  0: ["01110", "10001", "10011", "10101", "11001", "10001", "01110"],
  1: ["00100", "01100", "00100", "00100", "00100", "00100", "01110"],
  2: ["01110", "10001", "00001", "00110", "01000", "10000", "11111"],
  3: ["11110", "00001", "00001", "01110", "00001", "00001", "11110"],
  4: ["00010", "00110", "01010", "10010", "11111", "00010", "00010"],
  5: ["11111", "10000", "11110", "00001", "00001", "10001", "01110"],
  6: ["00110", "01000", "10000", "11110", "10001", "10001", "01110"],
  7: ["11111", "00001", "00010", "00100", "01000", "01000", "01000"],
  8: ["01110", "10001", "10001", "01110", "10001", "10001", "01110"],
  9: ["01110", "10001", "10001", "01111", "00001", "00010", "01100"],
  "-": ["00000", "00000", "00000", "11111", "00000", "00000", "00000"],
  " ": ["00000", "00000", "00000", "00000", "00000", "00000", "00000"],
};
const GLYPH_W = 5;
const GLYPH_H = 7;

// Sanitize to the supported charset; collapse runs of unsupported chars to a
// single space so the result stays legible.
function normalizeText(s) {
  return s
    .toUpperCase()
    .split("")
    .map((ch) => (FONT[ch] ? ch : " "))
    .join("")
    .replace(/ +/g, " ")
    .trim();
}

// Width in pixels of a string at a given scale (1px gap between glyphs).
function textWidth(text, scale) {
  if (text.length === 0) return 0;
  return text.length * GLYPH_W * scale + (text.length - 1) * scale;
}

// Draw a string with top-left at (ox, oy) at integer `scale`.
function drawText(px, text, ox, oy, scale, r, g, b) {
  let cx = ox;
  for (const ch of text) {
    const glyph = FONT[ch] || FONT[" "];
    for (let gy = 0; gy < GLYPH_H; gy++) {
      const row = glyph[gy];
      for (let gx = 0; gx < GLYPH_W; gx++) {
        if (row[gx] === "1") {
          for (let sy = 0; sy < scale; sy++)
            for (let sx = 0; sx < scale; sx++)
              px(cx + gx * scale + sx, oy + gy * scale + sy, r, g, b);
        }
      }
    }
    cx += (GLYPH_W + 1) * scale;
  }
}

// Greedily wrap words so each line fits within maxW at `scale`. A single word
// too wide for the line is kept on its own line (the caller picks a scale that
// fits the longest word).
function wrapText(words, scale, maxW) {
  const lines = [];
  let cur = "";
  for (const word of words) {
    const candidate = cur ? `${cur} ${word}` : word;
    if (cur && textWidth(candidate, scale) > maxW) {
      lines.push(cur);
      cur = word;
    } else {
      cur = candidate;
    }
  }
  if (cur) lines.push(cur);
  return lines;
}

// ---------------------------------------------------------------------------
// Name seeding: FNV-1a hash → hue, then a dark gradient in that hue.
// ---------------------------------------------------------------------------
function hashHue(name) {
  let h = 0x811c9dc5;
  for (let i = 0; i < name.length; i++) {
    h ^= name.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h % 360;
}

// HSL → RGB (h in [0,360), s/l in [0,1]). Returns [r,g,b] 0–255.
function hslToRgb(h, s, l) {
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const hp = h / 60;
  const x = c * (1 - Math.abs((hp % 2) - 1));
  let r = 0, g = 0, b = 0;
  if (hp < 1) [r, g, b] = [c, x, 0];
  else if (hp < 2) [r, g, b] = [x, c, 0];
  else if (hp < 3) [r, g, b] = [0, c, x];
  else if (hp < 4) [r, g, b] = [0, x, c];
  else if (hp < 5) [r, g, b] = [x, 0, c];
  else [r, g, b] = [c, 0, x];
  const m = l - c / 2;
  return [Math.round((r + m) * 255), Math.round((g + m) * 255), Math.round((b + m) * 255)];
}

// ---------------------------------------------------------------------------
// Render path 1: the name-text card (every game except Snake).
// ---------------------------------------------------------------------------
function makeNameCard(config) {
  const { buf, px } = newCanvas();
  const hue = hashHue(config.name);

  // Dark diagonal gradient in the seeded hue: deep at top-left, slightly
  // brighter at bottom-right. Lightness stays low so white text stays readable.
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const t = (x / W + y / H) / 2; // 0..1 diagonal
      const l = 0.06 + 0.1 * t; // 6%..16% lightness — dark, Polkadot-ish
      const [r, g, b] = hslToRgb(hue, 0.55, l);
      px(x, y, r, g, b);
    }
  }

  // A faint accent bar in a complementary hue along the bottom for polish.
  const [ar, ag, ab] = hslToRgb((hue + 330) % 360, 0.7, 0.45);
  for (let y = H - 6; y < H; y++) for (let x = 0; x < W; x++) px(x, y, ar, ag, ab);

  // ---- Title: fit config.name into the 640px width, wrapping/scaling. ----
  const name = normalizeText(config.name) || "GAME";
  const words = name.split(" ");
  const maxTextW = W - 80; // 40px side margins

  // Pick the largest scale (cap 14) at which the wrapped title fits both the
  // width and a sane height budget.
  let scale = 14;
  let lines = [];
  for (; scale >= 2; scale--) {
    lines = wrapText(words, scale, maxTextW);
    const widest = Math.max(...lines.map((ln) => textWidth(ln, scale)));
    const totalH = lines.length * GLYPH_H * scale + (lines.length - 1) * 2 * scale;
    if (widest <= maxTextW && totalH <= 220) break;
  }

  const lineH = GLYPH_H * scale;
  const lineGap = 2 * scale;
  const blockH = lines.length * lineH + (lines.length - 1) * lineGap;
  let y = Math.round((H - blockH) / 2) - 14; // nudge up to leave room for subtitle
  for (const ln of lines) {
    const w = textWidth(ln, scale);
    const x = Math.round((W - w) / 2);
    // Subtle drop shadow then bright white text for legibility on any hue.
    drawText(px, ln, x + scale, y + scale, scale, 8, 6, 14);
    drawText(px, ln, x, y, scale, 245, 245, 250);
    y += lineH + lineGap;
  }

  // ---- Subtitle: config.gameType, small, centered below the title. ----
  const sub = normalizeText(config.gameType || "");
  if (sub) {
    const subScale = 3;
    const subW = textWidth(sub, subScale);
    const subX = Math.round((W - subW) / 2);
    const subY = Math.min(y + 10, H - 40 - GLYPH_H * subScale);
    const [sr, sg, sb] = hslToRgb(hue, 0.35, 0.78);
    drawText(px, sub, subX, subY, subScale, sr, sg, sb);
  }

  return buf;
}

// ---------------------------------------------------------------------------
// Render path 2: the original hand-drawn Snake art (preserved verbatim).
// ---------------------------------------------------------------------------
function makeSnake() {
  const { buf, px } = newCanvas();

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
const image = config.name === "Snake" ? makeSnake() : makeNameCard(config);
const png = encodePng(image, W, H);
writeFileSync(out, png);
console.log(`Wrote ${out} (${W}×${H}, ${(png.length / 1024).toFixed(1)} KiB) for "${config.name}"`);

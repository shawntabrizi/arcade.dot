// Deterministic placeholder thumbnail derived purely from a game's address
// (SPEC §6.4): shown when thumbnailCid is empty or the gateway fetch fails, so
// an image failure never breaks a card. No deps — a small FNV-1a hash seeds a
// two-tone gradient + a blocky identicon-ish glyph, rendered as an inline SVG
// data URI. Pure and deterministic (same address → same image), so it's
// testable and stable across sessions.

// FNV-1a 32-bit over the lowercased address bytes.
function hash32(s: string): number {
  let h = 0x811c9dc5;
  const v = s.toLowerCase();
  for (let i = 0; i < v.length; i++) {
    h ^= v.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

// Derive two pleasant dark-friendly hues from the hash.
function colorsFor(address: string): { a: string; b: string; fg: string } {
  const h = hash32(address);
  const hueA = h % 360;
  const hueB = (hueA + 90 + ((h >> 8) % 120)) % 360;
  return {
    a: `hsl(${hueA} 55% 32%)`,
    b: `hsl(${hueB} 50% 18%)`,
    fg: `hsl(${hueA} 70% 70%)`,
  };
}

// A 5-cell-wide symmetric blocky glyph (mirror left half), 5 rows tall, derived
// from hash bits. Returns SVG <rect> markup positioned on a 16:9 canvas.
function glyph(address: string, fg: string): string {
  const h = hash32(address.split("").reverse().join("")); // decorrelate from colors
  const cells: string[] = [];
  const size = 36; // px per cell
  const cols = 5;
  const rows = 5;
  // center the 5x5 glyph on a 640x360 (16:9) canvas
  const offX = (640 - cols * size) / 2;
  const offY = (360 - rows * size) / 2;
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < 3; c++) {
      const bit = (h >> (r * 3 + c)) & 1;
      if (!bit) continue;
      const xs = [c, cols - 1 - c];
      for (const x of new Set(xs)) {
        cells.push(
          `<rect x="${offX + x * size}" y="${offY + r * size}" width="${size}" height="${size}" rx="6" fill="${fg}" />`,
        );
      }
    }
  }
  return cells.join("");
}

// A self-contained data: URI SVG. 16:9 (SPEC §6.4 recommends 640×360).
export function placeholderDataUri(address: string): string {
  const { a, b, fg } = colorsFor(address);
  const id = `g${hash32(address).toString(16)}`;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 640 360" preserveAspectRatio="xMidYMid slice"><defs><linearGradient id="${id}" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${a}"/><stop offset="1" stop-color="${b}"/></linearGradient></defs><rect width="640" height="360" fill="url(#${id})"/>${glyph(
    address,
    fg,
  )}</svg>`;
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
}

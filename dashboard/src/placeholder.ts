// Deterministic placeholder key art derived from a game's address and (when
// available) its display name (SPEC §6.4): shown when thumbnailCid is empty or
// the gateway fetch fails, so an image failure never breaks a card. No deps —
// a small FNV-1a hash seeds layered gradients + ambient glows, with the game's
// title set in bold type, rendered as an inline SVG data URI. Pure and
// deterministic (same address + name → same image), so it's testable and
// stable across sessions.

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

// Two hues derived from the hash: a dominant and a complementary partner,
// spaced far enough apart that the gradient reads as intentional key art.
function hues(address: string): { h1: number; h2: number } {
  const h = hash32(address);
  const h1 = h % 360;
  const h2 = (h1 + 40 + ((h >> 8) % 160)) % 360;
  return { h1, h2 };
}

// The game's signature colour, for ambient UI glows (hero capsule, detail
// backdrop). Same hue family as its generated art, so the tint always matches.
export function ambientColor(address: string): string {
  const { h1 } = hues(address);
  return `hsl(${h1} 60% 45%)`;
}

function escapeXml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

// Split a long multi-word title into two balanced lines (split at the space
// that best equalizes line lengths); short or single-word titles stay whole.
function titleLines(name: string): string[] {
  const t = name.trim();
  if (t.length <= 14 || !/\s/.test(t)) return [t];
  const words = t.split(/\s+/);
  let best = 1;
  let bestDiff = Infinity;
  for (let i = 1; i < words.length; i++) {
    const left = words.slice(0, i).join(" ").length;
    const right = words.slice(i).join(" ").length;
    const diff = Math.abs(left - right);
    if (diff < bestDiff) {
      bestDiff = diff;
      best = i;
    }
  }
  return [words.slice(0, best).join(" "), words.slice(best).join(" ")];
}

// A self-contained data: URI SVG. 16:9 (SPEC §6.4 recommends 640×360).
// Layers: diagonal two-hue gradient → two soft ambient glows → a faint light
// sweep → edge vignette → the title in bold uppercase type. No glyphs/shapes.
export function placeholderDataUri(address: string, name = ""): string {
  const { h1, h2 } = hues(address);
  const id = `g${hash32(address).toString(16)}`;

  const lines = titleLines(name).map((l) => escapeXml(l.toUpperCase()));
  const longest = Math.max(1, ...lines.map((l) => l.length));
  // Bold uppercase glyphs run ~0.72em wide incl. tracking; fit to ~580px.
  const fontSize = Math.max(22, Math.min(64, Math.floor(580 / (longest * 0.72))));
  const font =
    'font-family="system-ui, -apple-system, &#39;Segoe UI&#39;, sans-serif" font-weight="800" letter-spacing="0.06em"';
  const title = !name.trim()
    ? ""
    : lines.length === 1
      ? `<text x="320" y="180" text-anchor="middle" dominant-baseline="central" font-size="${fontSize}" ${font} fill="#f2f6f9" filter="url(#${id}s)">${lines[0]}</text>`
      : `<text x="320" y="${180 - fontSize * 0.62}" text-anchor="middle" dominant-baseline="central" font-size="${fontSize}" ${font} fill="#f2f6f9" filter="url(#${id}s)">${lines[0]}</text>` +
        `<text x="320" y="${180 + fontSize * 0.62}" text-anchor="middle" dominant-baseline="central" font-size="${fontSize}" ${font} fill="#f2f6f9" filter="url(#${id}s)">${lines[1]}</text>`;

  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 640 360" preserveAspectRatio="xMidYMid slice">` +
    `<defs>` +
    `<linearGradient id="${id}" x1="0" y1="0" x2="1" y2="1">` +
    `<stop offset="0" stop-color="hsl(${h1} 62% 32%)"/>` +
    `<stop offset="1" stop-color="hsl(${h2} 68% 13%)"/>` +
    `</linearGradient>` +
    `<radialGradient id="${id}a" cx="0.2" cy="0.02" r="0.9">` +
    `<stop offset="0" stop-color="hsl(${h1} 75% 58%)" stop-opacity="0.75"/>` +
    `<stop offset="1" stop-color="hsl(${h1} 75% 58%)" stop-opacity="0"/>` +
    `</radialGradient>` +
    `<radialGradient id="${id}b" cx="0.88" cy="1" r="0.85">` +
    `<stop offset="0" stop-color="hsl(${h2} 70% 48%)" stop-opacity="0.55"/>` +
    `<stop offset="1" stop-color="hsl(${h2} 70% 48%)" stop-opacity="0"/>` +
    `</radialGradient>` +
    `<linearGradient id="${id}w" x1="0" y1="0" x2="1" y2="1">` +
    `<stop offset="0.35" stop-color="#ffffff" stop-opacity="0"/>` +
    `<stop offset="0.5" stop-color="#ffffff" stop-opacity="0.07"/>` +
    `<stop offset="0.65" stop-color="#ffffff" stop-opacity="0"/>` +
    `</linearGradient>` +
    `<radialGradient id="${id}v" cx="0.5" cy="0.5" r="0.75">` +
    `<stop offset="0.55" stop-color="#000000" stop-opacity="0"/>` +
    `<stop offset="1" stop-color="#000000" stop-opacity="0.45"/>` +
    `</radialGradient>` +
    `<filter id="${id}s" x="-20%" y="-20%" width="140%" height="140%">` +
    `<feDropShadow dx="0" dy="3" stdDeviation="6" flood-color="#000000" flood-opacity="0.45"/>` +
    `</filter>` +
    `</defs>` +
    `<rect width="640" height="360" fill="url(#${id})"/>` +
    `<rect width="640" height="360" fill="url(#${id}a)"/>` +
    `<rect width="640" height="360" fill="url(#${id}b)"/>` +
    `<rect width="640" height="360" fill="url(#${id}w)"/>` +
    `<rect width="640" height="360" fill="url(#${id}v)"/>` +
    title +
    `</svg>`;
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
}

// Pure, chain-free logic. Everything here is unit-tested (logic.test.ts) and
// imported by both the UI and the reads layer. No I/O, no React, no codecs.

import type {
  ActivityItem,
  Address,
  Game,
  ScoreConfig,
  ScoreEntry,
} from "./types";

// SPEC §4.1: the only standard version this dashboard supports.
export const SUPPORTED_ARCADE_VERSION = 1;

// SPEC §7.4 conformance gate. The registry is permissionless, so a listing's
// game contract is junk until it proves itself by answering arcadeVersion()
// with a version we support. A null version means the call failed (not a GCS
// contract / EOA / reverted) and is also rejected. This — not registry-side
// validation — is what filters non-games. Kept pure so it is trivially tested.
export function isConformant(arcadeVersion: number | null): boolean {
  return arcadeVersion === SUPPORTED_ARCADE_VERSION;
}

// ---- Home-page sort orders (SPEC §7.1) ----------------------------------
// All three return new arrays; inputs are never mutated (the UI reuses the
// same Game[] across surfaces).

// Featured (item 1) + the basis for the activity-rail set: most recently active.
export function sortByLastPlayed(games: Game[]): Game[] {
  return [...games].sort((a, b) => b.stats.lastPlayedAt - a.stats.lastPlayedAt);
}

// Most Played (item 2): all-time playCount desc.
export function sortByPlayCount(games: Game[]): Game[] {
  return [...games].sort((a, b) => b.stats.playCount - a.stats.playCount);
}

// New (item 3): registeredAt desc.
export function sortByRegisteredAt(games: Game[]): Game[] {
  return [...games].sort(
    (a, b) => b.listing.registeredAt - a.listing.registeredAt,
  );
}

// ---- gameType chip bucketing (SPEC §5.4) --------------------------------
// Known vocabulary. `gameType` is a free string tag, not an enum (§5.4): the
// dashboard filters on these and buckets anything else under "other".
export const KNOWN_GAME_TYPES = [
  "arcade",
  "puzzle",
  "racing",
  "strategy",
  "shooter",
  "card",
  "idle",
  "other",
] as const;

export type GameTypeChip = (typeof KNOWN_GAME_TYPES)[number];

// Map a raw on-chain gameType to a chip. Case-insensitive; unknown → "other"
// (the §5.4 catch-all bucket). Empty/whitespace also buckets to "other".
export function bucketGameType(raw: string): GameTypeChip {
  const t = raw.trim().toLowerCase();
  return (KNOWN_GAME_TYPES as readonly string[]).includes(t)
    ? (t as GameTypeChip)
    : "other";
}

// Which chips to actually render: "all" plus only the buckets present in the
// current game set, in canonical order. Avoids showing empty filters.
export function presentChips(games: Game[]): GameTypeChip[] {
  const present = new Set(games.map((g) => bucketGameType(g.listing.gameType)));
  return KNOWN_GAME_TYPES.filter((c) => present.has(c));
}

// Filter games by a selected chip; null/"all" means no filter.
export function filterByChip(games: Game[], chip: GameTypeChip | null): Game[] {
  if (chip === null) return games;
  return games.filter((g) => bucketGameType(g.listing.gameType) === chip);
}

// ---- Bounded live-activity merge (SPEC §7.1 item 5, §7.4) ---------------
// Merge getRecent rows from at most the N most-recently-active games into one
// newest-first feed. Bounded on BOTH ends: we read recent rows from ≤ N games
// (the caller decides which games to fetch; this picks them) and cap the merged
// output. This is the §7.4 "bounded reads per block" guarantee in pure form —
// it tells the caller exactly which game addresses to fetch.
export const ACTIVITY_GAME_LIMIT = 10;
export const ACTIVITY_FEED_LIMIT = 20;

// Pick the ≤ N most-recently-active games whose recent rings to read. Games
// that have never been played (lastPlayedAt === 0) are excluded — they have no
// activity to contribute. Returns their addresses, newest-active first.
export function activityGameSet(
  games: Game[],
  limit = ACTIVITY_GAME_LIMIT,
): Address[] {
  return sortByLastPlayed(games)
    .filter((g) => g.stats.lastPlayedAt > 0)
    .slice(0, limit)
    .map((g) => g.listing.address);
}

// Merge per-game recent rows into one bounded, newest-first feed. `perGame`
// maps each fetched game address → its recent ScoreEntry[] (already newest-first
// per contract, but we re-sort defensively across games). `names` maps address →
// display name for tagging. Output is capped at `feedLimit`.
export function mergeActivity(
  perGame: Map<Address, ScoreEntry[]>,
  names: Map<Address, string>,
  feedLimit = ACTIVITY_FEED_LIMIT,
): ActivityItem[] {
  const items: ActivityItem[] = [];
  for (const [game, entries] of perGame) {
    const gameName = names.get(game) ?? "";
    for (const e of entries) {
      items.push({
        game,
        gameName,
        player: e.player,
        score: e.score,
        at: e.at,
      });
    }
  }
  // Newest-first; stable tie-break keeps multiple plays at the same second in a
  // deterministic order (by game address) so the feed doesn't jitter.
  items.sort(
    (a, b) => b.at - a.at || (a.game < b.game ? -1 : a.game > b.game ? 1 : 0),
  );
  return items.slice(0, feedLimit);
}

// Merge a bounded per-block refresh (SPEC §7.4) into the session's game list:
// for each game in `base`, swap in the fresh stats from `refreshed` (matched by
// address) if present, otherwise keep the last-fetched game unchanged. Listing
// order and identity are preserved; games absent from `refreshed` degrade to
// their last-good state (§9.3 — a failed/partial refresh never drops a card).
export function mergeStats(base: Game[], refreshed: Game[]): Game[] {
  const fresh = new Map<string, Game>(
    refreshed.map((g) => [g.listing.address.toLowerCase(), g]),
  );
  return base.map((g) => fresh.get(g.listing.address.toLowerCase()) ?? g);
}

// ---- Score formatting (SPEC §4.2 scoreFormat / scoreUnit) ---------------
// 0 = points (integer), 1 = duration ms rendered m:ss.mmm, 2 = value + unit.
// The lower-is-better sentinel u128::MAX (§4.2) means "no score" and renders
// as a dash, never as a giant number.
const U128_MAX = (1n << 128n) - 1n;

export function formatScore(score: bigint, config: ScoreConfig): string {
  if (score === U128_MAX) return "—";

  switch (config.scoreFormat) {
    case 1:
      return formatDuration(score);
    case 2: {
      const unit = config.scoreUnit.trim();
      return unit ? `${score.toString()} ${unit}` : score.toString();
    }
    case 0:
    default:
      return score.toString();
  }
}

// Milliseconds → m:ss.mmm (SPEC §4.2 scoreFormat == 1). Minutes are unbounded
// (a 90-minute time is "90:00.000"), seconds and millis are zero-padded.
export function formatDuration(ms: bigint): string {
  const totalMs = ms < 0n ? 0n : ms;
  const millis = totalMs % 1000n;
  const totalSeconds = totalMs / 1000n;
  const seconds = totalSeconds % 60n;
  const minutes = totalSeconds / 60n;
  return `${minutes.toString()}:${seconds.toString().padStart(2, "0")}.${millis
    .toString()
    .padStart(3, "0")}`;
}

// ---- playUrl → paseo.li launch URL (SPEC §7.5) --------------------------
// The Play button is a plain anchor to https://<label>.paseo.li. The platform
// migrated dot.li → paseo.li (June 2026); dot.li no longer resolves, so we both
// derive new URLs as .paseo.li AND heal legacy .dot.li values stored on-chain
// (every listing registered before the migration has a now-dead .dot.li
// playUrl). A playUrl may be:
//   - a bare DotNS name:        "snake.dot"          → https://snake.paseo.li
//   - a bare label:             "snake"              → https://snake.paseo.li
//   - a legacy dot.li URL:      "https://x.dot.li"   → https://x.paseo.li (healed)
//   - any other https:// URL:   passed through (registry doesn't validate, §6.2)
// Returns null for empty/garbage so the UI can disable the button.
export function toLaunchUrl(playUrl: string): string | null {
  const raw = playUrl.trim();
  if (!raw) return null;

  // Already an absolute http(s) URL: trust it, but heal a dead .dot.li host to
  // the current .paseo.li viewer. Any non-dot.li host passes through unchanged.
  if (/^https?:\/\//i.test(raw)) {
    try {
      const u = new URL(raw);
      if (u.hostname.toLowerCase().endsWith(".dot.li")) {
        u.hostname = `${u.hostname.slice(0, -".dot.li".length)}.paseo.li`;
      }
      return u.href;
    } catch {
      return null;
    }
  }

  // A scheme we can't launch from the sandbox (e.g. dot://) — reject.
  if (/^[a-z][a-z0-9+.-]*:/i.test(raw)) return null;

  // Bare name/label. Strip a trailing ".dot" if present, then derive the label.
  // "arcade-snake.dot" → label "arcade-snake"; "snake" → "snake".
  // We only strip a single trailing ".dot"; subdomains within a .dot name are
  // preserved ("app.snake.dot" → "app.snake").
  let label = raw.replace(/\/+$/, ""); // drop trailing slashes
  label = label.replace(/\.dot$/i, "");
  if (!label) return null;
  // Reject anything with whitespace or a path — labels are DNS-ish.
  if (/[\s/]/.test(label)) return null;
  return `https://${label}.paseo.li`;
}

// ---- Relative time (SPEC §7.2 "active 2m ago") --------------------------
// `now` is injectable so tests are deterministic. unix seconds in, human string
// out. 0 / falsy → "never". Future timestamps clamp to "just now".
export function relativeTime(
  unixSeconds: number,
  now: number = Date.now(),
): string {
  if (!unixSeconds) return "never";
  const nowSec = Math.floor(now / 1000);
  const diff = nowSec - unixSeconds;
  if (diff <= 0) return "just now";
  if (diff < 60) return `${diff}s ago`;
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  if (diff < 2592000) return `${Math.floor(diff / 86400)}d ago`;
  if (diff < 31536000) return `${Math.floor(diff / 2592000)}mo ago`;
  return `${Math.floor(diff / 31536000)}y ago`;
}

// ---- Address shortening (used by the resolveName fallback, SPEC §8.2) ---
export function shortAddress(address: string): string {
  if (!address.startsWith("0x") || address.length < 11) return address;
  return `${address.slice(0, 6)}…${address.slice(-4)}`;
}

// ---- Player display name — abstract the wallet address (SPEC §8.2) ------
// We never surface a raw wallet address in the UI. A friendly deterministic
// alias is derived from the address so unmapped players stay distinct without
// ever showing hex. (Collisions are possible across a very large player set;
// players who set a DotNS name always show their real username instead.)
const ALIAS_ADJECTIVES = [
  "Swift",
  "Calm",
  "Bold",
  "Brave",
  "Quiet",
  "Clever",
  "Lucky",
  "Keen",
  "Mellow",
  "Noble",
  "Sly",
  "Witty",
  "Spry",
  "Jolly",
  "Bright",
  "Stoic",
];
const ALIAS_ANIMALS = [
  "Otter",
  "Falcon",
  "Lynx",
  "Heron",
  "Fox",
  "Ibex",
  "Koi",
  "Raven",
  "Mole",
  "Wren",
  "Seal",
  "Hare",
  "Newt",
  "Crane",
  "Vole",
  "Tern",
];

export function anonAlias(address: string): string {
  const hex = address.toLowerCase().replace(/^0x/, "");
  let h = 0;
  for (let i = 0; i < hex.length; i++) h = (h * 31 + hex.charCodeAt(i)) >>> 0;
  const adj = ALIAS_ADJECTIVES[h % ALIAS_ADJECTIVES.length];
  const animal =
    ALIAS_ANIMALS[
      Math.floor(h / ALIAS_ADJECTIVES.length) % ALIAS_ANIMALS.length
    ];
  const suffix = (h >>> 8)
    .toString(36)
    .toUpperCase()
    .padStart(4, "0")
    .slice(-4);
  return `${adj} ${animal} #${suffix}`;
}

// Format a player for display. `resolved` is the resolveName output (a DotNS
// name like "alice.dot", a truncated-address fallback, or undefined before it
// lands). A resolved DotNS name wins, shown WITHOUT the ".dot" suffix
// ("alice.dot" → "alice"); anything else falls back to a friendly alias — never
// the raw address.
export function displayName(address: string, resolved?: string): string {
  if (resolved && /\.dot$/i.test(resolved)) {
    return resolved.replace(/\.dot$/i, "");
  }
  return anonAlias(address);
}

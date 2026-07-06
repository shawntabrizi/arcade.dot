// The real ArcadeReads implementation: PAPI + @polkadot-api/sdk-ink against
// Paseo Asset Hub, best-block reads, no account / no signer / no writes
// (SPEC §7, §8.4). Reuses the game-template's gcs.ts wiring idiom
// (createClient(getWsProvider) + createInkSdk(client, { atBest: true })) — reads
// are free dry-runs that work over WebSocket in both a Triangle host and a plain
// browser, so no host/standalone branching is needed here. A host-provider seam
// is left as a documented TODO (item 13/host adoption).

import { createClient, type PolkadotClient } from "polkadot-api";
// polkadot-api 2.x removed the `polkadot-api/ws-provider/*` subpaths; the WS
// provider now ships as the standalone `@polkadot-api/ws-provider` package
// (matching game-template). 2.x also aligns the JSON-RPC provider shape with
// host-api-wrapper's createPapiProvider (parsed messages, not strings).
import { getWsProvider } from "@polkadot-api/ws-provider";
// Route reads THROUGH the host (not a direct RPC WebSocket) so reading the
// chain doesn't trigger the host's "Allow access to web domains?" prompt.
// createPapiProvider tunnels JSON-RPC over the host's own chain connection,
// falling back to the WS provider when there is no host. See game-template
// scoreboard/gcs.ts for the matching write-side setup.
import { createPapiProvider } from "@novasamatech/host-api-wrapper";
import { createInkSdk } from "@polkadot-api/sdk-ink";
import cdmJson from "../cdm.json";

// Asset Hub genesis for "Paseo Asset Hub Next". The host routes chain access by
// genesis hash; a WRONG one makes createPapiProvider's host-support check fail
// and silently fall back to a direct RPC WebSocket → the host's "Allow access to
// web domains?" prompt. Verified live via getChainSpecData().
const ASSET_HUB_GENESIS =
  "0xbf0488dbe9daa1de1c08c5f743e26fdc2a4ecd74cf87dd1b4b1eeb99ae4ef19f" as const;
import dotnsReverseResolverAbi from "./abis/DotnsReverseResolver.json";
import type { ArcadeReads } from "./arcade-reads";
import {
  isConformant,
  shortAddress,
  SUPPORTED_ARCADE_VERSION,
} from "./logic";
import type {
  Address,
  Game,
  GameStats,
  Listing,
  ScoreConfig,
  ScoreEntry,
} from "./types";

// Reads are dry-runs; nothing is signed or paid (SPEC §4.2, §8.4). An unmapped
// origin reverts every dry-run with Revive::AccountUnmapped. Per product-sdk
// PR #152, the canonical query origin is pallet-revive's OWN pallet account —
// stable, always on-chain, not a dev seed (//Alice): it is
// `PalletId(*b"py/reviv").into_account_truncating()` = "modlpy/reviv" + 20 zero
// bytes, SS58-encoded (prefix 42). The dashboard never signs or maps anything.
const READ_ORIGIN = "5EYCAe5ijiYfhaAUBd6H9WGRTsvwFFc7GnhQkiHvBYxdvpbV";

const REGISTRY_NAME = "@arcade/registry";
const GCS_NAME = "@arcade/gcs-reference";

// SPEC §8.2: DotNS reverse resolver on Paseo Asset Hub. nameOf(h160) -> String,
// fail-closed (returns "" if the address no longer owns the name). Players on
// the GCS leaderboard are already H160, so this is a direct nameOf(player) call —
// the dotns-sdk reverse path (useResolverStore.resolveAddressToName) passes the
// EVM address verbatim with no conversion.
const DOTNS_REVERSE_RESOLVER =
  "0xa691F7ed662685a0D8aDF711A90D8302E5cfd2aD" as Address;

// Registry pagination page size; the §4.3 cap is ≥ 50, so one page usually
// covers the whole registry in the §9.2 ~100-game envelope.
const REGISTRY_PAGE = 50;

interface ContractEntry {
  address: Address;
  abi: unknown[];
}

interface CdmShape {
  targets: Record<string, { "asset-hub": string; bulletin?: string }>;
  contracts: Record<string, Record<string, { address: Address; abi: unknown[] }>>;
}

function cdm(): CdmShape {
  return cdmJson as unknown as CdmShape;
}

function targetKey(): string {
  return Object.keys(cdm().contracts)[0];
}

function assetHubEndpoint(): string {
  const ep = cdm().targets[targetKey()]?.["asset-hub"];
  if (!ep) throw new Error("cdm.json has no asset-hub endpoint configured.");
  return ep;
}

function registryEntry(): ContractEntry {
  const e = cdm().contracts[targetKey()][REGISTRY_NAME];
  if (!e?.address || !e?.abi)
    throw new Error("cdm.json is missing the registry contract.");
  return { address: e.address, abi: e.abi };
}

// The GCS ABI is identical for every conforming game (SPEC §7.4); we ship the
// reference one from cdm.json and reuse it for every game address.
function gcsAbi(): unknown[] {
  const e = cdm().contracts[targetKey()][GCS_NAME];
  if (!e?.abi) throw new Error("cdm.json is missing the GCS reference ABI.");
  return e.abi;
}

// In-host: route ALL chain RPC through the host via createPapiProvider with NO
// WS fallback. The fallback arg is "for testing purposes only" and is exactly
// what opens a direct RPC WebSocket (→ the web-domain prompt) when the host
// route isn't taken. With the correct genesis the host serves the chain and no
// socket opens. Direct WS only where there is no host: Node (the live smoke
// test, `typeof window === "undefined"`) and local dev (`localhost`).
function chainProvider(endpoint: string) {
  const directWs =
    typeof window === "undefined" ||
    /^localhost(:\d+)?$/.test(window.location.host);
  return directWs ? getWsProvider(endpoint) : createPapiProvider(ASSET_HUB_GENESIS);
}

let _client: PolkadotClient | null = null;
function client(): PolkadotClient {
  if (!_client) _client = createClient(chainProvider(assetHubEndpoint()));
  return _client;
}

// Close the live connection. The app never needs this (the socket lives for the
// session), but the live smoke test calls it so the test process can exit.
export function closeChainReads(): void {
  _client?.destroy();
  _client = null;
  _ink = null;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let _ink: any = null;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function ink(): any {
  // Best-block reads (SPEC §7.4): a fresh submitScore is visible within a block.
  if (!_ink) _ink = createInkSdk(client(), { atBest: true });
  return _ink;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let _registry: any = null;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function registry(): any {
  if (!_registry) {
    const e = registryEntry();
    _registry = ink().getContract({ abi: e.abi }, e.address);
  }
  return _registry;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let _resolver: any = null;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function resolver(): any {
  if (!_resolver) {
    try {
      _resolver = ink().getContract(
        { abi: dotnsReverseResolverAbi as unknown[] },
        DOTNS_REVERSE_RESOLVER,
      );
    } catch {
      return null; // resolver not deployable/found → callers use the fallback
    }
  }
  return _resolver;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const _gameContracts = new Map<string, any>();
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function game(address: Address): any {
  const key = address.toLowerCase();
  let c = _gameContracts.get(key);
  if (!c) {
    c = ink().getContract({ abi: gcsAbi() }, address);
    _gameContracts.set(key, c);
  }
  return c;
}

// One best-block dry-run read. The two failure modes are deliberately kept
// distinct: a REVERT (r.success === false) is a verdict about the contract
// (non-conformant / absent) and returns null, which callers may cache for the
// session; a THROWN error (transport down, contract not found on this node) is
// transient and is rethrown, so it can never be baked into a session cache or
// rendered as "0 plays / empty board".
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function q<T>(contract: any, method: string, data: Record<string, unknown> = {}): Promise<T | null> {
  const r = await contract.query(method, { origin: READ_ORIGIN, data });
  return r.success ? (r.value.response as T) : null;
}

// ---- raw ABI tuple shapes (snake_case fields per the shipped ABIs) -------
interface RawMeta {
  name: string;
  game_type: string;
  short_description: string;
  play_url: string;
  thumbnail_cid: string;
  requires_account: boolean;
  extra_cid: string;
}
interface RawListing {
  meta: RawMeta;
  meta_version: number | bigint;
  registered_at: number | bigint;
  updated_at: number | bigint;
}
interface RawGameEntry {
  game: Address;
  listing: RawListing;
}
interface RawEntry {
  player: Address;
  score: bigint;
  at: number | bigint;
}

function toListing(address: Address, l: RawListing): Listing {
  return {
    address,
    name: l.meta.name,
    gameType: l.meta.game_type,
    shortDescription: l.meta.short_description,
    playUrl: l.meta.play_url,
    thumbnailCid: l.meta.thumbnail_cid,
    requiresAccount: l.meta.requires_account,
    extraCid: l.meta.extra_cid,
    metaVersion: Number(l.meta_version),
    registeredAt: Number(l.registered_at),
    updatedAt: Number(l.updated_at),
  };
}

function toEntries(rows: RawEntry[] | null): ScoreEntry[] {
  if (!rows) return [];
  return rows.map((r) => ({ player: r.player, score: r.score, at: Number(r.at) }));
}

// Session caches (SPEC §7.4): immutable score config + resolved names.
const scoreConfigCache = new Map<string, ScoreConfig>();
const nameCache = new Map<string, string>();

// SPEC §7.4 session caches for the read strategy:
//  - listingCache: registry listing metadata, cached until session end (the
//    registry is enumerated AT MOST once per session — re-enumeration would only
//    be needed on a ListingChanged event, which we do not subscribe to in v1, so
//    a session-lifetime cache is the documented choice).
//  - conformanceCache: arcadeVersion() verdict per game address (§7.4); a game
//    that passed the gate stays conformant for the session, so per-block refresh
//    re-reads only the (mutable) Module A stats, never the immutable version.
const listingCache = new Map<string, Listing>();
let listingsEnumerated = false;
const conformanceCache = new Map<string, boolean>();

// Read ONLY Module A stats (SPEC §7.4 batched per game) — the mutable surface
// refreshed every best block. A transient read failure throws (the caller omits
// the game so mergeStats keeps its last-good stats, §9.3); a revert degrades
// that one field to 0.
async function readStats(address: Address): Promise<GameStats> {
  const c = game(address);
  const [playCount, uniquePlayers, lastPlayedAt] = await Promise.all([
    q<number | bigint>(c, "playCount"),
    q<number | bigint>(c, "uniquePlayers"),
    q<number | bigint>(c, "lastPlayedAt"),
  ]);
  return {
    playCount: Number(playCount ?? 0),
    uniquePlayers: Number(uniquePlayers ?? 0),
    lastPlayedAt: Number(lastPlayedAt ?? 0),
  };
}

// SPEC §7.4 conformance gate, cached per session. arcadeVersion() is immutable
// for a contract's lifetime, so it is read once per address and never again.
async function isAddressConformant(address: Address): Promise<boolean> {
  const key = address.toLowerCase();
  const cached = conformanceCache.get(key);
  if (cached !== undefined) return cached;
  const version = await q<number>(game(address), "arcadeVersion");
  const ok = isConformant(version === null ? null : Number(version));
  conformanceCache.set(key, ok);
  return ok;
}

// Fetch the conformance verdict (cached) + Module A stats. Returns null if the
// contract fails the gate (§7.4) — that game is skipped silently.
async function statsIfConformant(address: Address): Promise<GameStats | null> {
  if (!(await isAddressConformant(address))) return null;
  return readStats(address);
}

// Enumerate the registry into the session listing cache AT MOST once (SPEC §7.4,
// §9.2). Subsequent calls return the cached map without re-enumerating.
async function enumerateListings(): Promise<Map<Address, Listing>> {
  if (listingsEnumerated) {
    const m = new Map<Address, Listing>();
    for (const l of listingCache.values()) m.set(l.address, l);
    return m;
  }
  const result = new Map<Address, Listing>();
  let offset = 0;
  // Loop pages until a short page. Bounded by gameCount; the §9.2 envelope
  // is ~100 games.
  for (;;) {
    const page = await q<RawGameEntry[]>(registry(), "getGames", {
      offset,
      limit: REGISTRY_PAGE,
    });
    if (!page || page.length === 0) break;
    for (const e of page) {
      const listing = toListing(e.game, e.listing);
      result.set(e.game, listing);
      listingCache.set(e.game.toLowerCase(), listing);
    }
    if (page.length < REGISTRY_PAGE) break;
    offset += REGISTRY_PAGE;
  }
  listingsEnumerated = true;
  return result;
}

export function createChainReads(): ArcadeReads {
  return {
    async listGames(): Promise<Game[]> {
      const listings = await enumerateListings();
      const addrs = [...listings.keys()];
      // Conformance gate + batched stats per game, in parallel (SPEC §7.4).
      // Per-game reads catch: one game's transient failure (e.g. a registered
      // address the node can't find right now) omits that game this round
      // instead of failing the whole directory. Registry enumeration above
      // still throws on transport failure → Home's error state.
      const stats = await Promise.all(
        addrs.map((a) => statsIfConformant(a).catch(() => null)),
      );
      const games: Game[] = [];
      addrs.forEach((addr, i) => {
        const s = stats[i];
        if (s) games.push({ listing: listings.get(addr)!, stats: s });
      });
      return games;
    },

    // SPEC §7.4 bounded per-block refresh: re-read ONLY the given games' stats.
    // No registry enumeration, no re-gating of immutable arcadeVersion() — the
    // conformance verdict and listing metadata come from the session caches, so
    // per-block work is O(addresses), never O(all games).
    async refreshGames(addresses: Address[]): Promise<Game[]> {
      const refreshed = await Promise.all(
        addresses.map(async (addr) => {
          const listing = listingCache.get(addr.toLowerCase());
          if (!listing) return null; // not in this session's listing set
          const stats = await statsIfConformant(addr).catch(() => null);
          // Transient failure or non-conformant → omit from this refresh;
          // mergeStats keeps the caller's last-good stats (§9.3).
          if (!stats) return null;
          return { listing, stats } as Game;
        }),
      );
      return refreshed.filter((g): g is Game => g !== null);
    },

    async getGame(address: Address): Promise<Game | null> {
      // Detail-page deep link: the listing is cached after the first read (until
      // session end, §7.4), so per-block refresh re-reads only this one game's
      // stats — the detail page's bounded read.
      let listing = listingCache.get(address.toLowerCase());
      if (!listing) {
        const opt = await q<{ isSome: boolean; value: RawListing }>(
          registry(),
          "getListing",
          { game: address },
        );
        if (!opt || !opt.isSome) return null;
        listing = toListing(address, opt.value);
        listingCache.set(address.toLowerCase(), listing);
      }
      const stats = await statsIfConformant(address);
      if (!stats) return null;
      return { listing, stats };
    },

    async getScoreConfig(address: Address): Promise<ScoreConfig> {
      const key = address.toLowerCase();
      const cached = scoreConfigCache.get(key);
      if (cached) return cached;
      const c = game(address);
      const [ordering, format, unit] = await Promise.all([
        q<number>(c, "scoreOrdering"),
        q<number>(c, "scoreFormat"),
        q<string>(c, "scoreUnit"),
      ]);
      const config: ScoreConfig = {
        scoreOrdering: Number(ordering ?? 0),
        scoreFormat: Number(format ?? 0),
        scoreUnit: unit ?? "",
      };
      scoreConfigCache.set(key, config);
      return config;
    },

    async getLeaderboard(address, offset, limit): Promise<ScoreEntry[]> {
      return toEntries(await q<RawEntry[]>(game(address), "getLeaderboard", { offset, limit }));
    },

    async getRecent(address, offset, limit): Promise<ScoreEntry[]> {
      return toEntries(await q<RawEntry[]>(game(address), "getRecent", { offset, limit }));
    },

    // SPEC §8.2 player display names: DotnsReverseResolver.nameOf(player H160).
    // Players are already H160 on the leaderboard, so this is a direct call (no
    // conversion). On a non-empty name → use it; on "" / revert / error → fall
    // back to the truncated address (the identicon is rendered separately by the
    // placeholder SVG, seeded by the same address — §6.4 fallback). Cached per
    // session (nameCache), so a second lookup never re-invokes the resolver and
    // resolution never blocks card/leaderboard render (useResolvedNames swaps the
    // name in progressively when it lands).
    async resolveName(player: Address): Promise<string> {
      const key = player.toLowerCase();
      const cached = nameCache.get(key);
      if (cached !== undefined) return cached;
      const fallback = shortAddress(player);
      // Fully fail-closed (SPEC §8.2): a missing/undeployed resolver, a revert,
      // or any thrown/rejected error → truncated-address fallback, never an
      // escaping rejection. (The live smoke test caught this: the resolver
      // lookup rejected with "Contract not found" as an unhandled rejection.)
      let resolved = fallback;
      try {
        const c = resolver();
        if (c) {
          const name = await q<string>(c, "nameOf", { addr: player });
          if (name && name.length > 0) resolved = name;
        }
        // Cache only a real verdict (a name, or a fail-closed ""/revert).
        nameCache.set(key, resolved);
      } catch {
        // Transient failure — return the fallback WITHOUT caching it, so a
        // player who does own a name isn't stuck anonymous all session.
      }
      return resolved;
    },

    onNewBlock(cb): () => void {
      // On a subscription error, resubscribe after a delay instead of going
      // silently stale (the header would otherwise keep pulsing "live" on a
      // dead subscription and all per-block refresh would stop).
      let stopped = false;
      let sub: { unsubscribe(): void } | null = null;
      let retry: ReturnType<typeof setTimeout> | null = null;
      const subscribe = () => {
        sub = client().bestBlocks$.subscribe({
          next: (blocks) => {
            const head = blocks[0];
            if (head) cb(head.number);
          },
          error: () => {
            if (!stopped) retry = setTimeout(subscribe, 5_000);
          },
        });
      };
      subscribe();
      return () => {
        stopped = true;
        if (retry) clearTimeout(retry);
        sub?.unsubscribe();
      };
    },
  };
}

// Bulletin / IPFS gateways for thumbnails (SPEC §6.4). The bulletin gateway is
// preferred (where the template uploads); the public polkadot gateway is the
// fallback. Exposed so the thumbnail component can try in order.
export function thumbnailGateways(): string[] {
  const bulletin = cdm().targets[targetKey()]?.bulletin;
  const gateways = [
    bulletin ?? "https://paseo-bulletin-next-ipfs.polkadot.io/ipfs",
    "https://gateway.polkadot.io/ipfs",
  ];
  return gateways;
}

export { SUPPORTED_ARCADE_VERSION };

// The real ArcadeReads implementation: PAPI against Paseo Asset Hub, best-block
// reads, no account / no signer / no writes (SPEC §7, §8.4). Reads go through
// the runtime-compatible ReviveApi.call entry + viem encode/decode (mirroring
// the game-template's gcs.ts) — NOT the ink SDK's contract.query, which routes
// through ReviveApi.trace_call and is incompatible with the paseo-next-v2
// runtime. Reads are free dry-runs that work over WebSocket in both a Triangle
// host and a plain browser, so no host/standalone branching is needed here.

import { createClient, type PolkadotClient } from "polkadot-api";
import { getWsProvider } from "polkadot-api/ws-provider/web";
import { encodeFunctionData, decodeFunctionResult, type Abi } from "viem";
import cdmJson from "../cdm.json";
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

let _client: PolkadotClient | null = null;
function client(): PolkadotClient {
  if (!_client) _client = createClient(getWsProvider(assetHubEndpoint()));
  return _client;
}

// Close the live connection. The app never needs this (the socket lives for the
// session), but the live smoke test calls it so the test process can exit.
export function closeChainReads(): void {
  _client?.destroy();
  _client = null;
}

// The three contracts the dashboard reads, as {address, abi} entries. We no
// longer build ink SDK contract objects: reads go through the runtime-compatible
// ReviveApi.call entry (see q() below), so all we need is the address + ABI.
function registryContract(): ContractEntry {
  return registryEntry();
}

function resolverContract(): ContractEntry {
  return { address: DOTNS_REVERSE_RESOLVER, abi: dotnsReverseResolverAbi as unknown[] };
}

const _gameEntries = new Map<string, ContractEntry>();
function gameContract(address: Address): ContractEntry {
  const key = address.toLowerCase();
  let e = _gameEntries.get(key);
  if (!e) {
    e = { address, abi: gcsAbi() };
    _gameEntries.set(key, e);
  }
  return e;
}

// Lower-case hex for a byte buffer (browser-safe; no Node Buffer).
function toHex(u: Uint8Array): `0x${string}` {
  let s = "0x";
  for (const b of u) s += b.toString(16).padStart(2, "0");
  return s as `0x${string}`;
}

function hexToBytes(hex: string): Uint8Array {
  const h = hex.startsWith("0x") ? hex.slice(2) : hex;
  const u = new Uint8Array(h.length / 2);
  for (let i = 0; i < u.length; i++) u[i] = parseInt(h.slice(i * 2, i * 2 + 2), 16);
  return u;
}

// A version-proof Binary-like for runtime-call byte args (dest H160 + input
// calldata). The dashboard's papi 1.x tree duplicates substrate-bindings and the
// ESM-resolved `Binary` lacks asBytes(); the SCALE codec only duck-types
// asBytes()/asHex(), so a plain object satisfies it regardless of which version
// resolves. (papi 2.x accepts a bare hex string for these; 1.x does not.)
function bin(hex: string): { asBytes: () => Uint8Array; asHex: () => string } {
  return { asBytes: () => hexToBytes(hex), asHex: () => hex };
}

// One best-block dry-run read; null on a reverted/failed/incompatible query
// (treated as "non-conformant / absent" by callers).
//
// We go through the runtime-COMPATIBLE `ReviveApi.call` entry — NOT the ink
// SDK's `contract.query`, which routes through `ReviveApi.trace_call`.
// paseo-next-v2 exposes `trace_call` with an incompatible signature, so the ink
// query throws `Incompatible runtime entry RuntimeCall(ReviveApi_trace_call)`,
// which `q` would swallow to null → every game reads as non-conformant → an
// empty dashboard. `ReviveApi.call` is the same standard entry the game's
// gcs.ts uses (proven live); we encode/decode the SolAbi message with viem. The
// decoded shapes match the ABI's snake_case components, so toListing/toEntries
// and the getListing isSome/value handling are unchanged.
async function q<T>(
  entry: ContractEntry,
  method: string,
  data: Record<string, unknown> = {},
): Promise<T | null> {
  const abi = entry.abi as Abi;
  const items = entry.abi as { type?: string; name?: string; inputs?: { name: string }[] }[];
  const fn = items.find((x) => x.type === "function" && x.name === method);
  if (!fn) return null;
  // Map the named-arg object onto positional args in the ABI's declared order.
  const args = (fn.inputs ?? []).map((i) => data[i.name]);

  let input: `0x${string}`;
  try {
    input = encodeFunctionData({ abi, functionName: method as never, args: args as never });
  } catch {
    return null;
  }

  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const api = client().getUnsafeApi() as any;
    // ReviveApi::call(origin, dest, value, gas_limit?, storage_deposit_limit?, input)
    const res = await api.apis.ReviveApi.call(
      READ_ORIGIN,
      bin(entry.address),
      0n,
      undefined,
      undefined,
      bin(input),
      { at: "best" },
    );
    // Result<ExecReturnValue, DispatchError>. A reverted call still returns Ok
    // with the Revert flag (bit 0) set; a trapped/failed call returns !success.
    if (!res?.result?.success) return null;
    const ev = res.result.value;
    if ((Number(ev?.flags ?? 0) & 1) === 1) return null;

    const d = ev?.data;
    const retHex =
      typeof d?.asHex === "function"
        ? (d.asHex() as `0x${string}`)
        : d instanceof Uint8Array
          ? toHex(d)
          : typeof d === "string"
            ? (d as `0x${string}`)
            : undefined;
    if (!retHex) return null;

    return decodeFunctionResult({ abi, functionName: method as never, data: retHex }) as T;
  } catch {
    return null;
  }
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
// refreshed every best block. Failed reads degrade to 0 rather than blanking.
async function readStats(address: Address): Promise<GameStats> {
  const c = gameContract(address);
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
  const version = await q<number>(gameContract(address), "arcadeVersion");
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
    const page = await q<RawGameEntry[]>(registryContract(), "getGames", {
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
      const stats = await Promise.all(addrs.map((a) => statsIfConformant(a)));
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
          const stats = await statsIfConformant(addr);
          if (!stats) return null; // went non-conformant — drop silently
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
          registryContract(),
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
      const c = gameContract(address);
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
      return toEntries(await q<RawEntry[]>(gameContract(address), "getLeaderboard", { offset, limit }));
    },

    async getRecent(address, offset, limit): Promise<ScoreEntry[]> {
      return toEntries(await q<RawEntry[]>(gameContract(address), "getRecent", { offset, limit }));
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
        const c = resolverContract();
        if (c) {
          const name = await q<string>(c, "nameOf", { addr: player });
          if (name && name.length > 0) resolved = name;
        }
      } catch {
        /* keep fallback */
      }
      nameCache.set(key, resolved);
      return resolved;
    },

    onNewBlock(cb): () => void {
      const sub = client().bestBlocks$.subscribe({
        next: (blocks) => {
          const head = blocks[0];
          if (head) cb(head.number);
        },
        error: () => {},
      });
      return () => sub.unsubscribe();
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

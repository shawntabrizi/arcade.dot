import { createClient, type PolkadotClient } from "polkadot-api";
// polkadot-api 2.x removed the `polkadot-api/ws-provider/*` subpaths; the WS
// provider now ships as the standalone `@polkadot-api/ws-provider` package.
import { getWsProvider } from "@polkadot-api/ws-provider";
// Route chain access THROUGH the host instead of dialing the RPC directly.
// A direct WebSocket to the Asset Hub RPC is an external-domain request, so the
// host prompts "Allow access to web domains?" just to read/write the chain.
// createPapiProvider tunnels JSON-RPC through the host's own chain connection
// (no external request, no prompt), with the WS provider as the fallback.
import { createPapiProvider } from "@novasamatech/host-api-wrapper";
import { createInkSdk } from "@polkadot-api/sdk-ink";
import cdmJson from "../../cdm.json";

// Asset Hub genesis for "Paseo Asset Hub Next" (the chain
// `assetHubEndpoint()` points at). The host routes chain access by genesis
// hash: createPapiProvider asks `host_feature_supported(Chain, <genesis>)`, and
// ONLY tunnels through the host when it matches. A WRONG genesis makes that
// check fail, so it silently opens a direct RPC WebSocket — which makes the host
// prompt "Allow access to web domains?". Verified live via getChainSpecData().
const ASSET_HUB_GENESIS =
  "0xbf0488dbe9daa1de1c08c5f743e26fdc2a4ecd74cf87dd1b4b1eeb99ae4ef19f" as const;

// The one game contract the template talks to: the GCS reference (SPEC §4.6).
// Its ABI is identical for every conforming game (SPEC §7.4); the deployed
// address is recorded in cdm.json by the deploy pipeline (SPEC §10.3 step 4).
const CONTRACT_NAME = "@arcade/gcs-reference";

// The origin for read dry-runs. pallet_revive rejects an unmapped origin (an
// arbitrary SS58 like 5C4hrfjw… reverts with AccountUnmapped → empty board), so
// the origin must be one the runtime accepts. Per product-sdk PR #152, the
// canonical query origin is pallet-revive's OWN pallet account — stable, always
// on-chain, and not tied to a dev seed (//Alice). It is
// `PalletId(*b"py/reviv").into_account_truncating()` = bytes "modlpy/reviv" +
// 20 zero bytes, SS58-encoded (prefix 42). Verified to read our GCS contract.
export const READ_ORIGIN = "5EYCAe5ijiYfhaAUBd6H9WGRTsvwFFc7GnhQkiHvBYxdvpbV";

interface ContractEntry {
  address: `0x${string}`;
  abi: unknown[];
}

function target(): string | undefined {
  const targets = (cdmJson as { contracts?: Record<string, unknown> }).contracts;
  return targets ? Object.keys(targets)[0] : undefined;
}

function contractEntry(): ContractEntry | null {
  const t = target();
  if (!t) return null;
  const contracts = (cdmJson as {
    contracts: Record<string, Record<string, { address?: `0x${string}`; abi?: unknown[] }>>;
  }).contracts;
  const entry = contracts[t]?.[CONTRACT_NAME];
  if (!entry?.address || !entry?.abi) return null;
  return { address: entry.address, abi: entry.abi };
}

export function getGcsAddress(): `0x${string}` | null {
  return contractEntry()?.address ?? null;
}

export function isGcsDeployed(): boolean {
  return getGcsAddress() !== null;
}

export function assetHubEndpoint(): string {
  const t = target();
  const targets = (cdmJson as { targets: Record<string, { "asset-hub": string }> }).targets;
  const ep = t ? targets[t]?.["asset-hub"] : undefined;
  if (!ep) throw new Error("cdm.json has no asset-hub endpoint configured.");
  return ep;
}

// In-host: route ALL chain RPC through the host via createPapiProvider with NO
// WS fallback. The fallback arg is "for testing purposes only" (host-api-wrapper
// papiProvider.js) and is exactly what opens a direct WebSocket to the RPC when
// the host route isn't taken — the thing that triggers the web-domain prompt.
// With the correct genesis the host serves the chain and no socket is opened.
// Direct WS only where there is genuinely no host to tunnel through: Node
// (smoke/boot harnesses, `typeof window === "undefined"`) and local dev.
function chainProvider(endpoint: string) {
  const directWs =
    typeof window === "undefined" ||
    /^(localhost|127\.0\.0\.1)(:\d+)?$/.test(window.location.host);
  return directWs ? getWsProvider(endpoint) : createPapiProvider(ASSET_HUB_GENESIS);
}

let client: PolkadotClient | null = null;
export function getClient(): PolkadotClient {
  if (!client) client = createClient(chainProvider(assetHubEndpoint()));
  return client;
}

// Best-block ink SDK (SPEC §7.4 / §8.1: reads + writes at best block so a fresh
// submitScore is visible within a block and a just-included map_account is seen
// by the dry-run that follows).
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let inkBest: any = null;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function inkSdkBest(): any {
  if (!inkBest) inkBest = createInkSdk(getClient(), { atBest: true });
  return inkBest;
}

// The raw best-block ink contract: `.query(...)` for reads/dry-runs and the
// dry-run's `.send()` for a watchable PAPI tx. Null when not deployed.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function gcsContract(): any | null {
  const entry = contractEntry();
  if (!entry) return null;
  return inkSdkBest().getContract({ abi: entry.abi }, entry.address);
}

// A best-block read (dry-run). `origin` MUST be a mapped account (see
// READ_ORIGIN) or pallet_revive reverts with AccountUnmapped. Returns the
// decoded value, or null on a reverted/failed query.
export async function gcsQuery<T>(
  method: string,
  data: Record<string, unknown>,
  origin: string,
): Promise<T | null> {
  const contract = gcsContract();
  if (!contract) return null;
  const r = await contract.query(method, { origin, data });
  return r.success ? (r.value.response as T) : null;
}

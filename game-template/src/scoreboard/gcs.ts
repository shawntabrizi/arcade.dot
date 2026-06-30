import { createClient, Binary, type PolkadotClient } from "polkadot-api";
// polkadot-api 2.x removed the `polkadot-api/ws-provider/*` subpaths; the WS
// provider now ships as the standalone `@polkadot-api/ws-provider` package.
import { getWsProvider } from "@polkadot-api/ws-provider";
import { createInkSdk } from "@polkadot-api/sdk-ink";
import { encodeFunctionData, decodeFunctionResult, type Abi } from "viem";
import cdmJson from "../../cdm.json";

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

let client: PolkadotClient | null = null;
export function getClient(): PolkadotClient {
  if (!client) client = createClient(getWsProvider(assetHubEndpoint()));
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

// Lower-case hex for a byte buffer (browser-safe; no Node Buffer).
function toHex(u: Uint8Array): `0x${string}` {
  let s = "0x";
  for (const b of u) s += b.toString(16).padStart(2, "0");
  return s as `0x${string}`;
}

// A best-block read (dry-run). `origin` MUST be a mapped account (see
// READ_ORIGIN) or pallet_revive reverts with AccountUnmapped. Returns the
// decoded value, or null on a reverted/failed query.
//
// We go through the runtime-COMPATIBLE `ReviveApi.call` runtime entry — NOT the
// ink SDK's `contract.query`, which routes through `ReviveApi.trace_call`.
// paseo-next-v2 exposes `trace_call` with an incompatible signature, so the ink
// query throws `Incompatible runtime entry RuntimeCall(ReviveApi_trace_call)` —
// the error that broke getBest at game-over and the submit dry-run in-host
// (confirmed live). `ReviveApi.call` is the same standard entry the proven
// dApp-factory template uses; we encode/decode the SolAbi message with viem.
export async function gcsQuery<T>(
  method: string,
  data: Record<string, unknown>,
  origin: string,
): Promise<T | null> {
  const entry = contractEntry();
  if (!entry) return null;
  const abi = entry.abi as Abi;
  // Map the named-arg object onto positional args in the ABI's declared order.
  const items = entry.abi as { type?: string; name?: string; inputs?: { name: string }[] }[];
  const fn = items.find((x) => x.type === "function" && x.name === method);
  if (!fn) return null;
  const args = (fn.inputs ?? []).map((i) => data[i.name]);

  const input = encodeFunctionData({
    abi,
    functionName: method as never,
    args: args as never,
  });

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const api = getClient().getUnsafeApi() as any;
  // ReviveApi::call(origin, dest, value, gas_limit?, storage_deposit_limit?, input)
  const res = await api.apis.ReviveApi.call(
    origin,
    entry.address,
    0n,
    undefined,
    undefined,
    Binary.fromHex(input),
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

  try {
    return decodeFunctionResult({ abi, functionName: method as never, data: retHex }) as T;
  } catch {
    return null;
  }
}

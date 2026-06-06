import { createClient, type PolkadotClient } from "polkadot-api";
import { getWsProvider } from "polkadot-api/ws-provider/web";
import { createInkSdk } from "@polkadot-api/sdk-ink";
import cdmJson from "../../cdm.json";

// The one game contract the template talks to: the GCS reference (SPEC §4.6).
// Its ABI is identical for every conforming game (SPEC §7.4); the deployed
// address is recorded in cdm.json by the deploy pipeline (SPEC §10.3 step 4).
const CONTRACT_NAME = "@arcade/gcs-reference";

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

// A best-block read (dry-run). `origin` is any SS58 — reads don't need a funded
// or mapped account. Returns the decoded value, or null on a reverted/failed
// query.
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

import { createCdm, type Cdm } from "@dotdm/cdm";
import { createInkSdk } from "@polkadot-api/sdk-ink";
import type { PolkadotSigner } from "polkadot-api";
import cdmJson from "../../cdm.json";
import { getBurnerSigner, getBurnerSs58 } from "./signer";
import { submitInBlock } from "./tx";

let instance: Cdm | null = null;

export function getCdm(): Cdm {
  if (!instance) {
    instance = createCdm(cdmJson, {
      defaultSigner: getBurnerSigner(),
      defaultOrigin: getBurnerSs58(),
    });
  }
  return instance;
}

// A dedicated ink SDK pinned to the *best* block, not the finalized one. This
// is what makes the in-block write strategy (see tx.ts) coherent: dry-runs,
// reads, and the account-mapping check all see a just-included tx instead of
// lagging ~finality behind it. cdm's own inkSdk reads at finalized, so we make
// our own from the same client and route all contract interaction through it.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let inkBest: any = null;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function inkSdkBest(): any {
  if (!inkBest) inkBest = createInkSdk(getCdm().client, { atBest: true });
  return inkBest;
}

interface ContractEntry {
  address: `0x${string}`;
  abi: unknown[];
}

function contractEntry(name: string): ContractEntry | null {
  const contracts = (cdmJson as { contracts?: Record<string, unknown> })
    .contracts as
    | Record<string, Record<string, { address?: `0x${string}`; abi?: unknown[] }>>
    | undefined;
  const target = contracts ? Object.keys(contracts)[0] : undefined;
  if (!target) return null;
  const entry = contracts?.[target]?.[name];
  if (!entry?.address || !entry?.abi) return null;
  return { address: entry.address, abi: entry.abi };
}

export function getContractAddress(name: string): `0x${string}` | null {
  return contractEntry(name)?.address ?? null;
}

export function isContractInstalled(name: string): boolean {
  return getContractAddress(name) !== null;
}

// The raw ink contract (best-block), exposing `.send(...)` (a PAPI tx we can
// watch to inclusion) and `.query(...)` — unlike cdm's wrapper, whose `.tx` is
// hardcoded to finalization. All reads and writes funnel through here.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function inkContract(name: string): any | null {
  const entry = contractEntry(name);
  if (!entry) return null;
  return inkSdkBest().getContract({ abi: entry.abi }, entry.address);
}

// A read (dry-run) at the best block. Returns the decoded response, or null on
// a failed/reverted query.
export async function contractQuery<T>(
  name: string,
  method: string,
  data: Record<string, unknown>,
  origin: string,
): Promise<T | null> {
  const contract = inkContract(name);
  if (!contract) return null;
  const r = await contract.query(method, { origin, data });
  return r.success ? (r.value.response as T) : null;
}

// Send a contract write and resolve at best-block inclusion — the in-block
// equivalent of cdm's finalization-bound `.tx`, and the single funnel for every
// on-chain write. We dry-run first (at best block, so a just-mapped burner is
// visible) and submit via the dry-run's own `.send()`, which fills both the gas
// and the storage-deposit limits pallet_revive requires.
export async function contractSendInBlock(
  name: string,
  method: string,
  data: Record<string, unknown>,
  origin: string,
  signer: PolkadotSigner,
): Promise<void> {
  const contract = inkContract(name);
  if (!contract) throw new Error(`Contract ${name} is not in cdm.json.`);
  const dry = await contract.query(method, { origin, data });
  if (!dry.success) {
    throw new Error(
      `dry-run of ${method} failed: ${JSON.stringify(dry.value, (_k, v) =>
        typeof v === "bigint" ? v.toString() : v,
      )}`,
    );
  }
  await submitInBlock(dry.value.send(), signer);
}

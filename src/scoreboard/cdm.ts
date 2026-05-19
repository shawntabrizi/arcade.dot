import { createCdm, type Cdm } from "@dotdm/cdm";
import cdmJson from "../../cdm.json";
import { getBurnerSigner, getBurnerSs58 } from "./signer";

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

export function getContractAddress(name: string): `0x${string}` | null {
  const target = Object.keys(
    (cdmJson as { contracts?: Record<string, unknown> }).contracts ?? {},
  )[0];
  if (!target) return null;
  const contracts = (cdmJson as {
    contracts: Record<string, Record<string, { address?: `0x${string}` }>>;
  }).contracts;
  return contracts[target]?.[name]?.address ?? null;
}

export function isContractInstalled(name: string): boolean {
  return getContractAddress(name) !== null;
}

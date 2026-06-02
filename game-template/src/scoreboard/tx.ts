import type { PolkadotSigner } from "polkadot-api";

// Submit a transaction and resolve as soon as it's included in a best block,
// instead of waiting for GRANDPA finalization (what `signAndSubmit` does).
//
// Finalization on Asset Hub is several blocks behind inclusion, so this is a
// ~2-4x latency win. The trade-off is durability: a best block can in theory
// be reorged. For a game leaderboard that's an acceptable risk — and the tx is
// already broadcast, so it still finalizes on-chain regardless of when we stop
// watching. This is a deliberate departure from the "resolve only when durable"
// convention; see CLAUDE.md.
//
// Works for any PAPI submittable: raw `api.tx.*(...)` and ink `contract.send(...)`
// both expose `signSubmitAndWatch`.

interface TxEvent {
  type: string;
  found?: boolean;
  ok?: boolean;
  txHash?: string;
  dispatchError?: unknown;
}

interface Subscription {
  unsubscribe: () => void;
}

interface Watchable {
  signSubmitAndWatch: (signer: PolkadotSigner) => {
    subscribe: (observer: {
      next: (event: TxEvent) => void;
      error: (err: unknown) => void;
    }) => Subscription;
  };
}

export interface InBlockResult {
  txHash: string;
  ok: boolean;
}

function stringify(value: unknown): string {
  return JSON.stringify(value, (_k, v) =>
    typeof v === "bigint" ? v.toString() : v,
  );
}

export function submitInBlock(
  tx: Watchable,
  signer: PolkadotSigner,
): Promise<InBlockResult> {
  return new Promise<InBlockResult>((resolve, reject) => {
    let settled = false;
    let sub: Subscription | undefined;

    const finish = (fn: () => void) => {
      if (settled) return;
      settled = true;
      // Stop tracking once we've seen inclusion; the tx is already on the
      // network and will finalize on its own.
      queueMicrotask(() => sub?.unsubscribe());
      fn();
    };

    sub = tx.signSubmitAndWatch(signer).subscribe({
      next: (event) => {
        // First sighting in a best block (or, defensively, finalization).
        const included =
          (event.type === "txBestBlocksState" && event.found === true) ||
          event.type === "finalized";
        if (!included) return;
        if (event.ok === false) {
          finish(() =>
            reject(new Error(`transaction reverted: ${stringify(event.dispatchError)}`)),
          );
        } else {
          finish(() => resolve({ txHash: event.txHash ?? "", ok: true }));
        }
      },
      error: (err) => finish(() => reject(err)),
    });
  });
}

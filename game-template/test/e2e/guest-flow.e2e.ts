import { test, expect, type Page } from "@playwright/test";
import type { FakeGatewayConfig } from "../../src/scoreboard/fake-gateway";
import cdm from "../../cdm.json" with { type: "json" };

// E2E for the SPEC §8.3 guest / save-score / sign-in flows. The chain is faked
// at the ChainGateway seam (src/scoreboard/fake-gateway.ts), wired in by App.tsx
// only under VITE_ARCADE_FAKE_GATEWAY=1 (set by playwright.config.ts's dev
// server). Each test seeds window.__ARCADE_FAKE__.config BEFORE the app boots
// via addInitScript, then drives a deterministic game-over via the test-only
// window.__snakeForceGameOver hook.

// The in-game guest-store key is `arcade:guest-best:<gameKey>` where gameKey is
// the deployed GCS address from cdm.json (App.tsx: getGcsAddress()). Derive it
// the SAME way the app does, so a redeploy that rewrites cdm.json's address
// never silently diverges the test key from the app's (which previously caused
// false failures here).
const _cdmContracts = (cdm as { contracts: Record<string, Record<string, { address?: string }>> }).contracts;
const _target = Object.keys(_cdmContracts)[0];
const GAME_KEY =
  _cdmContracts[_target]?.["@arcade/gcs-reference"]?.address ?? "local";
const GUEST_BEST_KEY = `arcade:guest-best:${GAME_KEY}`;

const SIGNED_IN_PLAYER = "0x00000000000000000000000000000000000000bb" as const;
const CONNECTS_TO = "0x00000000000000000000000000000000000000aa" as const;

// Seed the per-test fake config and a clean localStorage before the app's JS
// runs. Optionally pre-seed the guest best (for the non-improving case).
async function boot(page: Page, config: FakeGatewayConfig, guestBest?: number) {
  await page.addInitScript(
    ([cfg, key, best]) => {
      // The window-scoped fake handle (config + recorded calls) is re-seeded on
      // every load — it doesn't survive navigation. localStorage seeding is
      // one-time (guarded by a sentinel) so a reload exercises real persistence
      // rather than re-wiping the held guest score.
      const SENTINEL = "__arcade_e2e_seeded__";
      if (!window.localStorage.getItem(SENTINEL)) {
        window.localStorage.clear();
        window.localStorage.setItem(SENTINEL, "1");
        if (best !== null) window.localStorage.setItem(key as string, String(best));
      }
      window.__ARCADE_FAKE__ = {
        config: cfg as Record<string, unknown>,
        state: { connectCalls: 0, mappedCalls: 0, submits: [] },
      } as unknown as Window["__ARCADE_FAKE__"];
    },
    [config, GUEST_BEST_KEY, guestBest ?? null] as const,
  );
  await page.goto("/");
  // Wait for the game canvas (proves the app booted, not gated/erroring).
  await expect(page.locator("canvas.snake-canvas")).toBeVisible();
}

async function forceGameOver(page: Page, score: number) {
  await page.evaluate((s) => {
    const fn = (window as unknown as { __snakeForceGameOver?: (n: number) => void })
      .__snakeForceGameOver;
    if (!fn) throw new Error("__snakeForceGameOver hook missing — is the test flag set?");
    fn(s);
  }, score);
}

async function submits(page: Page): Promise<number[]> {
  return page.evaluate(() => window.__ARCADE_FAKE__?.state.submits ?? []);
}

test("1. guest game-over (score > 0) shows the save prompt; dismissing keeps the score across reload", async ({
  page,
}) => {
  await boot(page, { ordering: 0, player: null });
  await forceGameOver(page, 7);

  // The save-score nudge appears (SPEC §8.3).
  await expect(page.getByText("Sign in to save your score")).toBeVisible();

  // No chain interaction happened on the guest path.
  expect(await submits(page)).toEqual([]);

  // The held score is persisted locally (SPEC §8.3: held locally, survives session).
  const held = await page.evaluate((k) => window.localStorage.getItem(k), GUEST_BEST_KEY);
  expect(held).toBe("7");

  // Dismiss ("Keep playing as guest") returns to play; the stored score remains.
  await page.getByRole("button", { name: "Keep playing as guest" }).click();
  await expect(page.getByText("Sign in to save your score")).toBeHidden();

  // Persists across a reload.
  await page.reload();
  await expect(page.locator("canvas.snake-canvas")).toBeVisible();
  const afterReload = await page.evaluate((k) => window.localStorage.getItem(k), GUEST_BEST_KEY);
  expect(afterReload).toBe("7");
});

test("2. guest accepts sign-in → exactly ONE submitScore of the held score, prompt gone, board entry shown", async ({
  page,
}) => {
  await boot(page, { ordering: 0, player: null, connectsTo: CONNECTS_TO });
  await forceGameOver(page, 12);
  await expect(page.getByText("Sign in to save your score")).toBeVisible();

  await page.getByRole("button", { name: "Sign in & save" }).click();

  // Exactly one submit, of the held score (SPEC §10.4 submit-once).
  await expect.poll(() => submits(page)).toEqual([12]);

  // Prompt dismissed; the optimistic board entry (the connected player) shows.
  await expect(page.getByText("Sign in to save your score")).toBeHidden();
  await expect(page.locator(".leaderboard .is-you")).toHaveCount(2); // top list + recent list
});

test("3. signed-in player → game-over submits directly, exactly once, no prompt", async ({
  page,
}) => {
  await boot(page, { ordering: 0, player: SIGNED_IN_PLAYER });
  await forceGameOver(page, 5);

  // No nudge for a signed-in player.
  await expect(page.getByText("Sign in to save your score")).toBeHidden();

  // Submitted directly, exactly once.
  await expect.poll(() => submits(page)).toEqual([5]);
});

test("4. requiresAccount=true gates at launch; play is blocked until sign-in", async ({ page }) => {
  await page.addInitScript(() => {
    window.localStorage.clear();
    window.__ARCADE_FAKE__ = {
      config: { ordering: 0, player: null, requiresAccount: true, connectsTo: "0x00000000000000000000000000000000000000aa" },
      state: { connectCalls: 0, mappedCalls: 0, submits: [] },
    } as unknown as Window["__ARCADE_FAKE__"];
  });
  await page.goto("/");

  // Launch gate is shown; the game canvas is NOT (play blocked) — SPEC §8.3.
  await expect(page.getByText("This game requires an account")).toBeVisible();
  await expect(page.locator("canvas.snake-canvas")).toHaveCount(0);

  // Signing in clears the gate and reveals the game.
  await page.getByRole("button", { name: "Sign in with your host wallet" }).click();
  await expect(page.locator("canvas.snake-canvas")).toBeVisible();
});

test("5. guest non-improving score (known best higher, higher-is-better) → no save prompt", async ({
  page,
}) => {
  // Guest already has a stored best of 50; a new score of 30 does not improve it.
  await boot(page, { ordering: 0, player: null }, 50);
  await forceGameOver(page, 30);

  // No nudge (SPEC §8.3: don't pester about a score that wouldn't change standing).
  await expect(page.getByText("Sign in to save your score")).toBeHidden();
  expect(await submits(page)).toEqual([]);
  // The stored best is untouched.
  const held = await page.evaluate((k) => window.localStorage.getItem(k), GUEST_BEST_KEY);
  expect(held).toBe("50");
});

// ── On-load login-status detection + UX (SPEC §8.1/§8.3) ────────────────────
// The three honest states shown on load, prompt-free (no connect() on boot).

test("6. SIGNED IN on load: shows 'Signed in as …', no boot connect()", async ({ page }) => {
  await boot(page, { ordering: 0, player: SIGNED_IN_PLAYER, inHost: true });
  await expect(page.getByText("Signed in as", { exact: false })).toBeVisible();
  // Detection is passive — no connect() fired just by loading.
  expect(await page.evaluate(() => window.__ARCADE_FAKE__?.state.connectCalls)).toBe(0);
});

test("7. IN-HOST GUEST on load: nudge + a 'Sign in' action available NOW (pre game-over)", async ({
  page,
}) => {
  await boot(page, { ordering: 0, player: null, inHost: true, connectsTo: CONNECTS_TO });
  await expect(page.getByText("in the Polkadot app", { exact: false })).toBeVisible();

  const signIn = page.getByRole("button", { name: "Sign in", exact: true });
  await expect(signIn).toBeVisible();
  // No connect() until the user clicks (detection is prompt-free).
  expect(await page.evaluate(() => window.__ARCADE_FAKE__?.state.connectCalls)).toBe(0);

  // Clicking signs in → transitions to SIGNED IN, with no game played yet.
  await signIn.click();
  await expect(page.getByText("Signed in as", { exact: false })).toBeVisible();
});

test("8. STANDALONE GUEST on load: guest message, NO sign-in button", async ({ page }) => {
  await boot(page, { ordering: 0, player: null, inHost: false });
  await expect(page.getByText("open this game in the Polkadot app", { exact: false })).toBeVisible();
  // Sign-in is unavailable standalone (connect would fail) — no button offered.
  await expect(page.getByRole("button", { name: "Sign in", exact: true })).toHaveCount(0);
});

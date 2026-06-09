import { test, expect, type Page } from "@playwright/test";
import type { FakeGatewayConfig } from "../../src/scoreboard/fake-gateway";

// E2E for the Account tab (SPEC §8.1). The chain/host is faked at the
// ChainGateway seam; the fake's accountDetails()/mapAccount() are driven by
// window.__ARCADE_FAKE__.config (free balance, mapping, identifier, etc.).
// Runs at a mobile viewport so the bottom tab bar (and the Account tab) is
// present — on desktop all panels show at once and there is no tab to click.

const PLAYER = "0x00000000000000000000000000000000000000bb" as const;
const SS58 = "5GrwvaEF5zXb26Fz9rcQpDWS57CtERHpNehXCPcNoHGKutQY";

async function boot(page: Page, config: FakeGatewayConfig) {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.addInitScript((cfg) => {
    window.localStorage.clear();
    window.__ARCADE_FAKE__ = {
      config: cfg as Record<string, unknown>,
      state: { connectCalls: 0, mappedCalls: 0, submits: [], mapAccountCalls: 0 },
    } as unknown as Window["__ARCADE_FAKE__"];
  }, config as unknown as Record<string, unknown>);
  await page.goto("/");
  await expect(page.locator("canvas.snake-canvas")).toBeVisible();
  await page.getByRole("button", { name: "Account" }).click();
}

test("Account tab shows derivation, addresses, balance and mapped status", async ({ page }) => {
  await boot(page, {
    ordering: 0,
    player: PLAYER,
    playerSs58: SS58,
    identifier: "arcade-snake.dot",
    derivationIndex: 0,
    free: 15_000_000_000, // 1.5 PAS at 10 decimals
    mapped: true,
    decimals: 10,
    symbol: "PAS",
  });

  // Derivation path + the private-root-account note.
  await expect(page.getByText("product / arcade-snake.dot / 0")).toBeVisible();
  await expect(page.getByText("private to the host", { exact: false })).toBeVisible();

  // Addresses (truncated) + a copy control for each.
  await expect(page.getByText("Your account (SS58)")).toBeVisible();
  await expect(page.getByText("In-game ID (H160)")).toBeVisible();
  await expect(page.getByRole("button", { name: "Copy Your account (SS58)" })).toBeVisible();

  // Balance formatted with the symbol, and mapped status.
  await expect(page.getByText("1.5 PAS")).toBeVisible();
  await expect(page.getByText("ready to save scores")).toBeVisible();

  // Faucet action present; no Map button when already mapped.
  await expect(page.getByRole("link", { name: "Get test funds" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Get test funds" })).toHaveAttribute(
    "href",
    /faucet\.polkadot\.io.*address=/,
  );
  await expect(page.getByRole("button", { name: "Map account to save scores" })).toHaveCount(0);
});

test("Account tab: an unmapped account offers Map, and mapping flips the status", async ({
  page,
}) => {
  await boot(page, {
    ordering: 0,
    player: PLAYER,
    playerSs58: SS58,
    identifier: "arcade-snake.dot",
    free: 0,
    mapped: false,
  });

  await expect(page.getByText("Not mapped", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Map account to save scores" }).click();

  // mapAccount() was invoked exactly once, and the tab reloads to Mapped.
  await expect
    .poll(() => page.evaluate(() => window.__ARCADE_FAKE__?.state.mapAccountCalls))
    .toBe(1);
  await expect(page.getByText("ready to save scores")).toBeVisible();
});

test("desktop: right column tabs between Scoreboard (default) and Account", async ({ page }) => {
  // On desktop the game is always on the left and the right column is a tabbed
  // card: Scoreboard (default) / Account. Account no longer stacks below the
  // boards (which pushed it off-screen). Account data still loads on sign-in, so
  // switching to the Account tab shows it immediately — never "Couldn't load".
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.addInitScript((cfg) => {
    window.localStorage.clear();
    window.__ARCADE_FAKE__ = {
      config: cfg as Record<string, unknown>,
      state: { connectCalls: 0, mappedCalls: 0, submits: [], mapAccountCalls: 0 },
    } as unknown as Window["__ARCADE_FAKE__"];
  }, {
    ordering: 0,
    player: PLAYER,
    playerSs58: SS58,
    identifier: "arcade-snake.dot",
    free: 15_000_000_000,
    mapped: true,
  } as unknown as Record<string, unknown>);
  await page.goto("/");
  await expect(page.locator("canvas.snake-canvas")).toBeVisible();

  // Default: Scoreboard shown, Account hidden (not stacked below).
  await expect(page.locator(".panel-boards")).toBeVisible();
  await expect(page.locator(".panel-account")).toBeHidden();

  // Switch to the Account tab (the desktop right-column tab strip).
  await page.getByRole("tab", { name: "Account" }).click();
  await expect(page.locator(".panel-account")).toBeVisible();
  await expect(page.locator(".panel-boards")).toBeHidden();
  // Already loaded on sign-in — content shows, never the error fallback.
  await expect(page.getByText("product / arcade-snake.dot / 0")).toBeVisible();
  await expect(page.getByText("1.5 PAS")).toBeVisible();
  await expect(page.getByText("Couldn't load your account.")).toHaveCount(0);

  // And back to the Scoreboard.
  await page.getByRole("tab", { name: "Scoreboard" }).click();
  await expect(page.locator(".panel-boards")).toBeVisible();
  await expect(page.locator(".panel-account")).toBeHidden();
});

test("Account tab when signed out (in-host) prompts sign-in", async ({ page }) => {
  await boot(page, {
    ordering: 0,
    player: null,
    inHost: true,
    connectsTo: PLAYER,
    playerSs58: SS58,
  });
  await expect(page.getByText("Sign in to view your account")).toBeVisible();
});

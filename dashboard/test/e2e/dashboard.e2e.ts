import { test, expect, type Page } from "@playwright/test";

// End-to-end coverage for the dashboard (BUILD_PLAN item 15, SPEC §7).
//
// The app is served with VITE_ARCADE_FAKE_READS=1 (see playwright.config.ts), so
// every assertion below is against the deterministic fixtures in
// src/fake-reads.ts (SAMPLE_GAMES + the fixture reverse-resolver). No RPC.
//
// Fixture facts these tests pin to (keep in sync with src/fake-reads.ts):
//   A1 Snake       arcade        playCount 1280  lastPlayed NOW-60   reg NOW-10d  fmt 0 points
//   A2 Time Trial  racing        playCount 540   lastPlayed NOW-600  reg NOW-3d   fmt 1 duration(ms)
//   A3 Lap Battle  multiplayer*  playCount 30    lastPlayed 0        reg NOW-1d   fmt 2 unit "laps"
//   ghost          (arcadeVersion=null) playCount 999999  — MUST NOT render (§7.4 gate)
//   * "multiplayer" is an unknown gameType → buckets under "other" (§5.4)
// Player names: P1 (0xaaaa…) → "alice.dot" (mapped, shown as "alice"); P2
// (0xbbbb…) unmapped → abstracted to a friendly alias, never the raw address.

const A1 = "0x1111111111111111111111111111111111111111";
const A2 = "0x2222222222222222222222222222222222222222";
const A3 = "0x3333333333333333333333333333333333333333";

// Wait until the home view has rendered (the async fake read resolved): the
// sortable game list is the first thing to populate.
async function gotoHome(page: Page) {
  await page.goto("/#/");
  await expect(page.locator(".gamelist__row").first()).toBeVisible();
}

test.describe("Home — game list, featured hero, conformance gate", () => {
  test("lists the conformant games and hides the non-conformant ghost (§7.4)", async ({
    page,
  }) => {
    await gotoHome(page);

    // The three conformant games appear by name in the left list.
    for (const name of ["Snake", "Time Trial", "Lap Battle"]) {
      await expect(page.locator(".gamelist__name", { hasText: name })).toBeVisible();
    }

    // The ghost listing (registered but non-conformant) is filtered out — it
    // never appears despite its huge playCount, which would otherwise top the list.
    await expect(page.locator(".gamelist__name", { hasText: "Ghost" })).toHaveCount(0);
    await expect(page.getByText("999,999")).toHaveCount(0);
  });

  test("featured hero is the most-recently-active game (§7.1)", async ({ page }) => {
    await gotoHome(page);
    // Featured = lastPlayedAt desc → Snake (NOW-60) is the hero.
    await expect(page.locator(".feature__name")).toHaveText("Snake");
  });

  test("the game list is sortable (§7.1)", async ({ page }) => {
    await gotoHome(page);
    const names = page.locator(".gamelist__name");

    // Default sort = Most played → Snake (1280) is first.
    await expect(names.first()).toHaveText("Snake");

    // Switch to Name (A–Z) → Lap Battle sorts first.
    await page.locator(".gamelist__sort").selectOption("name");
    await expect(names.first()).toHaveText("Lap Battle");

    // Newest = registeredAt desc → Lap Battle (NOW-1d) first.
    await page.locator(".gamelist__sort").selectOption("new");
    await expect(names.first()).toHaveText("Lap Battle");
  });

  test("the game list filters by category chip and name search (§5.4)", async ({ page }) => {
    await gotoHome(page);
    const names = page.locator(".gamelist__name");
    const chips = page.locator(".gamelist__chip");

    // "all" plus exactly the buckets present: arcade, racing, other.
    await expect(chips).toHaveText(["all", "arcade", "racing", "other"]);

    // Category filter: "arcade" → only Snake survives.
    await chips.filter({ hasText: "arcade" }).click();
    await expect(names).toHaveText(["Snake"]);

    // "other" → Lap Battle (gameType "multiplayer" buckets to other, §5.4).
    await chips.filter({ hasText: "other" }).click();
    await expect(names).toHaveText(["Lap Battle"]);

    // Back to all, then name search narrows to a single match.
    await chips.filter({ hasText: "all" }).click();
    await page.locator(".gamelist__search").fill("time");
    await expect(names).toHaveText(["Time Trial"]);

    // A non-matching query shows the empty state.
    await page.locator(".gamelist__search").fill("zzz");
    await expect(page.locator(".gamelist__empty")).toBeVisible();
    await expect(names).toHaveCount(0);
  });
});

test.describe("Detail — hero, Play button, name resolution, score formats (§7.3, §7.5, §8.2)", () => {
  test("Snake (points format): hero, integer scores, mapped + truncated names, Play link", async ({
    page,
  }) => {
    // Navigate by direct hash deep-link.
    await page.goto(`/#/game/${A1}`);

    await expect(page.locator(".hero__name")).toHaveText("Snake");

    // Stats block renders the three Module A stats.
    await expect(page.locator(".stats .stat-box")).toHaveCount(3);
    await expect(page.locator(".stats")).toContainText("1,280"); // playCount
    await expect(page.locator(".stats")).toContainText("342"); // uniquePlayers

    // Leaderboard: format 0 = integer points. Rank 1 = P1 (alice.dot, mapped),
    // rank 2 = P2 (unmapped → truncated address). Scores are plain integers.
    const board = page.locator(".board__list .board__row");
    await expect(board).toHaveCount(2);
    // Mapped player shows the bare username, ".dot" stripped (§8.2).
    await expect(board.nth(0).locator(".board__player")).toHaveText("alice");
    await expect(board.nth(0).locator(".board__score")).toHaveText("9001");
    // Unmapped player is abstracted to a friendly alias — never the raw address.
    await expect(board.nth(1).locator(".board__player")).not.toContainText("0x");
    await expect(board.nth(1).locator(".board__score")).toHaveText("880");

    // Recent plays section is present and populated.
    await expect(page.locator(".recent .recent__row").first()).toBeVisible();

    // Play button (§7.5): anchor, target=_blank, href derived from playUrl
    // "arcade-snake.dot" → https://arcade-snake.paseo.li.
    const play = page.locator(".btn--play");
    await expect(play).toHaveJSProperty("tagName", "A");
    await expect(play).toHaveAttribute("target", "_blank");
    // Bare-label playUrl ("arcade-snake.dot") is rebuilt to https://<label>.paseo.li
    // directly (no URL normalization), so no trailing slash.
    await expect(play).toHaveAttribute("href", "https://arcade-snake.paseo.li");
  });

  test("Time Trial (duration format): score renders m:ss.mmm", async ({ page }) => {
    await page.goto(`/#/game/${A2}`);
    await expect(page.locator(".hero__name")).toHaveText("Time Trial");
    // 83456 ms → 1:23.456 ; 605000 ms → 10:05.000 (§4.2 scoreFormat 1).
    const scores = page.locator(".board__list .board__score");
    await expect(scores.nth(0)).toHaveText("1:23.456");
    await expect(scores.nth(1)).toHaveText("10:05.000");
    // playUrl is a legacy full dot.li URL → host healed to the paseo.li viewer.
    await expect(page.locator(".btn--play")).toHaveAttribute(
      "href",
      "https://time-trial.paseo.li/",
    );
  });

  test("Lap Battle (custom unit): score renders value + unit", async ({ page }) => {
    await page.goto(`/#/game/${A3}`);
    await expect(page.locator(".hero__name")).toHaveText("Lap Battle");
    // 42 with unit "laps" → "42 laps" (§4.2 scoreFormat 2).
    await expect(page.locator(".board__list .board__score").first()).toHaveText("42 laps");
    // requiresAccount listing shows the badge.
    await expect(page.locator(".badge--account")).toBeVisible();
  });

  test("navigating from the game list opens the matching detail page", async ({ page }) => {
    await gotoHome(page);
    await page
      .locator(".gamelist__row", { has: page.locator(".gamelist__name", { hasText: "Snake" }) })
      .first()
      .click();
    await expect(page.locator(".hero__name")).toHaveText("Snake");
    expect(page.url()).toContain(`#/game/${A1}`);
  });
});

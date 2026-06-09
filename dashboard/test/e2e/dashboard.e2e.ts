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
// Player names: P1 (0xaaaa…) → "alice.dot" (mapped); P2 (0xbbbb…) unmapped → truncated.

const A1 = "0x1111111111111111111111111111111111111111";
const A2 = "0x2222222222222222222222222222222222222222";
const A3 = "0x3333333333333333333333333333333333333333";

// Wait until the home grid has rendered cards (the async fake read resolved).
async function gotoHome(page: Page) {
  await page.goto("/#/");
  await expect(page.locator(".card").first()).toBeVisible();
}

test.describe("Home — listing, conformance gate, ordering", () => {
  test("renders the conformant games and hides the non-conformant ghost (§7.4)", async ({
    page,
  }) => {
    await gotoHome(page);

    // The three conformant games appear by name somewhere on the page.
    for (const name of ["Snake", "Time Trial", "Lap Battle"]) {
      await expect(page.locator(".card__name", { hasText: name }).first()).toBeVisible();
    }

    // The ghost listing (registered but non-conformant) is filtered out — it
    // never appears as a card despite its huge playCount, which would otherwise
    // place it first in Most Played / Featured.
    await expect(page.locator(".card__name", { hasText: "Ghost" })).toHaveCount(0);
    await expect(page.getByText("999,999")).toHaveCount(0);
  });

  test("the three home sections are present and correctly ordered (§7.1)", async ({
    page,
  }) => {
    await gotoHome(page);

    const sections = page.locator("section.row");
    // Featured, Most played, New, All games — in that DOM order.
    await expect(sections.nth(0).locator(".section__title")).toHaveText("Featured");
    await expect(sections.nth(1).locator(".section__title")).toHaveText("Most played");
    await expect(sections.nth(2).locator(".section__title")).toHaveText("New");
    await expect(sections.nth(3).locator(".section__title")).toHaveText("All games");

    // Featured = lastPlayedAt desc → Snake (NOW-60) is first.
    await expect(sections.nth(0).locator(".card__name").first()).toHaveText("Snake");
    // Most played = playCount desc → Snake (1280) is first.
    await expect(sections.nth(1).locator(".card__name").first()).toHaveText("Snake");
    // New = registeredAt desc → Lap Battle (NOW-1d) is first.
    await expect(sections.nth(2).locator(".card__name").first()).toHaveText("Lap Battle");
  });
});

test.describe("Home — gameType filter chips (§5.4)", () => {
  test("clicking a chip filters the All-games grid; unknown type buckets to 'other'", async ({
    page,
  }) => {
    await gotoHome(page);

    const allGames = page.locator("section.row").nth(3);
    const chips = allGames.locator(".chip--filter");

    // "all" plus exactly the buckets present: arcade, racing, other.
    await expect(chips).toHaveText(["all", "arcade", "racing", "other"]);

    // Filter to "arcade": only Snake remains in this section's grid.
    await chips.filter({ hasText: "arcade" }).click();
    await expect(allGames.locator(".card__name")).toHaveText(["Snake"]);

    // Lap Battle's gameType is "multiplayer" (unknown) → it shows only under the
    // "other" bucket, proving the §5.4 catch-all.
    await chips.filter({ hasText: "other" }).click();
    await expect(allGames.locator(".card__name")).toHaveText(["Lap Battle"]);

    // "racing" → Time Trial.
    await chips.filter({ hasText: "racing" }).click();
    await expect(allGames.locator(".card__name")).toHaveText(["Time Trial"]);
  });
});

test.describe("Home — live activity rail (§7.1 item 5)", () => {
  test("shows recent-play rows merged from the fixtures", async ({ page }) => {
    await gotoHome(page);

    const rail = page.locator(".rail");
    await expect(rail.locator(".section__title")).toHaveText("Live activity");

    // Snake (P3, P1) + Time Trial (P2) contribute recent rows; Lap Battle has
    // lastPlayedAt 0 so contributes none. Expect at least those three rows.
    const rows = rail.locator(".rail__row");
    await expect(rows.first()).toBeVisible();
    expect(await rows.count()).toBeGreaterThanOrEqual(3);

    // A row links to a game and carries the mapped name where one exists.
    await expect(rail.getByText("alice.dot").first()).toBeVisible();
  });
});

test.describe("Home — player name resolution on cards (§8.2)", () => {
  test("a card's top player shows the resolved .dot name", async ({ page }) => {
    await gotoHome(page);
    // Snake's rank-1 player is P1 → alice.dot (mapped in the fixture resolver).
    const snakeCards = page.locator(".card", { has: page.locator(".card__name", { hasText: "Snake" }) });
    await expect(snakeCards.first().locator(".card__top-name")).toHaveText("alice.dot");
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
    await expect(board.nth(0).locator(".board__player")).toHaveText("alice.dot");
    await expect(board.nth(0).locator(".board__score")).toHaveText("9001");
    // Unmapped address falls back to the truncated form 0xbbbb…bbbb (§8.2).
    await expect(board.nth(1).locator(".board__player")).toHaveText("0xbbbb…bbbb");
    await expect(board.nth(1).locator(".board__score")).toHaveText("880");

    // Recent plays section is present and populated.
    await expect(page.locator(".recent .recent__row").first()).toBeVisible();

    // Play button (§7.5): anchor, target=_blank, href derived from playUrl
    // "arcade-snake.dot" → https://arcade-snake.dot.li.
    const play = page.locator(".btn--play");
    await expect(play).toHaveJSProperty("tagName", "A");
    await expect(play).toHaveAttribute("target", "_blank");
    // Bare-label playUrl ("arcade-snake.dot") is rebuilt to https://<label>.dot.li
    // directly (no URL normalization), so no trailing slash.
    await expect(play).toHaveAttribute("href", "https://arcade-snake.dot.li");
  });

  test("Time Trial (duration format): score renders m:ss.mmm", async ({ page }) => {
    await page.goto(`/#/game/${A2}`);
    await expect(page.locator(".hero__name")).toHaveText("Time Trial");
    // 83456 ms → 1:23.456 ; 605000 ms → 10:05.000 (§4.2 scoreFormat 1).
    const scores = page.locator(".board__list .board__score");
    await expect(scores.nth(0)).toHaveText("1:23.456");
    await expect(scores.nth(1)).toHaveText("10:05.000");
    // playUrl is already a full dot.li URL → passed through unchanged.
    await expect(page.locator(".btn--play")).toHaveAttribute(
      "href",
      "https://time-trial.dot.li/",
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

  test("navigating from a home card opens the matching detail page", async ({ page }) => {
    await gotoHome(page);
    await page
      .locator(".card", { has: page.locator(".card__name", { hasText: "Snake" }) })
      .first()
      .click();
    await expect(page.locator(".hero__name")).toHaveText("Snake");
    expect(page.url()).toContain(`#/game/${A1}`);
  });
});

test.describe("About page (§1/§3–§7 explainer)", () => {
  test("the header About link routes to #/about and renders the explainer", async ({ page }) => {
    await gotoHome(page);
    await page.locator(".app__navlink", { hasText: "About" }).click();
    expect(page.url()).toContain("#/about");
    await expect(page.locator(".about__title")).toHaveText("Insert coin.");
    // Key concepts are present.
    await expect(page.getByText("One prompt, one game")).toBeVisible();
    await expect(page.getByText("How the cabinet is wired")).toBeVisible();
    await expect(page.getByText("How games phone home")).toBeVisible();
    // Source links point at the repo.
    const spec = page.locator("a.link", { hasText: "the full spec" });
    await expect(spec).toHaveAttribute(
      "href",
      /github\.com\/shawntabrizi\/arcade-dashboard.*SPEC\.md/,
    );
  });

  test("deep-linking to #/about renders the page directly", async ({ page }) => {
    await page.goto("/#/about");
    await expect(page.locator(".about__title")).toBeVisible();
  });
});

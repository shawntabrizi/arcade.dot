import { test, expect } from "@playwright/test";

// The app must BOOT and render without an uncaught error, even standalone (not
// in a host). A blank #root means a top-level/module-init throw crashed React
// before first paint — the failure mode that shipped to the deployed app and
// could only be seen by loading it. This catches it locally in ~10s, no host.
test("app boots and renders without an uncaught error (real gateway, standalone)", async ({
  page,
}) => {
  const pageErrors: string[] = [];
  page.on("pageerror", (e) => pageErrors.push(String(e.message ?? e)));

  await page.goto("/", { waitUntil: "load" });

  // Something must render into #root. Blank = boot crash.
  const rootHtml = await page.locator("#root").innerHTML();
  expect(
    rootHtml.length,
    "#root is empty — the app crashed during boot (see page errors below)",
  ).toBeGreaterThan(0);

  // A standalone load must not produce an uncaught error. The known regression
  // is host-api-wrapper throwing "Environment is not correct" from an unguarded
  // subscription; assert specifically against it plus any other uncaught throw.
  expect(
    pageErrors,
    `uncaught page errors on boot:\n${pageErrors.join("\n")}`,
  ).toEqual([]);
});

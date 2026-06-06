// Nav spike driver (BUILD_PLAN item 5). Opens the deployed spike both
// directly (gateway) and, if reachable, inside the dot.li web host, clicks
// each variant, and reports what navigation results.
import { chromium } from "playwright";

const SPIKE = "https://arcade-nav-spike.dot.li";
const results = [];

const browser = await chromium.launch();

async function probe(label, url) {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  try {
    const resp = await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30000 });
    const inIframe = await page.evaluate(() => window.self !== window.top).catch(() => "?");
    const title = await page.title().catch(() => "?");
    const frames = page.frames().map((f) => f.url());
    results.push({ probe: label, url, status: resp?.status(), title, inIframe, frames });
    return { ctx, page };
  } catch (e) {
    results.push({ probe: label, url, error: String(e).slice(0, 200) });
    await ctx.close();
    return null;
  }
}

// 1. The spike served directly from the gateway.
const direct = await probe("direct-gateway", SPIKE);

// 2. Click variants in the direct context (plain-browser baseline).
if (direct) {
  const { ctx, page } = direct;
  for (const variant of ["A", "C", "D"]) {
    await page.goto(SPIKE, { waitUntil: "domcontentloaded" });
    try {
      const before = page.url();
      await page.locator(`.btn:has-text("${variant}")`).first().click({ timeout: 5000 });
      await page.waitForTimeout(4000);
      results.push({ click: variant, context: "plain", before, after: page.url() });
    } catch (e) {
      results.push({ click: variant, context: "plain", error: String(e).slice(0, 200) });
    }
  }
  // target=_blank variants: watch for popups
  for (const variant of ["B", "E"]) {
    await page.goto(SPIKE, { waitUntil: "domcontentloaded" });
    try {
      const popupP = ctx.waitForEvent("page", { timeout: 6000 }).catch(() => null);
      await page.locator(`.btn:has-text("${variant}")`).first().click({ timeout: 5000 });
      const popup = await popupP;
      results.push({
        click: variant, context: "plain",
        popup: popup ? popup.url() : null, samePage: page.url(),
      });
    } catch (e) {
      results.push({ click: variant, context: "plain", error: String(e).slice(0, 200) });
    }
  }
  await ctx.close();
}

// 3. Is there a web-host shell that embeds apps? Try the known host URL forms.
for (const hostUrl of [
  "https://dot.li",
  "https://dot.li/app/arcade-nav-spike.dot",
  "https://playground.dot.li",
]) {
  const r = await probe(`host:${hostUrl}`, hostUrl);
  if (r) await r.ctx.close();
}

await browser.close();
console.log(JSON.stringify(results, null, 2));

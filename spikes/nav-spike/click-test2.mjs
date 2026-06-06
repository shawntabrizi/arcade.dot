// Round 2: the dot.li URL serves a host shell that boots the app async.
// Wait for the spike to appear (any frame), report the frame structure,
// then click variants inside the app frame.
import { chromium } from "playwright";

const SPIKE = "https://arcade-nav-spike.dot.li";
const browser = await chromium.launch();
const out = [];

async function findAppFrame(page, timeoutMs = 45000) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    for (const f of page.frames()) {
      const hasBtn = await f.locator(".btn").count().catch(() => 0);
      if (hasBtn > 0) return f;
    }
    await page.waitForTimeout(1000);
  }
  return null;
}

async function freshAppFrame(ctx) {
  const page = await ctx.newPage();
  await page.goto(SPIKE, { waitUntil: "domcontentloaded", timeout: 30000 });
  const frame = await findAppFrame(page);
  return { page, frame };
}

// Structure probe
{
  const ctx = await browser.newContext();
  const { page, frame } = await freshAppFrame(ctx);
  out.push({
    probe: "structure",
    frames: page.frames().map((f) => ({ url: f.url().slice(0, 120), isMain: f === page.mainFrame() })),
    appFrameFound: !!frame,
    appFrameUrl: frame?.url().slice(0, 160),
    inIframeLog: frame ? await frame.locator("#log").textContent().catch(() => "?") : null,
  });
  await ctx.close();
}

// Click variants, fresh context each time
for (const variant of ["A", "B", "C", "D", "E", "F"]) {
  const ctx = await browser.newContext();
  try {
    const { page, frame } = await freshAppFrame(ctx);
    if (!frame) { out.push({ click: variant, error: "app frame never appeared" }); await ctx.close(); continue; }
    const beforeMain = page.url();
    const beforeFrame = frame.url();
    const popupP = ctx.waitForEvent("page", { timeout: 8000 }).catch(() => null);
    await frame.locator(`.btn:has-text("${variant}")`).first().click({ timeout: 8000 });
    const popup = await popupP;
    await page.waitForTimeout(5000);
    const afterFrames = page.frames().map((f) => f.url().slice(0, 120));
    out.push({
      click: variant,
      beforeMain, beforeFrame: beforeFrame.slice(0, 120),
      afterMain: page.url(),
      popup: popup ? popup.url() : null,
      afterFrames,
    });
  } catch (e) {
    out.push({ click: variant, error: String(e).slice(0, 200) });
  }
  await ctx.close();
}

await browser.close();
console.log(JSON.stringify(out, null, 2));

// R5-01 verification: user wheel on the chip row must pause playhead follow for ~2s at any FPS.
// Methodology mirrors docs/acceptance/evidence/integration-r5/verify-scroll.mjs, but runs against
// a local build (BASE_URL, default http://localhost:4173) instead of the production site.
import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";

const root = "D:/projects/new_project1";
const out = `${root}/apps/web/evidence/r5-01-follow`;
const fixture = `${root}/docs/acceptance/evidence/integration-r5/03-tiled-4x.png`;
const baseUrl = process.env.BASE_URL ?? "http://localhost:4173/";
process.env.PLAYWRIGHT_BROWSERS_PATH = `${root}/docs/acceptance/evidence/integration-r4/runtime`;
const require = createRequire(
  `${root}/tests/golden/reports/acceptance/playwright-runtime/package.json`,
);
const { chromium } = require("playwright");

const report = {
  at: new Date().toISOString(),
  baseUrl,
  fixture: "03-tiled-4x.png (640x132, 48 frames)",
  tests: [],
};

async function snapshot(page) {
  return page.evaluate(() => {
    const row = document.querySelector(".frame-row");
    const chip = row.querySelector(".playhead");
    const canvas = document.querySelector(".animation-canvas");
    const chipBox = chip.getBoundingClientRect();
    const rowBox = row.getBoundingClientRect();
    const data = canvas.getContext("2d").getImageData(0, 0, canvas.width, canvas.height).data;
    let nonzero = 0;
    for (let i = 3; i < data.length; i += 4) if (data[i]) nonzero++;
    return {
      at: performance.now(),
      left: row.scrollLeft,
      max: row.scrollWidth - row.clientWidth,
      frame: Number(chip.dataset.frameIndex),
      inside: chipBox.left >= rowBox.left - 1 && chipBox.right <= rowBox.right + 1,
      nonzero,
    };
  });
}

async function runWheelCase(browser, config) {
  const r = { ...config, id: `wheel-${config.fps}-${config.scheme}-${config.lang}`, events: [] };
  report.tests.push(r);
  const context = await browser.newContext({
    viewport: { width: 1024, height: 768 },
    colorScheme: config.scheme,
    locale: config.lang === "zh" ? "zh-CN" : "en-US",
  });
  const page = await context.newPage();
  try {
    await page.goto(baseUrl, { waitUntil: "networkidle" });
    await page.locator(".lang select").selectOption(config.lang);
    await page.locator("#spriteflow-file").setInputFiles(fixture);
    await page.locator("section.review").waitFor();
    r.frames = await page.locator(".frame-chip").count();
    assert.equal(r.frames, 48);
    await page.waitForFunction(() => !document.querySelector(".viewport-loading"));
    await page.locator('.timeline input[type="number"]').fill(String(config.fps));
    const box = await page.locator(".frame-row").boundingBox();
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.evaluate(() => {
      const row = document.querySelector(".frame-row");
      window.__events = [];
      row.addEventListener("wheel", (e) =>
        window.__events.push({
          type: "wheel",
          at: performance.now(),
          trusted: e.isTrusted,
          left: row.scrollLeft,
        }),
      );
      row.addEventListener("scroll", () =>
        window.__events.push({ type: "scroll", at: performance.now(), left: row.scrollLeft }),
      );
    });
    const playLabel = config.lang === "zh" ? "播放" : "Play";
    await page.getByRole("button", { name: playLabel, exact: true }).click();
    await page.waitForTimeout(config.fps === 2 ? 350 : 200);
    // The click parked the mouse on the play button; wheel must be dispatched over the row.
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    r.beforeWheel = await snapshot(page);
    await page.mouse.wheel(5000, 0);
    r.samples = [];
    for (let i = 0; i < 32; i += 1) {
      await page.waitForTimeout(80);
      r.samples.push(await snapshot(page));
      if (i === 2) await page.screenshot({ path: `${out}/${r.id}-paused.png`, fullPage: true });
      if (i === 31) await page.screenshot({ path: `${out}/${r.id}-resumed.png`, fullPage: true });
    }
    r.events = await page.evaluate(() => window.__events);
    const wheel = r.events.find((e) => e.type === "wheel");
    assert.ok(wheel?.trusted, "Must receive a real browser wheel event");
    const moved = r.events.find((e) => e.type === "scroll" && e.at > wheel.at && e.left > 2000);
    assert.ok(moved, "Wheel must actually move the row far away from the playhead");
    r.wheel = wheel;
    r.moved = moved;
    const firstReturn = r.events.find(
      (e) => e.type === "scroll" && e.at > moved.at && e.left < moved.left - 2,
    );
    r.pauseMillis = firstReturn ? firstReturn.at - moved.at : null;
    assert.ok(firstReturn, "Follow must resume and bring the offscreen playhead back");
    assert.ok(
      r.pauseMillis >= 1900 && r.pauseMillis <= 2400,
      `Expected ~2000ms follow pause, observed ${r.pauseMillis}ms`,
    );
    const paused = r.samples.filter((s) => s.at > moved.at + 200 && s.at < moved.at + 1800);
    assert.ok(
      paused.length >= 5 && paused.every((s) => Math.abs(s.left - moved.left) <= 1),
      "User scroll position must be preserved during the pause",
    );
    // At 120 FPS the playhead sweeps through the parked view every 400ms, so chipInside
    // toggles legitimately; the position is the invariant. At low FPS it must stay hidden.
    if (config.fps !== 120) {
      assert.ok(
        paused.every((s) => !s.inside),
        "Playhead must stay offscreen while parked",
      );
    }
    const resumed = r.samples.filter((s) => s.at > moved.at + 2200);
    assert.ok(
      resumed.length && resumed.every((s) => s.inside),
      "Playhead must be visible after the pause",
    );
    assert.ok(
      r.samples.every((s) => s.nonzero > 0),
      "Viewport must never blank out",
    );
    r.status = "PASS";
  } catch (error) {
    r.status = "FAIL";
    r.error = String(error.stack ?? error);
  } finally {
    await context.close();
  }
  return r;
}

async function runFollowCase(browser, config) {
  const r = { ...config, id: `follow-${config.fps}-${config.scheme}-${config.lang}`, samples: [] };
  report.tests.push(r);
  const context = await browser.newContext({
    viewport: { width: 1024, height: 768 },
    colorScheme: config.scheme,
    locale: config.lang === "zh" ? "zh-CN" : "en-US",
  });
  const page = await context.newPage();
  try {
    await page.goto(baseUrl, { waitUntil: "networkidle" });
    await page.locator(".lang select").selectOption(config.lang);
    await page.locator("#spriteflow-file").setInputFiles(fixture);
    await page.locator("section.review").waitFor();
    await page.waitForFunction(() => !document.querySelector(".viewport-loading"));
    await page.getByRole("button", { name: "播放", exact: true }).click();
    for (let i = 0; i < 46; i += 1) {
      await page.waitForTimeout(100);
      r.samples.push(await snapshot(page));
    }
    const lost = r.samples.filter((s) => !s.inside);
    let longestLossMs = 0;
    let run = 0;
    for (const s of r.samples) {
      run = s.inside ? 0 : run + 1;
      longestLossMs = Math.max(longestLossMs, run * 100);
    }
    r.lostSamples = lost.length;
    r.longestLossMs = longestLossMs;
    r.wrapped = r.samples.some((s) => s.frame < 4);
    // The pre-fix build tolerated a frame-level (~100ms) chipInside=false transient at loop
    // wraparound; anything longer means follow lost the playhead for real.
    r.status = longestLossMs <= 200 ? "PASS" : "FAIL";
    if (r.status === "FAIL") {
      r.error = `Playhead chip offscreen for ${longestLossMs}ms during playback`;
    }
  } catch (error) {
    r.status = "FAIL";
    r.error = String(error.stack ?? error);
  } finally {
    await context.close();
  }
  return r;
}

await mkdir(out, { recursive: true });
const browser = await chromium.launch({
  executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe",
  headless: true,
});
try {
  await runWheelCase(browser, { fps: 12, scheme: "dark", lang: "zh" });
  await runWheelCase(browser, { fps: 12, scheme: "light", lang: "en" });
  await runWheelCase(browser, { fps: 120, scheme: "dark", lang: "zh" });
  await runWheelCase(browser, { fps: 2, scheme: "dark", lang: "zh" });
  await runFollowCase(browser, { fps: 12, scheme: "dark", lang: "zh" });
} finally {
  await browser.close();
  await writeFile(`${out}/report.json`, JSON.stringify(report, null, 2));
}
for (const r of report.tests) {
  console.log(
    JSON.stringify({ id: r.id, status: r.status, pauseMillis: r.pauseMillis, error: r.error }),
  );
}
process.exitCode = report.tests.some((r) => r.status === "FAIL") ? 1 : 0;

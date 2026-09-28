import assert from "node:assert/strict";
import { rename, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";

const root = "D:/projects/new_project1",
  out = `${root}/docs/acceptance/evidence/integration-r5`;
process.env.PLAYWRIGHT_BROWSERS_PATH = `${root}/docs/acceptance/evidence/integration-r4/runtime`;
const require = createRequire(
  `${root}/tests/golden/reports/acceptance/playwright-runtime/package.json`,
);
const { chromium } = require("playwright");
const browser = await chromium.launch({
  executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe",
  headless: true,
});
const report = {
  at: new Date().toISOString(),
  fixture: "03-tiled-4x.png",
  derivation: "Unmodified golden 03 input tiled horizontally four times; 640x132, 48 frames",
  tests: [],
};
async function snapshot(page) {
  return page.evaluate(() => {
    const row = document.querySelector(".frame-row"),
      chip = row.querySelector(".playhead"),
      c = document.querySelector(".animation-canvas");
    const b = chip.getBoundingClientRect(),
      r = row.getBoundingClientRect();
    const data = c.getContext("2d").getImageData(0, 0, c.width, c.height).data;
    let nonzero = 0;
    for (let i = 3; i < data.length; i += 4) if (data[i]) nonzero++;
    return {
      at: performance.now(),
      left: row.scrollLeft,
      max: row.scrollWidth - row.clientWidth,
      frame: Number(chip.dataset.frameIndex),
      inside: b.left >= r.left - 1 && b.right <= r.right + 1,
      nonzero,
    };
  });
}
try {
  const cases = [
    { fps: 2, scheme: "dark", lang: "zh" },
    ...["dark", "light"].flatMap((scheme) =>
      ["zh", "en"].map((lang) => ({ fps: 12, scheme, lang })),
    ),
  ];
  for (const config of cases) {
    const r = { ...config, id: `wheel-${config.fps}-${config.scheme}-${config.lang}`, events: [] };
    report.tests.push(r);
    const context = await browser.newContext({
      viewport: { width: 1024, height: 768 },
      colorScheme: config.scheme,
      locale: config.lang === "zh" ? "zh-CN" : "en-US",
      recordVideo: { dir: `${out}/videos`, size: { width: 1024, height: 768 } },
    });
    const page = await context.newPage(),
      video = page.video();
    try {
      await page.goto("https://spriteflow-doa.pages.dev/", { waitUntil: "networkidle" });
      await page.locator(".lang select").selectOption(config.lang);
      await page.locator("#spriteflow-file").setInputFiles(`${out}/${report.fixture}`);
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
            deltaX: e.deltaX,
            left: row.scrollLeft,
          }),
        );
        row.addEventListener("scroll", (e) =>
          window.__events.push({
            type: "scroll",
            at: performance.now(),
            trusted: e.isTrusted,
            left: row.scrollLeft,
          }),
        );
      });
      await page
        .getByRole("button", { name: config.lang === "zh" ? "播放" : "Play", exact: true })
        .click();
      await page.waitForTimeout(config.fps === 2 ? 350 : 200);
      await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
      r.beforeWheel = await snapshot(page);
      await page.mouse.wheel(5000, 0);
      r.samples = [];
      for (let i = 0; i < 32; i++) {
        await page.waitForTimeout(80);
        r.samples.push(await snapshot(page));
        if (i === 1 || i === 18 || i === 31)
          await page.screenshot({ path: `${out}/${r.id}-${i}.png`, fullPage: true });
      }
      r.events = await page.evaluate(() => window.__events);
      const wheel = r.events.find((e) => e.type === "wheel");
      assert.ok(wheel?.trusted, "Must receive a real browser wheel event");
      const moved = r.events.find((e) => e.type === "scroll" && e.at > wheel.at && e.left > 2000);
      assert.ok(moved, "Wheel must actually move timeline far away");
      r.wheel = wheel;
      r.moved = moved;
      r.firstReturn = r.events.find(
        (e) => e.type === "scroll" && e.at > moved.at && e.left < moved.left - 2,
      );
      r.pauseMillis = r.firstReturn ? r.firstReturn.at - moved.at : null;
      assert.ok(r.firstReturn, "Follow must resume and bring an offscreen playhead back");
      assert.ok(
        r.pauseMillis >= 1900 && r.pauseMillis <= 2400,
        `Expected ~2000ms follow pause, observed ${r.pauseMillis}ms`,
      );
      const paused = r.samples.filter((s) => s.at > moved.at + 200 && s.at < moved.at + 1800);
      assert.ok(
        paused.length >= 5 && paused.every((s) => Math.abs(s.left - moved.left) <= 1 && !s.inside),
        "User position must be preserved while playhead is offscreen",
      );
      const resumed = r.samples.filter((s) => s.at > moved.at + 2200);
      assert.ok(
        resumed.length && resumed.every((s) => s.inside),
        "Playhead must be visible after the pause",
      );
      assert.ok(r.samples.every((s) => s.nonzero > 0));
      r.status = "PASS";
    } catch (e) {
      r.status = "FAIL";
      r.error = e.stack;
    } finally {
      if (!r.events.length) r.events = await page.evaluate(() => window.__events ?? []);
      await context.close();
      r.video = `videos/${r.id}.webm`;
      await rename(await video.path(), `${out}/${r.video}`);
      await writeFile(`${out}/scroll-confirmation.json`, JSON.stringify(report, null, 2));
      console.log(
        JSON.stringify({ id: r.id, status: r.status, pauseMillis: r.pauseMillis, error: r.error }),
      );
    }
  }
} finally {
  await browser.close();
}
process.exitCode = report.tests.some((r) => r.status === "FAIL") ? 1 : 0;

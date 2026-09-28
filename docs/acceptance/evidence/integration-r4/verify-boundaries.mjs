import assert from "node:assert/strict";
import { rename, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";

const root = "D:/projects/new_project1",
  out = `${root}/docs/acceptance/evidence/integration-r4`;
process.env.PLAYWRIGHT_BROWSERS_PATH = `${out}/runtime`;
const require = createRequire(
  `${root}/tests/golden/reports/acceptance/playwright-runtime/package.json`,
);
const { chromium } = require("playwright");
const browser = await chromium.launch({
  executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe",
  headless: true,
});
const results = { at: new Date().toISOString(), tests: [] };
async function snap(page) {
  return page.evaluate(() => {
    const c = document.querySelector(".animation-canvas"),
      a = c.getContext("2d").getImageData(0, 0, c.width, c.height).data;
    let count = 0;
    for (let i = 3; i < a.length; i += 4) if (a[i]) count++;
    const row = document.querySelector(".frame-row"),
      chip = document.querySelector(".frame-chip.playhead");
    const r = row.getBoundingClientRect(),
      b = chip?.getBoundingClientRect();
    return {
      frame: document.querySelector(".viewport-caption").textContent,
      nonzero: count,
      scroll: row.scrollLeft,
      scrollWidth: row.scrollWidth,
      clientWidth: row.clientWidth,
      chipInside: b ? b.left >= r.left && b.right <= r.right : false,
      rowRect: { left: r.left, right: r.right },
      chipRect: b ? { left: b.left, right: b.right } : null,
    };
  });
}
async function run(id, fixture, fn, slow = false) {
  const r = { id };
  results.tests.push(r);
  const context = await browser.newContext({
    viewport: { width: 1024, height: 768 },
    locale: "zh-CN",
    recordVideo: { dir: `${out}/videos`, size: { width: 1024, height: 768 } },
  });
  const page = await context.newPage();
  const video = page.video();
  try {
    await page.addInitScript(
      ({ slow }) => {
        window.__commands = [];
        const Native = Worker;
        window.Worker = class extends Native {
          constructor(...args) {
            super(...args);
            const send = this.postMessage.bind(this);
            let player = 0;
            this.postMessage = (m, ...rest) => {
              const req = m?.argumentList?.find((x) => x?.value?.command)?.value;
              if (req) {
                window.__commands.push({
                  time: performance.now(),
                  command: req.command,
                  options: req.payload?.options,
                  maxDimension: req.payload?.maxDimension,
                });
                if (
                  slow &&
                  req.command === "preview" &&
                  req.payload.maxDimension === 320 &&
                  ++player > 1
                ) {
                  setTimeout(() => send(m, ...rest), 2200);
                  return;
                }
              }
              send(m, ...rest);
            };
          }
        };
      },
      { slow },
    );
    await page.goto("https://spriteflow-doa.pages.dev", { waitUntil: "networkidle" });
    await page.locator(".lang select").selectOption("zh");
    await page
      .locator("#spriteflow-file")
      .setInputFiles(`${root}/tests/golden/cases/${fixture}/input.png`);
    await page.locator("section.review").waitFor();
    await page.waitForFunction(() => {
      const c = document.querySelector(".animation-canvas");
      return (
        c &&
        c
          .getContext("2d")
          .getImageData(0, 0, c.width, c.height)
          .data.some((v, i) => i % 4 === 3 && v)
      );
    });
    await fn(page, r);
    r.status = "PASS";
  } catch (e) {
    r.status = "FAIL";
    r.error = e.message;
  } finally {
    r.commands = await page.evaluate(() => window.__commands);
    await page.screenshot({ path: `${out}/${id}.png`, fullPage: true });
    await context.close();
    await rename(await video.path(), `${out}/videos/${id}.webm`);
    await writeFile(`${out}/boundary-results.json`, JSON.stringify(results, null, 2));
    console.log(JSON.stringify(r));
  }
}
try {
  await run("playhead-auto-scroll", "03-grid-4x3", async (page, r) => {
    await page.waitForTimeout(700);
    await page.locator(".timeline input[type=number]").fill("2");
    await page.getByRole("button", { name: "播放", exact: true }).click();
    await page.waitForFunction(
      () => document.querySelector(".viewport-caption").textContent === "12",
      {},
      { timeout: 12000 },
    );
    r.atLast = await snap(page);
    assert.equal(r.atLast.chipInside, true, "Current playhead chip must scroll into view");
  });
  await run(
    "slow-player-playing",
    "02-grid-3x2",
    async (page, r) => {
      r.initial = await snap(page);
      await page.locator(".timeline input[type=number]").fill("1");
      await page.getByRole("button", { name: "播放", exact: true }).click();
      await page.waitForFunction(
        () => document.querySelector(".viewport-caption").textContent === "2",
      );
      r.second = await snap(page);
      assert.ok(
        r.second.nonzero > 0,
        "Playback must retain previous ready image while next bitmap is unavailable",
      );
    },
    true,
  );
  await run("q3-changed-parameter-retry", "19-ambiguous-degrade", async (page, r) => {
    await page.locator(".tune-guidance").waitFor();
    await page.locator("input[type=range]").first().focus();
    await page.keyboard.press("ArrowRight");
    await page.waitForTimeout(1600);
    r.alphaUI = await page.locator("input[type=range]").first().inputValue();
    const count = await page.evaluate(
      () => window.__commands.filter((c) => c.command === "detect").length,
    );
    await page.locator(".tune-guidance button").click();
    await page.locator("dialog button.primary").click();
    await page.waitForFunction(
      (n) => window.__commands.filter((c) => c.command === "detect").length > n,
      count,
    );
    await page.locator(".tune-guidance").waitFor();
    r.retry = await page.evaluate(() =>
      window.__commands.filter((c) => c.command === "detect").at(-1),
    );
    assert.equal(r.retry.options.alphaThreshold, 9);
    r.copy = await page.locator(".tune-guidance").innerText();
  });
} finally {
  await browser.close();
}
process.exitCode = results.tests.some((r) => r.status === "FAIL") ? 1 : 0;

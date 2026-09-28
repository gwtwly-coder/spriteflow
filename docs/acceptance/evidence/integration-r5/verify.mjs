import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, rename, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";

const root = "D:/projects/new_project1";
const out = `${root}/docs/acceptance/evidence/integration-r5`;
process.env.PLAYWRIGHT_BROWSERS_PATH = `${root}/docs/acceptance/evidence/integration-r4/runtime`;
const require = createRequire(`${root}/tests/golden/reports/acceptance/playwright-runtime/package.json`);
const { chromium } = require("playwright");
await mkdir(`${out}/videos`, { recursive: true });
const browser = await chromium.launch({ executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe", headless: true });
const report = { startedAt: new Date().toISOString(), url: "https://spriteflow-doa.pages.dev/", browser: browser.version(), tests: [] };

function setup({ hold }) {
  window.__playerHeld = hold;
  window.__playerQueue = [];
  window.__commands = [];
  window.__scrolls = [];
  const Native = Worker;
  window.Worker = class extends Native {
    constructor(...args) {
      super(...args);
      const send = this.postMessage.bind(this);
      this.postMessage = (m, ...rest) => {
        const req = m?.argumentList?.find((x) => x?.value?.command)?.value;
        if (req) window.__commands.push({ at: performance.now(), command: req.command, maxDimension: req.payload?.maxDimension });
        if (window.__playerHeld && req?.command === "preview" && req.payload.maxDimension === 320) {
          window.__playerQueue.push(() => send(m, ...rest));
          return;
        }
        send(m, ...rest);
      };
    }
  };
}
async function state(page) {
  return page.evaluate(() => {
    const c = document.querySelector(".animation-canvas");
    const d = c.getContext("2d").getImageData(0, 0, c.width, c.height).data;
    let nonzero = 0, hash = 2166136261;
    for (let i = 0; i < d.length; i++) { hash = Math.imul(hash ^ d[i], 16777619); if (i % 4 === 3 && d[i]) nonzero++; }
    const row = document.querySelector(".frame-row"), chip = row.querySelector(".playhead");
    const r = row.getBoundingClientRect(), b = chip.getBoundingClientRect();
    const loading = document.querySelector(".viewport-loading");
    return { at: performance.now(), frameIndex: Number(chip.dataset.frameIndex), caption: document.querySelector(".viewport-caption").textContent, nonzero, hash: (hash >>> 0).toString(16), width: c.width, height: c.height, loading: !!loading, loadingLabel: loading?.getAttribute("aria-label"), scrollLeft: row.scrollLeft, clientWidth: row.clientWidth, scrollWidth: row.scrollWidth, chipInside: b.left >= r.left - 1 && b.right <= r.right + 1, row: { left: r.left, right: r.right }, chip: { left: b.left, right: b.right } };
  });
}
async function shot(page, name) { await page.screenshot({ path: `${out}/${name}.png`, fullPage: true }); return `${name}.png`; }
async function run(id, { hold = false, scheme = "dark", lang = "zh", fixture = "02-grid-3x2" }, fn) {
  const r = { id, scheme, lang, hold, fixture, pageErrors: [] }; report.tests.push(r);
  const context = await browser.newContext({ viewport: { width: 1024, height: 768 }, locale: lang === "zh" ? "zh-CN" : "en-US", colorScheme: scheme, recordVideo: { dir: `${out}/videos`, size: { width: 1024, height: 768 } } });
  const page = await context.newPage(), video = page.video();
  page.on("pageerror", (e) => r.pageErrors.push(e.message));
  try {
    await page.addInitScript(setup, { hold });
    await page.goto(report.url, { waitUntil: "networkidle" });
    r.assets = await page.locator("script[src]").evaluateAll((ns) => ns.map((n) => n.src));
    await page.locator(".lang select").selectOption(lang);
    await page.locator("#spriteflow-file").setInputFiles(`${root}/tests/golden/cases/${fixture}/input.png`);
    await page.locator("section.review").waitFor();
    await fn(page, r);
    r.status = "PASS";
  } catch (e) { r.status = "FAIL"; r.error = e.stack; await shot(page, `${id}-failure`).catch(() => {}); }
  finally {
    r.commands = await page.evaluate(() => window.__commands);
    r.scrollEvents = await page.evaluate(() => window.__scrolls);
    await context.close(); r.video = `videos/${id}.webm`; await rename(await video.path(), `${out}/${r.video}`);
    await writeFile(`${out}/results.json`, JSON.stringify(report, null, 2));
    console.log(JSON.stringify({ id, status: r.status, error: r.error }));
  }
}
try {
  for (const scheme of ["dark", "light"]) for (const lang of ["zh", "en"]) {
    await run(`hold-${scheme}-${lang}`, { hold: true, scheme, lang }, async (page, r) => {
      await page.waitForFunction(() => window.__playerQueue.length > 0);
      r.initial = await state(page); assert.equal(r.initial.nonzero, 0); assert.equal(r.initial.loading, true);
      r.screenshots = [await shot(page, `${r.id}-initial-c72`)];
      await page.evaluate(() => window.__playerQueue.shift()());
      await page.waitForFunction(() => !document.querySelector(".viewport-loading"));
      r.ready = await state(page); assert.ok(r.ready.nonzero > r.ready.width * r.ready.height * .01);
      r.screenshots.push(await shot(page, `${r.id}-ready`));
      await page.locator(".frame-chip").nth(1).click();
      r.waiting = await state(page); assert.equal(r.waiting.hash, r.ready.hash); assert.equal(r.waiting.loading, true);
      r.screenshots.push(await shot(page, `${r.id}-waiting`));
      await page.locator(".frame-chip").nth(0).click();
      await page.locator('.timeline input[type="number"]').fill("1");
      await page.getByRole("button", { name: lang === "zh" ? "播放" : "Play", exact: true }).click();
      await page.waitForFunction(() => document.querySelector(".frame-chip.playhead")?.dataset.frameIndex === "1");
      r.playing = await state(page); assert.equal(r.playing.hash, r.ready.hash); assert.equal(r.playing.loading, true);
      await page.getByRole("button", { name: lang === "zh" ? "暂停" : "Pause", exact: true }).click();
      r.screenshots.push(await shot(page, `${r.id}-playing-held`));
      await page.evaluate(() => { window.__playerHeld = false; for (const send of window.__playerQueue.splice(0)) send(); });
      await page.waitForFunction(() => !document.querySelector(".viewport-loading"));
      r.recovered = await state(page); assert.ok(r.recovered.nonzero > 0); assert.notEqual(r.recovered.hash, r.ready.hash);
      r.screenshots.push(await shot(page, `${r.id}-recovered`));
    });
  }
  for (const fps of [2, 12]) {
    await run(`follow-${fps}fps`, { fixture: "03-grid-4x3" }, async (page, r) => {
      await page.waitForFunction(() => !document.querySelector(".viewport-loading"));
      await page.waitForTimeout(300);
      await page.locator('.timeline input[type="number"]').fill(String(fps));
      await page.evaluate(() => {
        const row = document.querySelector(".frame-row");
        row.addEventListener("scroll", () => window.__scrolls.push({ at: performance.now(), left: row.scrollLeft, frame: document.querySelector(".frame-chip.playhead")?.dataset.frameIndex }));
      });
      await page.getByRole("button", { name: "播放", exact: true }).click();
      await page.waitForFunction(() => document.querySelector(".frame-chip.playhead")?.dataset.frameIndex === "11", null, { timeout: 15000 });
      await page.waitForTimeout(30);
      r.auto = await state(page); assert.equal(r.auto.chipInside, true); assert.ok(r.auto.scrollLeft > 0);
      r.screenshots = [await shot(page, `${r.id}-auto`)];
      // At 2 FPS place the wheel event outside the 300ms self-scroll suppression window.
      // At default 12 FPS use ordinary wheel input without special timing accommodations.
      if (fps === 2) await page.waitForTimeout(300);
      const box = await page.locator(".frame-row").boundingBox();
      await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
      r.wheelAt = await page.evaluate(() => performance.now());
      await page.mouse.wheel(-800, 0);
      await page.waitForTimeout(80);
      r.manual = await state(page); assert.equal(r.manual.scrollLeft, 0);
      r.screenshots.push(await shot(page, `${r.id}-manual`));
      r.samples = [];
      for (let i = 0; i < 25; i++) { await page.waitForTimeout(100); r.samples.push(await state(page)); }
      r.screenshots.push(await shot(page, `${r.id}-after-2s`));
      const endPause = r.wheelAt + 1900;
      r.earlyScrolls = r.scrollEvents = await page.evaluate(() => window.__scrolls);
      r.earlyScrolls = r.earlyScrolls.filter((x) => x.at > r.manual.at && x.at < endPause && x.left > 1);
      assert.equal(r.earlyScrolls.length, 0, "User scroll must pause follow for two seconds");
      r.afterPause = r.samples.filter((s) => s.at > r.wheelAt + 2100);
      assert.ok(r.afterPause.length && r.afterPause.every((s) => s.chipInside), "Follow must resume after two seconds");
    });
  }
} finally {
  report.finishedAt = new Date().toISOString();
  await writeFile(`${out}/results.json`, JSON.stringify(report, null, 2));
  await browser.close();
}
const assetURL = report.tests[0].assets[0];
const response = await fetch(assetURL), bytes = Buffer.from(await response.arrayBuffer());
await writeFile(`${out}/production.json`, JSON.stringify({ assetURL, status: response.status, sha256: createHash("sha256").update(bytes).digest("hex"), bytes: bytes.length }, null, 2));
process.exitCode = report.tests.some((r) => r.status === "FAIL") ? 1 : 0;

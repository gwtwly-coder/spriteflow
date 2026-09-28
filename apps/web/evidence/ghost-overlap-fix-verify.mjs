// Ghost-overlap regression evidence: a >1024px source with large transparent areas must not
// show tiled copies of the preview bitmap on the editor canvas (pattern-backed checkerboard fix).
import { mkdir, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";

const root = "D:/projects/new_project1";
const out = `${root}/apps/web/evidence/ghost-overlap-fix`;
const baseUrl = process.env.BASE_URL ?? "http://localhost:4175/";
const require = createRequire(
  `${root}/tests/golden/reports/acceptance/playwright-runtime/package.json`,
);
const { chromium } = require("playwright");

const report = { at: new Date().toISOString(), baseUrl, checks: [] };
await mkdir(out, { recursive: true });

const browser = await chromium.launch({
  executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe",
  headless: true,
});
const context = await browser.newContext({ viewport: { width: 1024, height: 768 } });
const page = await context.newPage();

// 1536×1024 RGBA PNG generated in-page: opaque red block on the left 256px, rest fully
// transparent — the transparent right half is where tiled preview copies used to leak.
const dataUrl = await page.evaluate(() => {
  const canvas = document.createElement("canvas");
  canvas.width = 1536;
  canvas.height = 1024;
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "rgb(220, 40, 50)";
  ctx.fillRect(0, 0, 256, 1024);
  return canvas.toDataURL("image/png");
});
const synthetic = Buffer.from(dataUrl.split(",")[1], "base64");
await writeFile(`${out}/synthetic-1536-transparent.png`, synthetic);

await page.goto(baseUrl, { waitUntil: "networkidle" });
await page.locator("#spriteflow-file").setInputFiles({
  name: "synthetic-1536-transparent.png",
  mimeType: "image/png",
  buffer: synthetic,
});
await page.locator("section.review").waitFor({ timeout: 30000 });
await page.waitForFunction(() => !document.querySelector(".viewport-loading"));
await page.waitForTimeout(300);

const check = await page.evaluate(() => {
  const canvas = document.querySelector(".canvas-host canvas");
  const ctx = canvas.getContext("2d");
  const { width, height } = canvas;
  const data = ctx.getImageData(0, 0, width, height).data;
  const redXs = [];
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const i = (y * width + x) * 4;
      if (data[i] > 180 && data[i + 1] < 90 && data[i + 2] < 90) redXs.push(x);
    }
  }
  if (!redXs.length) return { status: "FAIL", error: "No red block rendered at all" };
  const minX = Math.min(...redXs);
  const maxX = Math.max(...redXs);
  // After the fix the red pixels form one band (~1/6 of the shown image). A tiled copy
  // would push red pixels out to x≈66% of the image, widening the span past 0.5 of canvas.
  const span = (maxX - minX) / width;
  return { status: span < 0.35 ? "PASS" : "FAIL", redPixels: redXs.length, minX, maxX, span };
});
report.checks.push({ id: "synthetic-1536-no-tiled-copy", ...check });
await page.screenshot({ path: `${out}/synthetic-1536-canvas.png`, fullPage: true });

// Same-class input as the product owner's report: the 1536×1024 mermaid sheet.
try {
  await page.locator('button:has-text("换一张图")').click();
  await page.getByRole("dialog").getByRole("button", { name: "换图" }).click();
  await page.locator("#spriteflow-file").setInputFiles("D:/桌面/素材/游泳素材图.png");
  await page.locator("section.review").waitFor({ timeout: 30000 });
  await page.waitForFunction(() => !document.querySelector(".viewport-loading"), null, {
    timeout: 60000,
  });
  await page.waitForTimeout(500);
  const host = await page.locator(".canvas-host").boundingBox();
  await page.screenshot({ path: `${out}/mermaid-1536-canvas.png`, clip: host });
  report.checks.push({ id: "mermaid-1536-screenshot", status: "PASS" });
} catch (error) {
  report.checks.push({
    id: "mermaid-1536-screenshot",
    status: "FAIL",
    error: String(error).slice(0, 200),
  });
}

await browser.close();
await writeFile(`${out}/report.json`, JSON.stringify(report, null, 2));
console.log(JSON.stringify(report.checks, null, 1));
process.exitCode = report.checks.some((c) => c.status === "FAIL") ? 1 : 0;

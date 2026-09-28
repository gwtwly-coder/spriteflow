import { writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";

const root = "D:/projects/new_project1";
const out = `${root}/docs/acceptance/evidence/integration-r4`;
process.env.PLAYWRIGHT_BROWSERS_PATH = `${out}/runtime`;
const require = createRequire(
  `${root}/tests/golden/reports/acceptance/playwright-runtime/package.json`,
);
const { chromium } = require("playwright");
const browser = await chromium.launch({
  executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe",
  headless: true,
});
const context = await browser.newContext({
  viewport: { width: 1440, height: 1000 },
  locale: "zh-CN",
});
const page = await context.newPage();
try {
  await page.goto("https://spriteflow-doa.pages.dev", { waitUntil: "networkidle" });
  await page.locator(".lang select").selectOption("zh");
  await page
    .locator("#spriteflow-file")
    .setInputFiles(`${root}/tests/golden/cases/13-grid-multicomponent/input.png`);
  await page.locator("section.review").waitFor();
  await page.waitForTimeout(3000);
  const result = {
    version: browser.version(),
    url: page.url(),
    scripts: await page.locator("script[src]").evaluateAll((ns) => ns.map((n) => n.src)),
    text: await page.locator("body").innerText(),
    canvases: await page
      .locator("canvas")
      .evaluateAll((ns) =>
        ns.map((n) => ({ class: n.className, width: n.width, height: n.height })),
      ),
    inputs: await page
      .locator("input")
      .evaluateAll((ns) => ns.map((n) => ({ type: n.type, value: n.value, outer: n.outerHTML }))),
    buttons: await page.getByRole("button").allTextContents(),
  };
  await writeFile(`${out}/probe.json`, JSON.stringify(result, null, 2));
  await page.screenshot({ path: `${out}/probe.png`, fullPage: true });
  console.log(JSON.stringify(result, null, 2));
} finally {
  await context.close();
  await browser.close();
}

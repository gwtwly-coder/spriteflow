// Frame-deletion fix evidence: confirming deletion must remove the frame from drafts so the
// timeline chips, canvas rects, and the status-bar summary all agree.
import { mkdir, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";

const root = "D:/projects/new_project1";
const out = `${root}/apps/web/evidence/frame-deletion-fix`;
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

await page.goto(baseUrl, { waitUntil: "networkidle" });
await page
  .locator("#spriteflow-file")
  .setInputFiles(`${root}/tests/golden/cases/02-grid-3x2/input.png`);
await page.locator("section.review").waitFor({ timeout: 30000 });
await page.waitForFunction(() => !document.querySelector(".viewport-loading"));
const count = () => page.locator(".frame-chip").count();
const summaryText = () =>
  page.evaluate(() =>
    [...document.querySelectorAll(".statusbar span")]
      .map((s) => s.textContent)
      .find((t) => /^\d+ 帧$/.test(t ?? "")),
  );
report.checks.push({ id: "initial", chips: await count(), summary: await summaryText() });

// Full owner path: click chip 1 → 删除帧 → confirm dialog → 删除.
await page.locator(".frame-chip").first().click();
await page.locator('button:has-text("删除帧")').click();
await page.screenshot({ path: `${out}/delete-confirm-dialog.png`, fullPage: true });
await page.getByRole("dialog").getByRole("button", { name: "删除", exact: true }).click();
await page.waitForTimeout(250);
await page.screenshot({ path: `${out}/after-delete-5-chips.png`, fullPage: true });

const after = {
  chips: await count(),
  summary: await summaryText(),
  deleteDisabled: await page.evaluate(
    () =>
      [...document.querySelectorAll(".toolbar .tool")].find((b) => b.textContent.includes("删除帧"))
        ?.disabled,
  ),
};
report.checks.push({ id: "after-delete", ...after });
report.checks.push({
  id: "assertions",
  chipsReduced: (await count()) === 5,
  summaryAgrees: (await summaryText()) === "5 帧",
  deleteDisabledAgain: after.deleteDisabled === true,
  status: (await count()) === 5 && (await summaryText()) === "5 帧" ? "PASS" : "FAIL",
});

// Undo restores the frame, redo deletes it again (consistency requirement).
await page.keyboard.press("Control+z");
await page.waitForTimeout(200);
const afterUndo = { chips: await count(), summary: await summaryText() };
await page.keyboard.press("Control+y");
await page.waitForTimeout(200);
const afterRedo = { chips: await count(), summary: await summaryText() };
report.checks.push({
  id: "undo-redo",
  afterUndo,
  afterRedo,
  status: afterUndo.chips === 6 && afterRedo.chips === 5 ? "PASS" : "FAIL",
});

await browser.close();
await writeFile(`${out}/report.json`, JSON.stringify(report, null, 2));
console.log(JSON.stringify(report.checks, null, 1));
process.exitCode = report.checks.some((c) => c.status === "FAIL") ? 1 : 0;

import { readdir, readFile, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";

const root = "D:/projects/new_project1",
  out = `${root}/docs/acceptance/evidence/integration-r4`;
const require = createRequire(
  `${root}/tests/golden/reports/acceptance/playwright-runtime/package.json`,
);
const { chromium } = require("playwright");
const browser = await chromium.launch({
  executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe",
  headless: true,
});
const page = await browser.newPage();
const results = [];
try {
  for (const file of (await readdir(`${out}/videos`)).filter((f) => f.endsWith(".webm"))) {
    await page.setContent("<video muted></video><canvas></canvas>");
    const data = await readFile(`${out}/videos/${file}`);
    const result = await page.evaluate(
      async (src) => {
        const v = document.querySelector("video");
        v.src = src;
        await new Promise((ok, bad) => {
          v.onloadeddata = ok;
          v.onerror = () => bad(new Error(v.error?.message));
        });
        if (!Number.isFinite(v.duration)) throw new Error("No finite duration");
        const canvas = document.querySelector("canvas");
        canvas.width = v.videoWidth;
        canvas.height = v.videoHeight;
        const context = canvas.getContext("2d");
        const samples = [];
        for (const part of [0.25, 0.6, 0.9]) {
          await new Promise((ok) => {
            v.onseeked = ok;
            v.currentTime = v.duration * part;
          });
          context.drawImage(v, 0, 0);
          const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
          let nonzero = 0;
          for (let i = 3; i < pixels.length; i += 4) if (pixels[i]) nonzero++;
          samples.push({ time: v.currentTime, nonzero });
        }
        return { duration: v.duration, width: v.videoWidth, height: v.videoHeight, samples };
      },
      `data:video/webm;base64,${data.toString("base64")}`,
    );
    results.push({ file, ...result, status: "PASS" });
  }
} finally {
  await writeFile(`${out}/video-playback-validation.json`, JSON.stringify(results, null, 2));
  await browser.close();
}
console.log(
  JSON.stringify(results.map(({ file, duration, status }) => ({ file, duration, status }))),
);

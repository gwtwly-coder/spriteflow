// First-screen JS budget gate (CI build job), per docs/architecture-m1.md section 5.1:
//   - First-screen JS (every script referenced by apps/web/dist/index.html, gzip): must stay
//     strictly below 300 KiB.
//   - Delayed pipeline-worker JS is reported separately against the 180 KiB target; it must
//     not hide behind lazy-loading of first-screen dependencies.
//   - dist must ship THIRD_PARTY_NOTICES.txt (section 8.3).
// If the web app has not been built yet (no dist), the gate reports N/A and passes so the
// build job stays green until apps/web lands; it becomes a hard gate the moment dist exists.

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { gzipSync } from "node:zlib";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const dist = join(root, "apps", "web", "dist");
const BUDGET_FIRST_SCREEN = 300 * 1024; // hard limit, strictly below
const TARGET_WORKER = 180 * 1024; // reporting target, not a hard gate

const indexHtml = join(dist, "index.html");
if (!existsSync(indexHtml)) {
  console.log(
    "check-bundle-budget: N/A - apps/web/dist/index.html not found (web app not built yet); budget gate activates as soon as the build output exists",
  );
  process.exit(0);
}

const indexHtmlContent = readFileSync(indexHtml, "utf8");
const entryScripts = [...indexHtmlContent.matchAll(/<script[^>]*\bsrc="([^"]+\.js)"/g)].map((m) =>
  resolve(dist, `.${m[1]}`),
);
if (entryScripts.length === 0) {
  console.error(
    "check-bundle-budget: index.html references no JS entry - static output looks wrong",
  );
  process.exit(1);
}

// Collect every emitted .js so nothing (worker, lazy chunks) escapes the report.
const emitted = [];
(function walk(dir) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) walk(p);
    else if (e.name.endsWith(".js")) emitted.push(p);
  }
})(dist);

const entries = new Set(entryScripts);
const workerChunks = emitted.filter((f) => !entries.has(f) && /worker/i.test(relative(dist, f)));
const lazyChunks = emitted.filter((f) => !entries.has(f) && !/worker/i.test(relative(dist, f)));

function row(file) {
  const buf = readFileSync(file);
  const gz = gzipSync(buf, { level: 9 }).length;
  return { file: relative(dist, file).replaceAll("\\", "/"), raw: buf.length, gzip: gz };
}

const firstScreen = [...entries].map(row);
const firstScreenTotal = firstScreen.reduce((s, r) => s + r.gzip, 0);

console.log("check-bundle-budget: first-screen JS (referenced by index.html)");
for (const r of firstScreen)
  console.log(`  ${r.file.padEnd(40)} raw ${fmt(r.raw)}  gzip ${fmt(r.gzip)}`);
const verdict = firstScreenTotal < BUDGET_FIRST_SCREEN ? "PASS" : "FAIL";
console.log(
  `  TOTAL gzip ${fmt(firstScreenTotal)} / budget < ${fmt(BUDGET_FIRST_SCREEN)}  ->  ${verdict}`,
);

for (const [label, files, target] of [
  ["delayed pipeline-worker JS (target)", workerChunks, TARGET_WORKER],
  ["lazy chunks (not first-screen)", lazyChunks, null],
]) {
  if (files.length === 0) continue;
  console.log(`check-bundle-budget: ${label}`);
  let total = 0;
  for (const f of files) {
    const r = row(f);
    total += r.gzip;
    console.log(`  ${r.file.padEnd(40)} raw ${fmt(r.raw)}  gzip ${fmt(r.gzip)}`);
  }
  console.log(
    `  TOTAL gzip ${fmt(total)}${target ? ` / target <= ${fmt(target)}${total > target ? "  ->  OVER TARGET (report only)" : ""}` : ""}`,
  );
}

if (!existsSync(join(dist, "THIRD_PARTY_NOTICES.txt"))) {
  console.error(
    "check-bundle-budget: FAIL - dist/THIRD_PARTY_NOTICES.txt is missing (architecture-m1.md section 8.3)",
  );
  process.exit(1);
}

if (firstScreenTotal >= BUDGET_FIRST_SCREEN) {
  console.error(
    "check-bundle-budget: FAIL - first-screen JS exceeds the 300 KiB gzip budget (architecture-m1.md section 5.1)",
  );
  process.exit(1);
}
console.log("check-bundle-budget: PASS");

function fmt(n) {
  return `${(n / 1024).toFixed(1)} KiB`;
}

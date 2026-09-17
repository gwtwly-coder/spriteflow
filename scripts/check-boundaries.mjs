// Static dependency-boundary check (CI lint job).
// Rules come from docs/architecture-m1.md section 2 ("依赖方向固定") and section 7 (lint job):
//   1. Pipeline core (src/** except src/browser/**) must not import react/zustand/zundo/comlink.
//   2. Pipeline root entry (src/index.ts) must not export browser code.
//   3. No relative import may cross a workspace package boundary (no bypassing package exports).
//   4. apps/web may only import "@spriteflow/pipeline" via its declared exports (".", "./browser").
//   5. tests/golden must not import the app.
// DOM types in core are already enforced by tsc (tsconfig.json has lib ES2022 without DOM);
// this script only covers rules tsc cannot see.
import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const packageRoots = ["packages/pipeline", "apps/web", "tests/golden"].map((p) => resolve(root, p));

function packageOf(file) {
  return packageRoots.find((p) => (file + sep).startsWith(p + sep));
}

// git ls-files keeps the check on the committed tree; untracked work-in-progress
// from other roles is not CI's problem until it is committed.
const files = execSync("git ls-files", { encoding: "utf8", cwd: root })
  .split(/\r?\n/)
  .filter((f) => /^(packages\/pipeline|apps\/web|tests\/golden)\/src\/.*\.[cm]?[jt]sx?$/i.test(f))
  .map((f) => resolve(root, f));

const CORE_FORBIDDEN = /^(react|react-dom|zustand|zundo|comlink)(\/|$)/;
const PIPELINE_EXPORTS = new Set(["@spriteflow/pipeline", "@spriteflow/pipeline/browser"]);
const findings = [];

for (const file of files) {
  const rel = file.slice(root.length + 1).replaceAll("\\", "/");
  const pkg = packageOf(file);
  if (!pkg) continue;
  const src = readFileSync(file, "utf8");
  const imports = [
    ...src.matchAll(
      /(?:^|\n)\s*(?:import|export)[^'"()]*?from\s*["']([^"']+)["']|import\s*\(\s*["']([^"']+)["']\s*\)|import\s*["']([^"']+)["']/g,
    ),
  ]
    .map((m) => m[1] || m[2] || m[3])
    .filter(Boolean);

  for (const spec of imports) {
    const inBrowserAdapter = rel.startsWith("packages/pipeline/src/browser/");
    // Rule 1: pure core must not import UI/state/transport libraries.
    if (
      rel.startsWith("packages/pipeline/src/") &&
      !inBrowserAdapter &&
      CORE_FORBIDDEN.test(spec)
    ) {
      findings.push(
        `${rel}: core imports "${spec}" (react/zustand/zundo/comlink are forbidden outside src/browser)`,
      );
    }
    // Rule 2: root entry must not re-export the browser subentry.
    if (rel === "packages/pipeline/src/index.ts" && /^\.\.?\/browser\b/.test(spec)) {
      findings.push(
        `${rel}: root entry must not export "./browser" code (DOM/native-call leakage)`,
      );
    }
    // Rule 3: relative imports must stay inside the same workspace package.
    if (spec.startsWith(".")) {
      const resolved = resolve(dirname(file), spec);
      if (!resolved.startsWith(pkg + sep)) {
        findings.push(
          `${rel}: relative import "${spec}" escapes its workspace package (bypasses package exports)`,
        );
      }
    }
    // Rule 4: the app may only use declared pipeline exports.
    if (
      rel.startsWith("apps/web/") &&
      spec.startsWith("@spriteflow/pipeline") &&
      !PIPELINE_EXPORTS.has(spec)
    ) {
      findings.push(
        `${rel}: "${spec}" is not a declared export of @spriteflow/pipeline (only "." and "./browser")`,
      );
    }
    // Rule 5: golden tests must not touch the app (relative escapes already covered by rule 3).
    if (rel.startsWith("tests/golden/") && spec === "@spriteflow/web") {
      findings.push(`${rel}: golden tests must not import the app`);
    }
  }
}

if (findings.length > 0) {
  console.error(`check-boundaries: ${findings.length} violation(s):`);
  for (const f of findings) console.error(`  - ${f}`);
  process.exit(1);
}
console.log(
  `check-boundaries: OK (${files.length} source files scanned, all workspace import rules hold)`,
);

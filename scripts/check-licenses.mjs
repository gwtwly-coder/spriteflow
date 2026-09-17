// License-closure gate (CI build job), per docs/architecture-m1.md sections 7/8:
//   - Parse every name@version in the pnpm-lock.yaml "packages" section.
//   - Bidirectionally diff it against the audited allowlist (scripts/license-audit.json,
//     generated from architecture-m1.md appendix A, audit date 2026-09-16).
//   - Reject GPL/AGPL/LGPL anywhere and banned packages (FFmpeg/ONNX/pngquant/GIF/video
//     demuxers are excluded from M1 by user decision).
//   - All dependency version specs must be exact (no ^ ~ * ranges); workspace links use
//     "workspace:*" and are exempt.
// Any lockfile change therefore requires a fresh audit - CI never auto-accepts new packages.
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

// --- collect lockfile packages --------------------------------------------
const lock = readFileSync(join(root, "pnpm-lock.yaml"), "utf8");
const section = lock
  .split(/^packages:$/m)[1]
  ?.split(/^(?:snapshots|ignoredOptionalDependencies):$/m)[0];
if (section === undefined) {
  console.error("check-licenses: no 'packages:' section found in pnpm-lock.yaml");
  process.exit(1);
}
const locked = new Set();
for (const m of section.matchAll(/^ {2}'?([^:'\n]+)@([^'@:\n]+)'?:$/gm))
  locked.add(`${m[1]}@${m[2]}`);

// --- audited allowlist -----------------------------------------------------
const audit = JSON.parse(readFileSync(join(root, "scripts", "license-audit.json"), "utf8"));
const audited = new Set(audit.packages.map((p) => `${p.name}@${p.version}`));
if (audited.size !== audit.count) {
  console.error(
    `check-licenses: license-audit.json is inconsistent (count ${audit.count} != entries ${audited.size})`,
  );
  process.exit(1);
}

const problems = [];
for (const entry of locked)
  if (!audited.has(entry)) problems.push(`lockfile package not in audit: ${entry}`);
for (const entry of audited)
  if (!locked.has(entry)) problems.push(`audited package missing from lockfile: ${entry}`);

// --- license policy --------------------------------------------------------
for (const { name, version, license } of audit.packages) {
  if (/(^|[^A-Za-z])(GPL|LGPL|AGPL)(-[0-9.]+| |$|[(|)/+&])/.test(license)) {
    problems.push(
      `copyleft license in audit: ${name}@${version} (${license}) - audit refresh required`,
    );
  }
}

const BANNED = /(ffmpeg|onnxruntime|pngquant|jsquash|gifuct|gif\.js|mp4box|libwebm|webm-demux)/i;
for (const entry of locked)
  if (BANNED.test(entry)) problems.push(`banned package in lockfile: ${entry}`);

// --- exact-version policy in all workspace manifests ----------------------
const manifestPaths = [
  "package.json",
  ...findManifests(join(root, "packages")),
  ...findManifests(join(root, "apps")),
  ...findManifests(join(root, "tests")),
];
for (const rel of manifestPaths) {
  const manifest = JSON.parse(readFileSync(join(root, rel), "utf8"));
  for (const sectionName of [
    "dependencies",
    "devDependencies",
    "optionalDependencies",
    "peerDependencies",
  ]) {
    for (const [name, spec] of Object.entries(manifest[sectionName] ?? {})) {
      if (spec === "workspace:*" || spec === "workspace:^") continue;
      if (!/^\d+\.\d+\.\d+([-+][0-9A-Za-z.-]+)?$/.test(spec)) {
        problems.push(`${rel}: ${name} uses non-exact version "${spec}" (exact versions required)`);
      }
    }
  }
}

if (problems.length > 0) {
  console.error(`check-licenses: ${problems.length} problem(s):`);
  for (const p of problems) console.error(`  - ${p}`);
  console.error(`check-licenses: lockfile=${locked.size} audited=${audited.size}`);
  process.exit(1);
}
console.log(
  `check-licenses: OK (${locked.size} lockfile packages match the ${audited.size}-entry audit; no copyleft, no banned packages, all specs exact)`,
);

function findManifests(dir) {
  const out = [];
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const e of entries) {
    if (!e.isDirectory() || e.name === "node_modules" || e.name === "dist") continue;
    const sub = join(dir, e.name);
    try {
      readFileSync(join(sub, "package.json"));
      out.push(`${sub.slice(root.length + 1)}\\package.json`.replaceAll("\\", "/"));
    } catch {
      /* not a workspace package */
    }
    out.push(...findManifests(sub));
  }
  return out;
}

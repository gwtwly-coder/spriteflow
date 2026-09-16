import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PNG } from "pngjs";
import { countComponents, scanBbox } from "./fixture-utils.mjs";

const goldenRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const casesRoot = path.join(goldenRoot, "cases");
const reportsRoot = path.join(goldenRoot, "reports");
const fixturesOnly = process.argv.includes("--fixtures-only");
const caseFilter = readArgument("--case");
const startedAt = new Date();

const caseIds = (await readdir(casesRoot, { withFileTypes: true }))
  .filter((entry) => entry.isDirectory() && /^\d{2}-/.test(entry.name))
  .map((entry) => entry.name)
  .filter((caseId) => !caseFilter || caseId === caseFilter)
  .sort();

if (!caseFilter)
  assert.equal(caseIds.length, 20, "The M1 golden suite must contain exactly 20 cases");
assert.ok(caseIds.length > 0, "No golden cases were selected");

let pipeline = null;
if (!fixturesOnly) {
  try {
    pipeline = await import("@spriteflow/pipeline");
    assert.equal(typeof pipeline.detect, "function", "@spriteflow/pipeline must export detect()");
  } catch (error) {
    console.error("Golden fixture preflight can run now, but pipeline regression cannot start.");
    console.error(
      "Build @spriteflow/pipeline first, or run `pnpm golden:fixtures` during the fixture-first phase.",
    );
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 2;
  }
}

const results = [];
if (fixturesOnly || pipeline) {
  for (const caseId of caseIds) {
    const before = performance.now();
    try {
      const loaded = await loadCase(caseId);
      validateFixture(loaded);
      if (pipeline) await validatePipeline(loaded, pipeline);
      results.push({
        caseId,
        status: "passed",
        durationMs: round(performance.now() - before),
        failures: [],
      });
      console.log(`PASS ${caseId}`);
    } catch (error) {
      const message = error instanceof Error ? (error.stack ?? error.message) : String(error);
      results.push({
        caseId,
        status: "failed",
        durationMs: round(performance.now() - before),
        failures: [message],
      });
      console.error(`FAIL ${caseId}\n${message}`);
    }
  }
}

const failed = results.filter((result) => result.status === "failed");
const report = {
  schemaVersion: "spriteflow-golden-report/1",
  startedAt: startedAt.toISOString(),
  finishedAt: new Date().toISOString(),
  mode: fixturesOnly ? "fixtures-only" : "pipeline",
  summary: {
    selected: caseIds.length,
    passed: results.length - failed.length,
    failed: failed.length,
    pipelineAvailable: Boolean(pipeline),
  },
  results,
};
await mkdir(reportsRoot, { recursive: true });
await writeFile(
  path.join(reportsRoot, "golden-report.json"),
  `${JSON.stringify(report, null, 2)}\n`,
  "utf8",
);

if (results.length > 0) {
  console.log(
    `\nGolden: ${report.summary.passed}/${report.summary.selected} passed (${report.mode})`,
  );
  console.log(`Report: ${path.join(reportsRoot, "golden-report.json")}`);
}
if (failed.length > 0) process.exitCode = 1;

async function loadCase(caseId) {
  const caseDir = path.join(casesRoot, caseId);
  const [groundTruthText, sourceText, pngBytes] = await Promise.all([
    readFile(path.join(caseDir, "ground-truth.json"), "utf8"),
    readFile(path.join(caseDir, "source.json"), "utf8"),
    readFile(path.join(caseDir, "input.png")),
  ]);
  return {
    caseDir,
    groundTruth: JSON.parse(groundTruthText),
    source: JSON.parse(sourceText),
    pngBytes,
    png: PNG.sync.read(pngBytes),
  };
}

function validateFixture({ groundTruth, source, pngBytes, png }) {
  assert.equal(groundTruth.schemaVersion, "spriteflow-golden/1");
  assert.equal(source.schemaVersion, "spriteflow-source/1");
  assert.equal(source.license, "CC0-1.0");
  assert.equal(groundTruth.input.width, png.width);
  assert.equal(groundTruth.input.height, png.height);
  assert.equal(groundTruth.input.sha256, createHash("sha256").update(pngBytes).digest("hex"));
  assert.equal(groundTruth.expected.frameCount, groundTruth.expected.frames.length);
  assert.ok(["grid", "components", "manual-grid"].includes(groundTruth.expected.strategy));

  for (const [index, expected] of groundTruth.expected.frames.entries()) {
    assert.equal(expected.index, index);
    validateRect(expected.sourceRect, png.width, png.height, `frames[${index}].sourceRect`);
    if (expected.bbox !== null)
      validateRect(expected.bbox, png.width, png.height, `frames[${index}].bbox`);
    assert.deepEqual(
      scanBbox(png, expected.sourceRect),
      expected.bbox,
      `frames[${index}] bbox is not pixel-tight`,
    );
    const expectedMultiple = countComponents(png, expected.sourceRect) >= 2;
    assert.equal(
      expected.flags.multipleComponents,
      expectedMultiple,
      `frames[${index}] multipleComponents mismatch`,
    );
    assert.equal(expected.flags.empty, expected.bbox === null, `frames[${index}] empty mismatch`);
    assert.equal(expected.flags.duplicateOf, null, "M1 duplicateOf must remain null");
  }
}

async function validatePipeline({ groundTruth, png }, implementation) {
  const bytes = new Uint8ClampedArray(png.data.length);
  bytes.set(png.data);
  const asset = {
    ref: { assetId: groundTruth.caseId.replaceAll("-", "_"), revision: 1 },
    name: `${groundTruth.caseId}.png`,
    sourceMime: "image/png",
    originalSize: { width: png.width, height: png.height },
    pixels: {
      format: "rgba8",
      colorSpace: "srgb",
      alphaMode: "straight",
      width: png.width,
      height: png.height,
      data: bytes,
    },
    scaleFromOriginal: { x: 1, y: 1 },
  };
  const options = resolveOptions(
    groundTruth.run.detectOptions,
    implementation.DEFAULT_DETECT_OPTIONS,
  );
  const outcome = await implementation.detect(asset, options);
  assert.equal(outcome.ok, true, outcome.ok ? undefined : JSON.stringify(outcome.error));
  const actual = outcome.value;
  const expected = groundTruth.expected;
  assert.equal(actual.frames.length, expected.frameCount, "frame count mismatch");
  assert.equal(actual.strategy, expected.strategy, "strategy mismatch");
  assert.equal(
    actual.degraded?.reason ?? null,
    expected.degraded?.reason ?? null,
    "degraded reason mismatch",
  );
  assert.deepEqual(
    actual.degraded?.attempted ?? [],
    expected.degraded?.attempted ?? [],
    "attempted strategies mismatch",
  );
  assert.deepEqual(
    actual.warnings.map((warning) => warning.code),
    expected.warningCodes,
    "warning codes mismatch",
  );
  if (expected.degraded !== null && expected.layout !== null) {
    assert.equal(
      actual.degraded.suggestedGrid.rows,
      expected.layout.rows,
      "suggested rows mismatch",
    );
    assert.equal(
      actual.degraded.suggestedGrid.columns,
      expected.layout.columns,
      "suggested columns mismatch",
    );
  }

  for (let index = 0; index < expected.frames.length; index += 1) {
    const expectedFrame = expected.frames[index];
    const actualFrame = actual.frames[index];
    assert.ok(actualFrame, `missing frame ${index}`);
    assert.equal(actualFrame.origin, expected.origin, `frame ${index} origin mismatch`);
    assert.equal(actualFrame.included, true, `frame ${index} must be included`);
    assert.equal(actualFrame.reviewStatus, "pending", `frame ${index} must be pending`);
    assert.deepEqual(actualFrame.flags, expectedFrame.flags, `frame ${index} flags mismatch`);
    if (expectedFrame.bbox === null) {
      assert.equal(actualFrame.bbox, null, `frame ${index} bbox should be null`);
    } else {
      assert.ok(actualFrame.bbox, `frame ${index} bbox should not be null`);
      const iouValue = iou(actualFrame.bbox, expectedFrame.bbox);
      assert.ok(
        iouValue > groundTruth.assertions.bboxIouExclusiveMinimum,
        `frame ${index} bbox IoU ${iouValue.toFixed(6)} is not > ${groundTruth.assertions.bboxIouExclusiveMinimum}`,
      );
    }
  }

  for (const group of expected.hashEqualityGroups) {
    const hashes = group.map((index) => actual.frames[index]?.pHash?.hex ?? null);
    assert.ok(
      hashes.every((hash) => hash !== null),
      `hash equality group ${group.join(",")} contains null`,
    );
    assert.equal(new Set(hashes).size, 1, `hash equality group ${group.join(",")} differs`);
  }
}

function resolveOptions(overrides, defaults) {
  if (overrides === null) return undefined;
  assert.ok(defaults, "DEFAULT_DETECT_OPTIONS is required when a case overrides options");
  return {
    ...defaults,
    ...overrides,
    grid: { ...defaults.grid, ...(overrides.grid ?? {}) },
    normalize: { ...defaults.normalize, ...(overrides.normalize ?? {}) },
    manualGrid: overrides.manualGrid ?? defaults.manualGrid,
  };
}

function validateRect(rect, width, height, label) {
  assert.ok(
    Number.isInteger(rect.x) && Number.isInteger(rect.y),
    `${label} origin must be integer`,
  );
  assert.ok(
    Number.isInteger(rect.width) && rect.width >= 1,
    `${label}.width must be a positive integer`,
  );
  assert.ok(
    Number.isInteger(rect.height) && rect.height >= 1,
    `${label}.height must be a positive integer`,
  );
  assert.ok(rect.x >= 0 && rect.y >= 0, `${label} must start inside the image`);
  assert.ok(
    rect.x + rect.width <= width && rect.y + rect.height <= height,
    `${label} must end inside the image`,
  );
}

function iou(a, b) {
  const left = Math.max(a.x, b.x);
  const top = Math.max(a.y, b.y);
  const right = Math.min(a.x + a.width, b.x + b.width);
  const bottom = Math.min(a.y + a.height, b.y + b.height);
  const intersection = Math.max(0, right - left) * Math.max(0, bottom - top);
  const union = a.width * a.height + b.width * b.height - intersection;
  return union === 0 ? 0 : intersection / union;
}

function readArgument(name) {
  const index = process.argv.indexOf(name);
  return index === -1 ? null : (process.argv[index + 1] ?? null);
}

function round(value) {
  return Math.round(value * 1000) / 1000;
}

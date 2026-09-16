import { createHash } from "node:crypto";
import { mkdir, readdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PNG } from "pngjs";
import {
  cellRect,
  createImage,
  drawRect,
  drawSprite,
  makeExpectedFrames,
  setPixel,
} from "./fixture-utils.mjs";

const goldenRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const casesRoot = path.join(goldenRoot, "cases");

const PALETTE = [
  [44, 172, 224, 255],
  [239, 112, 96, 255],
  [117, 201, 99, 255],
  [155, 119, 221, 255],
];

const cases = [
  gridCase("01-grid-2x2", "规整透明网格 2×2", 2, 2, 48, 48, 24, 30),
  gridCase("02-grid-3x2", "规整透明网格 3×2", 2, 3, 44, 52, 23, 31),
  gridCase("03-grid-4x3", "规整透明网格 4×3", 3, 4, 40, 44, 20, 26),
  gridCase("04-grid-variable-silhouettes", "网格内轮廓轻微变化", 2, 4, 46, 50, 24, 29, true),
  gridCase("05-strip-6", "单行动画条带 6 帧", 1, 6, 42, 48, 22, 30),
  gridCase("06-strip-8-uneven-content", "单行条带内容位置不齐", 1, 8, 38, 46, 20, 27, true),
  scatterCase("07-scatter-5", "透明底散排 5 帧", [
    [70, 5, 24, 24],
    [10, 10, 24, 24],
    [40, 18, 24, 24],
    [90, 38, 24, 24],
    [58, 47, 24, 24],
  ]),
  scatterCase("08-scatter-6-irregular", "间距不齐散排 6 帧", [
    [72, 6, 22, 26],
    [9, 11, 21, 25],
    [39, 20, 23, 24],
    [94, 40, 22, 25],
    [57, 49, 24, 26],
    [24, 54, 22, 24],
  ]),
  detachedCase("09-detached-hats", "帽子与身体断开", "hat"),
  detachedCase("10-detached-weapons", "武器与身体断开", "weapon"),
  noiseCase("11-noise-speckles", "单像素噪点干扰", false),
  noiseCase("12-noise-clusters", "小簇噪点干扰", true),
  multiComponentGridCase("13-grid-multicomponent", "网格内多连通域", false),
  multiComponentGridCase("14-grid-multicomponent-mixed", "部分网格帧多连通域", true),
  repeatedCase(),
  outlierCase(),
  narrativeCase(),
  singleFrameDegradeCase(),
  ambiguousDegradeCase(),
  emptyCase(),
];

await mkdir(casesRoot, { recursive: true });
for (const entry of await readdir(casesRoot, { withFileTypes: true })) {
  if (entry.isDirectory() && /^\d{2}-/.test(entry.name)) {
    await rm(path.join(casesRoot, entry.name), { recursive: true, force: true });
  }
}

for (const fixture of cases) {
  await writeFixture(fixture);
}

const manifest = {
  schemaVersion: "spriteflow-golden-manifest/1",
  generatorVersion: "1.0.0",
  caseCount: cases.length,
  cases: cases.map(({ caseId, title, category, inputType }) => ({
    caseId,
    title,
    category,
    inputType,
  })),
};
await writeJson(path.join(casesRoot, "manifest.json"), manifest);
console.log(`Generated ${cases.length} deterministic golden cases in ${casesRoot}`);

function gridCase(
  caseId,
  title,
  rows,
  columns,
  cellWidth,
  cellHeight,
  spriteWidth,
  spriteHeight,
  varied = false,
) {
  const png = createImage(columns * cellWidth, rows * cellHeight);
  const sourceRects = [];
  for (let row = 0; row < rows; row += 1) {
    for (let column = 0; column < columns; column += 1) {
      const index = row * columns + column;
      const sourceRect = {
        x: column * cellWidth,
        y: row * cellHeight,
        width: cellWidth,
        height: cellHeight,
      };
      const dx = varied ? (index % 3) - 1 : 0;
      const dy = varied ? ((index * 2) % 3) - 1 : 0;
      const width = spriteWidth + (varied ? (index % 2) * 2 : 0);
      const height = spriteHeight + (varied ? ((index + 1) % 2) * 2 : 0);
      const rect = {
        x: sourceRect.x + Math.floor((cellWidth - width) / 2) + dx,
        y: sourceRect.y + Math.floor((cellHeight - height) / 2) + dy,
        width,
        height,
      };
      drawSprite(png, rect, index, PALETTE[index % PALETTE.length]);
      sourceRects.push(sourceRect);
    }
  }
  return fixture(
    caseId,
    title,
    rows === 1 ? "strip" : "regular-grid",
    rows === 1 ? "D" : "A",
    png,
    sourceRects,
    {
      strategy: "grid",
      origin: "grid",
      layout: { rows, columns },
      coverage: rows === 1 ? ["single-row-strip"] : ["regular-transparent-grid"],
    },
  );
}

function scatterCase(caseId, title, rectTuples) {
  const png = createImage(128, 92);
  const rects = rectTuples.map(([x, y, width, height]) => ({ x, y, width, height }));
  rects.forEach((rect, index) => {
    drawSprite(png, rect, index, PALETTE[index % PALETTE.length]);
  });
  disruptGridProjection(png);
  const ordered = [...rects].sort(compareRects);
  return fixture(caseId, title, "scatter", "C", png, ordered, {
    strategy: "components",
    origin: "components",
    coverage: ["transparent-scatter", "uneven-spacing"],
  });
}

function detachedCase(caseId, title, kind) {
  const png = createImage(168, 96);
  const groups = [];
  for (let index = 0; index < 4; index += 1) {
    const x = 12 + index * 40;
    const body = { x, y: 35 + (index % 2) * 3, width: 20, height: 29 };
    drawSprite(png, body, index, PALETTE[index % PALETTE.length]);
    const part =
      kind === "hat"
        ? { x: x + 4, y: body.y - 3, width: 12, height: 2 }
        : { x: body.x + body.width + 1, y: body.y + 9, width: 3, height: 14 };
    drawRect(png, part, [246, 197, 68, 255]);
    groups.push(unionRect(body, part));
  }
  disruptGridProjection(png);
  return fixture(caseId, title, "detached-parts", "E", png, groups.sort(compareRects), {
    strategy: "components",
    origin: "components",
    mergedIndexes: [0, 1, 2, 3],
    coverage: ["detached-parts", "dilation-merge", kind],
  });
}

function noiseCase(caseId, title, clustered) {
  const png = createImage(136, 94);
  const rects = [
    { x: 8, y: 12, width: 22, height: 26 },
    { x: 40, y: 20, width: 22, height: 26 },
    { x: 73, y: 8, width: 22, height: 26 },
    { x: 101, y: 42, width: 22, height: 26 },
    { x: 57, y: 53, width: 22, height: 26 },
  ];
  rects.forEach((rect, index) => {
    drawSprite(png, rect, index, PALETTE[index % PALETTE.length]);
  });
  const points = clustered
    ? [
        [3, 5],
        [4, 5],
        [130, 7],
        [130, 8],
        [6, 88],
        [7, 88],
      ]
    : [
        [3, 5],
        [130, 7],
        [6, 88],
        [126, 87],
        [35, 72],
        [111, 15],
      ];
  points.forEach(([x, y]) => {
    setPixel(png, x, y, [255, 255, 255, 255]);
  });
  disruptGridProjection(png);
  return fixture(caseId, title, "noise", "C", png, [...rects].sort(compareRects), {
    strategy: "components",
    origin: "components",
    coverage: ["noise-filtering", clustered ? "sub-threshold-clusters" : "single-pixel-speckles"],
  });
}

function multiComponentGridCase(caseId, title, mixed) {
  const rows = 2;
  const columns = 3;
  const cellWidth = 52;
  const cellHeight = 52;
  const png = createImage(columns * cellWidth, rows * cellHeight);
  const sourceRects = [];
  for (let row = 0; row < rows; row += 1) {
    for (let column = 0; column < columns; column += 1) {
      const index = row * columns + column;
      const sourceRect = {
        x: column * cellWidth,
        y: row * cellHeight,
        width: cellWidth,
        height: cellHeight,
      };
      const bodyOffsetY = mixed ? (index % 2 === 0 ? 16 : 12) : index % 2 === 0 ? 16 : 20;
      const body = {
        x: sourceRect.x + 14,
        y: sourceRect.y + bodyOffsetY,
        width: 23,
        height: 27,
      };
      drawSprite(png, body, index, PALETTE[index % PALETTE.length]);
      if (!mixed || index % 2 === 0) {
        const partOffsetY = mixed || index % 2 === 0 ? 8 : 12;
        drawRect(
          png,
          { x: sourceRect.x + 19, y: sourceRect.y + partOffsetY, width: 13, height: 4 },
          [246, 197, 68, 255],
        );
      }
      sourceRects.push(sourceRect);
    }
  }
  return fixture(caseId, title, "multi-component-cell", "A", png, sourceRects, {
    strategy: "grid",
    origin: "grid",
    layout: { rows, columns },
    coverage: ["grid-multiple-components", mixed ? "mixed-flags" : "all-frames-flagged"],
  });
}

function repeatedCase() {
  const png = createImage(150, 90);
  const rects = [
    { x: 10, y: 10, width: 24, height: 28 },
    { x: 43, y: 18, width: 24, height: 28 },
    { x: 78, y: 7, width: 24, height: 28 },
    { x: 111, y: 26, width: 24, height: 28 },
    { x: 59, y: 54, width: 24, height: 28 },
  ];
  rects.forEach((rect) => {
    drawSprite(png, rect, 1, PALETTE[0]);
  });
  disruptGridProjection(png);
  const result = fixture(
    "15-repeated-frames",
    "重复视觉帧（M1 不折叠）",
    "duplicates",
    "E",
    png,
    [...rects].sort(compareRects),
    {
      strategy: "components",
      origin: "components",
      coverage: ["repeated-frames", "dhash-metadata", "no-auto-fold"],
    },
  );
  result.hashEqualityGroups = [[0, 1, 2, 3, 4]];
  return result;
}

function outlierCase() {
  const png = createImage(178, 118);
  const rects = [
    { x: 10, y: 13, width: 20, height: 28 },
    { x: 39, y: 24, width: 20, height: 28 },
    { x: 70, y: 8, width: 20, height: 28 },
    { x: 99, y: 34, width: 20, height: 28 },
    { x: 128, y: 50, width: 40, height: 56 },
  ];
  rects.forEach((rect, index) => {
    drawSprite(png, rect, index, PALETTE[index % PALETTE.length]);
  });
  disruptGridProjection(png);
  return fixture(
    "16-size-outlier",
    "尺寸突变离群帧",
    "outlier",
    "E",
    png,
    [...rects].sort(compareRects),
    {
      strategy: "components",
      origin: "components",
      coverage: ["size-outlier", "review-flag"],
    },
  );
}

function narrativeCase() {
  const png = createImage(164, 108);
  const rects = [
    { x: 8, y: 18, width: 26, height: 34 },
    { x: 43, y: 7, width: 29, height: 31 },
    { x: 82, y: 24, width: 25, height: 36 },
    { x: 119, y: 10, width: 30, height: 33 },
    { x: 57, y: 68, width: 27, height: 32 },
    { x: 103, y: 69, width: 28, height: 35 },
  ];
  rects.forEach((rect, index) => {
    drawSprite(png, rect, index, PALETTE[index % PALETTE.length]);
  });
  disruptGridProjection(png);
  return fixture(
    "17-narrative-irregular",
    "叙事型不规则透明排布",
    "narrative",
    "E",
    png,
    [...rects].sort(compareRects),
    {
      strategy: "components",
      origin: "components",
      coverage: ["narrative-ai-layout", "size-clustering", "uneven-spacing"],
    },
  );
}

function singleFrameDegradeCase() {
  const png = createImage(96, 80);
  drawSprite(png, { x: 22, y: 13, width: 51, height: 54 }, 2, PALETTE[2]);
  return fixture(
    "18-single-frame-degrade",
    "单主体不足以自动分帧",
    "degradation",
    "E",
    png,
    [{ x: 0, y: 0, width: 96, height: 80 }],
    {
      strategy: "manual-grid",
      origin: "manual",
      layout: { rows: 1, columns: 1 },
      degraded: { reason: "INSUFFICIENT_COMPONENTS", attempted: ["grid", "components"] },
      coverage: ["explicit-degradation", "insufficient-components"],
    },
  );
}

function ambiguousDegradeCase() {
  const png = createImage(128, 128);
  drawRect(png, { x: 6, y: 6, width: 116, height: 6 }, PALETTE[0]);
  drawRect(png, { x: 6, y: 116, width: 116, height: 6 }, PALETTE[0]);
  drawRect(png, { x: 6, y: 12, width: 6, height: 104 }, PALETTE[0]);
  drawRect(png, { x: 116, y: 12, width: 6, height: 104 }, PALETTE[0]);
  drawSprite(png, { x: 27, y: 29, width: 17, height: 19 }, 0, PALETTE[1]);
  drawRect(png, { x: 68, y: 72, width: 34, height: 11 }, PALETTE[2]);
  const sourceRects = [];
  for (let row = 0; row < 2; row += 1) {
    for (let column = 0; column < 2; column += 1) {
      sourceRects.push(cellRect(png.width, png.height, 2, 2, row, column));
    }
  }
  return fixture(
    "19-ambiguous-degrade",
    "尺寸簇歧义显式降级",
    "degradation",
    "E",
    png,
    sourceRects,
    {
      strategy: "manual-grid",
      origin: "manual",
      layout: { rows: 2, columns: 2 },
      degraded: { reason: "AMBIGUOUS_COMPONENTS", attempted: ["grid", "components"] },
      coverage: ["explicit-degradation", "ambiguous-components", "suggested-grid"],
    },
  );
}

function emptyCase() {
  const png = createImage(64, 48);
  return fixture(
    "20-empty-transparent",
    "整图全透明",
    "empty",
    "E",
    png,
    [{ x: 0, y: 0, width: 64, height: 48 }],
    {
      strategy: "manual-grid",
      origin: "manual",
      layout: { rows: 1, columns: 1 },
      degraded: { reason: "EMPTY_INPUT", attempted: [] },
      coverage: ["empty-input", "explicit-degradation", "empty-frame"],
    },
  );
}

function fixture(caseId, title, category, inputType, png, sourceRects, options) {
  return {
    caseId,
    title,
    category,
    inputType,
    png,
    sourceRects,
    strategy: options.strategy,
    origin: options.origin,
    degraded: options.degraded ?? null,
    layout: options.layout ?? null,
    mergedIndexes: options.mergedIndexes ?? [],
    coverage: options.coverage,
    hashEqualityGroups: [],
  };
}

async function writeFixture(fixtureData) {
  const caseDir = path.join(casesRoot, fixtureData.caseId);
  await mkdir(caseDir, { recursive: true });
  const pngBytes = PNG.sync.write(fixtureData.png, {
    colorType: 6,
    inputColorType: 6,
    deflateLevel: 9,
    deflateStrategy: 3,
  });
  await writeFile(path.join(caseDir, "input.png"), pngBytes);

  const frames = makeExpectedFrames(fixtureData.png, fixtureData.sourceRects, {
    mergedIndexes: fixtureData.mergedIndexes,
  });
  const warningCodes = [];
  if (fixtureData.degraded) warningCodes.push("DETECTION_DEGRADED");
  if (frames.some((frame) => frame.flags.outlier)) warningCodes.push("OUTLIER_FRAMES");
  if (frames.some((frame) => frame.flags.multipleComponents))
    warningCodes.push("MULTIPLE_COMPONENTS");
  if (frames.some((frame) => frame.flags.empty)) warningCodes.push("EMPTY_FRAMES");

  const groundTruth = {
    schemaVersion: "spriteflow-golden/1",
    caseId: fixtureData.caseId,
    title: fixtureData.title,
    category: fixtureData.category,
    inputType: fixtureData.inputType,
    input: {
      file: "input.png",
      mimeType: "image/png",
      width: fixtureData.png.width,
      height: fixtureData.png.height,
      sha256: createHash("sha256").update(pngBytes).digest("hex"),
    },
    run: {
      detectOptions: null,
    },
    expected: {
      frameCount: frames.length,
      strategy: fixtureData.strategy,
      origin: fixtureData.origin,
      layout: fixtureData.layout,
      degraded: fixtureData.degraded,
      warningCodes,
      frames,
      hashEqualityGroups: fixtureData.hashEqualityGroups,
    },
    assertions: {
      frameCount: "exact",
      bboxIouExclusiveMinimum: 0.9,
      frameMatching: "contract-order",
      flags: "exact",
      degradation: "exact-reason-and-attempted",
    },
    coverage: fixtureData.coverage,
  };
  await writeJson(path.join(caseDir, "ground-truth.json"), groundTruth);
  await writeJson(path.join(caseDir, "source.json"), {
    schemaVersion: "spriteflow-source/1",
    kind: "programmatic",
    author: "SpriteFlow QA",
    license: "CC0-1.0",
    generator: "tests/golden/tools/generate.mjs",
    deterministic: true,
    notes: "Synthetic geometry only; no third-party artwork is embedded.",
  });
}

function compareRects(a, b) {
  return a.y - b.y || a.x - b.x || a.height - b.height || a.width - b.width;
}

function unionRect(a, b) {
  const x = Math.min(a.x, b.x);
  const y = Math.min(a.y, b.y);
  const right = Math.max(a.x + a.width, b.x + b.width);
  const bottom = Math.max(a.y + a.height, b.y + b.height);
  return { x, y, width: right - x, height: bottom - y };
}

function disruptGridProjection(png) {
  const rowAnchors = [1, png.width - 2, Math.floor(png.width / 3), Math.floor((png.width * 2) / 3)];
  const columnAnchors = [
    1,
    png.height - 2,
    Math.floor(png.height / 3),
    Math.floor((png.height * 2) / 3),
  ];

  const emptyRows = [];
  for (let y = 1; y < png.height - 1; y += 1) {
    if (!projectionOccupied(png, "row", y)) emptyRows.push(y);
  }
  addRunBreakers(emptyRows, (y, index) => {
    setPixel(png, rowAnchors[index % rowAnchors.length], y, [255, 255, 255, 255]);
  });

  const emptyColumns = [];
  for (let x = 1; x < png.width - 1; x += 1) {
    if (!projectionOccupied(png, "column", x)) emptyColumns.push(x);
  }
  addRunBreakers(emptyColumns, (x, index) => {
    setPixel(png, x, columnAnchors[index % columnAnchors.length], [255, 255, 255, 255]);
  });
}

function addRunBreakers(values, addPixel) {
  let runStart = 0;
  for (let index = 1; index <= values.length; index += 1) {
    const continues = index < values.length && values[index] === values[index - 1] + 1;
    if (continues) continue;
    const runLength = index - runStart;
    if (runLength >= 2) {
      for (let offset = 0; offset < runLength; offset += 2) {
        addPixel(values[runStart + offset], runStart + offset);
      }
    }
    runStart = index;
  }
}

function projectionOccupied(png, axis, coordinate) {
  const length = axis === "row" ? png.width : png.height;
  for (let position = 0; position < length; position += 1) {
    const x = axis === "row" ? position : coordinate;
    const y = axis === "row" ? coordinate : position;
    if (png.data[(y * png.width + x) * 4 + 3] > 8) return true;
  }
  return false;
}

async function writeJson(filePath, value) {
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

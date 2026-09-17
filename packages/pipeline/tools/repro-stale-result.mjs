import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { unzipSync } from "fflate";
import {
  createExecutionContext,
  DEFAULT_NORMALIZE_OPTIONS,
  ExportFormat,
  exportAssets,
  normalizeFrames,
  packFrames,
} from "../dist/index.js";

const { PNG } = createRequire(new URL("../../../tests/golden/package.json", import.meta.url))(
  "pngjs",
);
const context = createExecutionContext("stale_repro", { yieldControl: async () => {} });
const asset = {
  ref: { assetId: "same_asset", revision: 1 },
  name: "two-sprites.png",
  sourceMime: "application/x-rgba8",
  originalSize: { width: 200, height: 100 },
  scaleFromOriginal: { x: 1, y: 1 },
  pixels: {
    width: 200,
    height: 100,
    format: "rgba8",
    colorSpace: "srgb",
    alphaMode: "straight",
    data: new Uint8ClampedArray(200 * 100 * 4),
  },
};
for (const [left, color] of [
  [10, [255, 0, 0, 255]],
  [110, [0, 255, 0, 255]],
]) {
  for (let y = 10; y < 18; y++)
    for (let x = left; x < left + 8; x++) asset.pixels.data.set(color, (y * 200 + x) * 4);
}
function value(result) {
  if (!result.ok) throw new Error(JSON.stringify(result.error));
  return result.value;
}
function draft(x, edited) {
  return {
    id: "same_frame",
    name: "frame_000",
    sourceRect: { x, y: 0, width: 50, height: 50 },
    origin: "manual",
    sourceFrameIds: [],
    edited,
    included: true,
    reviewStatus: "accepted",
  };
}
const before = value(
  await normalizeFrames(asset, [draft(0, false)], { ...DEFAULT_NORMALIZE_OPTIONS }, context),
);
const packBefore = value(await packFrames(asset.ref, before.frames, undefined, context));
const after = value(
  await normalizeFrames(asset, [draft(100, true)], { ...DEFAULT_NORMALIZE_OPTIONS }, context),
);
const packAfter = value(await packFrames(asset.ref, after.frames, undefined, context));
assert.notDeepEqual(before.frames[0].bbox, after.frames[0].bbox);
assert.notDeepEqual(packBefore, packAfter);
for (const [pack, normalized] of [
  [packBefore, before],
  [packAfter, after],
]) {
  for (const key of ["sourceRect", "bbox"]) {
    assert.deepEqual(pack.frames[0][key], normalized.frames[0][key]);
    assert.notEqual(pack.frames[0][key], normalized.frames[0][key]);
  }
}
let codecCalls = 0;
const codec = {
  encode: async (pixels) => {
    codecCalls++;
    return new Uint8Array(
      PNG.sync.write({
        width: pixels.width,
        height: pixels.height,
        data: Buffer.from(pixels.data),
      }),
    ).buffer;
  },
};
const task = { format: ExportFormat.PhaserJsonHash, baseName: "atlas", animations: [] };
const current = await exportAssets(
  { asset, frames: after.frames, pack: structuredClone(packAfter) },
  task,
  codec,
  context,
);
const files = unzipSync(new Uint8Array(value(current).archive));
const decoded = PNG.sync.read(Buffer.from(files["atlas.png"]));
const rect = packAfter.frames[0].rect,
  offset = (rect.y * decoded.width + rect.x) * 4;
assert.deepEqual([...decoded.data.subarray(offset, offset + 4)], [0, 255, 0, 255]);
const callsBeforeStale = codecCalls;
const stale = await exportAssets(
  { asset, frames: after.frames, pack: structuredClone(packBefore) },
  task,
  codec,
  context,
);
assert.equal(stale.ok, false);
assert.deepEqual(stale.error, {
  code: "STALE_RESULT",
  stage: "validate",
  recoverable: true,
  recoveryActions: ["retry"],
  messageKey: "pipeline.error.STALE_RESULT",
  details: { field: "source.pack.frames.0.sourceRect", frameIds: ["same_frame"] },
});
assert.equal(codecCalls, callsBeforeStale);
console.log(
  JSON.stringify(
    {
      beforeBbox: before.frames[0].bbox,
      afterBbox: after.frames[0].bbox,
      publicPackDataIdentical: false,
      currentOutcome: "ok",
      freshPixel: "green",
      staleOutcome: stale.error.code,
      staleCodecCalls: codecCalls - callsBeforeStale,
    },
    null,
    2,
  ),
);

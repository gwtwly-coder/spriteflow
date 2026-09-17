// biome-ignore-all lint/style/noNonNullAssertion: The smoke fixture and successful pipeline results establish these canvas and file entries.
import { unzipSync } from "fflate";
import { createPipelineClient } from "../../src/browser/index.js";
import {
  DEFAULT_DETECT_OPTIONS,
  DEFAULT_NORMALIZE_OPTIONS,
  DEFAULT_PACK_OPTIONS,
  ExportFormat,
} from "../../src/index.js";
import type { Outcome } from "../../src/types.js";

function value<T>(result: Outcome<T>): T {
  if (!result.ok) throw new Error(JSON.stringify(result.error));
  return result.value;
}
function check(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}
async function run() {
  const client = createPipelineClient(
    new Worker(new URL("./worker.ts", import.meta.url), { type: "module" }),
  );
  try {
    const ready = value(await client.ready);
    check(ready.contractVersion === "3.0.0", "Version mismatch");
    const canvas = new OffscreenCanvas(128, 64),
      drawing = canvas.getContext("2d")!;
    drawing.fillStyle = "#ff0000";
    drawing.fillRect(10, 10, 30, 30);
    drawing.fillRect(74, 10, 30, 30);
    const webp = await canvas.convertToBlob({ type: "image/webp" });
    if (webp.type === "image/webp") {
      const encoded = await webp.arrayBuffer();
      const bitmap = await createImageBitmap(webp);
      bitmap.close();
      check(
        ready.decode.includes("image/webp"),
        `WebP probe false negative; valid fixture: ${btoa(String.fromCharCode(...new Uint8Array(encoded)))}`,
      );
    }
    const png = await (await canvas.convertToBlob({ type: "image/png" })).arrayBuffer();
    const asset = { assetId: "browser", revision: 1 };
    const loaded = value(
      (
        await client.submit("load", {
          kind: "encoded",
          ref: asset,
          name: "input.png",
          mimeHint: "ignored",
          bytes: png,
          resizeTo: null,
        }).result
      ).outcome,
    );
    check(png.byteLength === 0, "Encoded input was not transferred");
    check(loaded.preview.width === 128, "Preview dimension mismatch");
    const result = value(
      (await client.submit("detect", { asset, options: { ...DEFAULT_DETECT_OPTIONS } }).result)
        .outcome,
    );
    check(result.frames.length === 2, "Expected two frames");
    const drafts = result.frames.map((f) => ({
      id: f.id,
      name: f.name,
      sourceRect: f.sourceRect,
      origin: f.origin,
      sourceFrameIds: f.sourceFrameIds,
      edited: false,
      included: true,
      reviewStatus: "accepted" as const,
    }));
    const normalized = value(
      (
        await client.submit("normalize", {
          asset,
          drafts,
          options: { ...DEFAULT_NORMALIZE_OPTIONS },
        }).result
      ).outcome,
    );
    const packed = value(
      (
        await client.submit("pack", {
          asset,
          normalizationId: normalized.normalizationId,
          options: { ...DEFAULT_PACK_OPTIONS },
        }).result
      ).outcome,
    );
    const formats: string[] = [];
    for (const [i, frame] of packed.frames.entries()) {
      check(
        JSON.stringify(frame.sourceRect) === JSON.stringify(normalized.frames[i]?.sourceRect),
        "Missing Worker sourceRect snapshot",
      );
      check(
        JSON.stringify(frame.bbox) === JSON.stringify(normalized.frames[i]?.bbox),
        "Missing Worker bbox snapshot",
      );
    }
    for (const format of Object.values(ExportFormat)) {
      const sequence =
        format === ExportFormat.PngSequenceZip || format === ExportFormat.GodotFramesZip;
      const exported = value(
        (
          await client.submit("export", {
            asset,
            normalizationId: normalized.normalizationId,
            packId: sequence ? null : packed.packId,
            task: { format, baseName: "atlas", animations: [] },
          }).result
        ).outcome,
      );
      const files = unzipSync(new Uint8Array(exported.archive));
      check(Object.keys(files).length === exported.files.length, "ZIP manifest mismatch");
      for (const name of Object.keys(files).filter((name) => name.endsWith(".png"))) {
        const bitmap = await createImageBitmap(
          new Blob([files[name]!.slice()], { type: "image/png" }),
        );
        check(bitmap.width > 0 && bitmap.height > 0, "Invalid output PNG");
        bitmap.close();
      }
      formats.push(format);
    }
    value((await client.submit("release", { asset }).result).outcome);
    if (ready.decode.includes("image/webp")) {
      const webpLoaded = value(
        (
          await client.submit("load", {
            kind: "encoded",
            ref: asset,
            name: "input.webp",
            mimeHint: "image/png",
            bytes: await webp.arrayBuffer(),
            resizeTo: null,
          }).result
        ).outcome,
      );
      check(webpLoaded.asset.sourceMime === "image/webp", "Container signature was not honored");
      const webpDetected = value(
        (await client.submit("detect", { asset, options: { ...DEFAULT_DETECT_OPTIONS } }).result)
          .outcome,
      );
      check(webpDetected.frames.length === 2, "WebP frames mismatch");
      value((await client.submit("release", { asset }).result).outcome);
    }
    const empty = new Uint8ClampedArray(200 * 100 * 4);
    value(
      (
        await client.submit("load", {
          kind: "rgba",
          asset: {
            ref: asset,
            name: "empty",
            sourceMime: "application/x-rgba8",
            originalSize: { width: 200, height: 100 },
            scaleFromOriginal: { x: 1, y: 1 },
            pixels: {
              width: 200,
              height: 100,
              format: "rgba8",
              colorSpace: "srgb",
              alphaMode: "straight",
              data: empty,
            },
          },
        }).result
      ).outcome,
    );
    check(empty.byteLength === 0, "RGBA input was not transferred");
    const auto = value(
      (await client.submit("detect", { asset, options: { ...DEFAULT_DETECT_OPTIONS } }).result)
        .outcome,
    );
    check(
      auto.frames.length === 1 && auto.degraded?.reason === "EMPTY_INPUT",
      "Empty input special case failed",
    );
    const manual = value(
      (
        await client.submit("detect", {
          asset,
          options: {
            ...DEFAULT_DETECT_OPTIONS,
            mode: "manual-grid",
            manualGrid: { rows: 2, columns: 3, region: null, keepEmptyCells: false },
          },
        }).result
      ).outcome,
    );
    check(
      manual.frames.length === 0 && manual.degraded === null,
      "Manual result inherited degradation",
    );
    return {
      ok: true,
      capabilities: ready,
      formats,
      frameCount: result.frames.length,
      checks: [
        "native decode",
        "native PNG encode",
        "module Worker",
        "Comlink",
        "input/output transfer",
        "five ZIP formats",
        "r3 empty/manual transition",
        "r4 Worker source geometry snapshots",
        "WebP capability and real decode",
      ],
    };
  } finally {
    await client.dispose();
  }
}
void run()
  .then((result) => {
    (globalThis as unknown as { smokeResult: unknown }).smokeResult = result;
    document.querySelector("#status")!.textContent = JSON.stringify(result);
  })
  .catch((error) => {
    (globalThis as unknown as { smokeResult: unknown }).smokeResult = {
      ok: false,
      error: String(error),
      stack: error?.stack,
    };
  });

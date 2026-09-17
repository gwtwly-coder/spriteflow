// biome-ignore-all lint/style/noNonNullAssertion: Successful export and manifest assertions establish the indexed PNG and frame fixtures.
import { createRequire } from "node:module";
import { strFromU8, unzipSync } from "fflate";
import { describe, expect, it } from "vitest";
import {
  createExecutionContext,
  DEFAULT_NORMALIZE_OPTIONS,
  DEFAULT_PACK_OPTIONS,
  ExportFormat,
  exportAssets,
  normalizeFrames,
  packFrames,
} from "../src/index.js";
import type { FrameDraft, PixelBuffer } from "../src/types.js";
import { asset, paint, value } from "./helpers.js";

// Reuse the audited Node codec owned by the golden workspace, without a new dependency.
const { PNG } = createRequire(new URL("../../../tests/golden/package.json", import.meta.url))(
  "pngjs",
);
const context = () => createExecutionContext("roundtrip", { yieldControl: async () => {} });
const codec = {
  encode: async (p: PixelBuffer): Promise<ArrayBuffer> => {
    const output = PNG.sync.write(
      { width: p.width, height: p.height, data: Buffer.from(p.data) },
      { colorType: 6, inputColorType: 6 },
    );
    return new Uint8Array(output).buffer;
  },
};
describe("real PNG codec and ZIP roundtrip", () => {
  for (const format of Object.values(ExportFormat))
    it(`recovers exact logical pixels from ${format}`, async () => {
      const input = asset(100, 30);
      for (let y = 0; y < 9; y++)
        for (let x = 0; x < 70; x++)
          paint(input, { x, y, width: 1, height: 1 }, [
            x * 3,
            y * 20,
            170,
            (x + y) % 3 ? 255 : 120,
          ]);
      const drafts: FrameDraft[] = [
        {
          id: "a",
          name: "a",
          sourceRect: { x: 0, y: 0, width: 70, height: 9 },
          origin: "manual",
          sourceFrameIds: [],
          edited: false,
          included: true,
          reviewStatus: "accepted",
        },
        {
          id: "empty",
          name: "empty",
          sourceRect: { x: 75, y: 0, width: 20, height: 20 },
          origin: "manual",
          sourceFrameIds: [],
          edited: false,
          included: true,
          reviewStatus: "accepted",
        },
      ];
      const frames = value(
        await normalizeFrames(
          input,
          drafts,
          { ...DEFAULT_NORMALIZE_OPTIONS, padding: 3 },
          context(),
        ),
      ).frames;
      const sequence =
        format === ExportFormat.PngSequenceZip || format === ExportFormat.GodotFramesZip;
      const pack = sequence
        ? null
        : value(
            await packFrames(
              input.ref,
              frames,
              { ...DEFAULT_PACK_OPTIONS, maxWidth: 64, maxHeight: 128, allowRotation: true },
              context(),
            ),
          );
      if (pack) {
        expect(pack.frames[0]?.rotated).toBe(true);
        for (const [i, p] of pack.frames.entries()) {
          expect(p.sourceRect).toEqual(frames[i]?.sourceRect);
          expect(p.bbox).toEqual(frames[i]?.bbox);
        }
      }
      const result = value(
        await exportAssets(
          { asset: input, frames, pack },
          { format, baseName: "atlas", animations: [] },
          codec,
          context(),
        ),
      );
      const bytes = new Uint8Array(result.archive),
        zip = unzipSync(bytes);
      for (const frame of frames) {
        const expected = new Uint8Array(frame.canvas.width * frame.canvas.height * 4);
        if (frame.bbox)
          for (let y = 0; y < frame.bbox.height; y++)
            for (let x = 0; x < frame.bbox.width; x++) {
              const source = ((frame.bbox.y + y) * input.pixels.width + frame.bbox.x + x) * 4;
              expected.set(
                input.pixels.data.subarray(source, source + 4),
                ((frame.canvas.offset.y + y) * frame.canvas.width + frame.canvas.offset.x + x) * 4,
              );
            }
        if (sequence) {
          const decoded = PNG.sync.read(Buffer.from(zip[`frames/${frame.name}.png`]!));
          expect(new Uint8Array(decoded.data)).toEqual(expected);
        } else {
          const pageName = format === ExportFormat.GenericJson ? "atlas-0.png" : "atlas.png";
          const decoded = PNG.sync.read(Buffer.from(zip[pageName]!));
          const packed = pack!.frames.find((p) => p.frameId === frame.id)!;
          const recovered = new Uint8Array(expected.length);
          if (frame.bbox)
            for (let y = 0; y < frame.bbox.height; y++)
              for (let x = 0; x < frame.bbox.width; x++) {
                const ax = packed.rotated ? frame.bbox.height - 1 - y : x,
                  ay = packed.rotated ? x : y;
                const source = ((packed.rect.y + ay) * decoded.width + packed.rect.x + ax) * 4;
                recovered.set(
                  decoded.data.subarray(source, source + 4),
                  ((frame.canvas.offset.y + y) * frame.canvas.width + frame.canvas.offset.x + x) *
                    4,
                );
              }
          expect(recovered).toEqual(expected);
        }
      }
      const view = new DataView(result.archive);
      let offset = view.getUint32(bytes.length - 6, true);
      for (const file of result.files) {
        expect(view.getUint32(offset, true)).toBe(0x02014b50);
        expect(view.getUint16(offset + 12, true)).toBe(0);
        expect(view.getUint16(offset + 14, true)).toBe(33);
        expect(view.getUint16(offset + 10, true)).toBe(file.mime === "image/png" ? 0 : 8);
        const nameLength = view.getUint16(offset + 28, true),
          extra = view.getUint16(offset + 30, true),
          comment = view.getUint16(offset + 32, true);
        expect(strFromU8(bytes.subarray(offset + 46, offset + 46 + nameLength))).toBe(file.path);
        offset += 46 + nameLength + extra + comment;
      }
    });
});

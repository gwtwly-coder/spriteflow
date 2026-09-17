// biome-ignore-all lint/style/noNonNullAssertion: Successful fixture construction establishes the packed entries under test.
import { strFromU8, unzipSync } from "fflate";
import { describe, expect, it } from "vitest";
import { renderAtlas, renderFrame } from "../src/export/render.js";
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

const ctx = () => createExecutionContext("test", { yieldControl: async () => {} });
async function fixture() {
  const input = paint(asset(100, 40), { x: 3, y: 5, width: 20, height: 10 });
  paint(input, { x: 43, y: 3, width: 10, height: 25 }, [10, 200, 60, 180]);
  const drafts: FrameDraft[] = [0, 40, 80].map((x, i) => ({
    id: `f${i}`,
    name: `frame_${i}`,
    sourceRect: { x, y: 0, width: 20, height: 35 },
    origin: "manual",
    sourceFrameIds: [],
    edited: false,
    included: true,
    reviewStatus: "accepted",
  }));
  const frames = value(
    await normalizeFrames(input, drafts, { ...DEFAULT_NORMALIZE_OPTIONS, padding: 2 }, ctx()),
  ).frames;
  return { input, frames };
}
describe("MaxRects packing", () => {
  it("keeps timeline order and correct trim/empty/padding/extrude geometry", async () => {
    const { input, frames } = await fixture();
    const options = { ...DEFAULT_PACK_OPTIONS, sizeMode: "pot" as const, border: 3 };
    const packed = value(await packFrames(input.ref, frames, options, ctx()));
    expect(packed.frameOrder).toEqual(["f0", "f1", "f2"]);
    expect(packed.frames.map((f) => f.frameId)).toEqual(packed.frameOrder);
    expect(packed.frames[2]?.spriteSourceSize).toEqual({ x: 0, y: 0, width: 1, height: 1 });
    for (const page of packed.pages) {
      expect(Number.isInteger(Math.log2(page.width))).toBe(true);
      expect(Number.isInteger(Math.log2(page.height))).toBe(true);
    }
    for (const f of packed.frames) {
      expect(f.rect.x).toBe(f.allocation.x + 1);
      expect(f.rect.y).toBe(f.allocation.y + 1);
      expect(f.allocation.width).toBe(f.rect.width + 2);
      expect(f.allocation.x).toBeGreaterThanOrEqual(3);
    }
    expect(value(await packFrames(input.ref, frames, options, ctx()))).toEqual(packed);
  });
  it("rejects unreviewed, duplicate/reserved names, illegal heuristic and overflows", async () => {
    const { input, frames } = await fixture();
    frames[0]!.reviewStatus = "pending";
    expect(await packFrames(input.ref, frames)).toMatchObject({
      ok: false,
      error: { code: "REVIEW_REQUIRED" },
    });
    frames[0]!.reviewStatus = "accepted";
    frames[0]!.name = "CON";
    expect(await packFrames(input.ref, frames)).toMatchObject({
      ok: false,
      error: { code: "INVALID_ARGUMENT" },
    });
    frames[0]!.name = "FRAME_1";
    expect(await packFrames(input.ref, frames)).toMatchObject({
      ok: false,
      error: { code: "INVALID_ARGUMENT" },
    });
    frames[0]!.name = "a";
    expect(
      await packFrames(input.ref, frames, {
        ...DEFAULT_PACK_OPTIONS,
        heuristic: "fill-width",
      } as never),
    ).toMatchObject({
      ok: false,
      error: { code: "INVALID_ARGUMENT", details: { field: "options.heuristic" } },
    });
    expect(
      await packFrames(input.ref, frames, {
        ...DEFAULT_PACK_OPTIONS,
        maxWidth: 64,
        maxHeight: 64,
        extrude: 8,
        border: 20,
      }),
    ).toMatchObject({ ok: false, error: { code: "FRAME_TOO_LARGE" } });
  });
});
describe("rendering and five export formats", () => {
  it("renders frame pixels, atlas content and nearest-edge extrusion", async () => {
    const { input, frames } = await fixture();
    const packed = value(await packFrames(input.ref, frames, undefined, ctx()));
    const page = await renderAtlas(input, frames, packed, 0, ctx());
    for (const [i, p] of packed.frames.entries()) {
      const frame = frames[i]!;
      const rendered = await renderFrame(input, frame, ctx());
      expect(rendered.width).toBe(frame.canvas.width);
      for (let y = 0; y < p.allocation.height; y++)
        for (let x = 0; x < p.allocation.width; x++) {
          const xx = Math.min(p.rect.width - 1, Math.max(0, x - packed.options.extrude));
          const yy = Math.min(p.rect.height - 1, Math.max(0, y - packed.options.extrude));
          const sourceX = p.rotated ? yy : xx,
            sourceY = p.rotated ? p.rect.width - 1 - xx : yy;
          const src =
            ((sourceY + frame.canvas.offset.y) * rendered.width + sourceX + frame.canvas.offset.x) *
            4;
          const dst = ((y + p.allocation.y) * page.width + x + p.allocation.x) * 4;
          expect([...page.data.slice(dst, dst + 4)]).toEqual([
            ...rendered.data.slice(src, src + 4),
          ]);
        }
    }
  });
  for (const format of Object.values(ExportFormat))
    it(`exports deterministic ${format} with manifest and duplicate animation references`, async () => {
      const { input, frames } = await fixture();
      const sequence =
        format === ExportFormat.GodotFramesZip || format === ExportFormat.PngSequenceZip;
      const pack = sequence ? null : value(await packFrames(input.ref, frames, undefined, ctx()));
      const encoded: PixelBuffer[] = [];
      const codec = {
        encode: async (p: PixelBuffer) => {
          encoded.push(p);
          return p.data.slice().buffer;
        },
      };
      const task = {
        format,
        baseName: "sprites",
        animations: [{ name: "walk", frameIds: ["f1", "f0", "f1"], fps: 8, loop: false }],
      };
      const source = { asset: input, frames, pack };
      const result = value(await exportAssets(source, task, codec, ctx()));
      const zip = unzipSync(new Uint8Array(result.archive));
      expect(Object.keys(zip)).toEqual(result.files.map((f) => f.path));
      expect(Object.keys(zip)).toEqual(Object.keys(zip).sort());
      expect(result.fileName).toBe(`sprites-${format}.zip`);
      expect(result.files.every((f) => f.byteLength === zip[f.path]?.length)).toBe(true);
      expect(value(await exportAssets(source, task, codec, ctx())).archive).toEqual(result.archive);
      for (const path of Object.keys(zip).filter((p) => p.endsWith(".json")))
        expect(strFromU8(zip[path]!)).toMatch(/\n$/);
      if (sequence) {
        const doc = JSON.parse(strFromU8(zip["sequence.json"]!));
        expect(doc.frames.map((f: { id: string }) => f.id)).toEqual(["f0", "f1", "f2"]);
        expect(doc.animations).toEqual(task.animations);
        if (format === ExportFormat.GodotFramesZip) {
          const script = strFromU8(zip["build_spriteframes.gd"]!);
          expect(script).toContain("@tool");
          expect(script).toContain("FileAccess.file_exists");
          expect(script).toContain("ResourceSaver.save");
          expect(script).toContain("get_script().resource_path.get_base_dir()");
        }
      } else {
        const doc = JSON.parse(strFromU8(zip["sprites.json"]!));
        if (format === ExportFormat.GenericJson) expect(doc.frameOrder).toEqual(["f0", "f1", "f2"]);
        else {
          expect(doc.meta.version).toBe("3.0.0");
          expect(Array.isArray(doc.frames)).toBe(format === ExportFormat.PhaserJsonArray);
          expect(JSON.parse(strFromU8(zip["animations.json"]!)).animations[0].frames).toEqual([
            "frame_1",
            "frame_0",
            "frame_1",
          ]);
        }
      }
    });
  it("maps codec exceptions and refuses stale frame geometry", async () => {
    const { input, frames } = await fixture();
    const pack = value(await packFrames(input.ref, frames, undefined, ctx()));
    const source = { asset: input, frames, pack };
    const task = { format: ExportFormat.PhaserJsonHash, baseName: "atlas", animations: [] };
    const codec = {
      encode: async (): Promise<ArrayBuffer> => {
        throw new Error("private path");
      },
    };
    expect(await exportAssets(source, task, codec, ctx())).toMatchObject({
      ok: false,
      error: { code: "ENCODE_FAILED", stage: "encode" },
    });
    frames[0]!.canvas.width++;
    expect(await exportAssets(source, task, codec, ctx())).toMatchObject({
      ok: false,
      error: { code: "STALE_RESULT" },
    });
  });
});

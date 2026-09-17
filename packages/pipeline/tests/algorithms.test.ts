// biome-ignore-all lint/style/noNonNullAssertion: These deterministic fixtures establish the indexed entries used by assertions.
import { describe, expect, it } from "vitest";
import { components, dilate, groupComponents } from "../src/detection/components.js";
import {
  createExecutionContext,
  DEFAULT_DETECT_OPTIONS,
  DEFAULT_NORMALIZE_OPTIONS,
  detect,
  normalizeFrames,
} from "../src/index.js";
import { makeMask } from "../src/input/pixels.js";
import { dhash } from "../src/normalization/hash.js";
import type { FrameDraft } from "../src/types.js";
import { asset, paint, value } from "./helpers.js";

const ctx = () => createExecutionContext("test", { yieldControl: async () => {} });
const draft = (id: string, x: number, y: number, width: number, height: number): FrameDraft => ({
  id,
  name: id,
  sourceRect: { x, y, width, height },
  origin: "manual",
  sourceFrameIds: [],
  edited: false,
  included: true,
  reviewStatus: "accepted",
});
describe("mask, two-pass eight-connected labeling and grouping", () => {
  it("matches explicitly painted dilation for concave and randomized shapes", async () => {
    let seed = 23;
    for (let round = 0; round < 30; round++) {
      const w = 31,
        h = 19,
        radius = round % 3;
      const mask = Uint8Array.from({ length: w * h }, () => {
        seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
        return Number(seed % 23 < 2);
      });
      const painted = new Uint8Array(mask.length);
      for (let y = 0; y < h; y++)
        for (let x = 0; x < w; x++)
          if (mask[y * w + x]) {
            for (let dy = -radius; dy <= radius; dy++)
              for (let dx = -radius; dx <= radius; dx++) {
                if (x + dx >= 0 && x + dx < w && y + dy >= 0 && y + dy < h)
                  painted[(y + dy) * w + x + dx] = 1;
              }
          }
      const labeled = await components(painted, w, h, ctx());
      const expected = new Map<number, number[]>();
      for (let p = 0; p < mask.length; p++)
        if (mask[p]) {
          const label = labeled.labels[p] as number;
          const group = expected.get(label) ?? [];
          group.push(p);
          expected.set(label, group);
        }
      const boxes = [...expected.values()]
        .map((ps) => {
          const xs = ps.map((p) => p % w),
            ys = ps.map((p) => Math.floor(p / w));
          return {
            rect: {
              x: Math.min(...xs),
              y: Math.min(...ys),
              width: Math.max(...xs) - Math.min(...xs) + 1,
              height: Math.max(...ys) - Math.min(...ys) + 1,
            },
            area: ps.length,
          };
        })
        .sort(
          (a, b) =>
            a.rect.y - b.rect.y ||
            a.rect.x - b.rect.x ||
            a.rect.height - b.rect.height ||
            a.rect.width - b.rect.width,
        );
      expect(
        (await groupComponents(mask, w, h, radius, 0, 0, 1, ctx())).groups.map((g) => ({
          rect: g.rect,
          area: g.area,
        })),
      ).toEqual(boxes);
    }
  });
  it("joins diagonals, respects alpha threshold, and keeps original area", async () => {
    const input = asset(5, 5);
    for (let i = 0; i < 3; i++) paint(input, { x: i, y: i, width: 1, height: 1 }, [0, 0, 0, 9]);
    paint(input, { x: 4, y: 4, width: 1, height: 1 }, [0, 0, 0, 8]);
    const scan = await makeMask(input.pixels, 8, ctx());
    const labeled = await components(scan.mask, 5, 5, ctx());
    expect(labeled.groups).toHaveLength(1);
    expect(labeled.groups[0]).toMatchObject({ area: 3, rect: { x: 0, y: 0, width: 3, height: 3 } });
  });
  it("matches an independent flood-fill oracle for deterministic random masks", async () => {
    let seed = 17;
    for (let round = 0; round < 30; round++) {
      const w = 17,
        h = 13;
      const mask = Uint8Array.from({ length: w * h }, () => {
        seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
        return Number(seed % 7 < 2);
      });
      const seen = new Set<number>(),
        areas: number[] = [];
      for (let p = 0; p < mask.length; p++) {
        if (!mask[p] || seen.has(p)) continue;
        const queue = [p];
        seen.add(p);
        for (let i = 0; i < queue.length; i++) {
          const q = queue[i] as number,
            x = q % w,
            y = Math.floor(q / w);
          for (let dy = -1; dy <= 1; dy++)
            for (let dx = -1; dx <= 1; dx++) {
              const xx = x + dx,
                yy = y + dy,
                next = yy * w + xx;
              if (xx >= 0 && xx < w && yy >= 0 && yy < h && mask[next] && !seen.has(next)) {
                seen.add(next);
                queue.push(next);
              }
            }
        }
        areas.push(queue.length);
      }
      expect(
        (await components(mask, w, h, ctx())).groups.map((g) => g.area).sort((a, b) => a - b),
      ).toEqual(areas.sort((a, b) => a - b));
    }
  });
  it("square dilation is exact at clipped edges", async () => {
    const mask = new Uint8Array(25);
    mask[0] = 1;
    expect([...(await dilate(mask, 5, 5, 1, ctx()))]).toEqual([
      1, 1, 0, 0, 0, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
    ]);
  });
  it("merges fragments before area filtering and preserves provenance", async () => {
    const input = asset(12, 4);
    for (const x of [1, 4, 7]) paint(input, { x, y: 1, width: 1, height: 1 });
    const { mask } = await makeMask(input.pixels, 8, ctx());
    const result = await groupComponents(mask, 12, 4, 1, 0, 0, 3, ctx());
    expect(result.groups).toHaveLength(1);
    expect(result.groups[0]).toMatchObject({
      area: 3,
      rect: { x: 1, y: 1, width: 7, height: 1 },
      sources: [0, 1, 2],
    });
  });
  it("uses strict bbox gap comparisons and transitive merging", async () => {
    const input = asset(20, 8);
    for (const x of [1, 5, 9]) paint(input, { x, y: 1, width: 2, height: 2 });
    const { mask } = await makeMask(input.pixels, 8, ctx());
    expect((await groupComponents(mask, 20, 8, 0, 2, 0, 1, ctx())).groups).toHaveLength(3);
    expect((await groupComponents(mask, 20, 8, 0, 3, 0, 1, ctx())).groups).toHaveLength(1);
  });
});
describe("normalization and deterministic dHash", () => {
  it("preserves trim, uniform/excluded geometry and input ownership", async () => {
    const input = paint(asset(40, 20), { x: 2, y: 3, width: 3, height: 5 });
    paint(input, { x: 12, y: 2, width: 8, height: 8 });
    paint(input, { x: 25, y: 1, width: 12, height: 12 });
    const ds = [
      draft("a", 0, 0, 10, 15),
      draft("b", 10, 0, 12, 15),
      { ...draft("c", 23, 0, 15, 15), included: false },
    ];
    const before = structuredClone(input);
    const result = value(
      await normalizeFrames(input, ds, { ...DEFAULT_NORMALIZE_OPTIONS, padding: 1 }, ctx()),
    );
    expect(result.frames[0]?.bbox).toEqual({ x: 2, y: 3, width: 3, height: 5 });
    expect(result.frames[0]?.canvas).toEqual({ width: 10, height: 10, offset: { x: 3, y: 2 } });
    expect(result.frames[2]?.canvas).toEqual({ width: 14, height: 14, offset: { x: 1, y: 1 } });
    expect(input).toEqual(before);
    expect(
      value(
        await normalizeFrames(
          input,
          [ds[0] as FrameDraft],
          { ...DEFAULT_NORMALIZE_OPTIONS, trim: false },
          ctx(),
        ),
      ).frames[0]?.bbox,
    ).toEqual(ds[0]?.sourceRect);
  });
  it("counts significant raw components without deleting small pixels", async () => {
    const input = asset(20, 10);
    paint(input, { x: 1, y: 1, width: 2, height: 2 });
    paint(input, { x: 8, y: 1, width: 2, height: 2 });
    paint(input, { x: 18, y: 8, width: 1, height: 1 });
    const frame = value(await normalizeFrames(input, [draft("a", 0, 0, 20, 10)], undefined, ctx()))
      .frames[0];
    expect(frame?.flags.multipleComponents).toBe(true);
    expect(frame?.bbox).toEqual({ x: 1, y: 1, width: 18, height: 8 });
  });
  it("uses strict outlier deviation and retains merged metadata", async () => {
    const input = asset(90, 25);
    const ds = [10, 10, 14, 15].map((w, i) => {
      paint(input, { x: i * 20, y: 2, width: w, height: 10 });
      return draft(`f${i}`, i * 20, 0, 18, 20);
    });
    ds[3]!.sourceFrameIds = ["p_0", "p_1"];
    const result = value(
      await normalizeFrames(
        input,
        ds,
        { ...DEFAULT_NORMALIZE_OPTIONS, outlierThreshold: 0.2 },
        ctx(),
      ),
    );
    expect(result.frames.map((f) => f.flags.outlier)).toEqual([false, false, false, true]);
    expect(result.frames[3]?.flags.merged).toBe(true);
  });
  it("hashes decreasing/increasing grayscale with MSB-first strict comparisons", async () => {
    const input = asset(9, 8);
    for (let x = 0; x < 9; x++)
      paint(input, { x, y: 0, width: 1, height: 8 }, [
        240 - x * 20,
        240 - x * 20,
        240 - x * 20,
        255,
      ]);
    expect((await dhash(input.pixels, { x: 0, y: 0, width: 9, height: 8 }, ctx())).hex).toBe(
      "ffffffffffffffff",
    );
    expect((await dhash(asset(1, 1).pixels, { x: 0, y: 0, width: 1, height: 1 }, ctx())).hex).toBe(
      "0000000000000000",
    );
  });
});
describe("strategy selection", () => {
  it("uses the fundamental period instead of merging cells at harmonic periods", async () => {
    const input = asset(240, 40);
    for (let i = 0; i < 6; i++) paint(input, { x: 10 + i * 40, y: 10, width: 20, height: 20 });
    const result = value(await detect(input, undefined, ctx()));
    expect(result.strategy).toBe("grid");
    expect(result.frames).toHaveLength(6);
  });
  it("selects a regular grid and enforces a strict confidence threshold", async () => {
    const input = asset(80, 40);
    for (const x of [10, 50]) paint(input, { x, y: 10, width: 20, height: 20 });
    expect(value(await detect(input, undefined, ctx())).strategy).toBe("grid");
    const result = value(
      await detect(
        input,
        {
          ...DEFAULT_DETECT_OPTIONS,
          mode: "grid",
          grid: { ...DEFAULT_DETECT_OPTIONS.grid, confidenceThreshold: 1 },
        },
        ctx(),
      ),
    );
    expect(result.degraded?.reason).toBe("LOW_CONFIDENCE");
  });
  it("does not truncate too many frames", async () => {
    const input = asset(80, 40);
    for (const x of [10, 50]) paint(input, { x, y: 10, width: 20, height: 20 });
    const result = value(
      await detect(
        input,
        {
          ...DEFAULT_DETECT_OPTIONS,
          mode: "components",
          maxFrames: 1,
          dilationRadiusPx: 0,
          mergeDistancePx: 0,
        },
        ctx(),
      ),
    );
    expect(result.degraded?.reason).toBe("FRAME_LIMIT_EXCEEDED");
    expect(result.frames).toHaveLength(1);
  });
});

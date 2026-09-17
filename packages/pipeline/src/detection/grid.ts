// biome-ignore-all lint/style/noNonNullAssertion: Projection lengths and candidate counts bound indexed access in these hot loops.
import { tightBoundsAsync } from "../input/pixels.js";
import { checkpoint } from "../runtime/execution.js";
import type { ExecutionContext, FrameDraft, GridOptions, ManualGrid, Rect } from "../types.js";
import { ProgressStage } from "../types.js";
import { median } from "./components.js";

export async function gridDrafts(
  xs: number[],
  ys: number[],
  mask: Uint8Array,
  width: number,
  context: ExecutionContext,
  keepEmpty: boolean,
  minArea = 0,
  manual = false,
): Promise<FrameDraft[]> {
  const drafts: FrameDraft[] = [];
  for (let row = 0; row < ys.length - 1; row++)
    for (let col = 0; col < xs.length - 1; col++) {
      const rect = {
        x: xs[col]!,
        y: ys[row]!,
        width: xs[col + 1]! - xs[col]!,
        height: ys[row + 1]! - ys[row]!,
      };
      const { area } = await tightBoundsAsync(mask, width, rect, context, ProgressStage.Grid);
      if ((!area && !keepEmpty) || (area > 0 && area < minArea)) continue;
      drafts.push({
        id: `g_${row}_${col}`,
        name: `frame_${String(drafts.length).padStart(3, "0")}`,
        sourceRect: rect,
        origin: manual ? "manual" : "grid",
        sourceFrameIds: [],
        edited: false,
        included: true,
        reviewStatus: "pending",
      });
    }
  return drafts;
}
export async function manualDrafts(
  grid: ManualGrid,
  width: number,
  height: number,
  mask: Uint8Array,
  context: ExecutionContext,
): Promise<FrameDraft[]> {
  const r = grid.region ?? { x: 0, y: 0, width, height };
  const xs = Array.from(
    { length: grid.columns + 1 },
    (_, i) => r.x + Math.floor((i * r.width) / grid.columns),
  );
  const ys = Array.from(
    { length: grid.rows + 1 },
    (_, i) => r.y + Math.floor((i * r.height) / grid.rows),
  );
  return gridDrafts(xs, ys, mask, width, context, grid.keepEmptyCells, 0, true);
}
function periodicity(cuts: number[], tolerance: number): number {
  if (cuts.length === 2) return 1;
  const gaps = cuts.slice(1).map((x, i) => x - cuts[i]!);
  const period = median(gaps);
  return (
    (Math.max(0, 1 - median(gaps.map((g) => Math.abs(g - period))) / Math.max(1, period)) *
      gaps.filter((g) => Math.abs(g - period) / period <= tolerance).length) /
    gaps.length
  );
}
async function axisCandidates(
  signal: Uint32Array,
  orthogonal: number,
  workLength: number,
  o: GridOptions,
  context: ExecutionContext,
): Promise<number[][]> {
  const scale = signal.length / workLength,
    minimum = Math.max(1, Math.ceil(o.minGutterPx * scale));
  const gutters: { start: number; end: number; center: number }[] = [];
  for (let i = 0; i < signal.length; ) {
    if (signal[i]! / orthogonal > o.gutterOccupancyThreshold) {
      i++;
      continue;
    }
    const start = i++;
    while (i < signal.length && signal[i]! / orthogonal <= o.gutterOccupancyThreshold) i++;
    if (start && i < signal.length && i - start >= minimum)
      gutters.push({ start, end: i, center: Math.floor((start + i) / 2) });
  }
  const candidates: number[][] = [];
  const add = (inside: number[]) => {
    const cuts = [0, ...inside.map((x) => Math.floor(x / scale)), workLength];
    if (cuts.slice(1).some((x, i) => x - cuts[i]! < o.minCellPx)) return;
    if (!candidates.some((c) => c.length === cuts.length && c.every((x, i) => x === cuts[i])))
      candidates.push(cuts);
  };
  add(gutters.map((g) => g.center));
  // Normalized autocorrelation proposes periods; cuts still use transparent-slot centers.
  const scores: { lag: number; score: number }[] = [];
  for (
    let lag = Math.max(1, Math.ceil(o.minCellPx * scale));
    lag <= Math.floor(signal.length / 2);
    lag++
  ) {
    let cross = 0,
      aa = 0,
      bb = 0;
    for (let i = 0; i + lag < signal.length; i++) {
      const a = signal[i]!,
        b = signal[i + lag]!;
      cross += a * b;
      aa += a * a;
      bb += b * b;
    }
    scores.push({ lag, score: aa && bb ? cross / Math.sqrt(aa * bb) : 0 });
    if ((lag & 31) === 31) await checkpoint(context, ProgressStage.Grid);
  }
  const peaks = scores
    .filter(
      (s, i) =>
        s.score > 0.8 &&
        s.score >= (scores[i - 1]?.score ?? 0) &&
        s.score > (scores[i + 1]?.score ?? 0),
    )
    .sort((a, b) => b.score - a.score || a.lag - b.lag)
    .slice(0, 8);
  const fundamental = peaks.length ? Math.min(...peaks.map((p) => p.lag)) : Infinity;
  for (const { lag } of peaks) {
    // Harmonics describe repeated groups of frames, not additional cell candidates.
    if (lag > fundamental * (1 + optionsTolerance(o))) continue;
    const cells = Math.round(signal.length / lag);
    if (cells < 2 || cells > 100 || Math.abs(signal.length / cells - lag) / lag > o.periodTolerance)
      continue;
    const selected: number[] = [];
    for (let i = 1; i < cells; i++) {
      const target = (i * signal.length) / cells;
      const gutter = gutters.find((g) => target >= g.start && target < g.end);
      if (!gutter) break;
      selected.push(gutter.center);
    }
    if (selected.length === cells - 1) add(selected);
  }
  if (!gutters.length) add([]);
  return candidates;
}
function optionsTolerance(o: GridOptions): number {
  return Math.max(0.08, o.periodTolerance);
}
export async function findGrid(
  mask: Uint8Array,
  width: number,
  height: number,
  rows: Uint32Array,
  cols: Uint32Array,
  options: GridOptions,
  minArea: number,
  context: ExecutionContext,
) {
  const xCandidates = await axisCandidates(cols, rows.length, width, options, context);
  const yCandidates = await axisCandidates(rows, cols.length, height, options, context);
  let best: {
    xs: number[];
    ys: number[];
    confidence: number;
    drafts: FrameDraft[];
    cellCount: number;
  } | null = null;
  for (const xs of xCandidates)
    for (const ys of yCandidates) {
      if (xs.length === 2 && ys.length === 2) continue;
      let transparent = 0,
        total = 0,
        occupied = 0;
      const cutXs = new Set(xs.slice(1, -1)),
        cutYs = new Set(ys.slice(1, -1));
      for (let y = 0; y < height; y++) {
        if (cutYs.has(y))
          for (let x = 0; x < width; x++) {
            total++;
            if (!mask[y * width + x]) transparent++;
          }
        else
          for (const x of cutXs) {
            total++;
            if (!mask[y * width + x]) transparent++;
          }
        if ((y & 63) === 63) await checkpoint(context, ProgressStage.Grid);
      }
      for (let row = 0; row < ys.length - 1; row++)
        for (let col = 0; col < xs.length - 1; col++) {
          const rect: Rect = {
            x: xs[col]!,
            y: ys[row]!,
            width: xs[col + 1]! - xs[col]!,
            height: ys[row + 1]! - ys[row]!,
          };
          if ((await tightBoundsAsync(mask, width, rect, context, ProgressStage.Grid)).area)
            occupied++;
        }
      const cellCount = (xs.length - 1) * (ys.length - 1);
      const regularity =
        (periodicity(xs, options.periodTolerance) + periodicity(ys, options.periodTolerance)) / 2;
      const confidence = Math.min(
        1,
        0.45 * regularity + 0.35 * (total ? transparent / total : 0) + (0.2 * occupied) / cellCount,
      );
      if (
        !best ||
        confidence > best.confidence ||
        (confidence === best.confidence &&
          (cellCount < best.cellCount ||
            (cellCount === best.cellCount &&
              (ys.length < best.ys.length ||
                (ys.length === best.ys.length && xs.length < best.xs.length)))))
      ) {
        best = {
          xs,
          ys,
          confidence,
          cellCount,
          drafts: await gridDrafts(xs, ys, mask, width, context, options.keepEmptyCells, minArea),
        };
      }
    }
  return best;
}

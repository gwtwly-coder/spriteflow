// biome-ignore-all lint/style/noNonNullAssertion: Typed-array indices and union-find labels are bounded by the validated mask and loop limits.
import type { Progress } from "../runtime/execution.js";
import { checkpoint, memory } from "../runtime/execution.js";
import type { ExecutionContext, Rect } from "../types.js";
import { ProgressStage } from "../types.js";

export interface Component {
  rect: Rect;
  area: number;
  sources: number[];
  seed: number;
  runs: { y: number; left: number; right: number }[];
}
export function median(values: number[]): number {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b),
    m = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[m]! : (sorted[m - 1]! + sorted[m]!) / 2;
}
class UnionFind {
  readonly parent: Uint32Array;
  constructor(length: number) {
    this.parent = new Uint32Array(length);
  }
  root(i: number): number {
    let r = i;
    while (this.parent[r] !== r) r = this.parent[r]!;
    while (i !== r) {
      const next = this.parent[i]!;
      this.parent[i] = r;
      i = next;
    }
    return r;
  }
  join(a: number, b: number): number {
    a = this.root(a);
    b = this.root(b);
    if (a > b) [a, b] = [b, a];
    this.parent[b] = a;
    return a;
  }
}

export async function components(
  mask: Uint8Array,
  width: number,
  height: number,
  context: ExecutionContext,
  progress?: Progress,
  collectRuns = false,
) {
  const labels = new Uint32Array(mask.length);
  const uf = new UnionFind(Math.ceil(width / 2) * Math.ceil(height / 2) + 1);
  let next = 0;
  for (let y = 0; y < height; y++) {
    for (let x = 0, p = y * width; x < width; x++, p++) {
      if (!mask[p]) continue;
      const left = x ? labels[p - 1]! : 0;
      const up = y ? labels[p - width]! : 0;
      const ul = x && y ? labels[p - width - 1]! : 0;
      const ur = y && x + 1 < width ? labels[p - width + 1]! : 0;
      let label = left || up || ul || ur;
      if (!label) {
        label = ++next;
        uf.parent[label] = label;
      } else {
        if (up && up !== label) label = uf.join(label, up);
        if (ul && ul !== label) label = uf.join(label, ul);
        if (ur && ur !== label) label = uf.join(label, ur);
        if (left && left !== label) label = uf.join(label, left);
      }
      labels[p] = label;
    }
    if ((y & 63) === 63) {
      progress?.report(ProgressStage.Components, y + 1, height * 2);
      await checkpoint(context, ProgressStage.Components);
    }
  }
  const canonical = new Uint32Array(next + 1);
  for (let i = 1; i <= next; i++) canonical[i] = uf.root(i);
  const indices = new Int32Array(next + 1);
  indices.fill(-1);
  const groups: Component[] = [];
  for (let y = 0; y < height; y++) {
    let runStart = 0;
    for (let x = 0, p = y * width; x < width; x++, p++) {
      if (!labels[p]) continue;
      const root = canonical[labels[p]!]!;
      labels[p] = root;
      let index = indices[root]!;
      if (index < 0) {
        index = groups.length;
        indices[root] = index;
        if ((index & 4095) === 0)
          memory(
            context,
            24 * width * height + (index + 4096) * 256 + 16_777_216,
            { width, height },
            ProgressStage.Components,
          );
        groups.push({
          rect: { x, y, width: 1, height: 1 },
          area: 0,
          sources: [index],
          seed: p,
          runs: [],
        });
      }
      const group = groups[index]!,
        rect = group.rect;
      const right = Math.max(rect.x + rect.width, x + 1);
      rect.x = Math.min(rect.x, x);
      rect.width = right - rect.x;
      rect.height = y - rect.y + 1;
      group.area++;
      if (collectRuns) {
        if (x === 0 || labels[p - 1] !== root) runStart = x;
        if (x + 1 === width || canonical[labels[p + 1]!] !== root) {
          group.runs.push({ y, left: runStart, right: x + 1 });
        }
      }
    }
    if ((y & 63) === 63) {
      progress?.report(ProgressStage.Components, height + y + 1, height * 2);
      await checkpoint(context, ProgressStage.Components);
    }
  }
  return { groups, labels };
}
export async function dilate(
  mask: Uint8Array,
  width: number,
  height: number,
  radius: number,
  context: ExecutionContext,
): Promise<Uint8Array> {
  if (!radius) return mask;
  const horizontal = new Uint8Array(mask.length),
    output = new Uint8Array(mask.length);
  for (let y = 0; y < height; y++) {
    const start = y * width;
    let sum = 0;
    for (let x = 0; x < Math.min(width, radius + 1); x++) sum += mask[start + x]!;
    for (let x = 0; x < width; x++) {
      horizontal[start + x] = Number(sum > 0);
      if (x >= radius) sum -= mask[start + x - radius]!;
      if (x + radius + 1 < width) sum += mask[start + x + radius + 1]!;
    }
    if ((y & 63) === 63) await checkpoint(context, ProgressStage.Components);
  }
  const sums = new Uint32Array(width);
  for (let y = 0; y < Math.min(height, radius + 1); y++)
    for (let x = 0; x < width; x++) sums[x] = sums[x]! + horizontal[y * width + x]!;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      output[y * width + x] = Number(sums[x]! > 0);
      if (y >= radius) sums[x] = sums[x]! - horizontal[(y - radius) * width + x]!;
      if (y + radius + 1 < height) sums[x] = sums[x]! + horizontal[(y + radius + 1) * width + x]!;
    }
    if ((y & 63) === 63) await checkpoint(context, ProgressStage.Components);
  }
  return output;
}
function combine(a: Component, b: Component): void {
  const right = Math.max(a.rect.x + a.rect.width, b.rect.x + b.rect.width);
  const bottom = Math.max(a.rect.y + a.rect.height, b.rect.y + b.rect.height);
  a.rect.x = Math.min(a.rect.x, b.rect.x);
  a.rect.y = Math.min(a.rect.y, b.rect.y);
  a.rect.width = right - a.rect.x;
  a.rect.height = bottom - a.rect.y;
  a.area += b.area;
  a.sources.push(...b.sources);
}
function gap(a: Rect, b: Rect): number {
  return Math.max(
    0,
    a.x - b.x - b.width,
    b.x - a.x - a.width,
    a.y - b.y - b.height,
    b.y - a.y - a.height,
  );
}
export async function groupComponents(
  mask: Uint8Array,
  width: number,
  height: number,
  radius: number,
  distance: number | null,
  distanceRatio: number,
  minArea: number,
  context: ExecutionContext,
  progress?: Progress,
) {
  let { groups } = await components(mask, width, height, context, progress, radius > 0);
  if (radius && groups.length > 1) {
    // Two radius-r square dilations touch in the 8-neighborhood exactly when
    // their original pixel centers have Chebyshev distance <= 2r+1. Row runs
    // retain the original shape, unlike merging expanded bounding boxes.
    const uf = new UnionFind(groups.length);
    for (let i = 0; i < groups.length; i++) uf.parent[i] = i;
    const ordered = groups.map((g, i) => ({ g, i })).sort((a, b) => a.g.rect.x - b.g.rect.x);
    let operations = 0;
    for (let i = 0; i < ordered.length; i++) {
      const a = ordered[i]!;
      for (let j = i + 1; j < ordered.length; j++) {
        const b = ordered[j]!;
        if (b.g.rect.x - a.g.rect.x - a.g.rect.width > 2 * radius) break;
        if (gap(a.g.rect, b.g.rect) > 2 * radius || uf.root(a.i) === uf.root(b.i)) continue;
        let start = 0,
          touches = false;
        for (const ar of a.g.runs) {
          while (start < b.g.runs.length && b.g.runs[start]!.y < ar.y - 2 * radius - 1) start++;
          for (let k = start; k < b.g.runs.length && b.g.runs[k]!.y <= ar.y + 2 * radius + 1; k++) {
            const br = b.g.runs[k]!;
            if (Math.max(0, ar.left - br.right, br.left - ar.right) <= 2 * radius) {
              touches = true;
              break;
            }
            if ((++operations & 4095) === 0) await checkpoint(context, ProgressStage.Components);
          }
          if (touches) break;
        }
        if (touches) uf.join(a.i, b.i);
      }
      if ((i & 63) === 63) await checkpoint(context, ProgressStage.Components);
    }
    const merged = new Map<number, Component>();
    for (const [index, group] of groups.entries()) {
      group.runs = [];
      const label = uf.root(index),
        prior = merged.get(label);
      if (prior) combine(prior, group);
      else merged.set(label, group);
    }
    groups = [...merged.values()];
  }
  const effectiveDistance =
    distance ??
    Math.round(median(groups.map((g) => Math.min(g.rect.width, g.rect.height))) * distanceRatio);
  if (effectiveDistance > 0 && groups.length > 1) {
    const uf = new UnionFind(groups.length);
    for (let i = 0; i < groups.length; i++) uf.parent[i] = i;
    const sorted = groups.map((g, i) => ({ g, i })).sort((a, b) => a.g.rect.x - b.g.rect.x);
    let comparisons = 0;
    for (let i = 0; i < sorted.length; i++) {
      const a = sorted[i]!;
      for (let j = i + 1; j < sorted.length; j++) {
        const b = sorted[j]!;
        if (b.g.rect.x - a.g.rect.x - a.g.rect.width >= effectiveDistance) break;
        if (gap(a.g.rect, b.g.rect) < effectiveDistance) uf.join(a.i, b.i);
        if ((++comparisons & 4095) === 0) await checkpoint(context, ProgressStage.Components);
      }
      if ((i & 63) === 63) await checkpoint(context, ProgressStage.Components);
    }
    const merged = new Map<number, Component>();
    for (const [i, g] of groups.entries()) {
      const root = uf.root(i),
        prior = merged.get(root);
      if (prior) combine(prior, g);
      else merged.set(root, g);
    }
    groups = [...merged.values()];
  }
  const count = groups.length;
  groups = groups
    .filter((g) => g.area >= minArea)
    .sort(
      (a, b) =>
        a.rect.y - b.rect.y ||
        a.rect.x - b.rect.x ||
        a.rect.height - b.rect.height ||
        a.rect.width - b.rect.width,
    );
  for (const group of groups) group.sources.sort((a, b) => a - b);
  return { groups, count, effectiveDistance };
}

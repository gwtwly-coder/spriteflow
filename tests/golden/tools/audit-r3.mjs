// Independent geometry proof: flood-fill and explicit square painting, no pipeline imports.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const root = new URL("../", import.meta.url);
const { PNG } = createRequire(new URL("package.json", root))("pngjs");

function flood(mask, width, height) {
  const seen = new Uint8Array(mask.length),
    groups = [];
  for (let first = 0; first < mask.length; first++) {
    if (!mask[first] || seen[first]) continue;
    const points = [first];
    seen[first] = 1;
    for (let i = 0; i < points.length; i++) {
      const p = points[i],
        x = p % width,
        y = Math.floor(p / width);
      for (let dy = -1; dy <= 1; dy++)
        for (let dx = -1; dx <= 1; dx++) {
          const xx = x + dx,
            yy = y + dy,
            q = yy * width + xx;
          if (xx < 0 || xx >= width || yy < 0 || yy >= height || !mask[q] || seen[q]) continue;
          seen[q] = 1;
          points.push(q);
        }
    }
    groups.push(points);
  }
  return groups;
}
function bbox(points, width) {
  const xs = points.map((p) => p % width),
    ys = points.map((p) => Math.floor(p / width));
  const x = Math.min(...xs),
    y = Math.min(...ys);
  return { x, y, width: Math.max(...xs) - x + 1, height: Math.max(...ys) - y + 1 };
}
function median(items) {
  const s = [...items].sort((a, b) => a - b),
    m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}
for (const caseId of [
  "07-scatter-5",
  "10-detached-weapons",
  "11-noise-speckles",
  "12-noise-clusters",
  "15-repeated-frames",
  "16-size-outlier",
  "18-single-frame-degrade",
  "19-ambiguous-degrade",
  "20-empty-transparent",
]) {
  const png = PNG.sync.read(readFileSync(new URL(`cases/${caseId}/input.png`, root)));
  const { width, height } = png;
  const mask = Uint8Array.from({ length: width * height }, (_, i) =>
    Number(png.data[i * 4 + 3] > 8),
  );
  const original = flood(mask, width, height);
  const radius = Math.min(64, Math.round(Math.min(width, height) * 0.01));
  const expanded = new Uint8Array(mask.length);
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++)
      if (mask[y * width + x]) {
        for (let dy = -radius; dy <= radius; dy++)
          for (let dx = -radius; dx <= radius; dx++) {
            if (x + dx >= 0 && x + dx < width && y + dy >= 0 && y + dy < height)
              expanded[(y + dy) * width + x + dx] = 1;
          }
      }
  const dilated = flood(expanded, width, height).map((ps) => ps.filter((p) => mask[p]));
  const groups = dilated.map((points) => ({ points, bbox: bbox(points, width) }));
  const distance = groups.length
    ? Math.round(median(groups.map((g) => Math.min(g.bbox.width, g.bbox.height))) * 0.15)
    : 0;
  const seen = new Set(),
    merged = [];
  for (let first = 0; first < groups.length; first++) {
    if (seen.has(first)) continue;
    const indices = [first];
    seen.add(first);
    for (let i = 0; i < indices.length; i++)
      for (let next = 0; next < groups.length; next++) {
        if (seen.has(next)) continue;
        const a = groups[indices[i]].bbox,
          b = groups[next].bbox;
        const gap = Math.max(
          0,
          a.x - b.x - b.width,
          b.x - a.x - a.width,
          a.y - b.y - b.height,
          b.y - a.y - a.height,
        );
        if (gap < distance) {
          indices.push(next);
          seen.add(next);
        }
      }
    const points = indices.flatMap((i) => groups[i].points);
    if (points.length < Math.max(4, Math.ceil(width * height * 0.00001))) continue;
    const set = new Set(points),
      sources = original.map((ps, i) => (set.has(ps[0]) ? i : -1)).filter((i) => i >= 0);
    merged.push({ bbox: bbox(points, width), area: points.length, sources });
  }
  merged.sort(
    (a, b) =>
      a.bbox.y - b.bbox.y ||
      a.bbox.x - b.bbox.x ||
      a.bbox.height - b.bbox.height ||
      a.bbox.width - b.bbox.width,
  );
  const n = merged.length || 1,
    columns = Math.ceil(Math.sqrt((n * width) / height)),
    rows = Math.ceil(n / columns);
  if (caseId.startsWith("15")) {
    const crop = (r) => {
      const bytes = [];
      for (let y = r.y; y < r.y + r.height; y++)
        for (let x = r.x; x < r.x + r.width; x++)
          bytes.push(...png.data.subarray((y * width + x) * 4, (y * width + x) * 4 + 4));
      return bytes;
    };
    assert.deepEqual(crop(merged[0].bbox), crop(merged[4].bbox));
  }
  if (caseId.startsWith("19")) {
    assert.equal(original.length, 3);
    assert.equal(distance, 3);
    assert.equal(merged.length, 1);
  }
  console.log(
    JSON.stringify({
      caseId,
      originalCount: original.length,
      dilatedCount: dilated.length,
      distance,
      kept: merged,
      N: n,
      fallback: caseId.startsWith("20") ? { rows: 1, columns: 1 } : { rows, columns },
    }),
  );
}
console.error(
  `Evidence source: ${fileURLToPath(root)}; no imports from packages/pipeline/src or dist.`,
);

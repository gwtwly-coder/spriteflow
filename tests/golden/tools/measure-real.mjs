import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PNG } from "pngjs";

const ALPHA_THRESHOLD = 8;
const MIN_AREA_PX = 4;
const MIN_AREA_RATIO = 0.00001;
const MERGE_DISTANCE_RATIO = 0.15;
const CLUSTER_TOLERANCE = 0.3;
const GUTTER_OCCUPANCY_THRESHOLD = 0.005;
const MIN_GUTTER_PX = 2;
const PERIOD_TOLERANCE = 0.08;

const scriptRoot = path.dirname(fileURLToPath(import.meta.url));
const realRoot = path.resolve(scriptRoot, "..", "real");
const reportPath = path.join(realRoot, "measurements.json");
const inputs = ["rw-02.png", "RW-03.png", "RW-04.png", "RW-05.png", "RW-06.png", "RW-07.png"];

const measurements = [];
for (const file of inputs) {
  const bytes = await readFile(path.join(realRoot, file));
  const png = PNG.sync.read(bytes);
  measurements.push(measureImage(file, bytes, png));
  console.log(`MEASURED ${file}`);
}

await mkdir(realRoot, { recursive: true });
await writeFile(
  reportPath,
  `${JSON.stringify(
    {
      schemaVersion: "spriteflow-real-measurements/1",
      method: {
        implementation: "tests/golden/tools/measure-real.mjs",
        pipelineImported: false,
        alphaThreshold: ALPHA_THRESHOLD,
        connectivity: 8,
        minAreaPx: MIN_AREA_PX,
        minAreaRatio: MIN_AREA_RATIO,
        mergeDistanceRatio: MERGE_DISTANCE_RATIO,
        clusterTolerance: CLUSTER_TOLERANCE,
        gutterOccupancyThreshold: GUTTER_OCCUPANCY_THRESHOLD,
        minGutterPx: MIN_GUTTER_PX,
        periodTolerance: PERIOD_TOLERANCE,
      },
      images: measurements,
    },
    null,
    2,
  )}\n`,
  "utf8",
);
console.log(`Report: ${reportPath}`);

function measureImage(file, bytes, png) {
  const { width, height, data } = png;
  const mask = new Uint8Array(width * height);
  const alpha = { transparent: 0, translucent: 0, opaque: 0 };
  let foregroundPixels = 0;
  for (let index = 0; index < width * height; index += 1) {
    const value = data[index * 4 + 3];
    if (value === 0) alpha.transparent += 1;
    else if (value === 255) alpha.opaque += 1;
    else alpha.translucent += 1;
    if (value > ALPHA_THRESHOLD) {
      mask[index] = 1;
      foregroundPixels += 1;
    }
  }

  const effectiveMinAreaPx = Math.max(MIN_AREA_PX, Math.ceil(width * height * MIN_AREA_RATIO));
  const raw = labelMask(mask, width, height, true);
  const dilationRadiusPx = Math.min(64, Math.max(0, Math.round(Math.min(width, height) * 0.01)));
  const dilated = dilateSquare(mask, width, height, dilationRadiusPx);
  const dilatedLabels = labelMask(dilated, width, height, false);
  const dilationGroups = aggregateOriginalMask(
    mask,
    dilatedLabels.labels,
    dilatedLabels.count,
    width,
    height,
  );
  const shortSides = dilationGroups.map((group) => Math.min(group.bbox.width, group.bbox.height));
  const mergeDistancePx = Math.round(median(shortSides) * MERGE_DISTANCE_RATIO);
  const mergedGroups = mergeByBboxGap(dilationGroups, mergeDistancePx).filter(
    (group) => group.area >= effectiveMinAreaPx,
  );
  mergedGroups.sort(compareBbox);

  const clusterSizes = clusterBySize(mergedGroups.map((group) => group.bbox));
  const retainedPixels = mergedGroups.reduce((total, group) => total + group.area, 0);
  const componentConfidence =
    mergedGroups.length >= 2 && foregroundPixels > 0
      ? 0.7 * (Math.max(...clusterSizes) / mergedGroups.length) +
        0.3 * (retainedPixels / foregroundPixels)
      : 0;

  const rowProjection = projection(mask, width, height, "row");
  const columnProjection = projection(mask, width, height, "column");
  const rowGutters = gutterRuns(rowProjection, width, height);
  const columnGutters = gutterRuns(columnProjection, height, width);
  const grid = measureGridCandidate(
    mask,
    width,
    height,
    rowGutters,
    columnGutters,
    effectiveMinAreaPx,
  );
  const independentExpected = inferExpected({
    mask,
    width,
    height,
    grid,
    groupedComponents: mergedGroups,
    componentConfidence,
    effectiveMinAreaPx,
  });
  const projectedFrames = occupiedRuns(columnProjection).map(([start, end]) => {
    const sourceRect = { x: start, y: 0, width: end - start + 1, height };
    return {
      sourceRect,
      bbox: tightBbox(mask, width, sourceRect),
    };
  });

  return {
    file,
    sha256: createHash("sha256").update(bytes).digest("hex"),
    width,
    height,
    alpha,
    foregroundPixels,
    foregroundBbox: tightBbox(mask, width, { x: 0, y: 0, width, height }),
    effectiveMinAreaPx,
    rawComponents: raw.components
      .filter((component) => component.area >= effectiveMinAreaPx)
      .sort((a, b) => b.area - a.area || compareBbox(a, b)),
    rawComponentCountAll: raw.count,
    dilationRadiusPx,
    dilationGroupCount: dilationGroups.length,
    mergeDistancePx,
    groupedComponents: mergedGroups,
    componentConfidence,
    rowGutters,
    columnGutters,
    grid,
    independentExpected,
    projectedFrames,
    projectedFrameGapCv: gapCv(projectedFrames.map((frame) => frame.bbox)),
    perceptualHashPairs: hashPairs(projectedFrames, png),
  };
}

function inferExpected({
  mask,
  width,
  height,
  grid,
  groupedComponents,
  componentConfidence,
  effectiveMinAreaPx,
}) {
  let strategy;
  let origin;
  let layout = null;
  let degraded = null;
  let sourceRects;

  if (grid.confidence > 0.9) {
    strategy = "grid";
    origin = "auto-grid";
    layout = { rows: grid.rows, columns: grid.columns };
    sourceRects = gridRects(width, height, grid.rowCuts, grid.columnCuts).filter(
      (rect) => countMask(mask, width, rect) >= effectiveMinAreaPx,
    );
  } else if (groupedComponents.length >= 2 && componentConfidence >= 0.75) {
    strategy = "components";
    origin = "auto-components";
    sourceRects = groupedComponents.map((group) => group.bbox);
  } else {
    strategy = "manual-grid";
    origin = "manual";
    const candidateCount = Math.max(1, groupedComponents.length);
    const columns = Math.min(
      width,
      Math.max(1, Math.ceil(Math.sqrt((candidateCount * width) / height))),
    );
    const rows = Math.min(height, Math.max(1, Math.ceil(candidateCount / columns)));
    layout = { rows, columns };
    sourceRects = uniformGridRects(width, height, rows, columns);
    degraded = {
      reason: groupedComponents.length < 2 ? "INSUFFICIENT_COMPONENTS" : "AMBIGUOUS_COMPONENTS",
      attempted: ["grid", "components"],
    };
  }

  const frames = sourceRects.map((sourceRect, index) => {
    const bbox = tightBbox(mask, width, sourceRect);
    // Frame normalization uses normalize.componentMinAreaPx for the
    // multipleComponents flag; it does not reuse the image-level effective
    // candidate-area threshold.
    const componentCount = countComponentsInRect(mask, width, sourceRect, MIN_AREA_PX);
    return {
      index,
      sourceRect,
      bbox,
      componentCount,
      flags: {
        outlier: false,
        merged: strategy === "components" && groupedComponents[index].sourceGroupIds.length > 1,
        multipleComponents: componentCount > 1,
        empty: bbox === null,
        edited: false,
        duplicateOf: null,
      },
    };
  });
  markOutliers(frames);

  const warningCodes = [];
  if (degraded) warningCodes.push("DETECTION_DEGRADED");
  if (frames.some((frame) => frame.flags.outlier)) warningCodes.push("OUTLIER_FRAMES");
  if (frames.some((frame) => frame.flags.merged)) warningCodes.push("MERGED_FRAMES");
  if (frames.some((frame) => frame.flags.multipleComponents))
    warningCodes.push("MULTIPLE_COMPONENTS");
  if (frames.some((frame) => frame.flags.empty)) warningCodes.push("EMPTY_FRAMES");

  return { strategy, origin, layout, degraded, warningCodes, frames };
}

function gridRects(width, height, rowCuts, columnCuts) {
  const y = [0, ...rowCuts, height];
  const x = [0, ...columnCuts, width];
  const rects = [];
  for (let row = 0; row < y.length - 1; row += 1) {
    for (let column = 0; column < x.length - 1; column += 1) {
      rects.push({
        x: x[column],
        y: y[row],
        width: x[column + 1] - x[column],
        height: y[row + 1] - y[row],
      });
    }
  }
  return rects;
}

function uniformGridRects(width, height, rows, columns) {
  const x = Array.from({ length: columns + 1 }, (_, index) =>
    Math.floor((index * width) / columns),
  );
  const y = Array.from({ length: rows + 1 }, (_, index) => Math.floor((index * height) / rows));
  return gridRects(width, height, y.slice(1, -1), x.slice(1, -1));
}

function countComponentsInRect(mask, imageWidth, rect, minimumArea) {
  const cropped = new Uint8Array(rect.width * rect.height);
  for (let y = 0; y < rect.height; y += 1) {
    const sourceStart = (rect.y + y) * imageWidth + rect.x;
    cropped.set(mask.subarray(sourceStart, sourceStart + rect.width), y * rect.width);
  }
  return labelMask(cropped, rect.width, rect.height, true).components.filter(
    (component) => component.area >= minimumArea,
  ).length;
}

function markOutliers(frames) {
  const nonEmpty = frames.filter((frame) => frame.bbox !== null);
  if (nonEmpty.length < 3) return;
  const medianWidth = median(nonEmpty.map((frame) => frame.bbox.width));
  const medianHeight = median(nonEmpty.map((frame) => frame.bbox.height));
  const medianAspect = median(nonEmpty.map((frame) => frame.bbox.width / frame.bbox.height));
  for (const frame of nonEmpty) {
    const aspect = frame.bbox.width / frame.bbox.height;
    frame.flags.outlier =
      relativeDifference(frame.bbox.width, medianWidth) > 0.4 ||
      relativeDifference(frame.bbox.height, medianHeight) > 0.4 ||
      relativeDifference(aspect, medianAspect) > 0.4;
  }
}

function projection(mask, width, height, axis) {
  const outer = axis === "row" ? height : width;
  const inner = axis === "row" ? width : height;
  const values = new Int32Array(outer);
  for (let coordinate = 0; coordinate < outer; coordinate += 1) {
    let count = 0;
    for (let offset = 0; offset < inner; offset += 1) {
      const x = axis === "row" ? offset : coordinate;
      const y = axis === "row" ? coordinate : offset;
      count += mask[y * width + x];
    }
    values[coordinate] = count;
  }
  return values;
}

function gutterRuns(signal, orthogonal, axisLength) {
  const runs = [];
  let start = null;
  for (let index = 0; index <= signal.length; index += 1) {
    const isGutter =
      index < signal.length && signal[index] / orthogonal <= GUTTER_OCCUPANCY_THRESHOLD;
    if (isGutter && start === null) start = index;
    if ((!isGutter || index === signal.length) && start !== null) {
      const end = index - 1;
      if (end - start + 1 >= MIN_GUTTER_PX && start > 0 && end < axisLength - 1) {
        runs.push({ start, end, width: end - start + 1, center: Math.floor((start + end) / 2) });
      }
      start = null;
    }
  }
  return runs;
}

function occupiedRuns(signal) {
  const result = [];
  let start = null;
  for (let index = 0; index <= signal.length; index += 1) {
    const occupied = index < signal.length && signal[index] > 0;
    if (occupied && start === null) start = index;
    if ((!occupied || index === signal.length) && start !== null) {
      result.push([start, index - 1]);
      start = null;
    }
  }
  return result;
}

function measureGridCandidate(mask, width, height, rowGutters, columnGutters, minArea) {
  const rowCuts = rowGutters.map((run) => run.center);
  const columnCuts = columnGutters.map((run) => run.center);
  if (rowCuts.length === 0 && columnCuts.length === 0) {
    return {
      rows: 1,
      columns: 1,
      confidence: 0,
      periodScore: 0,
      gutterScore: 0,
      occupancyScore: 1,
    };
  }
  const yBoundaries = [0, ...rowCuts, height];
  const xBoundaries = [0, ...columnCuts, width];
  const rowScore = axisPeriodScore(yBoundaries);
  const columnScore = axisPeriodScore(xBoundaries);
  const periodScore = (rowScore + columnScore) / 2;
  let transparent = 0;
  let samples = 0;
  for (const y of rowCuts) {
    for (let x = 0; x < width; x += 1) {
      transparent += mask[y * width + x] === 0 ? 1 : 0;
      samples += 1;
    }
  }
  for (const x of columnCuts) {
    for (let y = 0; y < height; y += 1) {
      if (rowCuts.includes(y)) continue;
      transparent += mask[y * width + x] === 0 ? 1 : 0;
      samples += 1;
    }
  }
  const gutterScore = samples === 0 ? 0 : transparent / samples;
  let nonEmpty = 0;
  for (let row = 0; row < yBoundaries.length - 1; row += 1) {
    for (let column = 0; column < xBoundaries.length - 1; column += 1) {
      const rect = {
        x: xBoundaries[column],
        y: yBoundaries[row],
        width: xBoundaries[column + 1] - xBoundaries[column],
        height: yBoundaries[row + 1] - yBoundaries[row],
      };
      if (countMask(mask, width, rect) >= minArea) nonEmpty += 1;
    }
  }
  const total = (yBoundaries.length - 1) * (xBoundaries.length - 1);
  const occupancyScore = nonEmpty / total;
  return {
    rows: yBoundaries.length - 1,
    columns: xBoundaries.length - 1,
    rowCuts,
    columnCuts,
    rowScore,
    columnScore,
    periodScore,
    gutterScore,
    occupancyScore,
    confidence: 0.45 * periodScore + 0.35 * gutterScore + 0.2 * occupancyScore,
  };
}

function axisPeriodScore(boundaries) {
  if (boundaries.length <= 2) return 1;
  const gaps = [];
  for (let index = 1; index < boundaries.length; index += 1)
    gaps.push(boundaries[index] - boundaries[index - 1]);
  const period = median(gaps);
  const deviations = gaps.map((gap) => Math.abs(gap - period));
  const consistency = Math.max(0, 1 - median(deviations) / Math.max(1, period));
  const valid = gaps.filter(
    (gap) => Math.abs(gap - period) / Math.max(1, period) <= PERIOD_TOLERANCE,
  ).length;
  return consistency * (valid / gaps.length);
}

function labelMask(mask, width, height, includeComponents) {
  const labels = new Int32Array(mask.length);
  const queue = new Int32Array(mask.length);
  const components = [];
  let count = 0;
  for (let start = 0; start < mask.length; start += 1) {
    if (!mask[start] || labels[start] !== 0) continue;
    count += 1;
    let head = 0;
    let tail = 1;
    let area = 0;
    let minX = width;
    let minY = height;
    let maxX = -1;
    let maxY = -1;
    queue[0] = start;
    labels[start] = count;
    while (head < tail) {
      const current = queue[head];
      head += 1;
      const x = current % width;
      const y = Math.floor(current / width);
      area += 1;
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);
      for (let dy = -1; dy <= 1; dy += 1) {
        for (let dx = -1; dx <= 1; dx += 1) {
          if (dx === 0 && dy === 0) continue;
          const nextX = x + dx;
          const nextY = y + dy;
          if (nextX < 0 || nextX >= width || nextY < 0 || nextY >= height) continue;
          const next = nextY * width + nextX;
          if (!mask[next] || labels[next] !== 0) continue;
          labels[next] = count;
          queue[tail] = next;
          tail += 1;
        }
      }
    }
    if (includeComponents) {
      components.push({
        id: count,
        area,
        bbox: { x: minX, y: minY, width: maxX - minX + 1, height: maxY - minY + 1 },
      });
    }
  }
  return { labels, count, components };
}

function dilateSquare(mask, width, height, radius) {
  if (radius === 0) return mask.slice();
  const horizontal = new Uint8Array(mask.length);
  const output = new Uint8Array(mask.length);
  for (let y = 0; y < height; y += 1) {
    let count = 0;
    for (let x = 0; x <= Math.min(width - 1, radius); x += 1) count += mask[y * width + x];
    for (let x = 0; x < width; x += 1) {
      horizontal[y * width + x] = count > 0 ? 1 : 0;
      const add = x + radius + 1;
      const remove = x - radius;
      if (add < width) count += mask[y * width + add];
      if (remove >= 0) count -= mask[y * width + remove];
    }
  }
  for (let x = 0; x < width; x += 1) {
    let count = 0;
    for (let y = 0; y <= Math.min(height - 1, radius); y += 1) count += horizontal[y * width + x];
    for (let y = 0; y < height; y += 1) {
      output[y * width + x] = count > 0 ? 1 : 0;
      const add = y + radius + 1;
      const remove = y - radius;
      if (add < height) count += horizontal[add * width + x];
      if (remove >= 0) count -= horizontal[remove * width + x];
    }
  }
  return output;
}

function aggregateOriginalMask(mask, labels, count, width, height) {
  const groups = Array.from({ length: count }, (_, index) => ({
    id: index + 1,
    area: 0,
    bbox: { x: width, y: height, width: -1, height: -1 },
  }));
  for (let index = 0; index < mask.length; index += 1) {
    if (!mask[index]) continue;
    const label = labels[index];
    if (label === 0) throw new Error("Dilated mask lost an original foreground pixel");
    const group = groups[label - 1];
    const x = index % width;
    const y = Math.floor(index / width);
    const minX = Math.min(group.bbox.x, x);
    const minY = Math.min(group.bbox.y, y);
    const maxX = Math.max(group.bbox.width, x);
    const maxY = Math.max(group.bbox.height, y);
    group.area += 1;
    group.bbox = { x: minX, y: minY, width: maxX, height: maxY };
  }
  return groups
    .filter((group) => group.area > 0)
    .map((group) => ({
      id: group.id,
      area: group.area,
      bbox: {
        x: group.bbox.x,
        y: group.bbox.y,
        width: group.bbox.width - group.bbox.x + 1,
        height: group.bbox.height - group.bbox.y + 1,
      },
    }));
}

function mergeByBboxGap(groups, distance) {
  const parent = groups.map((_, index) => index);
  const find = (value) => {
    let root = value;
    while (parent[root] !== root) root = parent[root];
    while (parent[value] !== value) {
      const next = parent[value];
      parent[value] = root;
      value = next;
    }
    return root;
  };
  const union = (left, right) => {
    const a = find(left);
    const b = find(right);
    if (a !== b) parent[b] = a;
  };
  if (distance > 0) {
    for (let left = 0; left < groups.length; left += 1) {
      for (let right = left + 1; right < groups.length; right += 1) {
        if (bboxGap(groups[left].bbox, groups[right].bbox) < distance) union(left, right);
      }
    }
  }
  const merged = new Map();
  for (let index = 0; index < groups.length; index += 1) {
    const root = find(index);
    const previous = merged.get(root);
    if (!previous) {
      merged.set(root, {
        area: groups[index].area,
        bbox: { ...groups[index].bbox },
        sourceGroupIds: [groups[index].id],
      });
    } else {
      previous.area += groups[index].area;
      previous.bbox = unionRect(previous.bbox, groups[index].bbox);
      previous.sourceGroupIds.push(groups[index].id);
    }
  }
  return [...merged.values()];
}

function clusterBySize(rects) {
  const ordered = rects
    .map((rect, index) => ({ rect, index }))
    .sort(
      (a, b) => a.rect.width * a.rect.height - b.rect.width * b.rect.height || a.index - b.index,
    );
  const clusters = [];
  for (const item of ordered) {
    let target = null;
    for (const cluster of clusters) {
      const widths = cluster.map((member) => member.rect.width);
      const heights = cluster.map((member) => member.rect.height);
      if (
        relativeDifference(item.rect.width, median(widths)) <= CLUSTER_TOLERANCE &&
        relativeDifference(item.rect.height, median(heights)) <= CLUSTER_TOLERANCE
      ) {
        target = cluster;
        break;
      }
    }
    if (target) target.push(item);
    else clusters.push([item]);
  }
  return clusters.map((cluster) => cluster.length);
}

function hashPairs(frames, png) {
  const hashes = frames.map((frame) => dHash64(png, frame.bbox));
  const pairs = [];
  for (let left = 0; left < hashes.length; left += 1) {
    for (let right = left + 1; right < hashes.length; right += 1) {
      pairs.push({ left, right, hamming: hammingHex(hashes[left], hashes[right]) });
    }
  }
  return pairs
    .sort((a, b) => a.hamming - b.hamming || a.left - b.left || a.right - b.right)
    .slice(0, 8);
}

function dHash64(png, rect) {
  if (!rect) return null;
  const samples = [];
  for (let targetY = 0; targetY < 8; targetY += 1) {
    for (let targetX = 0; targetX < 9; targetX += 1) {
      const sourceX =
        rect.x + Math.min(rect.width - 1, Math.floor(((targetX + 0.5) * rect.width) / 9));
      const sourceY =
        rect.y + Math.min(rect.height - 1, Math.floor(((targetY + 0.5) * rect.height) / 8));
      const offset = (sourceY * png.width + sourceX) * 4;
      const alpha = png.data[offset + 3];
      samples.push(
        Math.floor(
          ((77 * png.data[offset] + 150 * png.data[offset + 1] + 29 * png.data[offset + 2]) *
            alpha) /
            (256 * 255),
        ),
      );
    }
  }
  let bits = 0n;
  for (let y = 0; y < 8; y += 1) {
    for (let x = 0; x < 8; x += 1) {
      bits = (bits << 1n) | BigInt(samples[y * 9 + x] > samples[y * 9 + x + 1] ? 1 : 0);
    }
  }
  return bits.toString(16).padStart(16, "0");
}

function hammingHex(left, right) {
  if (left === null || right === null) return null;
  let value = BigInt(`0x${left}`) ^ BigInt(`0x${right}`);
  let count = 0;
  while (value > 0n) {
    count += Number(value & 1n);
    value >>= 1n;
  }
  return count;
}

function tightBbox(mask, width, rect) {
  let minX = rect.x + rect.width;
  let minY = rect.y + rect.height;
  let maxX = -1;
  let maxY = -1;
  for (let y = rect.y; y < rect.y + rect.height; y += 1) {
    for (let x = rect.x; x < rect.x + rect.width; x += 1) {
      if (!mask[y * width + x]) continue;
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);
    }
  }
  return maxX < 0 ? null : { x: minX, y: minY, width: maxX - minX + 1, height: maxY - minY + 1 };
}

function countMask(mask, width, rect) {
  let count = 0;
  for (let y = rect.y; y < rect.y + rect.height; y += 1) {
    for (let x = rect.x; x < rect.x + rect.width; x += 1) count += mask[y * width + x];
  }
  return count;
}

function bboxGap(left, right) {
  const xGap = Math.max(0, left.x - (right.x + right.width), right.x - (left.x + left.width));
  const yGap = Math.max(0, left.y - (right.y + right.height), right.y - (left.y + left.height));
  return Math.max(xGap, yGap);
}

function unionRect(left, right) {
  const x = Math.min(left.x, right.x);
  const y = Math.min(left.y, right.y);
  const maxX = Math.max(left.x + left.width, right.x + right.width);
  const maxY = Math.max(left.y + left.height, right.y + right.height);
  return { x, y, width: maxX - x, height: maxY - y };
}

function gapCv(rects) {
  if (rects.length < 3 || rects.some((rect) => rect === null)) return null;
  const ordered = [...rects].sort((a, b) => a.x - b.x);
  const gaps = [];
  for (let index = 1; index < ordered.length; index += 1) {
    gaps.push(Math.max(0, ordered[index].x - (ordered[index - 1].x + ordered[index - 1].width)));
  }
  const mean = gaps.reduce((sum, value) => sum + value, 0) / gaps.length;
  if (mean === 0) return 0;
  const variance = gaps.reduce((sum, value) => sum + (value - mean) ** 2, 0) / gaps.length;
  return { gaps, value: Math.sqrt(variance) / mean };
}

function relativeDifference(value, reference) {
  return reference === 0
    ? value === 0
      ? 0
      : Number.POSITIVE_INFINITY
    : Math.abs(value - reference) / reference;
}

function compareBbox(left, right) {
  const a = "bbox" in left ? left.bbox : left;
  const b = "bbox" in right ? right.bbox : right;
  return a.y - b.y || a.x - b.x || a.height - b.height || a.width - b.width;
}

function median(values) {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[middle - 1] + sorted[middle]) / 2 : sorted[middle];
}

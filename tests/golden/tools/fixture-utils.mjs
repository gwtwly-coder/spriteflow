import { PNG } from "pngjs";

export const FLAGS = Object.freeze({
  outlier: false,
  merged: false,
  multipleComponents: false,
  empty: false,
  edited: false,
  duplicateOf: null,
});

export function createImage(width, height) {
  const png = new PNG({ width, height, colorType: 6 });
  png.data.fill(0);
  return png;
}

export function drawRect(png, rect, color) {
  for (let y = rect.y; y < rect.y + rect.height; y += 1) {
    for (let x = rect.x; x < rect.x + rect.width; x += 1) {
      setPixel(png, x, y, color);
    }
  }
}

export function drawSprite(png, rect, variant = 0, color = [48, 180, 224, 255]) {
  const edge = Math.max(2, Math.floor(Math.min(rect.width, rect.height) / 5));
  drawRect(png, rect, color);

  const cutout = [0, 0, 0, 0];
  if (variant % 3 === 0) {
    drawRect(
      png,
      {
        x: rect.x + edge,
        y: rect.y + edge,
        width: Math.max(1, rect.width - edge * 2),
        height: Math.max(1, Math.floor(edge / 2)),
      },
      cutout,
    );
  } else if (variant % 3 === 1) {
    drawRect(
      png,
      {
        x: rect.x + edge,
        y: rect.y + rect.height - edge,
        width: Math.max(1, Math.floor(edge / 2)),
        height: edge,
      },
      cutout,
    );
  } else {
    drawRect(
      png,
      {
        x: rect.x + rect.width - edge,
        y: rect.y + edge,
        width: edge,
        height: Math.max(1, Math.floor(edge / 2)),
      },
      cutout,
    );
  }

  const accent = [248, 196, 64, 255];
  drawRect(
    png,
    {
      x: rect.x + Math.floor(rect.width / 3),
      y: rect.y + Math.floor(rect.height / 3),
      width: Math.max(1, Math.floor(rect.width / 3)),
      height: Math.max(1, Math.floor(rect.height / 3)),
    },
    accent,
  );
}

export function setPixel(png, x, y, color) {
  if (x < 0 || x >= png.width || y < 0 || y >= png.height) {
    throw new RangeError(`Pixel (${x}, ${y}) is outside ${png.width}x${png.height}`);
  }
  const offset = (y * png.width + x) * 4;
  png.data[offset] = color[0];
  png.data[offset + 1] = color[1];
  png.data[offset + 2] = color[2];
  png.data[offset + 3] = color[3];
}

export function cellRect(width, height, rows, columns, row, column) {
  const x = Math.floor((column * width) / columns);
  const y = Math.floor((row * height) / rows);
  const right = Math.floor(((column + 1) * width) / columns);
  const bottom = Math.floor(((row + 1) * height) / rows);
  return { x, y, width: right - x, height: bottom - y };
}

export function scanBbox(png, sourceRect, alphaThreshold = 8) {
  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  for (let y = sourceRect.y; y < sourceRect.y + sourceRect.height; y += 1) {
    for (let x = sourceRect.x; x < sourceRect.x + sourceRect.width; x += 1) {
      if (alphaAt(png, x, y) > alphaThreshold) {
        minX = Math.min(minX, x);
        minY = Math.min(minY, y);
        maxX = Math.max(maxX, x);
        maxY = Math.max(maxY, y);
      }
    }
  }
  if (!Number.isFinite(minX)) return null;
  return { x: minX, y: minY, width: maxX - minX + 1, height: maxY - minY + 1 };
}

export function countComponents(png, sourceRect, alphaThreshold = 8, minArea = 4) {
  const width = sourceRect.width;
  const height = sourceRect.height;
  const visited = new Uint8Array(width * height);
  let count = 0;
  const queueX = new Int32Array(width * height);
  const queueY = new Int32Array(width * height);

  for (let localY = 0; localY < height; localY += 1) {
    for (let localX = 0; localX < width; localX += 1) {
      const startIndex = localY * width + localX;
      if (
        visited[startIndex] ||
        alphaAt(png, sourceRect.x + localX, sourceRect.y + localY) <= alphaThreshold
      ) {
        continue;
      }

      let head = 0;
      let tail = 1;
      let area = 0;
      queueX[0] = localX;
      queueY[0] = localY;
      visited[startIndex] = 1;
      while (head < tail) {
        const x = queueX[head];
        const y = queueY[head];
        head += 1;
        area += 1;
        for (let dy = -1; dy <= 1; dy += 1) {
          for (let dx = -1; dx <= 1; dx += 1) {
            if (dx === 0 && dy === 0) continue;
            const nextX = x + dx;
            const nextY = y + dy;
            if (nextX < 0 || nextX >= width || nextY < 0 || nextY >= height) continue;
            const index = nextY * width + nextX;
            if (
              visited[index] ||
              alphaAt(png, sourceRect.x + nextX, sourceRect.y + nextY) <= alphaThreshold
            ) {
              continue;
            }
            visited[index] = 1;
            queueX[tail] = nextX;
            queueY[tail] = nextY;
            tail += 1;
          }
        }
      }
      if (area >= minArea) count += 1;
    }
  }
  return count;
}

export function makeExpectedFrames(png, sourceRects, overrides = {}) {
  const mergedIndexes = new Set(overrides.mergedIndexes ?? []);
  const editedIndexes = new Set(overrides.editedIndexes ?? []);
  const frames = sourceRects.map((sourceRect, index) => {
    const bbox = scanBbox(png, sourceRect);
    return {
      index,
      sourceRect,
      bbox,
      flags: {
        ...FLAGS,
        merged: mergedIndexes.has(index),
        multipleComponents: countComponents(png, sourceRect) >= 2,
        empty: bbox === null,
        edited: editedIndexes.has(index),
      },
    };
  });

  applyOutliers(frames);
  return frames;
}

function applyOutliers(frames) {
  const nonEmpty = frames.filter((frame) => frame.bbox !== null);
  if (nonEmpty.length < 3) return;
  const widths = nonEmpty.map((frame) => frame.bbox.width);
  const heights = nonEmpty.map((frame) => frame.bbox.height);
  const ratios = nonEmpty.map((frame) => frame.bbox.width / frame.bbox.height);
  const medians = [median(widths), median(heights), median(ratios)];
  for (const frame of nonEmpty) {
    const values = [frame.bbox.width, frame.bbox.height, frame.bbox.width / frame.bbox.height];
    frame.flags.outlier = values.some(
      (value, index) => Math.abs(value - medians[index]) / medians[index] > 0.4,
    );
  }
}

function median(values) {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[middle - 1] + sorted[middle]) / 2 : sorted[middle];
}

function alphaAt(png, x, y) {
  return png.data[(y * png.width + x) * 4 + 3];
}

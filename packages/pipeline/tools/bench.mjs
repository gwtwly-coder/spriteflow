import { createHash } from "node:crypto";
import { writeFileSync } from "node:fs";
import os from "node:os";
import { performance } from "node:perf_hooks";
import { groupComponents } from "../dist/detection/components.js";
import {
  createExecutionContext,
  DEFAULT_NORMALIZE_OPTIONS,
  DEFAULT_PACK_OPTIONS,
  normalizeFrames,
  packFrames,
} from "../dist/index.js";
import { makeMask } from "../dist/input/pixels.js";
import { clusters } from "../dist/normalization/frames.js";

const width = 4096,
  height = 4096;
const pixels = {
  width,
  height,
  format: "rgba8",
  colorSpace: "srgb",
  alphaMode: "straight",
  data: new Uint8ClampedArray(width * height * 4),
};
for (let row = 0; row < 16; row++)
  for (let col = 0; col < 16; col++) {
    for (const [dx, dy, w, h] of [
      [0, 0, 96, 112],
      [108, 40, 12, 24],
    ]) {
      for (let y = 32 + row * 256 + dy; y < 32 + row * 256 + dy + h; y++)
        for (let x = 32 + col * 256 + dx; x < 32 + col * 256 + dx + w; x++) {
          pixels.data.set([100, 160, 210, 255], (y * width + x) * 4);
        }
    }
  }
const timings = [],
  sections = [];
for (let iteration = 0; iteration < 35; iteration++) {
  const context = createExecutionContext(`bench_${iteration}`);
  const start = performance.now();
  const { mask } = await makeMask(pixels, 8, context);
  const maskEnd = performance.now();
  const result = await groupComponents(
    mask,
    width,
    height,
    41,
    null,
    0.15,
    Math.ceil(width * height * 0.00001),
    context,
  );
  const groupsEnd = performance.now();
  const grouped = clusters(
    result.groups.map((g, i) => ({ id: `c_${i}`, rect: g.rect })),
    0.3,
  );
  const end = performance.now();
  if (result.groups.length !== 256 || grouped.length !== 1)
    throw new Error("Benchmark fixture geometry regressed");
  if (iteration >= 5) {
    timings.push(end - start);
    sections.push({ mask: maskEnd - start, groups: groupsEnd - maskEnd, cluster: end - groupsEnd });
  }
  if (iteration === 4 || iteration % 10 === 9)
    console.log(`Completed ${iteration + 1}/35: ${(end - start).toFixed(2)} ms`);
}
const sorted = [...timings].sort((a, b) => a - b);
const p95 = sorted[Math.ceil(0.95 * sorted.length) - 1];
const average = (key) => sections.reduce((s, item) => s + item[key], 0) / sections.length;
const input = {
  ref: { assetId: "bench", revision: 1 },
  name: "bench",
  sourceMime: "application/x-rgba8",
  originalSize: { width, height },
  scaleFromOriginal: { x: 1, y: 1 },
  pixels,
};
const normalized = await normalizeFrames(
  input,
  [
    {
      id: "seed",
      name: "seed",
      sourceRect: { x: 32, y: 32, width: 96, height: 112 },
      origin: "manual",
      sourceFrameIds: [],
      included: true,
      edited: false,
      reviewStatus: "accepted",
    },
  ],
  { ...DEFAULT_NORMALIZE_OPTIONS, computeHash: false },
);
if (!normalized.ok) throw new Error(JSON.stringify(normalized.error));
const frames = Array.from({ length: 500 }, (_, i) => {
  const frame = structuredClone(normalized.value.frames[0]);
  const width = 24 + (i % 11) * 4,
    height = 32 + (i % 13) * 4;
  return {
    ...frame,
    id: `f_${i}`,
    name: `frame_${i}`,
    bbox: { ...frame.bbox, width, height },
    canvas: { width, height, offset: { x: 0, y: 0 } },
  };
});
const packTimings = [];
for (let i = 0; i < 35; i++) {
  const start = performance.now();
  const result = await packFrames(input.ref, frames, { ...DEFAULT_PACK_OPTIONS, maxPages: 4 });
  const elapsed = performance.now() - start;
  if (
    !result.ok ||
    result.value.frames.length !== 500 ||
    !result.value.frames.every(
      (p, n) => p.sourceRect !== frames[n].sourceRect && p.bbox !== frames[n].bbox,
    )
  )
    throw new Error("Packing benchmark or snapshot independence regressed");
  if (i >= 5) packTimings.push(elapsed);
}
const packSorted = [...packTimings].sort((a, b) => a - b),
  packP95 = packSorted[28];
const report = `# r4 管线性能基准

测量日期：${new Date().toISOString()}。执行命令：\`pnpm -F pipeline build\` 后 \`pnpm -F pipeline bench\`。

## 环境与范围

- CPU：${os.cpus()[0].model}；逻辑处理器 ${os.cpus().length}；内存 ${(os.totalmem() / 2 ** 30).toFixed(2)} GiB。
- OS：${os.type()} ${os.release()} ${os.arch()}；Node ${process.version}。
- 输入：4096×4096 RGBA（16,777,216 像素），16×16 个主体与各自断开的附件；512 个原始组件合并为 256 帧，1 个尺寸簇。
- 原始 RGBA SHA-256：\`${createHash("sha256").update(pixels.data).digest("hex")}\`。
- 参数：alphaThreshold=8，dilationRadiusPx=41（默认短边1%），mergeDistanceRatio=.15，minAreaPx=168（默认相对面积解析值），clusterTolerance=.3。
- 包括：mask/alpha/行列统计、原始两遍CCL、精确方形膨胀分组、原始面积与bbox回收、近邻合并、过滤、尺寸聚类、默认执行上下文调度开销。
- 排除：磁盘IO、首次import、夹具构造、normalize/hash、PNG编解码。每轮重新分配临时数组，不复用检测缓存。
- 预热5轮；独立测量30轮；p95为排序后第ceil(.95×30)=29项。

## 结果

- min：${sorted[0].toFixed(2)} ms；median：${((sorted[14] + sorted[15]) / 2).toFixed(2)} ms；p95：**${p95.toFixed(2)} ms**。
- 分段均值：mask ${average("mask").toFixed(2)} ms；CCL/膨胀/回收/合并/过滤 ${average("groups").toFixed(2)} ms；聚类 ${average("cluster").toFixed(2)} ms。
- 本机 \`p95 < 500ms\`：**${p95 < 500 ? "通过" : "未通过"}**。
- 30轮原始毫秒值：${timings.map((t) => t.toFixed(2)).join(", ")}。

## 500帧打包（包含r4快照复制）

- 500个已接受非空帧；内容宽24…64、高32…80，确定性循环尺寸，源框96×112；夹具构造不计时。
- 完整公共packFrames调用：输入/审校/预算校验、排序、MaxRects插入、页面输出、独立sourceRect/bbox快照、默认yield；不含normalize、像素渲染与编码。
- PackOptions：默认值，仅maxPages=4；maxWidth/maxHeight=2048、padding=2、extrude=1、border=0、allowRotation=false、sizeMode=auto、heuristic=max-edge。
- 同样预热5轮、测量30轮，p95取第29项；min ${packSorted[0].toFixed(2)} ms，median ${((packSorted[14] + packSorted[15]) / 2).toFixed(2)} ms，p95 **${packP95.toFixed(2)} ms**；原预算 p95 < 200ms：**${packP95 < 200 ? "通过" : "未通过"}**。
- 30轮原始毫秒值：${packTimings.map((t) => t.toFixed(2)).join(", ")}。
- 新增几何复制及导出源几何比对为O(F)，每个非空帧只增加两个独立Rect对象；没有重扫像素、重跑normalize/packer。打包原有保守内存账本包含每帧对象与布局分配余量；32,000字节的几何数值不是对象堆内存上界。

本结果限定于上述机器与代表输入，不作为最坏棋盘/密集噪声恒定耗时承诺。电源模式及后台系统负载未受实验室控制；正式发布仍需在架构指定参考设备复测。未以 Node 结果冒充浏览器解码或真实引擎验收。
`;
writeFileSync(new URL("../BENCH.md", import.meta.url), report);
console.log(`p95=${p95.toFixed(2)}ms ${p95 < 500 ? "PASS" : "FAIL"}`);
console.log(`500-frame pack p95=${packP95.toFixed(2)}ms ${packP95 < 200 ? "PASS" : "FAIL"}`);
if (p95 >= 500 || packP95 >= 200) process.exitCode = 1;

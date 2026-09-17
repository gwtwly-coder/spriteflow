# SpriteFlow M1 管线

公共 API 遵守 [interface-contract.md](../../docs/interface-contract.md) **3.0.0 / r4**；RPC 协议仍为 1。私有 workspace 包名为 `@spriteflow/pipeline`，包版本不代替 `CONTRACT_VERSION`。Node 24.12.0、pnpm 11.9.0；纯 ESM，输出 JavaScript 与声明到 `dist`。

根入口是无 DOM 的纯 TypeScript：像素校验、分析副本、投影网格、两遍 8 连通域/并查集、精确方形膨胀合并、面积过滤/尺寸聚类、策略降级、trim/画布/hash/flags、MaxRects 打包及五种 ZIP 导出。`/browser` 单独提供 Worker 服务与 Comlink 客户端，使用原生 PNG/WebP 解码和 PNG 编码。计算不依赖服务器、网络或主线程 Canvas。

## 构建与验收

在仓库根目录运行：

```powershell
pnpm -F pipeline build
pnpm -F pipeline typecheck
pnpm -F pipeline test
pnpm -F pipeline check:contract
pnpm -F pipeline test:stale
pnpm golden
pnpm -F pipeline bench
pnpm -F pipeline test:browser
pnpm exec biome check packages/pipeline
```

`check:contract` 从当前契约提取声明，核对公开导出集合、API 双向类型兼容、ES2022 无 DOM 根入口以及完整浏览器接线示例。`test:stale` 是 SF-CONTRACT-003 的成功回归：旧布局必须在调用 codec 前被拒绝，当前布局导出的像素须为右侧绿色主体。

`test:browser` 使用本机已安装的 Chrome、Node 内置 DevTools WebSocket 和仓库已审计 Vite；不安装浏览器或测试依赖。默认可执行文件为 `C:/Program Files/Google/Chrome/Application/chrome.exe`，可通过 `SPRITEFLOW_BROWSER` 指定兼容 Chromium。只在 `.smoke-output/` 生成本地报告、隔离浏览器 profile 和缓存。Node 真实 PNG 回归复用黄金工作区已有 pngjs。性能原始数据、设备及测量范围见 [BENCH.md](./BENCH.md)。

## Node / 纯 API

输入是 `InputAsset`，内部 `PixelBuffer` 必须为紧密连续 RGBA8、sRGB、straight alpha。每个通道范围 0…255；工作图尺寸对应 data 长度；不能传子视图或已 detached 缓冲。`ImageData` 的调用方可在浏览器边界复制 `data` 后包装为 PixelBuffer，根入口不要求全局 ImageData。像素或工作尺寸改变时递增 `AssetRef.revision`。

纯 API 接受已解码像素。文件解码由调用者或 `/browser` 完成；PNG 编码通过 `PngCodec` 注入。以下示例由应用提供 `asset`、`codec` 和用户审校函数：

```ts
import {
  createExecutionContext,
  DEFAULT_DETECT_OPTIONS,
  DEFAULT_NORMALIZE_OPTIONS,
  DEFAULT_PACK_OPTIONS,
  detect,
  ExportFormat,
  exportAssets,
  normalizeFrames,
  packFrames,
  type FrameDraft,
  type InputAsset,
  type Outcome,
  type PngCodec,
} from "@spriteflow/pipeline";

function unwrap<T>(result: Outcome<T>): T {
  if (!result.ok) throw result.error;
  return result.value;
}

export async function buildAtlas(
  asset: InputAsset,
  codec: PngCodec,
  review: (drafts: FrameDraft[]) => Promise<FrameDraft[]>,
) {
  const context = createExecutionContext("node_export");
  const detected = unwrap(await detect(asset, { ...DEFAULT_DETECT_OPTIONS }, context));
  const drafts: FrameDraft[] = detected.frames.map((frame) => ({
    id: frame.id,
    name: frame.name,
    sourceRect: { ...frame.sourceRect },
    origin: frame.origin,
    sourceFrameIds: [...frame.sourceFrameIds],
    edited: frame.flags.edited,
    included: frame.included,
    reviewStatus: frame.reviewStatus,
  }));
  const accepted = await review(drafts);
  const normalized = unwrap(await normalizeFrames(
    asset, accepted, { ...DEFAULT_NORMALIZE_OPTIONS }, context,
  ));
  const pack = unwrap(await packFrames(
    asset.ref, normalized.frames, { ...DEFAULT_PACK_OPTIONS }, context,
  ));
  return unwrap(await exportAssets(
    { asset, frames: normalized.frames, pack },
    { format: ExportFormat.PhaserJsonHash, baseName: "atlas", animations: [] },
    codec,
    context,
  ));
}
```

`review` 应返回用户确认后的草稿；included 帧未 accepted 时 pack/export 返回 `REVIEW_REQUIRED`。示例的 throw 仅是消费端控制流；所有公共管线函数返回 `Outcome`。结果的 `archive` 是唯一 ZIP ArrayBuffer，`files` 仅含清单元数据；Node 消费端可自行写入磁盘。

动画 `frameIds` 引用 included 帧 ID，允许重复引用；空 animations 自动生成 12fps、loop=true 的 default 动画。帧数组顺序即时间轴顺序；excluded 帧不进入布局/导出，异常 flags 不会自动删除帧。

## 浏览器 Worker

由应用在自己的 Worker 启动文件中调用：

```ts
import { expose } from "comlink";
import { createWorkerService } from "@spriteflow/pipeline/browser";

expose(createWorkerService());
```

主线程上传与检测：

```ts
import { DEFAULT_DETECT_OPTIONS, DESKTOP_LIMITS } from "@spriteflow/pipeline";
import { createPipelineClient } from "@spriteflow/pipeline/browser";

export async function openSpriteSheet(file: File) {
  const client = createPipelineClient(
    new Worker(new URL("./workers/pipeline.worker.ts", import.meta.url), { type: "module" }),
    { protocolVersion: 1, limits: { ...DESKTOP_LIMITS } },
  );
  try {
    const ready = await client.ready;
    if (!ready.ok) throw ready.error;
    const asset = { assetId: crypto.randomUUID(), revision: 1 };
    const loaded = await client.submit("load", {
      kind: "encoded", ref: asset, name: file.name, mimeHint: file.type,
      bytes: await file.arrayBuffer(), resizeTo: null,
    }).result;
    if (!loaded.outcome.ok) throw loaded.outcome.error;
    const detection = client.submit("detect", {
      asset, options: structuredClone(DEFAULT_DETECT_OPTIONS),
    });
    const detected = await detection.result;
    if (!detected.outcome.ok) throw detected.outcome.error;
    return { client, asset, loaded: loaded.outcome.value, detected: detected.outcome.value };
  } catch (error) {
    await client.dispose();
    throw error;
  }
}
```

调用方持有成功返回的 client，并在页面卸载时 `await client.dispose()`。后续依次提交 normalize → pack → export，使用 normalize 返回的 `normalizationId` 与 pack 返回的 `packId`；完整示例见契约 §10。PNG/Godot 序列导出传 `packId:null`。下载后及时回收 Blob URL。

输入 ArrayBuffer 被 transfer 后调用方必须视为 detached，重试从保留的 File 重新获取；成功返回的预览和 ZIP 为独立可转移缓冲，不暴露 Worker 内完整原图。Worker 一次保存一个资产、执行一个任务。换图先 `release` 当前 AssetRef，不能自动释放用户仍在编辑的资产。

取消时调用任务 handle 的 `cancel()`，随后等待 `result` 的终态；`requested` 不表示取消已完成。2000ms 无终态时客户端终止 Worker 并结算所有 pending 请求。崩溃、释放、重新规范化/打包使相应 ID 失效；即使几何相同也不能复用旧 ID。

## 行为与 r4 迁移

- 自动模式原图所有 alpha=0 才返回 `EMPTY_INPUT`，固定整图 1×1 空帧；稀疏非零 alpha 不能因阈值或降采样误报为空。其他降级仍使用契约公式。显式 manual-grid 尊重 region、整数切点及 keepEmptyCells，合法请求不继承降级状态；全部跳过时可返回零帧。
- 非全透明输入严格按阈值 `alpha > alphaThreshold` 检测；opaque 比例严格大于 .99 拒绝。自动网格优先，失败后执行 components；final 回原工作图校验，preview 不作为最终 pack/export 依据。
- `pHash` 在 M1 实际为 `dhash64-v1`，透明底参与规范化灰度积分，输出16位小写十六进制；这是元数据，不自动折叠重复帧。画布统一只补透明边，不缩放主体。
- `PackedFrame.sourceRect` 和 `bbox` 是独立源坐标快照。旋转、padding、extrude、页面偏移不修改它们；空帧保留原 sourceRect、bbox=null，图集占位仍为1×1。输入和输出矩形不共享引用。
- 纯导出在 validate 阶段按值逐项比较，支持 structuredClone、JSON 往返和另一模块实例。旧 DTO 缺少任一字段返回 `STALE_RESULT`；存在但 undefined、非法或越界返回 `INVALID_ARGUMENT`。合法源几何不匹配返回 `STALE_RESULT`，details 指向 `source.pack.frames.<index>.<field>` 并列出帧 ID。不要用当前 Frame 回填旧快照；须重新 normalize/pack。
- 根 API 对相同 AssetRef、相同几何及布局允许值相等结果复用；Worker 仍使用严格历史 ID。客户端精确验证 contractVersion，2.0.0/3.0.0 混用返回 `PROTOCOL_MISMATCH`。
- 新快照只存在于 PackResult DTO，下载的 Phaser/generic/sequence/Godot 结构保持原 schema。Phaser `meta.version` 更新为3.0.0。Phaser 两种格式要求单页；generic 支持多页，PNG/Godot 序列要求纯 API 的 pack=null。

## 实现与验收范围

只使用已审计的 maxrects-packer 2.7.3、fflate 0.8.3、Comlink 4.4.2；根入口不导入 Comlink。测试覆盖原始 CCL 洪泛参考、膨胀像素参考、投影周期、hash、规范化、旋转/出血真实 PNG 恢复、ZIP 时间戳与顺序、输入校验、取消、缓存/传输和 r3/r4 契约回归。没有引入 coverage 插件，不把用例通过率当作代码覆盖率百分比。

最终复测记录见 [DELIVERY.md](./DELIVERY.md)。黄金集所有权仍属 R6；此前产品主授权的 r3 标注修正独立提交为 `6172e32`，详情和逐项证据在 [R3-CORRECTIONS.md](../../tests/golden/R3-CORRECTIONS.md)，须由 R6 在 Gate 3 复核。本轮 r4 不修改黄金目录。

真实 Chrome Worker/原生编解码已自动冒烟；Phaser 3.90.0 与 Godot 4.4.x 引擎内运行、Firefox/WebKit 仍由 Gate 3 执行验收。Godot ZIP 中提供 EditorScript 和中文操作说明，不声称已在引擎生成验证过 .tres。

# 架构验收裁决书（第 1 轮）

> 阶段：架构验收（Gate 1：架构 + 契约 + 许可审计）
> 验收官：R9（独立会话，与生产者 R3 异会话）
> 日期：2026-09-16
> 验收对象：`docs/architecture-m1.md`（1.0.0）、`docs/interface-contract.md`（契约 1.0.0 / 协议 1），参照 `docs/technical-design.md`、`docs/prd-m1.md`、`docs/agent-roles.md`、仓库实况
> 轮次：第 1 轮（同一阶段最多打回 2 轮，第 3 轮升级产品主人工裁决）

## 裁决：FAIL

问题清单共 5 项：P1 × 3、P2 × 2。其中一项为契约对第三方库行为的事实性错误（已对照库源码证实），一项为协调会话预审要点未按约定落地，一项为仓库写权限模糊地带在 Gate 1 仍未消除。三项均须在契约冻结、Wave 2 开工前修复。

---

## 一、检查单逐条核对

### 1.1 契约自足性测试 —— PASS

方法：验收官仅以 `interface-contract.md` 为依据，独立编写两段调用代码（不查阅其他项目文档），逐符号回溯契约出处。

**示例 A：浏览器端「检测降级 → 手动网格 → 审校 → Godot 导出」全流程**

```ts
import {
  DEFAULT_DETECT_OPTIONS, DEFAULT_NORMALIZE_OPTIONS, DESKTOP_LIMITS,
  ExportFormat, type FrameDraft,
} from "@spriteflow/pipeline";
import { createPipelineClient } from "@spriteflow/pipeline/browser";

const client = createPipelineClient(worker, {
  protocolVersion: 1, limits: { ...DESKTOP_LIMITS },        // §9.1 InitOptions
});
const caps = await client.ready;                             // §9.1 Outcome<WorkerCapabilities>
if (!caps.ok) throw caps.error;

const asset = { assetId: "sheet-1", revision: 1 };           // §2 AssetRef 字符集/revision
const loaded = await client.submit("load", {                 // §9.1 LoadInput(encoded)
  kind: "encoded", ref: asset, name: file.name, mimeHint: file.type,
  bytes: await file.arrayBuffer(), resizeTo: null,
}).result;
if (!loaded.outcome.ok) throw loaded.outcome.error;

const det = await client.submit("detect", {
  asset, options: structuredClone(DEFAULT_DETECT_OPTIONS),   // §4 DetectOptions/默认常量
}, (e) => ui.setProgress(e.overallProgress)).result;         // §9.1 ProgressEvent
if (!det.outcome.ok) throw det.outcome.error;

let drafts: FrameDraft[] = det.outcome.value.frames.map((f) => ({
  id: f.id, name: f.name, sourceRect: f.sourceRect, origin: f.origin,
  sourceFrameIds: f.sourceFrameIds, edited: f.flags.edited,
  included: f.included, reviewStatus: f.reviewStatus,        // §3 Frame→FrameDraft
}));
if (det.outcome.value.degraded) {                            // §4.2 Degradation.suggestedGrid
  const g = det.outcome.value.degraded.suggestedGrid;
  const manual = await client.submit("detect", {
    asset,
    options: { ...structuredClone(DEFAULT_DETECT_OPTIONS),
      mode: "manual-grid",
      manualGrid: { rows: g.rows, columns: g.columns, region: null, keepEmptyCells: true } },
  }).result;
  drafts = manual.outcome.value.frames.map(/* 同上映射 */);
}

const norm = await client.submit("normalize", {
  asset, drafts: drafts.map((d) => ({ ...d, reviewStatus: "accepted" as const })),
  options: { ...DEFAULT_NORMALIZE_OPTIONS },                 // §3 必须完整对象
}).result;
if (!norm.outcome.ok) throw norm.outcome.error;

const zip = await client.submit("export", {                  // §10：序列格式跳过 pack
  asset, normalizationId: norm.outcome.value.normalizationId, packId: null,
  task: { format: ExportFormat.GodotFramesZip, baseName: "atlas", animations: [] },
}).result;
```

**示例 B：Node 黄金测试纯 API 流水线**

```ts
import { detect, normalizeFrames, packFrames, exportAssets, createExecutionContext,
  DEFAULT_DETECT_OPTIONS, DEFAULT_NORMALIZE_OPTIONS, DEFAULT_PACK_OPTIONS,
  ExportFormat, type InputAsset, type PngCodec } from "@spriteflow/pipeline";

const png = PNG.sync.read(fs.readFileSync("cases/g01/input.png"));
const asset: InputAsset = {
  ref: { assetId: "golden", revision: 1 }, name: "input.png", sourceMime: "image/png",
  originalSize: { width: png.width, height: png.height },
  pixels: { format: "rgba8", colorSpace: "srgb", alphaMode: "straight",
    width: png.width, height: png.height,
    data: new Uint8ClampedArray(png.data) },                 // §2 紧密缓冲：复制而非视图切片
  scaleFromOriginal: { x: 1, y: 1 },
};
const ctx = createExecutionContext("task_golden_1");         // §7
const det = await detect(asset, structuredClone(DEFAULT_DETECT_OPTIONS), ctx);
if (!det.ok) throw det.error;                                // Outcome 错误通道
const norm = await normalizeFrames(asset,
  det.value.frames.map((f) => ({ /* 同示例 A 的 FrameDraft 映射 */ })),
  { ...DEFAULT_NORMALIZE_OPTIONS }, ctx);
const pack = await packFrames(asset.ref, norm.value.frames, { ...DEFAULT_PACK_OPTIONS }, ctx);
const codec: PngCodec = { encode: async (px, c) => pngjsEncode(px) };  // §7 Node 自备 codec
const out = await exportAssets({ asset, frames: norm.value.frames, pack: pack.value },
  { format: ExportFormat.PhaserJsonHash, baseName: "atlas", animations: [] }, codec, ctx);
```

**核对结论**：两段代码涉及的每个标识符、默认值、必填/可省规则、payload 形状、生命周期（normalizationId/packId、BUSY、cancel 竞态、transfer 所有权）与错误呈现均可在契约内自解：类型 §2–§7、默认值表 interface-contract.md:146-158 与 :249-273、生命周期 §9.2（interface-contract.md:817-829）、transfer §9.3（:831-842）、官方示例 §10（:876-958）交叉验证一致，未发现缺失符号或语义空洞。结论：仅凭契约可以写对调用代码。

（附注：契约自足性合格不等于契约内容全部正确——见问题 3，`heuristic` 映射存在事实错误。）

### 1.2 仓库结构无越界写权限模糊地带 —— FAIL

证据：

- `architecture-m1.md:91` 自认「根级 manifest/lock/tsconfig/biome 配置在现有所有权表没有责任人」，建议归 R7、待 Gate 1 裁决；`architecture-m1.md:353`（§9 第 5 条）重复「落盘脚手架前必须解决」。本验收即 Gate 1，该缺口仍未消除。
- `agent-roles.md:42-52` 所有权表核对：根 `package.json`、`pnpm-workspace.yaml`、`pnpm-lock.yaml`、`tsconfig.base.json`、`biome.json`、`.npmrc`、根 `README.md`、`.gitignore` 均无责任人。
- 另发现两处架构文档未点名的同类缺口：`docs/devops.md` 是 R7 的交付物（`agent-roles.md:243`）但不在 R7 写权限（`.github/**`、部署配置，`agent-roles.md:50`）内；`docs/technical-design.md`（唯一事实来源）在所有权表中不属于任何角色。

→ 问题 1（P1）。

### 1.3 许可审计表完备无 GPL 风险 —— PASS

实测（2026-09-16）：

- 附录 A 数据行机械清点 = **213 行**，与声称一致（`architecture-m1.md:577`）；附录 B 数据行 = **163 行**（含表头 164），与 `architecture-m1.md:749` 一致；附录 C 工具链 5 行齐备。
- 全文扫描 GPL/AGPL/LGPL/UNKNOWN/UNLICENSED/SEE LICENSE IN：审计表中零命中；所有出现处均为排除规则或「无 GPL 义务」声明（如 `architecture-m1.md:317、341`）。
- §3 的 21 个唯一直接依赖逐项与附录 A 比对：**21/21 全部在表**（机械核对通过）。
- registry 抽查（registry.npmjs.org）：`obug@2.2.1`=MIT、`zundo@2.3.0`=MIT、`maxrects-packer@2.7.3`=MIT，与审计表一致。
- 方法与义务链完备：临时 lockfile 解析 + SHA-512 校验 + 213 项双向 diff 方案（§8.1/§8.3），build job 的许可门禁（`architecture-m1.md:295、341`），发布义务按许可证分类（§8.2 表）。
- 附注（非缺陷）：本轮审计基于仓库外临时解析，正式 lockfile 落地后须按 §8.3 重新双向 diff——该义务已写入文档，留待集成验收终审。

### 1.4 性能预算分解到模块 —— PASS

证据：`architecture-m1.md:169-192`（§5.1）。首屏 <300KiB 分解为 React/编辑器 ≤220 + 状态/i18n ≤30 + 入口余量 ≤50（:175）；4K CCL <500ms 分解为 mask 45 / 膨胀 60 / 两遍 CCL 220 / bbox 回收 65 / 过滤合并簇 60 / 余量 40（:180）；打包 500 帧 <200ms 分解为 20/140/20/10（:182）；解码、编码、ZIP、preview、端到端 p50/p95、UI 交互各有独立预算与测量边界；测量协议（warmup 5、独立 30 次、p95 取第 ceil(.95n) 项，:192）与内存分解（§5.2，含 4K 272MiB / 8K 1040MiB 超限降采样推演）齐备，且与契约资源上限（1GiB/256MiB、mobile 4096）一致。技术方案 §6 的四项预算（首屏/4K CCL/打包/内存）全部承接并细化。

### 1.5 CI 五 job 齐备 —— PASS

证据：`architecture-m1.md:289-295`——lint、typecheck、unit、golden、build 五 job，各带必须执行的统一根脚本、失败条件与产物；公共设置（frozen-lockfile、`--ignore-scripts`、超时、缓存、concurrency，:297-299）；根脚本命名强制（:301）。文档明确本阶段无可运行 job、通过状态待代码落地（:303），符合架构阶段交付边界。

### 1.6 M1 依赖集无 v2+ 依赖混入 —— PASS

证据：§3 依赖表（`architecture-m1.md:97-122`）与附录 A 均无 ffmpeg 系、onnxruntime 系、pngquant/jSquash、GIF 解码器、视频 demuxer；明确禁用与 CDN/动态 import 绕道条款（:335）；Playwright/coverage/许可扫描器/i18next/router/Konva 等暂缓项逐一列出且给出回流条件（:126）。依赖方向与 exports 边界（core 无 DOM/React/Comlink）清晰（:87-89）。

### 1.7 补充审查要点 1：Frame 的 bbox 语义 —— PASS

证据：契约已明确双轨语义且无隐藏行为——`sourceRect` 为可编辑审校框，`bbox` 为其内 `alpha>threshold` 紧内容框、`trim=false` 时等于 sourceRect（interface-contract.md:142）；`trim` 是用户可见的规范化选项（默认 true，:152），不是打包内部的隐藏 auto-trim；图集页存 bbox 内容，但 `sourceSize`/`spriteSourceSize` 保留逻辑画布与偏移，引擎侧还原为所见画布（:357，公式与 §3 offset 一致）；PNG 序列导出直接存完整 `Frame.canvas`（:487）。语义闭环：序列导出=所见即所得；图集导出=显式 trim + 元数据还原。预审建议「auto-trim 若实现须标注为管线内部行为」——本契约将 trim 前移为规范化层的显式用户选项并给出全部公式，满足「须在契约中明确」的要求。

### 1.8 补充审查要点 2：pHash/离群标记「M1 不暴露」标注 —— FAIL（部分）

- pHash 部分：**达标**。`computeHash` 默认 true 但注明「M1 不据此自动去重或折叠」（interface-contract.md:156）；`duplicateOf` 在 M1 固定 null（:164）；dHash 算法逐位定义（:164）。
- 离群部分：**未达标**。预审要求「契约需标注 M1 不暴露，否则从管线交付范围移除」，契约实际选择了第三条路——暴露为 UI 呈现：警告表规定 `OUTLIER_FRAMES` →「帧角标与筛选项」（interface-contract.md:643），与 PRD 不做清单「离群帧产品能力及其批量属性」（`prd-m1.md:351`）直接冲突；`copy-m1.md`/PRD 状态清单亦无对应文案与界面状态。`architecture-m1.md:352`（§9 第 4 条）自称「不新增高级批处理面板」，但角标+筛选项已是产品界面能力，超出「计算元数据」边界，与 PRD 范围权威矛盾。
- MULTIPLE_COMPONENTS / EMPTY_FRAMES 的角标与 PRD 范围相容（粘连标记属 Stage 2 检测行为，technical-design.md:120；空帧属降级路径，prd-m1.md AC-F05 场景 B），不在本问题范围。

→ 问题 2（P1）。

---

## 二、问题清单

| 编号 | 严重级 | 位置 | 问题描述 | 修复建议 |
|---|---|---|---|---|
| 1 | P1 | `docs/agent-roles.md:42-52`（配合 `docs/architecture-m1.md:91、353`） | 根级配置（package.json、pnpm-workspace.yaml、pnpm-lock.yaml、tsconfig.base.json、biome.json、.npmrc、README.md、.gitignore）及 `docs/devops.md`、`docs/technical-design.md` 在文件所有权表中无责任人，仓库存在写权限模糊地带；Wave 2 脚手架落地即触发多人写根 lockfile 的冲突风险。架构文档已自认但 Gate 1 仍未消除。 | 产品主在 Gate 1 拍板唯一集成人（采纳架构建议归 R7），并在 `agent-roles.md` 所有权表落盘：新增「根 manifest/lock/共享配置/README/.gitignore、docs/devops.md」行归 R7（或指定角色）；同时注明 `docs/technical-design.md` 的修订权归产品主。R3 无需改架构文档（§2 建议已存在）。 |
| 2 | P1 | `docs/interface-contract.md:643`（冲突源 `docs/prd-m1.md:351`） | 离群标记未按预审约定处理：契约规定 OUTLIER_FRAMES 的 UI 呈现为「帧角标与筛选项」，属于把 PRD 明确排除的「离群帧产品能力」写进冻结契约，且未标注「M1 不暴露」，下游 R2/R5/copy 无对应范围与文案，必然产生实现分歧。 | 二选一，推荐 (a)：(a) 契约将 OUTLIER_FRAMES 改为「M1 不暴露」——保留 flags/警告数据通道，UI 呈现表删除角标/筛选项约定并注明「M1 仅作为数据通道，UI 不展示」；(b) 产品主裁决将离群复核角标纳入 M1，并同步修订 PRD 功能清单、copy-m1.md 文案表与 ui-spec 状态清单。 |
| 3 | P1 | `docs/interface-contract.md:320、353`；`docs/architecture-m1.md:21` | 契约事实性错误：声称 `heuristic` 三值「准确映射 maxrects-packer 2.7.3 的逻辑 1/0/2」。经对照库源码（v2.7.3 `src/maxrects-packer.ts`）：`PACKING_LOGIC` 仅含 `MAX_AREA=0`、`MAX_EDGE=1`；`logic=2` 在 TypeScript 中不可赋值（枚举类型），运行时静默落入面积排序分支——库中不存在 fill-width 行为。照契约实现将得到一个名为 fill-width、实际等同 max-area 的虚假选项。 | 契约剔除 `heuristic` 联合类型中的 `"fill-width"`（最小改动，默认 max-edge 不受影响）；若产品要保留三选项，则改为「fill-width 由管线自实现排序，不映射库 logic」并删除「准确映射 1/0/2」表述；`architecture-m1.md:21` 决策表同步更正。 |
| 4 | P2 | `docs/interface-contract.md:823` | 「有旧资产时新 load 返回 BUSY」将「状态错误」复用为「忙」语义；§8 表中 BUSY 的恢复动作（等待/取消/retry）不能指引「先 release」这一实际修复路径。 | 在 §8 BUSY 行或 §9.2 补一句：BUSY 因旧资产触发时 details.field 标注 `asset`，恢复路径为 release 后重试；或改用专用错误码。 |
| 5 | P2 | `.gitignore`（对照 `docs/architecture-m1.md:83`） | 架构定版结构注明 `tests/golden/reports/` 为 gitignored CI 产物，现行 `.gitignore` 无该条目。 | 脚手架落地（问题 1 的集成人）时在 `.gitignore` 追加 `tests/golden/reports/`。 |

## 三、跨文档对齐事项（架构师已记录于 `architecture-m1.md:347-355`，不计入本轮问题清单，提请产品主 Gate 1 一并拍板）

1. 五格式契约（含 generic-json / png-sequence-zip，用户明确要求）与 PRD「不做通用 JSON」（`prd-m1.md:349`）的入口差异——PM 侧需同步修订 PRD 或明确「API 提供、UI 仅暴露三主入口」。
2. 不透明阈值：契约/技术方案采用「完全不透明占比 >99% 拒绝」，PRD 为「至少一个非完全不透明像素」（`architecture-m1.md:350` 已记录）——PRD 验收阶段须对齐。

## 四、外部核验记录（验收官实测）

- registry.npmjs.org：`obug@2.2.1`/`zundo@2.3.0`/`maxrects-packer@2.7.3` 许可证均 MIT，与附录 A 一致。
- maxrects-packer v2.7.3 `src/maxrects-packer.ts`：`PACKING_LOGIC = { MAX_AREA: 0, MAX_EDGE: 1 }`；排序比较器仅对 `logic === MAX_EDGE` 严格分支，其余值（含 2）落入面积分支 → 问题 3 依据。
- Phaser v3.90.0 `src/textures/parsers/JSONHash.js`：按 JSON 原值取 `frame.w/h`，`rotated` 仅置标志并调用 `updateUVsInverted()` → 契约 §6.1（interface-contract.md:475）旋转语义声明**正确**。

## 五、结论与后续

裁决 **FAIL**，第 1 轮打回。修复范围小且明确：问题 2、3 为契约（及架构文档一行）修订，问题 1 为所有权表落盘，问题 4、5 可顺手处理。生产者（R3 + 产品主/协调会话对 agent-roles.md 的修订）完成修复后提交第 2 轮架构验收；第 2 轮仍不通过则升级产品主人工裁决。契约自足性、性能预算、CI 设计、依赖边界、许可审计五项本轮已达标，复审仅核验问题清单整改，无需全量重查。

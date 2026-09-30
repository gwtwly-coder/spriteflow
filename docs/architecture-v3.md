# SpriteFlow v3.0-alpha 架构基线（对齐 PRD）

> 版本：0.2.0-r2；日期：2026-09-29；角色：架构师 R3。本文只定 v3.0-alpha 架构，不包含功能实现。M1 [公共契约](./interface-contract.md) 3.0.0/r4 保持冻结；v3 新增契约见 [interface-contract-v3.md](./interface-contract-v3.md)。
>
> 必读核对：已核对 `technical-design-v3.md`、M1 接口契约、`architecture-m1.md`、已入库 `prd-v3.md` 与 `copy-v3.md`。范围和验收以 PRD v3.0-alpha 为准；本稿中的分段耗时是候选预算，尚非实测结果。

## 1. 决策摘要

v3.0-alpha 增加一个可在 Node 中运行的 workspace：`@spriteflow/segment` 管纯部位几何、蒙版格式、来源像素提取、部位 ZIP 导出和结果校验。`segment/browser` 是唯一能加载 ONNX Runtime Web、Cache API 和模型文件的适配入口。apps/web 继续消费 M1 管线，并新增角色工作区和一个 `character.worker.ts`；SAM 会话和部位导出均不在 React 主线程运行。`@spriteflow/rig`、骨架模板、姿态采样与逐帧渲染属于 PRD 明确排除的 v3.5，目录和 API 仅作后续规划，本版本不得实现或进入发布包。

M1 的包、公共类型、Worker 协议和导出契约不变。v3.0-alpha 输出部位 ZIP（独立 PNG、parts.json、README.txt），复用 M1 已审计的 PNG/ZIP 编码实现与安全校验约定，但新增部位包格式定义在 v3 契约内，不扩展 M1 的五种导出格式。没有后端。

L1 BYOK 使用浏览器原生 `fetch` 直连用户配置的 HTTPS、OpenAI Chat Completions 兼容端点；不安装供应商 SDK。默认只在 Worker 生命周期内持有密钥；用户明确勾选“在此浏览器记住”后才可用 `sessionStorage`，不进入 localStorage、IndexedDB、URL、日志、错误详情或分析事件。请求会把用户图像直接发给所选服务商，调用前须显示服务商、模型与素材出端提示并取得逐次同意。CORS/API 不可用时转本地点击式 SAM 工作流，不尝试自建代理。

L2 采用 `onnxruntime-web` 原生 API，不叠加 Transformers.js。WebGPU 优先，建会话或推理失败时销毁会话并以 WASM 重建、对同一请求最多重试一次。正式发布候选模型为 SAM 2.1 Hiera-Tiny 的 ONNX 导出；模型文件不是 npm 依赖、不进应用初始包，由 R2 同源静态对象提供并以 Cache API 可选缓存。每个导出模型都须独立冻结上游 revision、SHA-256、输入输出张量契约和权重授权证据；任一项未确认就不进入生产 R2 清单。SAM 2 的模型检查点和代码由上游声明 Apache-2.0，许可证依据见下表；具体导出文件必须继承可证明的来源链。[SAM 2 上游许可说明](https://github.com/facebookresearch/segment-anything-2#license)

L3 在 v3.0-alpha 不实现；契约只为 v3.1 预留类型并以 `NOT_IMPLEMENTED` 明确未实现，不引入 LaMa、扩散模型、编解码器或额外包。遮挡补全实现留 v3.1 的独立变更与审计。

## 2. 仓库结构与依赖方向

```text
/
  apps/web/
    src/character/                 # 部位工作区、BYOK 同意/key 输入
    src/workers/character.worker.ts
  packages/
    pipeline/                      # M1 原包；v3 不修改其接口
    segment/
      src/index.ts                 # Node-safe 纯逻辑入口
      src/types.ts
      src/mask/                    # bitset、裁切映射、连通区/蒙版编辑原语
      src/semantic/                # LLM JSON 校验、修复策略、提示词构造
      src/session/                 # 会话状态机与 backend 注入接口
      src/browser/index.ts         # 唯一导入 onnxruntime-web 的子入口
      src/browser/onnx-backend.ts  # ORT 会话、模型拉取与 Cache API
      tests/                       # Node mock backend、mask/LLM 单测
    rig/                            # v3.5 预留；v3.0-alpha 不创建/发布
  tests/golden/characters/
    cases/<caseId>/                 # 输入、部位 mask truth、来源许可、manifest
    reports/                        # CI artifact，不提交测量产物
```

v3.0-alpha 依赖方向固定为 `apps/web → pipeline/browser + segment/browser + segment`；`segment/browser → segment + onnxruntime-web`。`segment` 根入口只依赖 ECMAScript、TypedArray 和 M1 type-only 公共类型。`packages/rig` 不属于本阶段 workspace build/test graph；v3.5 再另行定义它与 segment 的依赖方向。segment 的 browser 子路径仅提供 ONNX 执行后端，提示构造、bitset、RLE、bbox 校验仍可在 Node 中测。Node 测试以 mock `SamInferenceBackend` 注入张量输出，不加载 WebGPU、WASM 或 DOM。

不要把 M1 Frame/Asset 等类型复制到 v3；`interface-contract-v3.md` 的 type-only import 指向 `@spriteflow/pipeline` 3.0.0。`packages/segment` 以 package exports 隔离 Node-safe 根入口和 browser 入口。v3.5 创建 `packages/rig` 时另行定义其 exports。apps/web 使用一份 character worker，避免 SAM 会话、源 RGBA 在多个 worker 中复制；任务串行，切换源资产先 dispose 上一会话。M1 worker 仍由原有契约独立管理。

## 3. v3 依赖与许可证审计

### 3.1 冻结的新增依赖

审计截至 2026-09-29。版本号只给选定的直接包精确 pin；其运行闭包在 v3 workspace lockfile 生成前没有解析结果，因此以“lockfile 精确版本”记录，不能伪造子依赖版本。Wave 0 必须在临时目录解析完整生产和开发闭包，逐个 name@version 检查 registry integrity 与包内 LICENSE/NOTICE，产出 v3 许可证清单。未审计、UNKNOWN、UNLICENSED、GPL/AGPL/LGPL、被禁止的许可证表达式或无可核验来源即构建失败；锁文件闭包清单须零漏项后才能合并依赖变更。

| 名称 | 版本 | 许可证 | 商用闭源风险评估 | 结论 |
|---|---:|---|---|---|
| `onnxruntime-web` | 1.30.0 | MIT | 低；Apache 兼容无传染，须保留 MIT 与发布包第三方通知；WASM/ORT 发布工件亦逐项检查 | 允许，唯一新增运行时 npm 依赖；只从 `segment/browser` 动态加载 |
| `onnxruntime-common` | 1.30.0（ORT 同版闭包） | MIT | 低；属于 ORT Web 公共运行时，单独纳入 SBOM/NOTICE | 允许为 ORT 闭包，不由 segment 直接声明 |
| `flatbuffers` | 25.9.23 | Apache-2.0 | 低；保留 LICENSE/NOTICE、修改声明 | 允许，仅在项目锁文件复核通过后 |
| `guid-typescript` | 1.0.9 | ISC | 低；保留版权与 ISC 文本 | 允许，仅在项目锁文件复核通过后 |
| `long` | 5.3.2 | Apache-2.0 | 低；保留 LICENSE 与 NOTICE/修改声明 | 允许，仅在项目锁文件复核通过后 |
| `platform` | 1.3.6 | MIT | 低；保留版权与许可 | 允许，仅在项目锁文件复核通过后 |
| `protobufjs` | 7.6.6 | BSD-3-Clause | 低；保留版权、免责和禁止背书条款 | 允许，仅在项目锁文件复核通过后 |
| `@protobufjs/aspromise` | 1.1.2 | BSD-3-Clause | 低；protobufjs 运行闭包 | 允许，仅在项目锁文件复核通过后 |
| `@protobufjs/base64` | 1.1.2 | BSD-3-Clause | 低；protobufjs 运行闭包 | 允许，仅在项目锁文件复核通过后 |
| `@protobufjs/codegen` | 2.0.5 | BSD-3-Clause | 低；protobufjs 运行闭包 | 允许，仅在项目锁文件复核通过后 |
| `@protobufjs/eventemitter` | 1.1.1 | BSD-3-Clause | 低；protobufjs 运行闭包 | 允许，仅在项目锁文件复核通过后 |
| `@protobufjs/fetch` | 1.1.1 | BSD-3-Clause | 低；protobufjs 运行闭包 | 允许，仅在项目锁文件复核通过后 |
| `@protobufjs/float` | 1.0.2 | BSD-3-Clause | 低；protobufjs 运行闭包 | 允许，仅在项目锁文件复核通过后 |
| `@protobufjs/path` | 1.1.2 | BSD-3-Clause | 低；protobufjs 运行闭包 | 允许，仅在项目锁文件复核通过后 |
| `@protobufjs/pool` | 1.1.0 | BSD-3-Clause | 低；protobufjs 运行闭包 | 允许，仅在项目锁文件复核通过后 |
| `@protobufjs/utf8` | 1.1.2 | BSD-3-Clause | 低；protobufjs 运行闭包 | 允许，仅在项目锁文件复核通过后 |
| `@types/node` | 26.6.3（ORT 可选 peer） | MIT | 低；类型工具，不随浏览器运行时执行 | 允许；按可选 peer 继续审计 |
| `undici-types` | 8.9.0（@types/node 闭包） | MIT | 低；仅 Node 类型声明 | 允许；按可选 peer 继续审计 |
| `@huggingface/transformers` | 不安装 | Apache-2.0 | 低；本方案不需要其抽象层；引入会增加包体、ORT 闭包与模型下载行为 | 排除；用原生 ORT API，不把两个模型运行时叠加 |
| `fetch` / Cache API / Web Crypto | 浏览器标准 API，无 npm 包 | 浏览器实现不作为项目依赖 | 无第三方 npm 许可证风险；运行时支持按能力检测 | 使用原生接口 |
| LLM SDK（OpenAI/GLM/CogVLM 等） | 不安装 | 不适用 | SDK 各有依赖闭包，浏览器 key 管理与服务端默认更易混淆 | 排除；用小型 provider adapter + 原生 fetch |
| SAM 2.1 Hiera-Tiny ONNX 权重 | 模型版本、revision、SHA-256 在模型准入时冻结 | 上游 SAM 2 声明 Apache-2.0；导出产物另保留来源与转换清单 | 许可适用到上游 checkpoint；第三方转换代码、预处理算子及具体权重 hash 必须分别核对 | 仅准入模型清单有完整许可证据的构建；不随 npm 包、不进首屏 |
| MobileSAM 代码/权重 | 不作为默认模型 | 上游仓库代码为 Apache-2.0；独立权重授权和来源须另核 | 仓库代码许可不能自动证明任意镜像权重的分发权 | 不纳入默认 R2，权重许可未单独通过时禁止分发 |
| LaMa / SD inpainting 模型与运行时 | v3.0 不安装/不分发 | 本稿不作许可批准 | v3.1 需模型、转换器、依赖和服务商条款独立审计 | 排除出 v3.0 |

ORT Web 1.30.0 的 npm 包声明 MIT；官方发布说明确认它是在浏览器使用 WebAssembly/WebGL/WebGPU 的运行时，WebGPU 后端标记为 experimental。我们只启用 WebGPU 和 WASM，固定使用 WASM 回退，不启用 WebGL/WebNN。[ORT Web npm 元数据](https://www.npmjs.com/package/onnxruntime-web)、[ORT Web 官方运行时说明](https://github.com/microsoft/onnxruntime/blob/main/js/README.md)、[ORT 1.30 包信息](https://github.com/microsoft/onnxruntime/blob/v1.30.0/js/web/package.json)。Transformers.js 上游为 Apache-2.0 且本身使用 ONNX Runtime，故本方案不安装它以免重复运行时。[Transformers.js 上游许可及运行说明](https://github.com/huggingface/transformers.js)。

特别说明：MobileSAM 仓库的 LICENSE 是 Apache-2.0，但上游说明了权重下载与导出流程，没有在该说明中明确每个镜像 checkpoint 的独立发布条款；故不得从源代码许可证外推任意权重文件的分发权。[MobileSAM 上游代码和 ONNX 导出说明](https://github.com/ChaoningZhang/MobileSAM)、[仓库 LICENSE](https://github.com/ChaoningZhang/MobileSAM/blob/master/LICENSE)。SAM 2 上游明确把其模型 checkpoint 和代码列入 Apache-2.0；入库仍需保留所选 revision、checkpoint hash、ONNX 导出命令/环境和导出后 hash，以便追溯具体工件。[SAM 2 许可证声明](https://github.com/facebookresearch/segment-anything-2#license)。

Cloudflare R2 是模型文件的静态对象存放位置，不是服务端推理或用户素材服务器；Cloudflare Cache API、Web Crypto、fetch 为浏览器平台能力，均不新增 npm 依赖。R2 对象公开可读、CORS 仅允许正式站点 origin；模型文件只存公开推理权重和 manifest，绝不存用户图像、BYOK key 或生成结果。

### 3.2 闭源发布门禁

完整审计复用 M1 `architecture-m1.md` §8 的方法：精确 lockfile closure 与审计表双向 diff、核对 registry integrity 与实际 tarball、扫描 SPDX 表达式、附上许可证/NOTICE hash。v3 清单不得将“dev only”“optional”“平台包”作为漏审理由。模型是独立于 npm 的资产，清单按模型 artifact 一行，记供应者、上游 revision、工件 SHA-256、导出器及版本、模型/代码/训练数据许可边界、NOTICE 与 R2 key。未确认模型权重许可、复现 hash 或重新分发权时，build 与发布清单拒绝该模型，不通过 URL 可配置绕开。GPL、AGPL、LGPL 以及任意未知/未解析条款在项目 npm 闭包中零容忍。

## 4. Worker、模型懒加载与生命周期

启动 `character.worker.ts` 后只加载小型 worker/ORT glue；ORT WebGPU/WASM chunks、权重均动态导入/按请求取回。创建工作区时先加载源像素，不自动下载 SAM。用户第一次执行分割时加载模型，并显示真实下载/验证/会话建立进度；用户可取消。Cache API 命中时按版本/hash复用；缓存被清除、配额不足或隐私模式拒绝写入，不影响当次在线推理，模型只保留在内存会话中。

模型 manifest 含 `modelId`, `revision`, `artifactUrl`, `sha256`, `byteLength`, `inputNames`, `outputNames`, `inputSize`, `maskEncoding`, `licenseId`。仅允许编译进应用的已审模型 ID 与 HTTPS R2 origin；不接受任意输入 URL。下载先做 Content-Length 上限和实际 byteLength 校验，再用 SubtleCrypto SHA-256 校验，随后再 `InferenceSession.create`。Cache API key 由模型 ID、revision 和 hash 组成；缓存值必须为完整成功校验的 Response，失败/取消的部分对象不入缓存。保存缓存不是成功的前置条件。

单 Worker 最多一份源 RGBA、一份 SAM session/embedding、一份当前 mask 编辑结果和一个渲染任务。更新源资产先取消任务、释放 `InferenceSession`，清空旧 image embedding 和部件缓冲，再加载新图；后台缓存可保留。WebGPU provider 首选；创建或第一次执行失败即 release 并重建 WASM session，同一 prompt 最多重放一次，取消和输入错误不重放。WASM `numThreads=1`，不要求 COOP/COEP 或 SharedArrayBuffer。关闭工作区时释放 worker、session、tensor、图像位图和临时 RGBA；Cache API 权重仍由用户浏览器管理。

L1 与模型执行共用 character worker 的单任务队列，避免同时占满 CPU/GPU。KEY 仅在 Worker 内任务期存活；调用结束、超时、取消或 dispose 时清空引用。所有 progress 以契约 taskId 关联，不将图像、key、prompt 原文写入日志。窗口 reload 会终止 Worker 并丢弃默认 memory-only key。

## 5. BYOK 请求、隐私和失败降级

- 支持在 UI 中配置自选 OpenAI Chat Completions 兼容 HTTPS endpoint、model 与 API key；内置 provider preset 只提供用户可编辑的 URL/model 默认值，不在包中带任何 key，也不把特定提供商 SDK 或固定服务端 API 当依赖。
- 图片由 Worker 转为调用方提供的 PNG/WebP base64 data URL，经 `fetch` 直接发送至该 endpoint；`credentials: "omit"`、`redirect: "error"`、有限超时、用户取消。endpoint 必须 HTTPS（localhost 开发除外），禁止 URL 中用户名/密码/fragment，限制响应字节与 token 参数；端点的 CORS 不可用就返回可呈现的 BYOK 错误。
- key 默认仅驻留 Worker 内存；可选 sessionStorage 仅在用户点选记住后写入，tab session 到期即清；禁止 localStorage、URL 查询、zustand persist、IndexedDB、console、telemetry、异常对象 details。离开工作区清除 Worker key 引用并清除 sessionStorage 中的对应项。
- 初始 LLM 请求包含严格 JSON schema 提示和透明图像，不传入整套像素对象；响应先限字节、剥除可选 markdown code fence，再 JSON.parse 和 schema/坐标/枚举/数量验证。仅语法或 schema 错误允许一次 JSON 修复调用；修复调用只发原始响应文本、字段错误摘要和 schema，不再次发图像。第二次仍无效即失败；HTTP 401/403、429、网络、CORS、超时、用户取消均不做修复重试。
- 自动语义调用失败、输出判定非人形或 key 未提供时都降级到本地点击式 SAM；失败类型和候选保存在 UI 可见的 warning，先前有效部件列表不被部分覆盖。SAM 不可用时保留已确认部件/原图，自动拆件与点击模式均明确标为不可用，提供重试；不声称可以离线手动画蒙版，也不调用服务器兜底。

## 6. 模块性能和内存预算

PRD §8 的验收口径优先：参考桌面设备、模型已缓存、key 可用、输入最长边≤2048，从用户确认上传到部位审校就绪（L1+L2 完成，可编辑且可导出）P50≤30 秒，UI 保持响应；不含人工审校。对 10 次固定样例分段记上传→L1→L2 和 UI 心跳。首次模型下载与 LLM 单次往返延迟按 PRD 单独披露、不计入门禁，但必须另报实耗；同时保存含这些等待的端到端墙钟时间，避免“体验耗时”和门禁统计混为一谈。当前阶段把 30 秒当 PRD 的强制 P50 退出指标；本节预算是尚待实测校准的分段建议，不构成另一种 p95 验收口径。

| PRD 门禁内阶段预算（候选 P50 分配） | 时间 | 计时边界 |
|---|---:|---|
| 上传确认、解码与预检 | 4 s | 上传至工作像素已就绪；最长边≤2048 |
| L1 本地准备、响应解析/校验 | 3 s | 图像编码与 JSON 校验；LLM 单次往返单独披露，不计门禁 |
| SAM warm 模型验证与 session 初始化 | 2 s | 已缓存权重；首次冷下载另报，不计门禁 |
| Image embedding | 4 s | 固定桌面参考设备、最长边≤2048 |
| 最多 12 个 L1 部位框的 SAM mask 推理 | 10 s | 包含逐部位 decoder 和可用的 mask 后处理；不含人手点击时间 |
| 结果规范化与可编辑工作区就绪 | 4 s | mask、来源几何、列表与首屏画布状态提交 |
| 调度与帧间隔余量 | 3 s | Worker 消息、进度刷新、取消检查；UI 心跳需持续响应 |
| **合计** | **30 s** | 门禁统计使用 P50；阶段值是分配建议，实测后与 PM 同步，不代表已达成 |

SAM 工作图默认最大边 2048、原 RGBA 16 MiB。模型输入最大边 1024；预处理 RGB float tensor 峰值 12 MiB（1024²×3×4），模型权重预算≤80 MiB（2026-09-30 模型档位 A 定版：fp16 encoder 实测 64.2 MiB + decoder 8.4 MiB，见 `docs/research/2026-09-30-sam2-onnx-model-sources.md`；fp32 WASM 回退档 encoder 128.2 MiB 超此预算，其会话内存表现待真模型冒烟实测后修订本行），session scratch/cache 上限 160 MiB，embedding≤16 MiB，bitset mask≤0.5 MiB/2048²/部件。12 个部件 bitset≤6 MiB。部位导出串行编码，一个 tight-crop RGBA 输出上限按工作图 16 MiB 计、再加一个 PNG 编码缓冲和一个 ZIP 缓冲；严格计入 M1 archive 限制，不同时保留多份整图副本。SAM 峰值目标≤320 MiB（fp16 主档口径，不含浏览器本身和 M1 原图重复驻留；fp32 回退档峰值另行实测）；超限时返回可恢复 `MEMORY_LIMIT` 并释放临时张量，不自动降尺寸、不悄悄转服务端。模型大小和 session scratch 是预算/准入上限，未对实际所选 artifact 测量前不得宣称满足。4K/8K 输入按 M1 预检及用户授权降采样规则处理；mask 与 bbox 始终对应实际工作图，不能将 2048 上限绕过后仍沿用旧坐标。

部位导出吞吐单列测量：tight crop、像素断言、PNG 编码、parts.json/README 生成、ZIP 归档各记时和峰值缓冲；固定输入 RGBA hash、部件数、mask 密度及压缩器版本。导出计入“可导出”功能校验，但 PRD 的 30 秒终点是部位审校就绪，不把 ZIP 下载纳入门禁。非人形锚点也须验证降级路径，但不进入 10 例人形配额。

## 7. 测试策略

### 7.1 Node 单测

`@spriteflow/segment` 根入口在 `node --test`/Vitest 环境仅用 ES2022；测试假 ORT backend 的会话建立、embedding、box/point 输入、mask 输出、取消与 dispose 状态。bitset 固定 LSB-first、row-major，mask bbox、点添加/删除、框越界、部分 alpha、空结果、sourceRect 逆映射、重复/坏 LLM JSON 与恰好一次修复都有纯数据测试。网络 fetch、Cache API 与实际 ORT 独立放 browser adapter 集成 smoke，不用 DOM 模拟声称模型 GPU 已验证。

`@spriteflow/rig` 的 Node 单测在 v3.5 才启用；不得作为 v3.0-alpha CI job 或交付物。

### 7.2 黄金人物集像素断言

`tests/golden/characters` 至少包含 10 例计入配额的人形立绘，另有至少 1 例独立非人形降级锚点（不占 10 例）。每例携带输入及 SHA-256、许可来源、working-size、ground-truth Parts（kind、sourceRect、二值mask）、期望路径；人形例另带部位命中容差。敏感图像只有明确商用/测试授权后入库；无授权、作者或 provenance 任一缺失即测试集准入失败。

segment 对标注 mask 断言部位 ID/kind 集、bbox IoU≥0.90、mask IoU≥0.90、重复运行输出确定；所有导出 PNG 必须逐部件断言 RGB 逐字节一致、alpha 不大于源 alpha（`≤` 为通用拒绝边界；v3.0-alpha 实现与黄金回归按契约 extractPartPixels 的更强"蒙版内相等"口径断言）、mask 外 alpha 为 0。另验证 tight bbox、PNG 数量和 parts.json 映射、README 存在、ZIP 解包/安全路径检查；断言失败不得生成归档。非人形锚点必须触发纯点击降级，且不得按人形样例计数。LLM 在线服务不进入 CI：固定原始 HTTP fixture 覆盖 parser/修复重试，prompt 文本变更做 golden JSON schema 回归。

报告分为纯算法、真实浏览器 ORT-WASM、真实浏览器 ORT-WebGPU 三种，不用 mock 结果冒充真实 provider 成绩；失败回归保存 case ID、模型 manifest hash、runtime/provider、浏览器版本和 mask/导出 PNG diff，报告仅作为 CI artifact。

## 8. 接口关系与落地门槛

`interface-contract-v3.md` 是 v3.0-alpha `@spriteflow/segment` 的公共 API 规范；其中 RigSpec/MotionPreset/逐帧渲染仅为 v3.5 占位定义，v3.0-alpha 不导出、不实现。契约导入 M1 稳定类型，不修改 3.0.0/r4；v3 部位 ZIP 是独立接口，不擅自增加 M1 ExportFormat。任何新增依赖、模型 hash、接口字段或恢复语义均先修订契约/架构、完成许可审计，再由产品主按既定流程确认后实施。

Wave 0 门槛依据已入库 PRD v3 与 copy v3 执行：技术主冻结具体模型 manifest；R7 解析 ORT 闭包并提交全量许可证审计/lockfile；产品主确认 BYOK 服务商出端告知。具体权重 hash/许可和 ORT closure 门禁未完成前，可实现 Node-safe 纯逻辑与 mock 测试，不下载或发布未审模型，不把性能指标标记为已验收。

## 9. PRD AC-V01～V07 对齐记录

| PRD 验收 | 契约/架构落点 | 复核结论 |
|---|---|---|
| AC-V01 输入与工作区 | M1 InputAsset/预检沿用；v3契约约束 8192 上限、授权降采样、新 AssetRef 与 2048 性能样例 | 一致；不允许 segment 静默缩图 |
| AC-V02 BYOK | LlmProviderConfig、逐次 consent、无 key 不发请求、单次 JSON 修复与分类错误 | 一致；点击模式独立于 LLM |
| AC-V03 SAM | 懒加载、WebGPU→WASM、模型 hash/许可门禁；模型失败保留输入与部件，可重试且不重新上传 | 修订后与“自动/点击模式都依赖 SAM”一致 |
| AC-V04 审校 | 正负点走 SamSession.segment；新增部位走 createPartAsset；像素修改与删除为不可变 mask/PartAsset 操作 | 契约已补 create/remove 函数 |
| AC-V05 部位导出 | PartExportTask/Result、parts.json、README、tight PNG、ZIP 结构验证和编码后 RGBA 三断言 | 契约已补完整任务/codec 端口；M1 格式枚举不变 |
| AC-V06 降级与恢复 | 非人形/LLM 失败/无 key 到本地 SAM；模型失败只重试并保留页面，SAM 不可用时明示不可用 | 一致；不虚构无模型手绘能力 |
| AC-V07 黄金回归 | 至少 10 个人形配额 + ≥1 非人形独立锚点；回归含三断言、部位匹配、导出 ZIP 校验 | 架构已明确非人形锚点不占配额 |

### 需协调会话转 PM 的 PRD 澄清项

PRD §8 的门禁写“从确认上传到部位审校就绪 P50≤30 秒”，同时规定首次模型下载和 LLM 单次往返单独披露且不计入门禁；§8 的端到端退出标准又要求“含点击修正的审校→导出”至少 3 例全程计时满足 30 秒口径。建议 PM 明文分成两个指标：`T_gate = wall time - cold model download - one LLM request/response RTT`（仍报告扣除项和原始墙钟时间），门禁只测上传至审校就绪；端到端人工修正与导出另定阈值/报告要求，不复用“P50≤30 秒”，除非 PM 明确接受。否则一个是“不含人工审校、止于就绪”，另一个是“含人工修正、直到导出”，同名口径无法判定是否达标。

另建议在 PRD AC-V05 增写导出前与 PNG 编码后解码各运行一次同一三断言，并注明 alpha 保持源值或只允许降低；当前契约选择 mask=1 时复制源 RGBA 原值（因此 alpha 相等），mask=0 时 alpha=0，这是满足 `alpha_output ≤ alpha_source` 的更强策略。产品若需部分 alpha 编辑，应另定义算法与回归，不可默认为实现细节。

> **采纳记录（2026-09-29）**：以上两项已经 PRD 修订 `4329161` 落地——§8 拆为门禁口径（确认上传→审校就绪 P50≤30s，样例 ≤2048/≤12 部位）与体验口径（含点击修正与导出，单独记录非门禁）；AC-V05 明确像素生成与 PNG 编码后解码复验各执行一次、alpha 采用"蒙版内相等"强口径。Gate 1 复核（`docs/acceptance/gate1-v3-verdict-1.md`）已核实闭环。

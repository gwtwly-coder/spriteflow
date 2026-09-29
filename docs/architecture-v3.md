# SpriteFlow v3 架构定版（候选）

> 版本：0.1.0-r1；日期：2026-09-29；角色：架构师 R3。本文只定 v3 架构，不包含功能实现。M1 [公共契约](./interface-contract.md) 3.0.0/r4 保持冻结；v3 新增契约见 [interface-contract-v3.md](./interface-contract-v3.md)。
>
> 必读核对：已按要求阅读 `technical-design-v3.md`、M1 接口契约和 `architecture-m1.md`。`docs/prd-v3.md` 当前不存在，产品范围暂依 v3 奠基文档；凡 PRD 应定义的验收阈值在本稿列为候选值，PM 产出 PRD 后须核对，不能把本稿代替 PRD 验收。

## 1. 决策摘要

v3 增加两个可在 Node 中运行的 workspace：`@spriteflow/segment` 管纯部位几何、蒙版格式、来源像素提取与结果校验；`@spriteflow/rig` 管骨架模板、姿态采样、整数像素变换与逐帧合成。`segment/browser` 是唯一能加载 ONNX Runtime Web、Cache API 和模型文件的适配入口。`rig` 根入口不依赖浏览器。apps/web 继续消费 M1 管线，并新增角色工作区和一个 `character.worker.ts`；SAM 会话和整段逐帧处理均不在 React 主线程运行。

M1 的包、公共类型、Worker 协议和导出契约不变。v3 渲染结果适配成一个透明 RGBA 图像和 M1 `FrameDraft[]`，再走 M1 的审校、打包、Phaser/Godot/通用导出。没有第二套 atlas 格式，也没有后端。

L1 BYOK 使用浏览器原生 `fetch` 直连用户配置的 HTTPS、OpenAI Chat Completions 兼容端点；不安装供应商 SDK。默认只在 Worker 生命周期内持有密钥；用户明确勾选“在此浏览器记住”后才可用 `sessionStorage`，不进入 localStorage、IndexedDB、URL、日志、错误详情或分析事件。请求会把用户图像直接发给所选服务商，调用前须显示服务商、模型与素材出端提示并取得逐次同意。CORS/API 不可用时转本地点击式 SAM 工作流，不尝试自建代理。

L2 采用 `onnxruntime-web` 原生 API，不叠加 Transformers.js。WebGPU 优先，建会话或推理失败时销毁会话并以 WASM 重建、对同一请求最多重试一次。正式发布候选模型为 SAM 2.1 Hiera-Tiny 的 ONNX 导出；模型文件不是 npm 依赖、不进应用初始包，由 R2 同源静态对象提供并以 Cache API 可选缓存。每个导出模型都须独立冻结上游 revision、SHA-256、输入输出张量契约和权重授权证据；任一项未确认就不进入生产 R2 清单。SAM 2 的模型检查点和代码由上游声明 Apache-2.0，许可证依据见下表；具体导出文件必须继承可证明的来源链。[SAM 2 上游许可说明](https://github.com/facebookresearch/segment-anything-2#license)

L3 仅在 v3.0 定义类型和返回 `NOT_IMPLEMENTED`，不引入 LaMa、扩散模型、编解码器或额外包。遮挡补全实现留 v3.1 的独立变更与审计。

## 2. 仓库结构与依赖方向

```text
/
  apps/web/
    src/character/                 # 部位工作区、BYOK 同意/key 输入、预设动作 UI
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
    rig/
      src/index.ts                 # Node-safe 纯逻辑入口
      src/types.ts
      src/templates/               # humanoid-biped-v1、骨骼映射
      src/curves/                  # 预设、定点姿态采样
      src/render/                  # nearest-neighbor 变换与 RGBA 合成
      tests/                       # 几何/曲线/像素黄金
  tests/golden/characters/
    cases/<caseId>/                 # 输入、部位 mask truth、来源许可、manifest
    reports/                        # CI artifact，不提交测量产物
```

依赖方向固定为 `apps/web → pipeline/browser + segment/browser + segment + rig`；`segment/browser → segment + onnxruntime-web`；`segment` 与 `rig` 根入口仅依赖 ECMAScript、TypedArray 和 M1 的 type-only 公共类型；`rig` 不依赖 `segment` 的运行实现。segment 的 `browser` 子路径仅提供 ONNX 执行后端，提示构造、bitset、RLE、bbox 校验仍可在 Node 中测。Node 测试以 mock `SamInferenceBackend` 注入张量输出，不加载 WebGPU、WASM 或 DOM。

不要把 M1 Frame/Asset 等类型复制到 v3；`interface-contract-v3.md` 的 type-only import 指向 `@spriteflow/pipeline` 3.0.0。`packages/segment`、`packages/rig` 分别以 package exports 隔离根入口和 browser 入口。apps/web 使用一份 character worker，避免 SAM 会话、源 RGBA 在多个 worker 中复制；任务串行，切换源资产先 dispose 上一会话。M1 worker 仍由原有契约独立管理。

## 3. v3 依赖与许可证审计

### 3.1 冻结的新增依赖

审计截至 2026-09-29。版本号只给选定的直接包精确 pin；其运行闭包在 v3 workspace lockfile 生成前没有解析结果，因此以“lockfile 精确版本”记录，不能伪造子依赖版本。Wave 0 必须在临时目录解析完整生产和开发闭包，逐个 name@version 检查 registry integrity 与包内 LICENSE/NOTICE，产出 v3 许可证清单。未审计、UNKNOWN、UNLICENSED、GPL/AGPL/LGPL、被禁止的许可证表达式或无可核验来源即构建失败；锁文件闭包清单须零漏项后才能合并依赖变更。

| 名称 | 版本 | 许可证 | 商用闭源风险评估 | 结论 |
|---|---:|---|---|---|
| `onnxruntime-web` | 1.30.0 | MIT | 低；Apache 兼容无传染，须保留 MIT 与发布包第三方通知；WASM/ORT 发布工件亦逐项检查 | 允许，唯一新增运行时 npm 依赖；只从 `segment/browser` 动态加载 |
| `onnxruntime-common` | 1.30.0（ORT 同版闭包） | MIT | 低；属于 ORT Web 公共运行时，单独纳入 SBOM/NOTICE | 允许为 ORT 闭包，不由 segment 直接声明 |
| `flatbuffers` | ORT lockfile 精确版本 | Apache-2.0 | 低；保留 LICENSE/NOTICE、修改声明 | 允许，仅在闭包审核通过后 |
| `guid-typescript` | ORT lockfile 精确版本 | MIT | 低；保留版权与 MIT 文本 | 允许，仅在闭包审核通过后 |
| `long` | ORT lockfile 精确版本 | Apache-2.0 | 低；保留 LICENSE 与 NOTICE/修改声明 | 允许，仅在闭包审核通过后 |
| `platform` | ORT lockfile 精确版本 | MIT | 低；保留版权与许可 | 允许，仅在闭包审核通过后 |
| `protobufjs` | ORT lockfile 精确版本 | BSD-3-Clause | 低；保留版权、免责和禁止背书条款 | 允许，仅在闭包审核通过后 |
| `@protobufjs/aspromise` | ORT lockfile 精确版本 | BSD-3-Clause | 低；protobufjs 运行闭包 | 允许，仅在闭包审核通过后 |
| `@protobufjs/base64` | ORT lockfile 精确版本 | BSD-3-Clause | 低；protobufjs 运行闭包 | 允许，仅在闭包审核通过后 |
| `@protobufjs/codegen` | ORT lockfile 精确版本 | BSD-3-Clause | 低；protobufjs 运行闭包 | 允许，仅在闭包审核通过后 |
| `@protobufjs/eventemitter` | ORT lockfile 精确版本 | BSD-3-Clause | 低；protobufjs 运行闭包 | 允许，仅在闭包审核通过后 |
| `@protobufjs/fetch` | ORT lockfile 精确版本 | BSD-3-Clause | 低；protobufjs 运行闭包 | 允许，仅在闭包审核通过后 |
| `@protobufjs/float` | ORT lockfile 精确版本 | BSD-3-Clause | 低；protobufjs 运行闭包 | 允许，仅在闭包审核通过后 |
| `@protobufjs/path` | ORT lockfile 精确版本 | BSD-3-Clause | 低；protobufjs 运行闭包 | 允许，仅在闭包审核通过后 |
| `@protobufjs/pool` | ORT lockfile 精确版本 | BSD-3-Clause | 低；protobufjs 运行闭包 | 允许，仅在闭包审核通过后 |
| `@protobufjs/utf8` | ORT lockfile 精确版本 | BSD-3-Clause | 低；protobufjs 运行闭包 | 允许，仅在闭包审核通过后 |
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
- 自动语义调用失败、输出判定非人形或 key 未提供时都降级到本地点击式 SAM；失败类型和候选保存在 UI 可见的 warning，先前有效部件列表不被部分覆盖。SAM 不可用时保留已确认部件/原图，并提示用户重新加载模型或手动画矩形；不调用服务器兜底。

## 6. 模块性能和内存预算

指标是 v3.0 候选工程门槛，不是已经测得的成绩。目标设备沿用 M1 基准：Intel i5-1240P 等级、16 GiB RAM、交流供电，记录 OS、浏览器和驱动；桌面冷缓存宽带按持续 50 Mbit/s 标定。30 秒统计从已解码的单人物透明 RGBA 开始到 12 部位可编辑、24 帧动画序列交给 M1 导出适配器结束；不含人的点选/审校时间、首次下载模型在慢速网络下的等待，也不伪称所有网络能 30 秒完成。冷模型下载的带宽单列报告；缓存后仍必须达到 30 秒路径。

| 阶段 | p95 预算 | 测量范围 |
|---|---:|---|
| L1 图像准备和 BYOK 语义定位 | 6 s | 缩图/PNG 编码≤1 s；首次请求≤4 s；一次无图 JSON 修复≤1 s；无 key 时本地点击降级，不计网络等待 |
| SAM 首次冷取模（仅 50 Mbit/s 条件） | 8 s | ≤40 MB 压缩模型下载约 6.4 s，校验/Cache API≤1.6 s；带宽更慢则如实报告超预算 |
| SAM 会话创建与 embedding | 3 s | provider 初始化≤1 s、图片 embedding≤2 s；Cache warm 与 cold 分开记录 |
| 12 个部位 mask prompt | 6 s | 每 prompt p95≤500 ms；含后处理和累计≤12 部位上限，不含用户点按思考时间 |
| mask 规范化、像素来源裁切、部件结果 | 1 s | 输出 bitset 与 bbox；不复制源 RGBA 全图 |
| 骨架模板与动作参数展开 | 1 s | 骨骼映射≤100 ms；剩余用于范围验证和适配 M1 drafts |
| 24 帧 × 512×512 渲染 | 4 s | 6.29 M 输出像素，串行纯逻辑渲染；不得阻塞主线程 |
| M1 适配图集打包及 archive 交接 | 1 s | 不含 PNG encode 额外等待与用户下载；使用既有 M1 预算 |
| 交互调度余量 | 1 s | 任务边界、一次消息交接、资源释放 |
| **合计** | **30 s** | 冷缓存、50 Mbit/s 的验证样例；另报 warm-cache p50/p95 与低带宽分布 |

SAM 工作图默认最大边 2048、原 RGBA 16 MiB。模型输入最大边 1024；预处理 RGB float tensor 峰值 12 MiB（1024²×3×4），模型权重≤40 MiB，session scratch/cache 上限 160 MiB，embedding≤16 MiB，bitset mask≤0.5 MiB/2048²/部件。12 个部件 bitset≤6 MiB；渲染期间一个 512² RGBA 输出≤1 MiB，默认串行复用。SAM 峰值目标≤320 MiB（不含浏览器本身和 M1 原图重复驻留）；ResourceLimits 超限时返回可恢复 `MEMORY_LIMIT` 并释放当前推理临时张量，不自动降尺寸、不悄悄转服务端。若实际模型 session scratch 超过预算，换模型/量化后重新测，不能抬高数字掩盖。

Rig 吞吐以 24×512² ≤4 s 为最低候选线，即≥1.57 M 输出像素/s，500帧打包复用 M1 <200ms 预算另行记录。性能报告分别写纯变换、合成、sheet 汇总、M1 pack，像素数/帧数/输入复杂度/hash 固定。4K 源图在 segment 上传预算不等于 4K 模型输入：先在 Worker 内等比缩至≤2048，再把所有 mask 坐标逆映射至源工作坐标；转换边界使用 floor 左上 / ceil 右下，并按原图可见像素采样，不缩放源 RGB。

## 7. 测试策略

### 7.1 Node 单测

`@spriteflow/segment` 根入口在 `node --test`/Vitest 环境仅用 ES2022；测试假 ORT backend 的会话建立、embedding、box/point 输入、mask 输出、取消与 dispose 状态。bitset 固定 LSB-first、row-major，mask bbox、点添加/删除、框越界、部分 alpha、空结果、sourceRect 逆映射、重复/坏 LLM JSON 与恰好一次修复都有纯数据测试。网络 fetch、Cache API 与实际 ORT 独立放 browser adapter 集成 smoke，不用 DOM 模拟声称模型 GPU 已验证。

`@spriteflow/rig` Node 单测覆盖 parent graph 无环、bone ID 唯一、attachment 引用完整、pose interpolation/循环采样边界、参数极限、层级矩阵、最近邻 tie-break、alpha mask、透明合成、z-order、越界裁剪、取消以及危险 pixel budget。给定相同 bytes/pose/preset 必须相同 output bytes。

### 7.2 黄金人物集像素断言

`tests/golden/characters` 每例携带输入及 SHA-256、许可来源、working-size、ground-truth Parts（kind、sourceRect、二值mask）、至少一个 click/box prompt、期望 degradation、RigSpec/MotionPreset 参数、逐帧 RGBA 哈希。敏感图像只有明确商用/测试授权后入库；无授权、作者或 provenance 任一缺失即测试集准入失败。

segment 对标注 mask 断言部位 ID/kind 集、bbox IoU≥0.90、mask IoU≥0.90、重复运行输出确定、可见像素源采样一致。Rig 用独立手工参考帧或程序化合成的小图，逐通道 byte-equal；断言每个非透明输出像素的 RGB 等于所采原像素、只有 mask/composite 修改 alpha、跨 Node 与指定 Chromium worker hash 一致。LLM 在线服务不进入 CI：固定原始 HTTP fixture 覆盖 parser/修复重试，prompt 文本变更做 golden JSON schema 回归。

报告分为纯算法、真实浏览器 ORT-WASM、真实浏览器 ORT-WebGPU 三种，不用 mock 结果冒充真实 provider 成绩；失败回归保存 case ID、模型 manifest hash、runtime/provider、浏览器版本和逐帧 diff PNG，报告仅作为 CI artifact。

## 8. 接口关系与落地门槛

`interface-contract-v3.md` 是两个 v3 包的单一公共 API 规范。它导入 M1 契约的稳定类型，不修改 3.0.0/r4；M1 导出兼容由 app adapter 实现。v3 任何新增依赖、模型 hash、接口字段或恢复语义均先修订契约/架构、完成对应许可审计，再由产品主按既定流程确认后实施。

Wave 0 开工门槛：PM 产出 PRD v3 并核对本文候选指标；技术主冻结具体模型 manifest；R7 解析 ORT 闭包并提交全量许可证审计/lockfile；产品主确认 BYOK 服务商出端告知。三个门槛未完成时，可实现 Node-safe 纯逻辑包和 mock 测试，不下载或发布任何模型，不接 LLM 网络，不把指标标记为已验收。

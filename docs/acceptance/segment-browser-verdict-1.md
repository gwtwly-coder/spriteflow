# segment/browser 增量独立验收裁决（verdict 1）

- 日期：2026-09-30
- 验收对象：commit `f62efa8`（feat(segment/browser): v3.0-alpha 增量 2 —— `./browser` 子入口；packages/segment 20 文件 +4145，测试 74→144）。其后 `1af9dbf`/`4bdb769` 两个 `.gitattributes` 提交经核对与本验收无关，未纳入评审。
- 规格依据：docs/interface-contract-v3.md（0.2.0-r2）§1（:11-107）、§3（:329-424）、§4（:425-533）、§5（:534-591）、§10（:795-846）、导出布局（:793-794）。
- 验收方法：只读代码/契约 + 本机复跑门禁 + 独立构造受控负例；生产者回执与自报 PASS 不作为证据。
- **身份披露**：本验收由独立子代理会话执行，继承父会话模型（型号未确认，GLM 同族），同族独立上下文，不声称异族；与生产者无共享对话上下文。

---

## 1. 检查单逐项

### 1.1 契约语义 — §4 模型准入与加载

| 检查点 | 结论 | 证据 |
|---|---|---|
| 准入门禁顺序 allowlist/frozen/license → 缓存 → 网络 → 字节 → SHA-256 | PASS | `src/browser/manifest.ts:170-178`（resolveApprovedEntry：未知 id/未 frozen/未审计 license → null）、`onnxBackend.ts:136-158`（create 先准入再 loadArtifact）、`manifest.ts:272-343`（loadVerifiedArtifact：cache match → 网络GET → verifyArtifactBytes）；字节校验 `manifest.ts:235-241`，SHA-256 `:242-245` |
| 坏哈希拒绝、不可降级跳过 | PASS | `manifest.ts:242-245` 哈希不符抛 `MODEL_HASH_MISMATCH`；网络副本与缓存副本走同一 `verifyArtifactBytes`，任何路径返回前必过哈希。测试 `tests/browserManifest.test.ts:164`（坏哈希拒且不入缓存）、`:138`（缓存坏字节丢弃回落网络，网络副本仍须过校验） |
| 未冻结拒绝 | PASS | `manifest.ts:175`（`!entry.frozen → null` → MODEL_NOT_APPROVED）；测试 `browserManifest.test.ts:93` |
| 缓存命中也验哈希 | PASS | `manifest.ts:288-296`：cache hit 后调用与网络下载同一 `verifyArtifactBytes`；测试 `browserManifest.test.ts:107` |
| 缓存不可用/损坏/写失败回落网络 + MODEL_CACHE_UNAVAILABLE warning | PASS | `manifest.ts:276-300,334-341`（异常吞掉置 cacheAvailable=false 继续网络）；`onnxBackend.ts:194-196,406-411`（cacheWasUnavailable → describeModelLoad 回传 warning）；测试 `browserManifest.test.ts:185,210` |
| 呈现 manifest 防篡改 | PASS | `manifest.ts:197-216` manifestMatchesEntry 15 字段全比对（含 artifactUrl/哈希/字节数/tensor 名/license），任一漂移 `onnxBackend.ts:136-139` → MODEL_NOT_APPROVED；测试 `browserManifest.test.ts:230` |
| 会话 WebGPU→WASM 仅 provider 级失败重试一次 | PASS | `session.ts:331-383`：仅 `MODEL_INITIALIZATION_FAILED` 或未知错误触发重建；哈希/license/准入/下载失败为终态（`:343-345`）；`replayedToWasm` 保证至多一次（`:346,358`）；推理首败同样 dispose→create(wasm)→重嵌入→同 prompt replay 至多一次（`:535-623`），取消/显式契约错误不 replay（`:536-545`）；成功降级附 `WEBGPU_FALLBACK_TO_WASM`（`:382,575`）。测试 `session.test.ts` 回退/准入终态/取消不 replay |
| BUSY 单任务锁 | PASS | `session.ts:309-311,403-405,463-465`（initialize/setImage/segment 各自 busy 检查→BUSY） |
| dispose 幂等、dispose 后 INVALID_STATE | PASS | `session.ts:626-637`（二次 dispose 直接 return，backend.dispose 吞异常不 reject）；`:306,400,460` 三操作 disposed→INVALID_STATE |
| 每 asset revision 仅 embed 一次 | PASS | `session.ts:421-428`（image-ready 且 refsEqual 直接返回 info 不重嵌入） |
| prompt 校验/去重 | PASS | `session.ts:199-283`：box 非空整数且在图内、点整数 [0,w-1]×[0,h-1]、负点≤16、完全相同点按 x,y,label 去重（`:253-267`）；"至少一个 positive" 仅在无 box 时强制（`:270-272`）——契约 :524 字面未区分 box-only，但 §5 编排对每个 proposal 恰以 `{type:"box",points:[]}` 驱动 L2（`orchestration.ts:376`），box-only 必须合法，onnxBackend 按 SAM 惯例合成两角点（`onnxBackend.ts:313-323`）。裁定：唯一可行读法，接受 |

### 1.2 契约语义 — §5 编排

| 检查点 | 结论 | 证据 |
|---|---|---|
| consent 字面量 true 门 | PASS | `orchestration.ts:297-302`：`!llmConsent || llm===null` 在调用 locatePartsWithLlm **之前**早退，LlmLocateRequest.userConsent 恒为字面量 true（`:311`） |
| 零图片外发路径 | PASS | 早退路径无任何 transport 调用；独立负例 NEG-2（见 §3）以记录型 transport 实证 0 调用 |
| 降级矩阵 | PASS | consent=false/llm=null→LLM_UNAVAILABLE（:299-302）；LLM 失败→LLM_FAILED+LLM_FALLBACK_TO_CLICK（:317-326）；非人形→NON_HUMANOID+NON_HUMANOID_CLICK_MODE（:330-338）；低人形置信→LOW_SEMANTIC_CONFIDENCE+LLM_FALLBACK_TO_CLICK（:339-347）；均为 ok:true 零部件 click 结果，非 transport 错误；LLM 失败不创建 SAM 会话（会话在全部降级门之后才建立，:350） |
| 进度单调+仅成功终态 complete+取消检查 | PASS | `orchestration.ts:72-116`（ProgressReporter 钳位+单调 max，complete 仅成功终态发一次，cancellable=false）；validate/locate/逐 proposal/逐阶段取消检查（:281,317,360,458）；负例与测试（进度单调、取消）覆盖 |
| PartAsset 像素来源 | PASS | part 由 createPartAsset 包装（ID 包内 generatePartId，mask 拷贝，canvas=sourceRect/offset 0:0，`partAsset.ts:205-265`），像素经 extractPartPixels 从同 revision 源图复制；编排测试 :211-215 做 mask=1 逐字节等于源、mask=0 全零校验；EMPTY_MASK/LOW_MASK_CONFIDENCE 保留部件仅加警告（`orchestration.ts:250-258`） |
| options.maxParts ≤ limits.maxParts 等 §1 上限 | PASS | `orchestration.ts:159-210`（1…32、[0,1]、256…1024、超 limits→RESOURCE_LIMIT） |

### 1.3 契约语义 — §3 浏览器传输

| 检查点 | 结论 | 证据 |
|---|---|---|
| POST / redirect:error / credentials:omit | PASS | `fetchTransport.ts:114-124` |
| 超时与取消联动同一 AbortController | PASS | `:100-112`（setTimeout 超时 abort；50ms 轮询 context.isCancelled abort），`:127`（读体后再查取消）；llm.ts:475 增加 CANCELLED 码映射，取消不再误报 LLM_TIMEOUT |
| 响应体字节上限（流式、超限取消流） | PASS | `:54-91`（逐 chunk 计数，超限抛 LLM_RESPONSE_TOO_LARGE 且 reader.cancel()） |
| Retry-After → retryAfterMs | PASS | `:31-42,125`（秒数/HTTP-date 两种格式） |
| 错误卫生：无 key/无 dataUrl/无端点/无未截断 body | PASS | `:15-23` LlmTransportError 消息为常量串；原始 fetch 错误不透传不 cause（:139-147）；负例与测试（错误卫生）覆盖；llm.ts:470 注释确认 provider 消息不含端点 URL |
| timeoutMs/maxResponseBytes/maxOutputTokens/endpoint 范围校验 | PASS | 在 L1 层完成：`llm.ts:31-39,102-175`（1000-8000、1-1048576 且 ≤ limits.maxLlmResponseBytes、128-4096、≤2048、HTTPS+无 userinfo/fragment），传输层消费已校验值 |
| 超时/取消后不继续读响应体 | PASS | abort 使 reader.read() reject → 归一化返回，不续读（:73-89） |

### 1.4 根入口纯净性

PASS。证据：

- grep（word 级）非 browser src 根：无 `fetch(`/`AbortController`/`AbortSignal`/`document.`/`window.`/`navigator`/`caches`/`onnxruntime`/`subtle`/`Response`/`Headers` 实际引用（命中均为 `request`/`provider`/`canvas` 等标识符子串与类型字段名）。
- `onnxruntime-web` 全仓唯一 import 点：`src/browser/onnxBackend.ts:425`（dynamic import，懒加载）；grep 输出确认 src 根与 tests 无静态/动态引用。
- 根 src 无一文件 import `src/browser/*`（grep 0 命中）。
- 双 tsconfig 隔离：`tsconfig.json` include src 全量但 `exclude: ["src/browser"]` 且 `types: []`；`tsconfig.browser.json` 仅含 src/browser、lib 加 DOM/DOM.Iterable。`pnpm run typecheck` 两配置全过，证明根入口声明面无 DOM 类型泄漏。
- `node scripts/check-boundaries.mjs` → OK（30 文件，工作区 import 规则全部成立）；`packages/pipeline` `check:contract` → PASS（exact root exports, bidirectional API types, ES2022 without DOM, browser types）。

### 1.5 测试有效性

PASS。

- 复跑：`packages/segment` `npx vitest run --reporter=dot` → **Test Files 9 passed, Tests 144 passed**（0.74s），与申报 74→144 一致。
- 抽验 3 组受控负例（验收人独立编写临时文件 `tests/acceptance-negative.tmp.test.ts`，运行后已删除，`git status` 恢复洁净）：
  - **NEG-1 篡改 manifest 哈希→准入拒绝**：合成注册表 + 真 OnnxSamBackend（假 ORT/fetch/Cache），呈现 manifest 翻转 sha256 一个 hex 字符 → `MODEL_NOT_APPROVED`（stage=model-initialize），且 **fetch 0 次调用**（准入先于网络）、会话保持未就绪（setImage→INVALID_STATE）。
  - **NEG-2 consent=false→零 transport 调用**：记录型 transport → `calls.length===0`，mode=click、0 部件、degradation=LLM_UNAVAILABLE、messageKey=`character.degradation.LLM_UNAVAILABLE`。
  - **NEG-3a/3b WebGPU 会话创建失败→WASM 恰好重试一次**：假后端 create 对 webgpu 抛错 → `calls.create` 精确等于 `["webgpu","wasm"]`、dispose 恰 1 次、info.provider=wasm、warning 含 WEBGPU_FALLBACK_TO_WASM；双 provider 皆败 → 恰 2 次 create、终态 `MODEL_INITIALIZATION_FAILED`。
  - 4 用例全部通过。
- 边界遵守：未重跑 golden/e2e；根 `test:unit` 未整体重跑（其中含 pipeline/golden 工件，按边界跳过），以 segment 包 144 用例 + 根 typecheck + check-boundaries + check:contract 佐证无回归。

### 1.6 ORT 用法风险面（静态审查，不要求真模型验证）

- `wasm numThreads=1`：`onnxBackend.ts:204-209` 仅 wasm 显式 `numThreads:1`；webgpu 未设置（见 P2-5）。`SamRuntimeOptions.wasmThreads!==1` 在 `session.ts:154` 拒绝。
- providers 以字符串数组传入（`executionProviders: [provider]`，:205），符合 ort-web API 形状。
- dynamic import 错误处理：`loadOrtModule` 失败（:425）从 `create()` 裸抛 → session 侧 `asCharacterError`=null → 按 provider 级失败走一次 WASM 重建；requested=wasm 时直接合成 `MODEL_INITIALIZATION_FAILED`（`session.ts:346-355,371-380`）。fail-closed 成立，无静默成功路径。
- 会话创建失败资源释放：encoder 成功/decoder 失败时先 release encoder 再抛（`onnxBackend.ts:160-172`）；dispose 吞 release 异常保持幂等（:387-403）。
- 非契约 `SamModelLoadError` 之外错误在 create 统一包成 `MODEL_INITIALIZATION_FAILED`（:178-181）。

### 1.7 回执自白最大缺口评估（张量名/预处理/输出映射未经真模型核实）

结论：**fail-closed 兜底基本真实成立，但有两处"保守降级"而非"报错"的边角（P2-1），须在真模型冒烟增量中消除**。

- 张量名错（feed 缺失/输出缺失）→ ORT run 抛错或 `masks/scores===undefined` → `INFERENCE_UNAVAILABLE`（`onnxBackend.ts:246-249,279-287`）——确为报错而非静默错图。
- scores 非 Float32Array → `INFERENCE_UNAVAILABLE`（:286-288）。
- **masks 非 Float32Array → 静默返回空 mask**（:374-375），表现为合法 EMPTY_MASK warning 而非错误。像素安全（不选中任何源像素，无错图外泄），但把映射故障伪装成合法空结果，应改为报错（P2-1）。
- 多 mask 布局仅处理 4-D `[1,N,H,W]`（按 bestIndex 取面，:368-373）；若真模型输出 3-D `[N,H,W]`，会取 plane 0 而 predictedIou 仍取 bestIndex——蒙版与置信度可能不一致（仍是源像素复制，不违反像素不变量，但置信度失真）（P2-1）。
- 像素不变量结构性成立：mask 只决定"选/不选"源像素，extractPartPixels 对 mask=1 复制源 RGBA、mask=0 写零；映射错误最多导致选错区域/空 mask，**不可能产生非源像素的可见颜色**。故"映射错误→静默错图"的风险不存在；存在的是"静默空图/错选区"。
- 预处理（0-1 RGB、NCHW、最近邻确定性缩放 :224-241）与 SAM2 ONNX 导出约定的匹配度未验证——已登记归真模型冒烟增量，本增量按静态审查接受。

---

## 2. 生产者登记的 7 项偏离/歧义裁定

| # | 登记 | 裁定 | 理由与条件 |
|---|---|---|---|
| 1 | createSamSession/segmentSemantically/segmentByPrompts 放根入口，browser 只出三函数 | **接受** | 非偏离，属合规：契约 :793-794 明文 browser 精确导出 `createOnnxSamBackend/createFetchLlmTransport/getApprovedSamManifest` 三函数，根入口导出"第 1-5 节及第 10 节"API（createSamSession 在 §4 :501、segmentSemantically/segmentByPrompts 在 §5 :554/:568 均为根面签名）；实现 `src/index.ts:15,22` 与 `src/browser/index.ts` 与之一一对应，check:contract PASS 实证 |
| 2 | mergePromptMask（§4 :515）只有签名无语义→未实现未杜撰 | **接受（附 P1-1 跟踪）** | 语义空白下任何实现都是杜撰，风险大于缺口本身；但契约 :794 "声明名与签名即完整公共表面，不可由实现包省略"与该缺失正面冲突，**必须在 RC 发布前二选一**：产品主补语义后补实现导出，或契约修订将其移出 v3.0-alpha 范围。已列 P1-1 |
| 3 | 加载路径未用 limits.maxModelBytes（默认 40MiB 会拒所有内置模型），只做 manifest.byteLength 相等校验 | **接受（当前处理安全；附 P1-2 跟踪）** | 安全性成立：呈现 manifest 被注册表 15 字段全比对钉死（裁定 7），下载字节数必须与冻结注册表 byteLength 精确相等（`manifest.ts:235-241`），实际内存/下载上限由注册表硬约束，limits 缺位不产生无界下载。但 `DEFAULT_CHARACTER_LIMITS.maxModelBytes=41,943,040` 与 fp32 encoder 134,429,092 字节矛盾是真实策略冲突，模型档位决策时必须一并裁决（改默认值/改注册表/启用校验），不得长期悬置。已列 P1-2 |
| 4 | useModelCache/cachedModel 经 deps 覆盖 + describeModelLoad 诊断协议传达 | **接受（附 P1-3 跟踪）** | 契约自身签名无通道：`createOnnxSamBackend()` 无参、`SamInferenceBackend.create(manifest, provider)` 不携带 options，deps 覆盖是测试/ops 路径唯一可行机制，describeModelLoad 作可选协议不污染契约面，且 info.cachedModel 有真实来源。**缺口**：公共路径（默认后端）下 `options.useModelCache=false` 实际不生效（`session.ts` 仅校验不转发，`onnxBackend.ts:150` 默认 true），属契约设计缺口而非实现疏漏，需契约 r3/后续增量建立通道。已列 P1-3 |
| 5 | SamSessionInfo.state 无 "new"：setImage 先于 initialize = INVALID_STATE | **接受** | 合规：契约 :456 state 类型恰为 `"ready"\|"image-ready"\|"disposed"`，无 "new"；embed 前置必须先 initialize 成功（:523 "直到 initialize 成功后才重新执行 embedding"），先 setImage 属调用时序错误，INVALID_STATE 语义正确（`session.ts:406-409`）。`buildInfo` 的 "new"→"ready" 映射为不可达防御分支，无害 |
| 6 | 降级映射（consent=false/llm=null→LLM_UNAVAILABLE；其余 LLM 失败→LLM_FAILED+LLM_FALLBACK_TO_CLICK；LLM 失败不初始化 SAM；messageKey=`character.degradation.<REASON>`） | **接受（messageKey 格式附 P2-4）** | 前三项与 :421-422（未同意→click+LLM_UNAVAILABLE、零请求）和 :575（LLM 失败/非人→成功 click 结果零语义部件）逐条吻合；LLM 失败路径确实不触碰 SAM（会话在所有降级门之后创建，`orchestration.ts:350`）。messageKey 用 `character.degradation.<REASON>`：§10 :846 "所有 messageKey 形如 character.error/warning.<CODE>" 字面可读作覆盖全部 messageKey，但 LLM_FAILED 等降级原因不是 CharacterErrorCode 成员，套用 error 前缀反而错误——契约歧义，登记 P2-4 由产品主在契约中明确 |
| 7 | modelId 篡改防护＝注册表全字段比对 | **接受** | `manifest.ts:197-216` 对全部 15 字段（含 artifactUrl、sha256、byteLength、全部 tensor 名、licenseId）逐一比对，任何漂移 MODEL_NOT_APPROVED 且不可降级（`onnxBackend.ts:136-139`），强于 :426 "模型 URL 不能由调用者传任意 host" 的最低要求；负例 NEG-1 实证坏哈希 manifest 在任何网络 IO 之前被拒 |

---

## 3. 问题清单

**P0（阻塞移交）**：无。

**P1（RC 整合前必须处置/跟踪）**

- **P1-1** `mergePromptMask` 未导出：契约 §4 :515 声明且 :794 禁止省略，与"语义空白"冲突。处置：产品主补语义→补实现+测试，或契约修订移出 alpha；二选一不得拖到 RC 之后。
- **P1-2** `DEFAULT_CHARACTER_LIMITS.maxModelBytes=40MiB` 与内置 fp32 encoder 134MB 的矛盾悬置：当前以注册表 byteLength 精确相等兜底安全（裁定 3），但模型档位决策时必须一并裁决 limits 与注册表的一致性，并决定是否/如何启用 limits 校验。
- **P1-3** `SamRuntimeOptions.useModelCache` 在公共路径（createOnnxSamBackend 默认后端）实际无效：契约签名未提供通道（裁定 4）。处置：契约 r3 增补通道（如 createOnnxSamBackend(options) 或 backend 可选协议），或契约明示该选项仅约束注入式后端。

**P2（登记，不阻塞）**

- **P2-1** `onnxBackend.ts:374-375` masks 非 Float32Array 时静默回空 mask（EMPTY_MASK warning）而非 INFERENCE_UNAVAILABLE；`:368-373` 多 mask 面选择仅支持 4-D `[1,N,H,W]`，3-D `[N,H,W]` 会取 plane 0 而 predictedIou 取 bestIndex，置信度与蒙版可能不一致。真模型冒烟增量必须覆盖：改报错 + 按真实输出布局校准。
- **P2-2** 模型下载 `response.arrayBuffer()` 无流式字节上限（`manifest.ts:326-331`），content-length 缺失时全量缓冲后才校验字节数；URL 已被注册表钉死（HTTPS、无 userinfo/fragment、15 字段比对）缓解，建议改流式读取+累计上限。
- **P2-3** provider 显式 `"webgpu"` 失败同样回退 WASM 一次（`session.ts:323-324,346`——回退分支不区分 auto 与显式 webgpu）：契约回退语义写在 auto 语境；行为披露充分（info.provider=wasm + warning），建议契约明确显式 webgpu 是否允许降级。
- **P2-4** `character.degradation.<REASON>` 与 §10 :846 messageKey 形态条款的字面冲突（裁定 6）：契约歧义，需产品主明确 SegmentationDegradation.messageKey 形态。
- **P2-5** webgpu 会话创建未设置 `numThreads:1`（`onnxBackend.ts:204-209` 仅 wasm 设置）；`wasmThreads` 运行时选项未写入 ORT env（由 create() 内 numThreads 覆盖实际生效）。契约钉的是 WASM 线程数，现读法可辩护；建议两 provider 统一 numThreads:1 消除歧义。
- **P2-6** 契约 :427 "先按完整 manifest 获取并检查…再尝试 Cache API" 字面顺序与实现（缓存优先，命中与网络同套校验）相悖；按字面顺序（网络先行）缓存将失去意义，且本验收清单定义的顺序即"缓存→网络→字节→SHA-256"。裁定：契约句子为病句，按验收清单语义执行合规；建议契约 r3 改写该句。

**验收费（已履行）**：负例临时文件已删除，工作树恢复洁净（`git status --porcelain` 空）；未 commit 任何文件；未重跑 golden/e2e。

---

## 4. 最终裁决

**PASS**（附 P1-1/P1-2/P1-3 跟踪项移交 RC 整合清单，P2 六项登记不阻塞）。

依据：契约 §3/§4/§5 语义逐项核对通过；根入口纯净性经 grep+双 tsconfig+check-boundaries+check:contract 四重实证；144 用例复跑全绿，验收人独立构造的 4 个受控负例（准入拒绝先于网络、consent=false 零外发、WebGPU→WASM 恰一次重试、双败终态）全部通过且已恢复现场；ORT 用法 fail-closed 面成立，无静默错图路径；7 项登记偏离 7 项接受（其中 3 项附 P1 跟踪、2 项附 P2 歧义登记），无一须在本增量返工。

**结论句：segment/browser 增量独立验收：PASS，移交 RC 整合。**

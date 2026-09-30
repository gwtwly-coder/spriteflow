# segment 核心模块独立验收裁决书（第 1 轮）

- 日期：2026-09-30
- 验收基线：commit `7355afb`（feat(segment): v3 拆部位纯 TS 核心，16 文件 +2745 行），验收时该提交为 HEAD 且工作树干净
- 验收范围：`packages/segment` 契约 §1–§3 根入口纯逻辑（BitMask、五纯函数、DEFAULT 常量、L1 BYOK 交换与修复）；fetch/ORT/SAM 会话/ZIP 导出/`segmentSemantically` 编排属后续增量，不在本轮判定范围
- 对照规格：docs/interface-contract-v3.md 0.2.0-r2 §1（:11-107）、§2（:109-328）、§3（:329-424），及 §4 SamMaskResult、§5 MaskEdit、§10 错误模型
- **身份披露：验收人为生产者之外的同族独立上下文（继承父会话模型，具体型号未确认，不声称异族）。** 生产者回执仅作核对线索，本裁决只依据磁盘提交、代码、测试实测与契约文本。

---

## 一、检查单逐项结论

### 1. 契约语义符合性 — PASS

| 项目 | 证据 | 结论 |
|---|---|---|
| BitMask 打包规范（:111-115） | `src/bitmask.ts:14-101`：`BITMASK_ENCODING="bitset-lsb0-row-major"`；`validateBitMask` 严格校验 `ceil(w*h/8)` 长度（:89-92）与末字节未用高位为 0（:93-99）；`getMaskBit/setMaskBit` LSB-first、row-major（:27-41）。测试 `tests/bitmask.test.ts:26-48` 断言具体字节值（index 0→byte0 bit0=0b0000_0001；index 8,10→byte1=0b0000_0101；跨行 index 5→0b0010_0000），能区分 LSB/MSB 与行/列主序错位 | PASS |
| 五纯函数签名与语义（:229-246） | `src/partAsset.ts:82-288` + `src/bitmask.ts:109-182`。validatePartAsset 校验 id/name/kind/引用(ASSET_MISMATCH)/sourceRect 越界/mask 结构/canvas 尺寸与 (0,0) offset/confidence/visibleFraction；applyMaskEdits 先全量校验后原子应用、`data.slice()` 复制不改输入（:170-175）；removePartAsset `filter` 返回新数组、拒绝未知 ID（:277-288）；createPartAsset 校验 `result.asset === source.ref`（:214-225）、包内生成唯一 ID（:180-193,245）、复制 mask 字节防后续 SAM 原地修改泄漏（:259） | PASS |
| 像素不变量（:246） | `src/partAsset.ts:145-178`：输出 buffer 为 sourceRect 尺寸；mask=1 逐字节复制源 RGBA 全四字节（:163-166，含 alpha，源 alpha=0 仍为 0）；mask=0 输出保持 `new Uint8ClampedArray` 全零。测试 `tests/partAsset.test.ts:151-205` 用逐坐标唯一梯度夹具 + mask=1 覆盖透明源像素（[10,20,30,0]→[10,20,30,0]）+ tight crop 坐标换算断言 | PASS |
| DEFAULT 常量（:71、:224） | `src/defaults.ts:8-28` 两常量 `Object.freeze`。本验收用构建产物直接运行时逐值比对：9 项 limits 与 5 项 options 全部与契约一致（2048/4194304/32/16/120/67108864/41943040/1048576/268435456；32/0.35/0.5/1024/true）；`tests/defaults.test.ts:13-45` 逐值断言 + 冻结断言 | PASS |
| L1 交换与修复（:419-423） | 详见下表 | PASS |

L1 细项：

| 子项 | 证据 | 结论 |
|---|---|---|
| fence 只剥一组 | `src/llm.ts:320-330`：只剥首行 ``` 与最后一个闭合 ```（要求闭合后无正文）；测试 `llm.test.ts:30-46`：单组 fence 通过、前后散文包裹拒绝、闭合后尾随文本拒绝（另见歧义裁定③附注） | PASS |
| schema 校验项齐全 | `src/llm.ts:378-444`：schemaVersion、coordinateSpace、humanoid（boolean/[0,1]/reason 封闭）、部位数 1..maxParts、封闭 PartKind、name 非空、box 整数与半开范围、confidence [0,1]、occluded boolean、kind+name 重复——契约 :419 列举的七类可修复错误全覆盖；错误条目截断至 20×200 字符（:46-47,379-381） | PASS |
| 最多一次修复且修复请求不含图像 | `src/llm.ts:628-647`：仅当首答为 `invalid` 才发修复；修复 user 内容=字段错误摘要+原文截断 2000 字符+指令；schema 经 system prompt 重发。测试 `llm.test.ts:156-189` 断言请求总数=2、serialized 不含 `data:image/png` 与 dataUrl、保留 model/temperature=0/max_tokens/response_format | PASS |
| 二次失败 LLM_INVALID_RESPONSE | `src/llm.ts:652-657`；测试 `llm.test.ts:191-202`（messageKey=`character.error.LLM_INVALID_RESPONSE`、requests=2 无第三次） | PASS |
| 401/403/429/5xx/网络/超时/取消/超限不修复 | `src/llm.ts:486-507`（状态分类先于解析）、:541-549（transport 抛错→分类为 error kind，不进修复）、:537,550,630（取消检查在首请求前后与修复前）、:561-568（超限→error kind）。测试：429（:204-211）、401/403（:213-222）、500/throw/TimeoutError（:224-250）、超限（:252-261）、已取消不发（:263-272，requests=0）、首答后取消不发修复（:274-292，requests=1）——各例均断言请求计数 | PASS |
| userConsent 门 | `src/llm.ts:587-595`：`!== true` 即拒绝（字面量 true 才合法），且先于配置校验；测试 `llm.test.ts:296-317`（false→LLM_CONSENT_REQUIRED、requests=0；consent 缺失+坏配置时仍返回 CONSENT） | PASS |
| 错误对象无 key/dataUrl/未截断 body | `src/errors.ts:18-31`：details 仅 field/provider/modelId/limit/actual/partIds；provider 只取 host 且剥 userinfo、截 128 字符（llm.ts:80-88）。测试 `llm.test.ts:406-430`：序列化错误不含 apiKey、不含 dataUrl、不含 `SECRET_PROVIDER_BODY` 原文（实现根本不携带任何 provider body，严于"截断"要求）、provider="llm.example.com" | PASS |
| config 范围（:421） | `src/llm.ts:31-39,119-176`：timeoutMs 1000..8000 整数、maxResponseBytes 1..1048576 且 ≤limits.maxLlmResponseBytes、maxOutputTokens 128..4096、endpoint ≤2048+HTTPS（localhost 例外）+禁 userinfo/fragment、model 1..128、apiKey 1..4096。测试 `llm.test.ts:319-365` it.each 15 例全否定 + 上下文上限封顶例；options 校验（:229-286）含 maxParts>limits.maxParts→RESOURCE_LIMIT（测试 :367-378） | PASS |
| 修复前不发任何请求 | 首请求前依次通过 cancel/consent/config/assetRef/image/options 校验（:584-604），测试 `llm.test.ts:380-403` 断言坏 mime/dataUrl/像素预算/坏 options 时 requests=0 | PASS |

### 2. 测试有效性 — PASS

- **像素三断言夹具有区分力**：`tests/helpers.ts:52-63` paintGradient 使每个工作坐标 RGB 唯一，任何重采样/坐标错位都会破坏逐字节相等断言；另专门覆盖 mask=1 且源 alpha=0 的像素（partAsset.test.ts:155,184）。
- **修复请求断言真实检查无图像**：`llm.test.ts:172-175` 对整个序列化请求做 `not.toContain("data:image/png")` 与 `not.toContain(LOCATE_IMAGE.dataUrl)`，覆盖 messages 全部字段。
- **错误卫生断言覆盖 key/dataUrl/原文**：见上表；实现"错误从不携带 provider body"，测试断言原文标记串不出现，强于截断验证。
- **不可变性断言**：applyMaskEdits 前后对比输入 data 且验证返回对象/数组非同一引用（bitmask.test.ts:126-159）；removePartAsset 验证原数组长度与内容不变（partAsset.test.ts:279-289）；extractPartPixels 快照源像素（partAsset.test.ts:207-211）。
- **实测复跑**：`pnpm --filter @spriteflow/segment test` → **74 passed (4 文件)**；`pnpm typecheck`、`pnpm build` 退出码 0；根 `pnpm lint`（biome 176 文件 + check-boundaries 30 文件 + pipeline check:contract PASS）、`pnpm typecheck`、`pnpm test:unit`（pipeline+segment+web 全过）退出码均 0。
- **受控负例（2 例，均已恢复原状，`git status` 确认树干净后复跑 74 全绿）**：
  1. 负例 A：`partAsset.ts` 提取循环把 alpha 字节改为常量 255（模拟 alpha 羽化）→ `tests/partAsset.test.ts` "produces a sourceRect-sized buffer honoring the three pixel assertions" **失败（1 failed / 15）**。证明三断言测试能真实拦截像素不变量破坏。已 `git checkout` 恢复。
  2. 负例 B：`llm.ts` 修复请求改传 `initialContent`（重发图像）→ `tests/llm.test.ts` "repairs once: schema + truncated original + error summary, never the image" **失败（1 failed / 37）**。证明"修复不带图像"断言有咬合力。已 `git checkout` 恢复。

### 3. 边界合规 — PASS

- **无 DOM/fetch/AbortSignal**：`grep -rnE "\b(fetch|AbortSignal|AbortController|document|window|navigator|HTMLElement|OffscreenCanvas|Worker)\b" packages/segment/src/ tests/` 全部命中为注释否定句（"no fetch/DOM/AbortSignal"）、`LlmLocateDocument` 等标识符与字符串字面量 "document"，无任何浏览器 API 使用；src tsconfig（`types: []`、lib ES2022）下 build/typecheck 通过。
- **零依赖**：`packages/segment/package.json` 无 `dependencies`/`devDependencies` 字段；M1 类型经 `src/m1.ts` 以 `import type` 相对引用 `../../pipeline/dist/types.js` 声明（注释说明缘由），运行时零解析。
- **未建 packages/rig**：`ls packages/` 仅 pipeline、segment。
- **测试真实运行**：vitest v4.0.18 实际执行 74 用例（本验收复跑两次，含负例恢复后一次）。
- 根门禁 `check-boundaries: OK (30 source files scanned)` 佐证工作区导入规则。

### 4. 类型层抽查 — PASS

- **CharacterStage（契约 :85-105）**：构建产物运行时导出 17 值，与契约逐一对齐（12 个 v3 值 + rig-mapping/pose-sampling/render/adapt/complete 5 个 v3.5 保留值，含注释声明不外发）。
- **PartKind（契约 :116-141）**：运行时导出 24 值，序列与拼写逐一对齐。
- 附带核对：CharacterErrorCode 31 值（含 6 个 v3.5 保留）、CharacterWarningCode 6 值、SegmentationDegradedReason 4 值、V3_CONTRACT_VERSION="3.0.0"、V3_PROTOCOL_VERSION=1，全部一致。
- M1 类型一致性：`packages/pipeline/dist/types.d.ts` 的 AssetRef{assetId,revision}/PixelBuffer{format,colorSpace,alphaMode,data:Uint8ClampedArray}/InputAsset 与 segment 构造/消费字段吻合；`extractPartPixels` 产出完整 PixelBuffer 五字段。

---

## 二、问题清单

无 P0（阻断）、无 P1（应修）。P2（建议）4 项：

| 编号 | 级别 | 位置 | 描述 | 建议 |
|---|---|---|---|---|
| P2-1 | P2 | `packages/segment/src/llm.ts:119-122`（config.endpoint 解引用）、`:178-180`（image.mime 解引用） | `locatePartsWithLlm` 运行时收到 `provider=null` 或 `image=null` 时抛 `TypeError: Cannot read properties of null`（本验收用构建产物实测证实），与契约 :13"不抛未约定异常"精神不符；且同文件 `validateAssetRef`/`validateOptions` 及 `applyMaskEdits` 均有 null 防御，防御口径不一致。TS 签名非空使类型内调用方不受影响，实际风险低 | 下个触点增量补两个顶层 null 守卫返回 INVALID_ARGUMENT，与其他入口对齐 |
| P2-2 | P2 | `packages/segment/src/llm.ts:471-484,541-549` | transport 抛错分支不复查 `context.isCancelled()`，且 `AbortError` 名被归类为 LLM_TIMEOUT——若浏览器 transport 因用户取消而 abort，将报告为超时而非 CANCELLED（契约 :15"取消成功返回 CANCELLED"）。纯逻辑核心自身不 abort，当前测试路径不受影响 | browser transport 增量落地时：catch 分支先查 isCancelled 再分类，AbortError 语义届时一并厘清 |
| P2-3 | P2 | `packages/segment/src/llm.ts:320-330` | `stripSingleCodeFence` 对"仅有开场 fence 行、无闭合"的输入也剥掉开场行（测试 `llm.test.ts:33-36` 显式记录该容忍），略宽于契约"剥离首尾一组 code fence"的字面；因仍要求 JSON.parse 严格成功、不从散文猜字段，无实质风险 | 保留现状可接受；如收紧，删去 `closing === -1` 时的已剥离返回即可，并同步该测试 |
| P2-4 | P2 | `packages/segment/tsconfig.tests.json:3` | 测试 tsconfig `lib` 含 `"DOM"`（测试编译便利），与"根入口无 DOM"的边界无冲突（src tsconfig 无 DOM 且 typecheck/build 通过、grep 无使用），仅记录避免误读 | 无需改动；后续增量可换 `types:["node"]`+去 DOM 使意图更醒目 |

---

## 三、生产者登记 6 项偏离/歧义的逐项裁定

（登记落点：project-state.md 挂起项仅落了②③两项原文；①④⑤来自生产者回执转述，本验收按磁盘代码与契约独立复核后裁定。）

| # | 登记项 | 裁定 | 理由 |
|---|---|---|---|
| ① | 修复请求 schema 经 system prompt 携带，是否满足 :420"只包含 schema+截断原文+错误摘要" | **接受** | 契约约束的是修复请求的信息内容三要素，未规定 message role 分布；实现中修复请求=system(schema 文档)+user(错误摘要+截断原文+指令)，序列化总内容恰为三要素，无图像无多余载荷；测试 `llm.test.ts:180` 显式断言 system prompt 含 schema、`:174-175` 断言无图像。以 system prompt 承载 schema 与首请求结构一致，属合理工程实现，无需修订 |
| ② | 部位数 0 归类为 schema 可修复错误，而非直接 NON_HUMANOID 降级（两条路都落 click mode） | **接受（附 P2 建议，交产品主择机定夺）** | :419 将"部位数"明列为可修复校验项但未定义下限，取 1..maxParts 是合法读法；两条路均不产生伪语义部件、最终都进 click mode，契约硬性要求满足。代价：对真实非人形图，模型正确返回 `non-humanoid + parts:[]` 会被追加一轮付费修复并以 LLM_INVALID_RESPONSE 收场，UI 呈现为"响应非法"而非"黄色非人形提示"。建议向产品主提出契约澄清：`parts:[] 且 humanoid.reason="non-humanoid"` 可直接接受为有效文档（改分类只动 llm.ts 一处+一个测试，成本小）；澄清前维持现状不构成违规 |
| ③ | endpoint 不校验 `/chat/completions` 路径后缀 | **接受（附 P2 建议）** | :421"请求 endpoint 是完整 /chat/completions URL"是对调用方输入形状的描述，未明文要求运行时后缀校验及对应错误分类；严格后缀匹配会误伤携带 query 的合法端点（如 Azure style `?api-version=`），BYOK 场景下 endpoint host 本就要求在同意弹窗向用户展示，误配置可由用户自纠。建议 UI 层做后缀提示而非包内硬校验；维持现状可接受 |
| ④ | maskBounds 对非法 mask 返回 null（签名无错误通道） | **接受** | 契约 :230 签名即 `maskBounds(mask): Rect | null`，无第三种返回；"空"与"非法"在该签名下必然合流。实现选择"非法→null"并在 `bitmask.ts:103-108` 文档注释中明确"需区分时调用方先 validate"，`validatePartAsset` 在调用 maskBounds 前已强制结构校验，无实际混淆路径。属签名强制的合理实现，无需修订 |
| ⑤ | AssetRef.revision 要求整数 ≥0 略严于契约 | **接受** | M1 AssetRef.revision 为 `number`；运行时收紧为整数 ≥0（`llm.ts:215-227`）属防御性输入校验，M1 语义下 revision 本为非负整数版本号，不存在会被误拒的合法资产；仅影响 locatePartsWithLlm 一处入口，不改变类型层。不构成契约偏离 |
| ⑥ | 其他（本验收自行发现） | 见问题清单 P2-1~P2-4 | 四项均 P2，不阻断本轮；P2-1/P2-2 建议随下一个触点增量顺手修复 |

---

## 四、最终裁决

**PASS。**

依据：契约语义符合性（BitMask/五纯函数/像素不变量/常量/L1 全项）、测试有效性（含 2 例受控负例证明关键断言有咬合力）、边界合规（无 DOM/fetch/AbortSignal、零依赖、未建 rig、vitest 实跑）、类型层抽查（CharacterStage 17 值、PartKind 24 值逐值对齐）全部通过；74 用例复跑全绿，segment build/typecheck 与根 lint/typecheck/test:unit 门禁以真实退出码复验通过；未发现任何 P0/P1 问题，4 项 P2 均不阻断。受控负例改动已全部恢复，验收后工作树与基线 7355afb 一致（仅新增本裁决文件）。登记的 6 项偏离/歧义全部裁定为接受，其中②③附改进建议，移交产品主在后续契约修订时择机处理。

**segment 核心模块独立验收：PASS（同族独立上下文验收，型号未确认），移交 RC 整合。**

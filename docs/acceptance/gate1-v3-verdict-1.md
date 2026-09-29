# Gate 1 裁决书（第 1 号）：v3 PRD + 架构 + 契约三文档对齐验收

- 日期：2026-09-29
- 复核基线：commit `666f486`（工作区仅 README.md 有未提交改动，与本次复核对象无关）
- 复核对象：`docs/technical-design-v3.md`、`docs/prd-v3.md`（含 `4329161` 修订）、`docs/architecture-v3.md`（0.2.0-r2，commit `19e7ee1`）、`docs/interface-contract-v3.md`（0.2.0-r2，实际 889 行；任务书所记"738 行"与入库实况不符，以入库为准）、`docs/copy-v3.md`，另抽查 `docs/inspections/v3-golden-precheck-2026-09-29.md` 与 M1 `docs/interface-contract.md` 交叉引用
- **独立性披露**：本复核为同仓新开的独立会话，无生产者（PRD/架构/契约撰写与修订会话）的任何对话上下文，仅依据入库文件内容裁决。复核模型为 GLM 系，与 PRD 修订者同模型家族——按现行运行协议 v3.0 允许，非异族强制。

---

## 一、检查单逐条裁决

### 1. AC-V01~V07 可测性与范围纪律 —— **PASS**

**可测性**：AC-V01～V07 共 29 个场景全部具备完整 Given/When/Then，期望可判定，且关键 UI 断言能与文案表词条精确对上（测试工程师可直接转化为用例）：

- AC-V01（prd-v3.md:118-133）：A 输入边界（≤8192、可解码、不透明占比≤99%）可由预检程序判定；B 拒绝清单逐项枚举（JPG/GIF/APNG/视频/ZIP/多文件/严格>99%）并断言"不出现去底、动图或批量入口"；C 切换确认三步可脚本化。
- AC-V02（prd-v3.md:135-160）：B 的外发告知断言原文与 copy-v3.md:56 `llm.privacy_notice`（"语义定位会把这张图片发送到你配置的 {provider}。"）逐字一致，且"未配置 key 时不产生任何携带图片数据的网络请求"可用网络拦截判定；C 四类失败原因与 copy-v3.md:124-127 四条 `llm.error.*` 一一对应，两个动作按钮与 copy-v3.md:122-123 `parts.fallback.use_click`/`parts.fallback.retry_llm` 对应。
- AC-V03（prd-v3.md:162-182）：A 的 `{size} MB` 与 copy-v3.md:73 `model.downloading` 对应；B 回退提示与 copy-v3.md:75 对应；D 的"重试加载"与 copy-v3.md:79 对应，且场景 C 显式援引 AC-V05 场景 B 作为断言口径（prd-v3.md:177），无悬空定义。
- AC-V04（prd-v3.md:184-204）：四个场景均为可操作的画布交互断言，撤销/重做到边界状态可枚举。
- AC-V05（prd-v3.md:206-226）：A 的 ZIP 结构三件套、PNG 数=部位数、parts.json 字段可程序判定；B/C/D 详见检查单第 2 条；D 的禁用文案与 copy-v3.md:147 `parts.export.disabled_no_parts` 逐字一致。
- AC-V06（prd-v3.md:228-253）：五条异常路径（非人形/无 key/LLM 失败/模型失败/超大图）各有可注入的触发条件与可观察的降级结果。
- AC-V07（prd-v3.md:255-270）：A 数据集枚举、B 全量回归判据、C 录制回放（不真实调用外部 API、不用用户 key）均可由 CI 断言。

**范围纪律**：四支柱（L1 定位/L2 SAM/点击增删/部位导出）之外的能力全部只出现在不做清单或占位标注中——遮挡补全：prd-v3.md:22、326（v3.1）+ AC-V09 仅展示 occluded（prd-v3.md:110）；绑骨/逐帧渲染/骨骼导出：prd-v3.md:23、327-328（v3.5）；蒙版手刷：prd-v3.md:24、329（不进 alpha）。29 个 AC 场景中无一引用 v3.1/v3.5 能力作为验收条件。范围裁决依据（technical-design-v3.md §1/§3，prd-v3.md:5 声明）与 PRD §1.2 范围追踪表逐项可对上。technical-design-v3.md:86 提到的"蒙版手刷兜底工具"仅出现在风险应对（§4），不构成 alpha 范围。

### 2. 像素不变量三断言对齐 —— **PASS**

PRD AC-V05 场景 B（prd-v3.md:216）与契约 extractPartPixels 语义逐条比对：

- **① RGB 逐字节相等**：PRD"每个 alpha>0 像素的 R/G/B 三通道与工作图同坐标像素逐字节相等"；契约 interface-contract-v3.md:244"每个 `alpha>0` 的输出像素必须满足：R/G/B 与工作图同坐标逐字节相等"；:240"mask 为 1 的输出像素 RGBA 逐字节等于 InputAsset 对应源像素"。一致。
- **② alpha 条款（修订后为"蒙版内 alpha 与源相等"）**：PRD 明文"蒙版内像素的 alpha 与工作图同坐标 alpha 相等（契约采用强于'只减不增'的规则：extractPartPixels 对蒙版内像素复制源 RGBA）"；契约明文两处——:240"mask 为 1 的输出像素 RGBA 逐字节等于 InputAsset 对应源像素"、:244"对 mask=1 复制源 RGBA 全四字节……（mask=1 且源 alpha=0 时，alpha 仍为 0）"。即"复制源 RGBA（含 alpha）"的更强规则在契约中是明文，PRD 引述准确。边界情形（mask=1 且源 alpha=0）契约已显式覆盖，PRD ①只对 alpha>0 像素断言 RGB，两者无冲突。
- **③ 蒙版外 alpha=0**：PRD"蒙版外像素 alpha 为 0"；契约 :240"mask 为 0 的输出 RGBA 全零"、:244"每个 mask 位为 0 的像素必须 `alpha=0`"。一致。
- **PNG 编码后解码复验**：两边都写明——PRD"三条断言在部位像素数据生成时与部位 PNG 编码后解码复验时各执行一次，任一不通过即中止导出……不生成下载文件"（prd-v3.md:216）；契约"导出前及 PNG 编码后解码都运行三条像素断言；任一失败即中止且不返回 ZIP"（interface-contract-v3.md:248）及"必须在打包前后通过该校验"（:325）；架构对齐表亦记"编码后 RGBA 三断言"（architecture-v3.md:157）。

遗留一个措辞级差异见问题 #2（断言强度"相等" vs 契约断言函数的拒绝边界"不大于"），不影响本条 PASS 判定。

### 3. 30 秒指标一致性 —— **PASS**

- **门禁口径**：PRD（prd-v3.md:340）"参考桌面设备、本地模型已缓存、已配置可用 key……最长边 ≤2048、部位数 ≤12……从确认上传到部位审校就绪（L1+L2 完成、部位可编辑可导出，不含人工审校时间）P50 ≤30 秒"；架构（architecture-v3.md:110）逐句复述同口径，并显式声明"当前阶段把 30 秒当 PRD 的强制 P50 退出指标；本节预算是尚待实测校准的分段建议，不构成另一种 p95 验收口径"。
- **分解自洽**：架构预算表（architecture-v3.md:112-121）4+3+2+4+10+4+3=30s，其中"最多 12 个 L1 部位框的 SAM mask 推理 10 s"与 PRD"部位数 ≤12"对应；"L1 本地准备 3s"注明"LLM 单次往返单独披露，不计门禁"；"SAM warm 2s"注明"首次冷下载另报，不计门禁"。内存数字复核无误（2048²×4=16MiB、1024²×3×4=12MiB、40MiB=maxModelBytes 41,943,040、0.5MiB/部件 bitset、12 部件 6MiB）。
- **冷下载与 LLM 往返**：两边一致——PRD"单独披露、不计门禁但必须记录"（prd-v3.md:340），架构"按 PRD 单独披露、不计入门禁，但必须另报实耗；同时保存含这些等待的端到端墙钟时间"（architecture-v3.md:110）。
- **双口径落地**：架构 §9 曾就"同名 30 秒口径无法判定"提请 PM 澄清（architecture-v3.md:163）；commit `4329161` 已按该建议将 PRD §8 端到端拆为门禁口径（→审校就绪 P50≤30s）与体验口径（含修正与导出，参考 ≤120s、非门禁、≥3 例记录两口径）（prd-v3.md:346，diff 已核实）。两文档现在实质一致；架构 §9 残留对修订前 PRD 的过时引述，见问题 #1。

### 4. v3.5 隔离 —— **PASS**

- 契约三重占位标注：版本边界"RigSpec/MotionPreset/逐帧渲染章节是 v3.5 预留 API……不属于……v3.0-alpha 的验收范围"（interface-contract-v3.md:9）；§7 引语"本节及第 8–9 节只记录 v3.5 候选接口……当前不得在 `@spriteflow/rig` 发布入口实现或导出"（:625-627）；导出面"第 7–9 节是 v3.5 占位，不是当前 package exports"，根入口仅导出第 1–5 及第 10 节（:791）。枚举级标注：`CharacterStage.RigMapping/PoseSampling/Render/Adapt` 注明"not emitted by v3.0-alpha"（:96-100），rig 相关错误码注明"v3.0-alpha does not emit them"（:826-830）。
- 架构："`@spriteflow/rig`……属于 PRD 明确排除的 v3.5，目录和 API 仅作后续规划，本版本不得实现或进入发布包"（architecture-v3.md:9）、"v3.0-alpha 不创建/发布"（:37）、rig 单测"v3.5 才启用"（:133）、"v3.0-alpha 不导出、不实现"（:145）。
- PRD §7 不做清单（prd-v3.md:322-334）与契约、架构无矛盾；L3 补全为 `NOT_IMPLEMENTED` 占位且"不接受'空成功'或伪造 pixels"（interface-contract-v3.md:623）与 PRD"最多如实展示 occluded，不做任何补全动作"（prd-v3.md:22、326）一致；蒙版手刷在契约中无任何 API（与 PRD 排除一致），且架构明确"不能显示'手动画蒙版'作为现有能力"（architecture-v3.md:106、interface-contract-v3.md:520）。
- 残留问题见 #3：个别 v3.5 语义枚举成员混入 alpha 表面类型且无 reserved 注释。

### 5. 许可审计 —— **PASS**

- **SAM 2.1 来源链**：架构明文"每个导出模型都须独立冻结上游 revision、SHA-256、输入输出张量契约和权重授权证据；任一项未确认就不进入生产 R2 清单"（architecture-v3.md:15）；准入表要求"模型版本、revision、SHA-256 在模型准入时冻结"，并要求保留"revision、checkpoint hash、ONNX 导出命令/环境和导出后 hash"（:76、82）；§3.2 发布门禁按模型 artifact 单行记录并拒绝未确认模型、不允许 URL 配置绕开（:88）；契约 `SamModelManifest` 含 `revision/sha256/licenseId`（interface-contract-v3.md:430-449），下载"模型 hash 未通过一律丢弃并报错"（:425）、"license 不批准……不能降级跳过验证"（:524）。上游 Apache-2.0 声明附引用（architecture-v3.md:15、82）。MobileSAM 权重"仓库代码许可不能自动证明任意镜像权重的分发权"，不纳入默认 R2（:77、82）——风险意识到位。
- **npm 依赖**：`onnxruntime-web` 1.30.0 MIT（唯一新增运行时依赖，仅从 segment/browser 动态加载）、`flatbuffers` Apache-2.0、protobufjs 及全部 `@protobufjs/*` 闭包 BSD-3-Clause、guid-typescript ISC、long Apache-2.0、platform MIT、@types/node+undici-types MIT 逐项列出（architecture-v3.md:54-74）；Transformers.js、LLM SDK、LaMa/SD 显式排除（:73-75、78）；GPL/AGPL/LGPL 及 UNKNOWN/UNLICENSED"零容忍/构建失败"（:51、88）；lockfile 前不伪造子依赖版本、Wave 0 全闭包逐项审计的方法论明确（:51、88）。未发现任何 GPL 传染项。
- **交叉引用核实**：契约默认值标注"沿用 M1 desktop 上限"，`maxArchiveBytes=268,435,456`（256 MiB）与 M1 契约 interface-contract.md:593 的 desktop `maxArchiveBytes=268,435,456` 逐字一致；输入 8192 上限同源（interface-contract.md:593）。

### 6. 非人形降级锚点 —— **PASS**

- **≥1 例且不占配额，四处口径一致**：PRD"另含至少 1 例非人形降级锚点（不占 10 例配额）"（prd-v3.md:260；V-07 prd-v3.md:108）；架构"至少 10 例计入配额的人形立绘，另有至少 1 例独立非人形降级锚点（不占 10 例）"（architecture-v3.md:137；另 :125"不进入 10 例人形配额"、:159 对齐表）；契约"至少 10 例人形和另 1 例不占配额的非人形锚点"（interface-contract-v3.md:886）；已存在的黄金集预检报告同口径（docs/inspections/v3-golden-precheck-2026-09-29.md:31"还差 7 例人形 + 1 例非人形锚点（非人形不占人形配额，PRD 已明文）"）。黄金集规范专项文档尚未建立（属 Wave 0 交付物），现有三处需求定义 + 预检报告一致，无冲突。
- **三类异常路径降级语义互洽**（保留状态、可重试、无需重传、不发携带图片的请求）：
  - **无 key**：PRD AC-V06 场景 B"两条明确路径……全程不产生携带图片数据的网络请求"（prd-v3.md:235-238）；契约"`llmConsent=false` 时 `segmentSemantically` 不得调用 LlmTransport，直接进入 click mode，并返回 `LLM_UNAVAILABLE` degradation"（interface-contract-v3.md:419）、"点击路径不发携带图片的 LLM 网络请求，保留当前 parts/草稿"（:866）。
  - **LLM 失败**：PRD"已上传的图片与已得到的部位（若有）保留，不要求重新上传"（prd-v3.md:240-243）+ AC-V02 场景 C 不静默清空（:147-150）；契约"不生成伪语义部件；返回 `mode="click"` 和相应 degradation"（:421）、"清除本次临时 proposals，保留之前确认的 parts"（:868）、JSON 修复调用"不得再次发送图像"（:417）。架构同口径（architecture-v3.md:106"先前有效部件列表不被部分覆盖"）。
  - **模型失败**：PRD"保持可交互……重试不需要重新上传图片；自动拆件与点击模式均明确标注不可用的原因"（prd-v3.md:179-182、245-248）；契约"保留当前 `InputAsset` 与已确认部件；再次调用 `initialize()` 重试……不要求也不得要求 UI 重新上传"（interface-contract-v3.md:520）、错误表 :872/:874；文案 copy-v3.md:78 `model.required_hint`"自动拆件和点击模式都依赖这个本地模型"支撑 PRD 的"二者依赖同一本地模型"表述。

---

## 二、问题清单

| 编号 | 严重级 | 位置 | 问题描述 | 修复建议 |
|---|---|---|---|---|
| 1 | P2 建议 | architecture-v3.md:161-165（§9"需协调会话转 PM 的 PRD 澄清项"） | 该节引述的是修订前 PRD §8（"端到端……至少 3 例全程计时满足 30 秒口径"），commit `4329161` 已按其建议改为双口径（门禁 30s / 体验 ≤120s 非门禁），但本节未标注"已采纳/已解决"，保留了对 PRD 现状的过时描述，后续读者可能误以为澄清仍悬置。 | 在 §9 两段建议后各加一行采纳记录（如"→ 已由 `4329161` 落地为 §8 双口径 / AC-V05 修订"），或将该节改标题为"已解决澄清项"。 |
| 2 | P2 建议 | prd-v3.md:216 ↔ interface-contract-v3.md:244、325 ↔ architecture-v3.md:139 | alpha 断言强度三种表述：PRD 断言②为"蒙版内 alpha **相等**"；契约 `assertPartPixelInvariant` 的规范检查为"alpha **不大于**源 alpha"（拒绝边界）；架构 §7.2 黄金回归写"alpha 不大于源 alpha"。对 v3.0-alpha 既定管线（extractPartPixels 复制源 RGBA）三者通过/失败结果完全相同，但黄金回归若按架构/契约措辞实现（≤），与 PRD 声明"同一断言进入黄金回归"（相等）存在规范级不一致，给未来"部分 alpha 编辑"变体留下被 ≤ 门禁放行的空间。 | 在 architecture-v3.md §7.2 或契约 §2 加一句："v3.0-alpha 黄金回归按 PRD AC-V05 ②相等口径断言；契约 `assertPartPixelInvariant` 的 ≤ 为通用拒绝边界（架构 §9 已说明部分 alpha 编辑需另行定义）。" |
| 3 | P2 建议 | interface-contract-v3.md:59-60、69（`CharacterLimits.maxMotionFrames/maxRenderPixels`）、:843-844（`CharacterRecoveryAction "edit-rig"/"edit-motion"`） | 个别 v3.5 语义成员存在于 v3.0-alpha 公共表面类型（第 1、10 节）中，且无 reserved 注释——同类的 Stage 枚举成员（:96-100）与错误码（:826-830）均注明"v3.0-alpha 不发"，而这两处没有；又因 :884"实现实际导出字段不得比本文件少"，alpha 实现被强制导出这些 v3.5 语义值，与"第 7–9 节占位不导出"的精神有张力。 | 为上述成员补注释"v3.5 reserved; not used/emitted by v3.0-alpha"，或在 §11 声明其为前向兼容保留值。 |
| 4 | P2 建议 | interface-contract-v3.md:69 | `DEFAULT_CHARACTER_LIMITS` 默认值句末括注"（沿用 M1 desktop 上限）"覆盖面不清：`maxModelBytes/maxLlmResponseBytes/maxParts` 为 v3 新增（M1 无此字段），`maxWorkingDimension=2048` 亦非 M1 `maxDimension=8192`（后者是输入预检上限，见 :15）。严格读会产生"默认值全部沿自 M1"的误解。 | 将括注改为仅限定 `maxArchiveBytes`（如"maxArchiveBytes 沿用 M1 desktop 上限，其余为 v3 新增预算"）。 |

无 P0、无 P1。

---

## 三、最终裁决

六项检查全部 PASS；4 项 P2 均为措辞/文档卫生级，不阻断。三文档在像素不变量、30 秒双口径、v3.5 隔离、许可审计、降级锚点五个要害上已实质对齐；commit `4329161` 对 PRD §8 与 AC-V05 的修订经 diff 核实与架构师结论一一对应。

**Gate 1 裁决：PASS（附 4 项 P2 建议，均不阻断；建议随下一轮文档修订顺手清理），移交产品主确认。**

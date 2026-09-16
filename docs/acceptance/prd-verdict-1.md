# SpriteFlow M1 PRD 验收裁决书（第 1 轮）

- 阶段：PRD 验收（Gate 1 · Wave 1 · PM R1 交付物）
- 轮次：1（docs/acceptance/ 本轮前不存在，为首轮打回；同阶段最多 2 轮打回）
- 日期：2026-09-16
- 验收对象：`docs/prd-m1.md`、`docs/copy-m1.md`
- 对照文档：`docs/technical-design.md`（PRD 自称的事实来源，prd-m1.md:5）、`docs/agent-roles.md`、`docs/architecture-m1.md`、`docs/interface-contract.md`（后两份为并行交付的 Gate 1 基线，用于交叉核对范围一致性）
- 阶段说明：`docs/ui-spec.md` 尚不存在（R2 属 Wave 2），本阶段按检查单不适用

## 裁决：**FAIL**

P0 ×2、P1 ×3、P2 ×2，见第 3 节问题清单。两项 P0 均为"范围裁决缺口"而非文字瑕疵，直接决定 R4/R5 的开工依据与集成验收基准，须 PM 修订后送第 2 轮。

---

## 1. 检查单逐条核对

### 1.1 范围恰好等于技术方案 M1（无蔓延无遗漏）——**不通过（边界未裁决）**

- 技术方案 M1 定义（technical-design.md:272）：骨架、透明底输入、策略 A/B 检测、审校编辑器、Phaser/Godot 导出、黄金集 20 例。PRD §1.2 追踪表（prd-m1.md:29-36）将六项逐一映射到 F-01…F-17，映射完备，无 M2/M3 功能混入（去底、GIF、libGDX/Cocos、批量、pngquant、AI 抠图、Lemon Squeezy 均在 §7 排除，prd-m1.md:338-355）。
- P1 项溯源成立，不属蔓延：F-14←Stage 4 检测参数实时可调（technical-design.md:135-137）；F-15/F-16←§4 审校编辑器（technical-design.md:187-196）；F-17←§5.1 打包细节（technical-design.md:203-209）。
- 不通过的原因：Stage 3 帧规范化（auto-trim、离群标记、画布统一，technical-design.md:127-133）在技术方案中未标注里程碑，PRD 全文未出现 auto-trim/统一画布，而 agent-roles.md:165（R4 交付清单）与 interface-contract.md:121-166、351 已按"实现并默认启用"冻结。PRD §1.1/§7 仅排除了"锚点对齐、尺寸归一、pHash/dHash 重复帧折叠、离群帧产品能力"（prd-m1.md:23、351），管线内部能力与产品暴露能力的边界无人裁决。详见问题 #1、#2 与第 2 节裁决。

### 1.2 每条 P0 有 Given/When/Then 可测标准——**基本通过，3 处影响可测性**

- 13 条 P0（F-01…F-13）在 §5 均有对应 AC 小节，共 27 个场景，全部为 Given/When/Then 结构（prd-m1.md:113-279）。
- 抽查可测性成立：AC-F03/F04 的"帧数精确、IoU>0.9"可直接转测试（prd-m1.md:147-169）；AC-F01 场景 A 的全量网络拦截可测（prd-m1.md:115-118）；AC-F12 三场景与文案表、契约内存规则互证一致（prd-m1.md:252-267）。
- 不可测/矛盾点：AC-F02 场景 A 透明判定与事实源冲突（问题 #3）；AC-F13 要求黄金集覆盖"粘连"但无 AC 定义粘连期望行为（问题 #5）；AC-F09 缺帧内容语义断言（问题 #2）。

### 1.3 用户故事与目标画像一致——**通过**

US-01（规整表→Phaser，prd-m1.md:60-66）、US-02（AI 散排图→Godot，prd-m1.md:68-74）、US-03（低置信度→手动兜底，prd-m1.md:76-82）分别覆盖画像三类典型输入（prd-m1.md:46）并命中核心痛点（prd-m1.md:48）；US-02"外部工具去背景"与 M1 不做去底一致；隐私诉求（prd-m1.md:49）由 F-01/AC-F01 场景 A 落实。

### 1.4 异常分支（降级/超大图/内存）有交代——**通过**

§6.3 A-E 五类分支齐备（prd-m1.md:305-336）：检测低置信度降级、超大图（>8192 预检停止+降采样/取消）、内存不足（预检+运行时两段）、不支持/非透明/损坏文件、导出失败/下载被阻止；与 AC-F05（prd-m1.md:171-186）、AC-F12（prd-m1.md:252-267）及 copy-m1.md §5/§7/§13 相互印证。

### 1.5 文案表覆盖全部界面状态且双语——**通过（覆盖完整、全表双语），1 处状态分类与 PRD 冲突**

copy-m1.md 15 个分区与 PRD §6.1 六大区域（prd-m1.md:285-292）逐一对得上；§16 状态核对表（copy-m1.md:283-300）自证覆盖；每行均有中文与 English 两列。唯一矛盾：全透明"空图"被归入"上传与预检错误"（copy-m1.md:63-64），与 PRD AC-F05 场景 B"空图必须降级进手动网格"（prd-m1.md:179-181）冲突，见问题 #4。

---

## 2. 补充审查要点裁决（协调会话预审发现）

### 要点 1：管线内部能力与产品暴露能力的边界——**裁决：PRD 必须补写边界条款，不应裁决为"M1 管线完全不实现"**

证据链：

- PRD 侧：prd-m1.md:22（"尺寸聚类不作为 M1 的独立用户能力"——PRD 已有"内部/用户能力"的区分模式，但仅用于聚类一处）、:23（M1 不含锚点对齐/尺寸归一）、:351（不做 pHash/dHash 折叠、"离群帧产品能力"及其批量属性）。
- 下游侧：agent-roles.md:165 R4 交付清单明确要求"帧规范化：auto-trim、pHash 计算、离群帧标记、画布统一"；interface-contract.md:94-108 的 Frame 含 pHash/flags.outlier，:164 明确"M1 计算 dhash64-v1 元数据；不做自动去重"，:162 定义离群标记规则；architecture-m1.md:18-20 已按"内部元数据、不做产品能力"定版，:349（§9.4）自认这是待 Gate 1 对齐项。
- 冲突实质：PRD 字面排除"离群帧产品能力"，而 interface-contract.md:635 要求 OUTLIER_FRAMES/MULTIPLE_COMPONENTS/EMPTY_FRAMES 以"帧角标与筛选项"呈现到 UI——角标/筛选是用户可见的产品能力，PRD 功能清单与文案表对它零覆盖；反向若按 PRD 字面禁止，则契约 §8 与 R4 提示词越界。两处对 M1 管线范围的表述不一致属实，须裁决。

裁决理由：契约已作为 Gate 1 基线交付，其 pHash/outlier/merged 类型是产品主明确要求（architecture-m1.md:349 记录在案）；QA 黄金集断言（agent-roles.md:216 ground-truth 含 flags）依赖管线计算这些元数据。退回"完全不实现"将迫使契约 major 修订并重写 R4 提示词，成本高且无产品收益。正确路径是 PRD 补写边界：

1. §1.1 增设"管线内部能力与产品暴露能力边界"条款：M1 管线内部计算 dHash、离群/多组件/空帧标记、auto-trim、统一逻辑画布（服务黄金集断言与导出质量，不是用户功能）；产品暴露面维持不做：重复帧折叠、离群自动排除、批量锚点/缩放。
2. 必须二选一裁决"帧角标与筛选项"（interface-contract.md:635）是否属于 M1 UI：若属于，PRD 补功能行与 AC、copy-m1.md 补词条；若不属于，回改 interface-contract.md §8 该行与 agent-roles.md:165 的表述。该项不能悬空给 R5 自行决定。

### 要点 2：帧框语义（所见即所得 vs auto-trim）——**裁决：PRD 必须定义帧框语义并指定 auto-trim 里程碑归属；推荐采纳契约已冻结的语义**

证据链：

- PRD 侧：F-06/F-07 只定义帧框的显示与编辑；F-09"将审校后的帧打包成图集"（prd-m1.md:98）；AC-F09 只断言"不重叠、≥2px padding、1px extrude、坐标与实际像素区域一致"（prd-m1.md:224-229）——通篇未回答审校框是"所见即所得的导出区域"还是"打包时裁到内容紧框"；§7 不做清单亦未提及 auto-trim。
- 技术方案侧："Auto-trim：每帧裁到内容 bbox + 可配置 padding"位于 §3.2 Stage 3（technical-design.md:127-133；预审材料所称"3.4"不存在，技术方案章节号从 3.3 直接跳至 3.5——此悬空引用移交协调会话修正，不计入 PRD 问题清单）；M3 行只列"锚点对齐/尺寸归一/pHash 去重"（technical-design.md:274），auto-trim/离群标记/画布统然的里程碑归属悬空。
- 契约侧（已冻结）：NormalizeOptions.trim 默认 true、canvasMode 默认 uniform（interface-contract.md:152、154）；"默认图集只存 bbox 内容；sourceSize 为逻辑 canvas 宽高，spriteSourceSize 记录 offset"（interface-contract.md:351）；PNG 序列保留画布透明边（interface-contract.md:479）。即"导出物≠用户所画之框"，属用户可感知的产品语义，已由架构侧单方面选定。

裁决理由：R4/R5 以契约为开工依据，PRD 是集成验收的验收依据；PRD 若不补此语义，集成阶段对"导出对不对"没有裁决基准。推荐采纳契约语义（trim 到内容 bbox + 统一逻辑画布，与 TexturePacker 类工具默认行为一致、服务"引擎就绪"定位），在 §1.1 明确 auto-trim/统一逻辑画布属 M1，并在 F-09/AC-F09 补断言。若产品主坚持所见即所得（trim=false），则 interface-contract.md 默认值须由架构师按契约变更流程修订。二择其一，不得继续沉默。

---

## 3. 问题清单

| 编号 | 严重级 | 位置 | 问题描述 | 修复建议 |
|---|---|---|---|---|
| 1 | P0 | prd-m1.md:18-25、351 ↔ agent-roles.md:165、interface-contract.md:94-108/635、architecture-m1.md:18-20 | 管线内部能力与产品暴露能力边界未裁决：PRD 排除"离群帧产品能力"等，但 R4 交付清单与接口契约要求实现 pHash 计算、离群/粘连标记、画布统一，且契约 §8 进一步要求离群/多组件/空帧以"帧角标与筛选项"暴露到 UI——该暴露面在 PRD 功能清单与文案表中均无对应，两种读法互相矛盾。 | 按第 2 节要点 1 补写边界条款；同步裁决角标/筛选是否入 M1 UI：入则 PRD 补功能行+AC、copy-m1.md 补词条；不入则回改契约 §8 与 R4 提示词。 |
| 2 | P0 | prd-m1.md:98、224-229（F-09/AC-F09）↔ technical-design.md:127-133、274、interface-contract.md:152-154、351、479 | 帧框语义未定义：审校框是所见即所得的导出区域，还是打包时 auto-trim 到内容 bbox，PRD 全文未裁决；auto-trim/统一画布的里程碑归属在技术方案中悬空，契约已按 trim=true+uniform 冻结。 | §1.1 明确 auto-trim/统一逻辑画布属 M1；F-09/AC-F09 补断言（导出帧内容=审校框内非透明紧框、spriteSourceSize/offset 如实记录、预览所见与导出所得一致）。若产品主选所见即所得，须回改契约默认值。 |
| 3 | P1 | prd-m1.md:128（AC-F02 场景 A）↔ technical-design.md:86、interface-contract.md:639 | 透明判定两套标准：PRD"含至少一个非完全不透明像素即可"，技术方案/契约"完全不透明占比>99% 判不透明"。99%~100% 不透明区间的同一图片两文档结论相反，黄金集与 E2E 无法落笔。 | PRD 以技术方案为事实来源（prd-m1.md:5），建议 AC-F02 改用 99% 阈值并说明临界样例；如产品上要更严，须显式声明覆盖技术方案并同步契约。 |
| 4 | P1 | prd-m1.md:179-181（AC-F05 场景 B）↔ copy-m1.md:63-64 | 全透明"空图"状态分类矛盾：PRD 规定预检放行、检测降级进手动网格（契约 :300 同此，返回 1 个待确认空帧）；文案表将其归入"上传与预检错误"，主行动是"换一张"。R6 黄金清单含"空图/全透明（考降级）"，会得到两种矛盾的界面实现。 | PRD 明确空图走检测降级路径（EMPTY_INPUT→降级横幅+手动网格）；copy-m1.md 将 error.empty_image 移出预检错误分区或改写为降级说明。 |
| 5 | P1 | prd-m1.md:274（AC-F13 场景 A） | 要求黄金集覆盖"粘连"，但全部 P0 AC 无一条定义粘连样例的期望行为（保留单帧？标记？拆分？）。契约已自行定为"multipleComponents 标记+保留单帧交人工"（interface-contract.md:289），PRD 层面缺可测依据。 | 补粘连行为 AC（建议并入 F-03 或 F-05）：网格 cell 内出现≥2 个有效连通域时保留单一候选帧并标记待复核，不擅自拆分、不静默丢弃。 |
| 6 | P2 | prd-m1.md:243 ↔ interface-contract.md:166、architecture-m1.md:348 | 重排后帧名语义含糊：PRD"按审校顺序使用 frame_000…"字面可读作按最终顺序重命名；契约规定"重排不自动重命名"（保动画引用稳定）。 | 建议采纳契约语义，将 243 行措辞改为"按检测初序命名，重排只改顺序不改名"。 |
| 7 | P2 | prd-m1.md:349（§7）↔ interface-contract.md:360-366、architecture-m1.md:346 | 契约按产品主要求提供 5 种导出格式（含 png-sequence-zip/generic-json），PRD §7"通用 JSON…不做"未区分"用户界面能力"与"管线 API 能力"，集成阶段易被误判为越界。 | §7 或 §1.1 注明：M1 UI 仅暴露 Phaser×2/Godot；管线 API 另含 png-sequence-zip/generic-json，不作为 M1 用户功能验收对象。 |

---

## 4. 结论与流程说明

- 裁决：**FAIL**。修复 #1、#2 两项 P0 后送第 2 轮；#3-#7 建议一并修复。
- 本轮已判通过的项（范围映射表、用户故事、异常分支、文案双语覆盖）下一轮不重审，除非修订引入新问题。
- 打回计数：PRD 验收第 1/2 轮打回。若第 2 轮仍存在 P0，按规则升级产品主人工裁决。
- 本裁决书未改动任何被审文件；验收官与生产者为不同会话。

# SpriteFlow M1 PRD 验收裁决书（第 2 轮）

- 阶段：PRD 验收（Gate 1 · Wave 1 · PM R1 交付物）
- 轮次：2（复审第 1 轮 7 条问题清单，见 [prd-verdict-1.md](./prd-verdict-1.md)）
- 日期：2026-09-16
- 验收对象：`docs/prd-m1.md`（v1.1，Gate 1 第 1 轮修订）、`docs/copy-m1.md`
- 交叉核对：`docs/technical-design.md`、`docs/interface-contract.md`（r2 候选稿）、`docs/architecture-m1.md`（r2）、`docs/agent-roles.md`（r2）
- **裁决：PASS**（7/7 条问题已解决；修复引入 1 条 P2 建议，不阻断）

---

## 1. 第 1 轮问题逐项验证

### #1（P0）管线内部能力与产品暴露能力边界 —— **已解决**

| 验证点 | 证据 |
|---|---|
| 边界条款落笔 | prd-m1.md:23（管线内部执行 auto-trim、统一逻辑画布、dHash、离群/多组件/空帧/合并来源/已编辑标记；不自动删除、折叠、缩放、修复）；prd-m1.md:24（UI 暴露三角标+筛选、确认后可导出；折叠/自动排除/锚点/主体缩放/批量属性不做） |
| 角标裁决落地（选了"入 M1 UI"） | 新增 P0 功能 F-18（prd-m1.md:106）与 AC-F18 三场景（prd-m1.md:339-363：角标显示、筛选只影响显示、确认不自动处理）；1.2 追踪表将 F-18 挂入"策略 A/B 检测"与"审校编辑器"两行（prd-m1.md:36-37） |
| 文案表同步 | copy-m1.md:160-173 新增 review.attention/badge/filter/pending/confirmed 词条；copy-m1.md:146 tool.confirm_review；copy-m1.md:133-134 editor.normalized_preview；copy-m1.md:244-246 export.review_required.*；§16 状态表同步（copy-m1.md:308-316） |
| 契约对齐（反向确认） | interface-contract.md:645（OUTLIER_FRAMES 行明确"按当前PRD F-18显示'尺寸异常'角标与筛选"）；interface-contract.md:648（角标可叠加、筛选集、OR 语义、确认保留 flags、REVIEW_REQUIRED 拦截、引用 review.*/export.review_required.* 词条——与 PRD AC-F18 逐点一致） |
| 下游交接 | agent-roles.md R2 提示词新增"Gate 1 r2 交接"条目（承接角标/筛选/确认审校到 ui-spec） |

裁定说明：F-18 是第 1 轮裁决书给出的合法路径（"若属于，PRD 补功能行与 AC"）的落地，且可溯源至技术方案"离群帧必须被算法发现并标记——体验的及格线"（technical-design.md:132）与风险表（technical-design.md:288）；契约 §8 本就要求该 UI 呈现。四方文档（PRD/文案/契约/角色手册）已一致，不构成范围蔓延。

### #2（P0）帧框语义（auto-trim 里程碑归属）—— **已解决**

| 验证点 | 证据 |
|---|---|
| 语义定义 | prd-m1.md:25：`sourceRect` 为用户编辑框、`bbox` 为框内 alpha 阈值内容紧框、图集默认只存 bbox 不缩放、统一逻辑画布经 `sourceSize`/`spriteSourceSize`/offset 保留留边与位置、Godot 序列输出完整逻辑画布、预览同画布——与 interface-contract.md:142-144（Frame 语义）、:357（图集只存 bbox、空帧 1×1 占位）一致 |
| 里程碑归属 | prd-m1.md:23 明确 auto-trim/统一逻辑画布属 M1 管线内部能力 |
| 功能行更新 | F-09 改名"帧规范化与图集打包基础能力"并写入 auto-trim+统一画布+不缩放主体（prd-m1.md:101） |
| 可测断言 | AC-F09 场景 A/B/C（prd-m1.md:257-278：bbox=内容紧框、1:1 不缩放、统一画布、offset/sourceSize/spriteSourceSize 如实记录、预览与导出一致、相邻 allocation ≥2px、extrude 1px、空帧 1×1 占位不删帧）——与 interface-contract.md:353-357 一致 |
| 序列导出语义 | AC-F11 场景 A（prd-m1.md:300：每张 PNG 尺寸=统一逻辑画布、bbox 按规范化预览 offset 放置）——与 interface-contract.md:485（PNG 序列=完整 Frame.canvas）一致 |
| 预览一致性 | 主流程步骤 6（prd-m1.md:385）+ copy-m1.md:133-134 |

### #3（P1）透明判定阈值 —— **已解决**

prd-m1.md:21（合法输入=完全不透明占比≤99%）、AC-F02 场景 A/C（prd-m1.md:132、143：严格大于 99% 拒绝）、新增边界场景 D（prd-m1.md:148-154：恰好 99% 放行、略高拒绝、用未四舍五入原始占比）——与 technical-design.md:86、interface-contract.md:652（严格大于 0.99 拒绝、等于 0.99 允许）三文一致；copy-m1.md:59-60 的 error.opaque 词条同步为 >99% 口径。

### #4（P1）全透明空图状态分类 —— **已解决**

AC-F05 新增场景 D（prd-m1.md:211-217）：全透明输入以 `EMPTY_INPUT` 成功降级、显示持续降级提示、生成 1 个待确认空帧、明确"不当作上传错误或检测异常"——与 interface-contract.md:304、:652 一致；copy-m1.md 已从 §4 删除 error.empty_image，新增 §7 的 fallback.empty_input.*（copy-m1.md:115-116），§16 状态表将"全透明降级"归入第 7 节（copy-m1.md:310）。

### #5（P1）粘连期望行为 AC —— **已解决**

AC-F03 新增场景 C（prd-m1.md:174-180）：网格 cell 内 ≥2 个达有效面积阈值的连通域时保留单一候选帧、标"可能粘连"、保持待确认、不自动拆分、不静默丢弃——与 interface-contract.md:293（multipleComponents=true、保留一个 cell 帧交人工审校、不擅自拆分）一致；配套地，AC-F13 场景 A/B 增加"期望 flags"断言（prd-m1.md:332、337），§8 指标同步（prd-m1.md:448）。

### #6（P2）重排后帧名语义 —— **已解决**

prd-m1.md:292：按检测初始顺序命名稳定帧名，"时间轴重排只改变播放和导出顺序，不自动重命名既有帧"——与 interface-contract.md:166 一致。

### #7（P2）管线 API 五格式与 PRD"不做"表述 —— **已解决**

prd-m1.md:27（UI 只暴露三个导出入口；管线 API 可提供 PNG 序列 ZIP/通用 JSON，非 M1 用户功能或 UI 验收对象）；§7 同步改写（prd-m1.md:433）。

---

## 2. 修复是否引入新问题

逐项扫描修订面（prd-m1.md §1.1/§1.2/§4/§5/§6/§7/§8，copy-m1.md §4/§7/§8/§12/§16）及同期契约 r2、agent-roles r2 的交叉影响：

1. **契约 r2 的其余变更与 PRD 无冲突**：heuristic 缩为 max-edge/max-area（interface-contract.md:320、353）——PRD F-17 未暴露该参数；新增 release-asset 恢复动作（:594-597、641、828）——属 Worker 生命周期机制，PRD 层"换一张图"已有确认对话框（copy-m1.md §11）；帧名禁用保留字扩展（:355）不影响 frame_000 序列命名。
2. **内部一致性抽查通过**：99% 口径在 prd-m1.md:21/132/143/150 四处自洽；"确认审校"链路（F-18→AC-F18 场景 C→6.3.A.4 prd-m1.md:396→copy export.review_required→契约 REVIEW_REQUIRED :355/:634）闭环；F-10/F-11 产物清单（animations.json、sequence.json、README.txt）与契约 :449、:485 一致；§7 排除清单与 1.1 边界条款无互相矛盾。
3. **发现 1 条 P2（建议，不阻断）**：见下表。

| 编号 | 严重级 | 位置 | 问题描述 | 修复建议 |
|---|---|---|---|---|
| R2-1 | P2 | prd-m1.md:332（AC-F13 场景 A） | 覆盖清单新增的"空帧"指代不明：若指整图全透明输入，则与同句"必须降级的失败输入"重复列举（architecture-m1.md §6.2 配额中的"全透明1"即此类）；若指图内单帧无内容（empty flag + 图集 1×1 占位，AC-F09 场景 C 需要夹具），则 architecture-m1.md §6.2 的 20 例固定配额中无此类别，R6 落地时类别与 20 例总数无法同时满足。 | PM 一句话澄清"空帧"含义；若为图内空帧，请协调架构师在 §6.2 配额内换入 1 例（如以"散排3"中 1 例带空帧），保持 20 例总数不变。 |

非问题观察（不需要修改，备案）：AC-F02/AC-F03/AC-F05/AC-F09/AC-F11/AC-F18 的 Given/When/Then 之间因插入空行产生段落间距，渲染与语义均不受影响；1.1:26 旧措辞"不包含实验性 .tres 直出"与 F-11 新措辞"不在 Web 端直出 .tres"并存但语义一致（均排除 Web 端生成 .tres，用户侧脚本生成不受影响）。

另：本轮工作区中 agent-roles.md（所有权表/R7 集成人/R2 交接）与 .gitignore 的改动属架构验收（architecture-verdict-1.md）问题清单的修复，不在本清单范围内；经交叉检查与 PRD 修订无冲突。

---

## 3. 结论

- **裁决：PASS**。第 1 轮 7 条问题（P0×2、P1×3、P2×2）全部验证解决，修复质量高：PRD、文案表、接口契约、角色手册四方对新增边界（角标/筛选/确认、帧框语义、透明阈值、空图降级）表述一致，未发现引入 P0/P1 级新问题。
- 遗留 1 条 P2 建议（R2-1，黄金集"空帧"类别澄清），不阻断 Gate 1；建议 PM 在 R6 开工前顺手澄清，避免黄金集配额返工。
- 按流程：PRD 验收通过，两轮用尽前闭合。最终合并与否由产品主拍板（agent-roles.md §3）。
- 本裁决书未改动任何被审文件；验收官与生产者为不同会话。

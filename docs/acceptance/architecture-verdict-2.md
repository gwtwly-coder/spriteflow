# 架构验收裁决书（第 2 轮）

> 阶段：架构验收（Gate 1：架构 + 契约 + 许可审计），第 2 轮复审
> 验收官：R9（独立会话，与生产者 R3 异会话）
> 日期：2026-09-16
> 验收对象：`docs/architecture-m1.md`（1.0.0-r2）、`docs/interface-contract.md`（目标契约 1.0.0，文档修订 r2），及其整改配套 `docs/agent-roles.md`、`.gitignore`、关联文档 `docs/prd-m1.md`（v1.1）、`docs/copy-m1.md`
> 上轮裁决：[architecture-verdict-1.md](./architecture-verdict-1.md)（FAIL，5 项问题）
> 复审范围约定：按上轮结论「复审仅核验问题清单整改，无需全量重查」执行；同时对整改新增内容做了独立外部核验与一致性扫描，防止修复引入新问题。

## 裁决：PASS

第 1 轮 5 项问题（P1×3、P2×2）全部验证解决，且附带的跨文档同步（PRD v1.1、copy 词条、R2 交接）形成闭环。整改未引入新问题；整改中新增的两处对第三方库行为的规范性声明，本轮验收官已对照库源码独立验证为**正确**。遗留事项均属后续 Gate 职责，已在文档中自我声明边界，不构成本阶段缺陷。

---

## 一、逐项整改核验

### 问题 1（P1）：仓库写权限模糊地带 —— 已解决

- `agent-roles.md:52`：所有权表 R7 行改为「DevOps / 唯一集成人 (R7)」，独占维护根 `package.json`、`pnpm-workspace.yaml`、`pnpm-lock.yaml`、`tsconfig.base.json`、`biome.json`、`.npmrc`、`README.md`、`.gitignore` 及 `docs/devops.md`——上轮指出的全部无主路径（含架构文档未点名的 `docs/devops.md`）均有归属。
- `agent-roles.md:55`：新增「产品主」行，拥有 `docs/technical-design.md`、`docs/agent-roles.md`——上轮指出的技术方案无主问题一并解决。
- `agent-roles.md:57`：边界说明——根级只授权列明路径、R7 不得改业务目录、其他角色走变更申请。
- `agent-roles.md:38` + `:250`：R7 根级初始化前置到 Wave 2 开工前，并写入 R7 职责第 5 条；单人改写 lockfile 规则明确。
- `architecture-m1.md:91-93`：§2 所有权段落与角色表互相引用、内容一致，原「没有责任人/待 Gate 1 裁决」表述已被「已落实到角色所有权表，不再作为待裁决建议」取代。
- 核验方式：逐文件比对两份文档的归属清单，无冲突、无遗漏、无新增无主路径。

### 问题 2（P1）：离群标记与 PRD 范围冲突（补充审查要点 2）—— 已解决（走方案 b，裁决链完整）

上轮要求二选一：(a) 契约标注「M1 不暴露」或 (b) 产品主裁决纳入 M1 并同步修订 PRD/copy/ui-spec。本轮实际走方案 (b)，四份文档同步到位：

1. **裁决出处**：并行的 PRD 验收官独立发现同一冲突（[prd-verdict-1.md](./prd-verdict-1.md) 要点 1，要求「必须二选一裁决，不能悬空」），PM 修订 PRD 至 v1.1 选择「纳入」。范围变更有据可查，非生产者单方拍板。
2. **PRD v1.1**：新增 F-18（P0，`prd-m1.md:106`）「待复核标记、筛选与确认」及 AC-F18 三场景（`prd-m1.md:339` 起：三角标可叠加、按标记筛选仅影响显示、确认不自动处理）；§1.1 补写管线内部能力与产品暴露能力边界（`prd-m1.md:23`：内部执行 auto-trim/dHash/flags，「不自动删除、折叠、缩放或修复帧」）；不做清单改写为「锚点/质心对齐、主体尺寸缩放、pHash/dHash 重复帧折叠、离群帧自动排除或自动修复…M1 只计算 dHash 和复核标记并显示角标/筛选」（`prd-m1.md:435`）。上轮的冲突源（原 :351「离群帧产品能力不做」与契约角标要求互相矛盾）已消除。
3. **契约 r2**：§8 警告表 OUTLIER_FRAMES 单列（`interface-contract.md:645`），并新增自含显示规则段（`interface-contract.md:648`）：三角标可同时出现、五类筛选、「全部待复核」=三 flags 逻辑或且与 reviewStatus 独立、筛选只影响显示、确认置 accepted 且**保留** flags 与角标、未确认走 REVIEW_REQUIRED；明确 dHash 元数据与 duplicateOf 仍仅是数据通道（无 hash 数值展示、无折叠）——pHash 部分延续上轮已达标的标注。
4. **copy-m1.md**：补齐全部所需双语词条（`copy-m1.md:160-175` 区间与 `:243-245`）：`review.badge.outlier/multiple_components/empty`、`review.filter.all/attention/outlier/multiple_components/empty/none`、`review.pending/confirmed`、`export.review_required.title/body/action`、`tool.confirm_review`。验收官机械核对契约/架构引用的 17 个键名：17/17 存在。
5. **ui-spec 交接**：ui-spec.md 属 Wave 2 尚不存在；承接要求已写入 R2 角色提示词（`agent-roles.md:125`「Gate 1 r2 交接」）与架构 §9 交接表（`architecture-m1.md:359-365`），并声明为 UI 验收必查项。延迟合理，闭环机制在案。
- PRD/AC-F18 与契约 :648 规则逐条比对一致（角标叠加、筛选语义、确认保留 flags、REVIEW_REQUIRED 门槛）。PRD 侧本身的最终裁决归 PRD 验收第 2 轮（尚未运行），不影响本阶段「架构与契约冲突已消除」的结论。

### 问题 3（P1）：fill-width 映射事实错误 —— 已解决，且修复经独立源码核验为正确

- `interface-contract.md:320`：`heuristic: "max-edge" | "max-area"`，`fill-width` 已从联合类型删除。
- `interface-contract.md:353`：映射句改写——「max-edge 映射 `PACKING_LOGIC.MAX_EDGE`（1），max-area 映射 `PACKING_LOGIC.MAX_AREA`（0）。实现须使用具名枚举，不把任意数字强转成枚举；M1 不提供 fill-width，传入该字符串应返回 INVALID_ARGUMENT，details.field="options.heuristic"」，并附两处 v2.7.3 源码链接。与上轮验收官实测的库事实完全一致。
- `interface-contract.md:361`（新增细则）：两启发式各自的确定性排序（最长边/面积降序 + frameId 平局）、「管线先排序、逐个调用 packer.add、不再调用会重新排序的 addArray/repack」。**验收官本轮独立核验**：v2.7.3 `src/maxrects-packer.ts` 中 `addArray` 确实按 `options.logic` 排序（`add()` 不排）；`src/maxrects-bin.ts` 的 `findNode()` 评分确实按 `options.logic === PACKING_LOGIC.MAX_AREA` 分支（面积残差 vs 短边残差）——「把所选具名 logic 传给 packer 用于放置评分」的表述**正确**。该结论同时消除了上轮修复说明中「logic 仅影响排序」的潜在误读。
- 配套：架构决策表更正（`architecture-m1.md:21`「仅有 MAX_EDGE=1、MAX_AREA=0…删除未实现的 fill-width」）；单测清单更新（`architecture-m1.md:224`）；整改索引（`architecture-m1.md:377`）记录「以实际采用版本的类型声明/源码为准，不以 README 为准」的教训固化。
- 残留扫描：全仓 `fill-width` 仅存在于拒绝规则、负例测试要求与修订记录语境，无残留合法值引用。

### 问题 4（P2）：BUSY 语义复用 —— 已解决

- `interface-contract.md:597`：`RecoveryAction` 新增 `"release-asset"`。
- `interface-contract.md:640-641`：§8 表拆分为两行——`BUSY, details.field="task"`（任务运行中，retry）与 `BUSY, details.field="asset"`（空闲但持有旧资产，`["release-asset","retry"]`），恢复路径指向明确。
- `interface-contract.md:826、828`：§9.2 明确「运行任务检查优先于旧资产检查」；asset 变体的 stage/recoverable/details 完整定义，并补齐 UI 操作顺序（先完成更换文件确认→以**当前已加载** AssetRef 调 release→等待成功→重试 load；不得用新文件 ref 释放旧资产；transfer 后须从 File 重建 buffer）。
- 配套：生命周期单测要求同步更新（`architecture-m1.md:226`：BUSY 两种 field、释放旧 ref 而非新 ref、缓冲重建、检查优先级）。

### 问题 5（P2）：.gitignore 缺 reports 规则 —— 已解决

- `.gitignore:5` 新增 `tests/golden/reports/`。
- 验收官独立实测 `git check-ignore -v`：`tests/golden/reports/junit.json`、`reports/overlay.png` 命中规则；`tests/golden/cases/g01/input.png`、`ground-truth.json` 不被忽略（保持跟踪）。规则效果与架构 `architecture-m1.md:93` 的声明一致。

## 二、整改是否引入新问题 —— 未发现

本轮针对性扫描与核验：

1. **契约 r2 全文重读**（对照第 1 轮版本逐节比对）：除上述四处修复及 §12 修订记录（`interface-contract.md:974-981`，版本卫生正确：r2 完整替代候选稿、目标契约版本/协议不变、明示尚未冻结）外，其余章节（类型、检测、导出、Worker 协议、示例）未变；自足性不受影响。
2. **新增外部声明核验**：上表问题 3 中两处库行为声明均经源码实测确认；Phaser 3.90 旋转语义（第 1 轮已验）未改动。
3. **许可审计完整性**：附录 A 仍为 213 行、附录 B 163 条（含表头 164），与 r1 逐字一致（`architecture-m1.md:388` 自称一致，验收官重新清点核实）；GPL 家族扫描零命中；本轮未新增/升级任何依赖。
4. **跨文档一致性**：契约 :645-648 ↔ PRD F-18/AC-F18 ↔ copy 词条 ↔ agent-roles R2 交接 ↔ 架构 §9 交接表，五处描述同一规则集，逐条比对无矛盾；PRD v1.1 同时把上轮「跨文档对齐事项」两条（99% 不透明阈值 `prd-m1.md:21、132`；五格式 UI 边界 `prd-m1.md:27`）一并消解。
5. **越界写问题**：本轮 R3 实际修改了 `agent-roles.md` 与根 `.gitignore`（超出其常规两文档所有权）。该操作有产品主明确指示并在三处书面披露授权依据（`agent-roles.md:57`、`architecture-m1.md:26`、契约 §12），且修订内容正是把这两个路径的所有权落盘。属授权例外而非静默越界，予以接受；提示今后此类修订仍应尽量由所有权人行文，或沿用本次「指示留痕」方式。
6. 生产者自查记录（`architecture-m1.md:383-390`，含 TS 严格编译正/负例、check-ignore 验证）与验收官独立复测结论一致，未见伪报。

## 三、检查单快照复核（六项 + 补充要点）

第 1 轮已判通过的检查项在 r2 中未回退：契约自足性（类型/示例未变，§8、§5 修订为增强）✓；许可审计（附录逐字一致）✓；性能预算分解（§5 未改动）✓；CI 五 job（§7 未改动）✓；M1 依赖集无 v2+ 混入（依赖表未改动）✓；补充要点 1（bbox 语义）在契约基础上进一步获得 PRD v1.1 §1.1/AC-F09 的产品侧锚定 ✓；补充要点 2（pHash/离群暴露边界）见问题 2，闭环 ✓。

## 四、遗留观察项（非问题，移交后续 Gate，不阻塞本轮）

1. PRD 验收第 2 轮尚未运行（`docs/acceptance/` 无 prd-verdict-2）——F-18、99% 阈值等 PRD 侧修订的最终裁决归该 Gate。
2. ui-spec 对 F-18 状态/词条的实际落地核验归 Gate 2（UI 验收必查项已预埋于 R2 提示词与架构 §9 表）。
3. copy-m1.md 现仅有通用 `status.busy`（`copy-m1.md:280`），无 BUSY(asset)/release-asset 场景的专用词条；该状态在 UI 上大概率由既有「更换文件」确认流承载，建议 UI 阶段确认是否需要补充文案。
4. 正式 lockfile 落地后的许可闭包双向 diff、CI 五 job 实跑、性能实测、引擎冒烟均按架构文档自我声明归集成验收。

## 五、结论

**PASS**。第 1 轮问题清单全部整改到位且经独立验证；`architecture-m1.md`（1.0.0-r2）与 `interface-contract.md`（目标 1.0.0 / r2）达到 Gate 1 交付基线，可作为 Wave 2 并行开发（R2/R4/R6）的开工依据。按流程提请产品主最终拍板：拍板通过后即视为契约冻结（冻结后的变更走契约 §11 版本规则），R7 可启动根级工程初始化。本轮未改动任何被审文件；验收官与生产者为不同会话。

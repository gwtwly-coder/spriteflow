# SpriteFlow M1 集成验收复审裁决（第 3 轮，供产品主最终裁定）

> 日期：2026-09-23（Asia/Shanghai）  
> 验收官：本独立会话；执行证据：R6、协调会话的其他会话  
> 仓库基线：`e351176ab3967463822a29f87ab0e51c37974765`  
> 修复提交：`74c1218adecaf68eb07e7c87c111d06c020c322d`、`e351176`  
> 生产站：https://spriteflow-doa.pages.dev  
> 权限：仅新增本裁决书，其他文件只读；未修复代码、改测试、重写执行记录、运行会写盘的构建/浏览器/Godot 测试。

## 1. 裁决与最终裁定边界

**技术裁决：FAIL。最终裁定由产品主作出。**

本轮已达手册规定的第 3 轮升级节点。本文是最终人工裁定的证据，不再安排普通第 4 轮自动打回。

本轮关闭：**INT-09 策略误显示、INT-10 用例 18 夹具、INT-11 Godot 4.4.x 实机验证**。接受生产站七例人工 UI 操作记录，特别是 RW-04 合并至一帧、RW-05 手动八帧、Kenney 20×20 及 RW-06 离群确认；不再以“只有 Node API 自动确认”描述这些新增证据。

整体不能 PASS 的主要理由：**连续第二张合法素材必现上传失败，判 P0 阻断**；4K/UI 性能仍未按预算实测；完整 P0、E2E 计划和发布验收仍有缺项。首轮遗留的 Comlink 完整许可文本、快捷键修饰键问题也未修复。“第 2 轮各项已全部完成”的总述与当前证据不完全一致。

新发现的状态忙碌残留为 P1，不单独阻断最小闭环；Firefox 快捷键缺测维持 P1 可延后。替换框“无显式 role=dialog”不成立为缺陷：当前源码用原生 dialog；实际应修的是可访问名称和模态焦点行为，判 P1，见 INT-14。

## 2. 本轮证据与身份

代号用于下文行号引用：

| 代号 | 文件/来源 | 核验范围 |
|---|---|---|
| W | `tests/golden/reports/acceptance/production-walkthrough.md` | 28 行完整读取；生产站人工操作、耗时概述、三次连续上传失败记录 |
| R | `tests/golden/reports/acceptance/exec-records.md` | 原始记录和第 208–382 行补测；Godot 命令、结果、拒绝覆盖；本地 Playwright 重跑 |
| B | `tests/golden/reports/acceptance/playwright-smoke.mjs` | 当前脚本读取 smoke-cases.json，并保存五份实际下载 ZIP；仍为 localhost、新 context 逐例 |
| J | `tests/golden/reports/acceptance/godot-4.4.1-run/godot-validation.json` | failures=[]，5 帧，default、12 FPS、loop=true，Godot 4.4.1 |
| S | `tests/golden/reports/acceptance/rw-06-outlier-badge.png` | 直接查看：八帧、第八帧角标、尺寸异常 1；底部仍显示忙碌 |
| C | `tests/golden/reports/acceptance/godot-4.4.1-run/godot-validation-contact-sheet.png` | 直接查看：实际加载的五张纹理接触表；不是 Godot 编辑器窗口截图 |
| V2 | `docs/acceptance/integration-verdict-2.md` | 继承未关闭问题及 37 场景基线，不改写历史 |

SHA-256：

- W：`d4e6f82d5c7c9b47ca3e8d0e2b632edca0e13563fc653f9b566170b73461381b`。
- R：`cb808d210d1f2450ec78b136882e71ca4c4a9242b0c20a8c01e90d3ee2881ac2`。
- B：`4fa72eff8b79f6d9a2058778516a2fd064f19787f8910e06a6104ec278a71001`。
- J：`5af4a6c5e610b1f90da55c64bab5bc28fded20aca0a7bfbecae3169bec79e44c`。
- S：`cffe3689be4dfbcbff7d59547904f0ee5632c2822eae8ad4202d8c61a01e90db`。
- V2：`846bd9524dac78ff701472aabdbc12896b274fe2a47732753c401eda3bc1f48d`。

本验收官独立做了：git diff/源码/文档核对；已有 ZIP 的内存解包与 PNG/JSON 检查；原始 ZIP 与 Godot 工程内容字节比较；HTTP GET 与本地 dist 比较；只读许可/体积检查；原生 dialog 的内存 DOM 语义复现。没有把执行手的浏览器操作或 Godot 运行说成本会话重新执行。

## 3. 已关闭问题

### 3.1 INT-09：PASS，策略显示修复

`74c1218` 在 App 中保存 `DetectResult.strategy`，用 `DetectionMethod` 同时更新侧栏和底部显示，替代由请求 options.mode 猜测实际策略的逻辑。见 `apps/web/src/app/App.tsx:37–52`、`:253–260`、`:605–608`、`:982–985`。

R:245–253 记录 07/16 均显示 components，Playwright 7/7，退出码 0；产品主本轮明确补充生产站 07/16 显示“区域”。该生产观察作为产品主提供的执行证据，未伪称 W 中有对应逐例截图。

本会话 GET 生产首页 HTTP 200，当前主 JS 为 `/assets/index-QPGD2v7f.js`，SHA-256 `c862459a28c2f35948dace803ea915c54dc6d3ef35c5e8dfe712e310cb3f2cc2`，与现有本地 dist 同名文件逐字节相等。发布修复与本地补测有一致产物支持。

### 3.2 INT-10：PASS，用例 18 夹具修复

`e351176` 将 `tests/e2e/fixtures/smoke-cases.json:38` 从 1 改为 2，与 `tests/golden/cases/18-single-frame-degrade/ground-truth.json:18` 一致。B:20–40 已读取夹具的帧数/策略，不再手写第三份该期望。R:251 记录页面手动两帧通过。

### 3.3 INT-11：PASS，Godot 实机验证

R:264–275 明确版本 `4.4.1.stable.official.49a5bc7b6`。R:293–375 包含 PNG 导入、执行原始 EditorScript、加载生成 SpriteFrames、帧数/路径/顺序/FPS/loop 校验，以及第二次执行时拒绝覆盖。

本会话只读核实：

1. `artifacts/07-scatter-5-godot.zip` SHA-256 为 `b1704e8ec7de6007e17b2e120057e2f1747a6cb09741a3595ee6f54a15b0ee9c`，与记录一致。
2. ZIP 内 README、build_spriteframes.gd、sequence.json 及五张 PNG 均与 godot-4.4.1-run 中对应文件逐字节相同，原导出脚本没有被临时修补。
3. `atlas.tres` SHA-256 为 `d41e6219f7174d37d4ce9c5e26542a984a8767b0fc4aa430b68af3b5077a47a4`，与首次生成和拒绝覆盖前后的记录一致。
4. J 与 `validate_spriteframes.gd:18–60` 相互支持：加载 SpriteFrames，比较实际纹理路径和数量，并核对 fps/loop；接触表显示五张纹理成功加载。

执行方式是 headless editor 加最小 SceneTree 启动器调用未修改 EditorScript._run()，不是在编辑器 GUI 点 Run；但本条要求的实际引擎执行、可加载资源、序列参数和拒绝覆盖均有证据，接受等效执行。启动器自身总是 quit(0)，故本裁决依赖生成资源、独立验证进程及哈希，而不是仅依赖启动器退出码。R:330 的退出清理诊断不认定为导出脚本失败。

## 4. 人工退出验收与生产站：进展有效，但存在边界

| 样本 | 本轮实际 UI 操作记录 | 裁定 |
|---|---|---|
| Kenney | W:10，手动 20×20 得 400 帧，记录 ZIP 解包及空帧占位 | 接受人工切帧路径和该解包观察，不再按整表一帧处理 |
| rw-02 | W:11，六帧、两项多组件提示，确认导出 | 接受单例路径；GT 期望本来就是 grid，见本节纠错 |
| RW-03 | W:12，降级后接受两帧并确认导出 | 接受两帧人工确认记录；W 未记录额外调行列或拆分，不能扩写为已执行这些动作 |
| RW-04 | W:13，Shift 多选→合并→一帧→导出 | 接受语义修正，关闭此前“默认两帧直接当完成”的事实缺口 |
| RW-05 | W:14，手动 1×8→八帧→导出 | 接受人工恢复八帧的路径 |
| RW-06 | W:15/S，八帧、一个离群角标，确认导出 | 接受离群保留和确认操作；没有自动删除或强行缩放的操作记录 |
| RW-07 | W:16，四帧、确认导出 | 接受单例路径；没有逐像素辉光输出比对记录 |

**7/7 可作为独立单例路径走通的执行记录，不能解释成一次连续会话 7/7。** W:22 同时记载导出后任何新上传均失败、刷新恢复。此反例不抹掉单例成功，但阻断正常连续使用。

PRD:452 还要求记录每例最终产物。W 中除 Kenney 的结构摘要外，六张 RW 的导出列仅为勾号，没有逐例文件名、格式、产物路径/哈希和下载内容检查结果；acceptance/artifacts 当前五份 ZIP 都是合成黄金病例，并非七张真实素材。本轮因而关闭 INT-03 的“未走真实 UI/未作人工修正”部分，剩余产物证据仍未闭环，不把单例操作概述升级为完整退出验收 PASS。

W:24“rw-02 ground truth 优先 components”是记录错误。实际 `tests/golden/real/rw-02/ground-truth.json:19` 为 grid，`docs/inspections/rw-semantic-review.md:92` 同样为 grid/6；不将其列为产品策略回归，也不建议改 GT。

## 5. 新发现问题的严重级与依据

### 5.1 INT-12：P0 阻断，换图后无法继续处理

执行证据：W:22，完成导出→换一张图→再次上传→error.unknown；记录三次复现，刷新后恢复。

源码独立核对到一致的原因链：

1. `apps/web/src/app/App.tsx:660–668` 只清前端 File/asset/preview 等状态，没有 release Worker 中的旧 asset，也没有 dispose/recreate client。
2. `App.tsx:108` 复用已有 client；`:219` 仅当前端 asset 非空时 release。换图已将 asset 设为 null，所以新上传跳过 release。
3. `packages/pipeline/src/browser/service.ts:118–119` 在旧资产仍存在时拒绝 load，返回 BUSY；`:142–150` 显示只有 release 才清资产及规范化/打包缓存。

这是产品允许的重复单图流程，不是 M1 不做的批量上传。合法新图无法进入 F02 的检测流程，需要用户刷新绕过，故不接受走查中“建议 P1”的级别。应先完成旧任务/资产释放和前后端状态一致性，再开启新任务，并验证同页至少连续三次上传→导出。

### 5.2 INT-13：P1 应修，忙碌提示长期残留

执行证据：W:22；S 的审校工作区仍显示“正在处理，请稍候”。

`App.tsx:145` 将进度事件保存，`:148` 只清 currentTask；`:530`、`:603–604` 却按 progress 是否非空显示 busy。任务完成没有清 progress；`:250` 仅在下一次 detect 开始时清空。忙碌残留和 Worker 旧资产未释放分别有状态管理原因，不能未经验证就认定为同一个根因。

已有记录证明用户仍能审校/导出，没有证据表明此文本单独禁用操作，因此本项本身不阻断最小闭环。需用真实活动任务状态驱动 busy，并覆盖成功、失败、取消后的复位；它也不能作为 UI 响应性能达标的证据。

### 5.3 INT-14：P1 应修，可访问名称/模态行为；“没有 dialog 角色”不成立

当前 `App.tsx:1556–1558` 是 `<dialog open aria-modal="true">` 包含 h1。原生 dialog 的隐式角色就是 dialog，不需要重复显式 role。依据：[W3C ARIA in HTML 的 dialog 映射](https://www.w3.org/TR/html-aria/#el-dialog)。仅因 DOM 没有 role 属性而报告角色缺失，应纠正。

本会话用源码同结构片段在内存 JSDOM + 现有 Testing Library 中核对：`getByRole(body,"dialog")` 得到 DIALOG；`queryByRole(body,"dialog",{name:"重新检测并替换当前帧？"})` 得到 null。标题没有通过 aria-labelledby/aria-label 关联，因此对话框缺可访问名称。

源码只设置 open 和 aria-modal，未见 showModal、初始焦点/返回焦点或焦点圈定逻辑；`docs/ui-spec.md:358` 明确要求模态焦点圈定。`aria-modal` 不能代替这些交互实现。内存 DOM 检查不是完整浏览器键盘复测，不声称已观察到特定 Tab 越界路线。

该问题按 P1 修复并补键盘/可访问性树验证；目前鼠标操作能完成替换，不单独阻断最小闭环。建议绑定标题及正文、实现真实模态焦点管理，避免仅添加冗余 role 当作修复。

## 6. 性能和 CI 的裁决

W:18 只有“07 散排 96×96 检测 1.5s”和“各例秒级”的概述。这不是 4096×4096 基准，也没有标明耗时是否包括上传/解码/规范化，不能拿 1.5s 与纯 CCL 500ms 直接比较，更不能证明 4K 达标。

`docs/architecture-m1.md:171/182/190/194` 要求 4096²、预热 5 次/测量 30 次、CCL p95 <500ms，UI p95 帧耗时≤16.7ms 且无 >50ms 处理长任务。`docs/prd-m1.md:448` 要求固定代表图连续十次的首次结果时间和 UI 心跳。以上原始数据/trace 本轮仍未提供，INT-04 保持 P0 证据阻断。

本会话只读执行：

- `node scripts/check-bundle-budget.mjs`：退出码 0；当前 index-QPGD2v7f.js 首屏 gzip 92.5 KiB、Worker 29.6 KiB，体积子项 PASS。
- `node scripts/check-licenses.mjs`：退出码 0；213/213 集合一致、无清单内 GPL 类/禁用依赖，集合子项 PASS。

已核实当前 [CI #6 / e351176](https://github.com/gwtwly-coder/spriteflow/actions/runs/35873751314) 为 Success、五 job 列出、耗时 39s，并有 golden/web-dist 两份 artifact；[CI #5 / 74c1218](https://github.com/gwtwly-coder/spriteflow/actions/runs/35869804050) 为修复提交的执行页面。CI #6 成功不是只引用旧 CI #4。页面仍需登录才能读完整日志；Actions 运行时弃用警告不等于编译器警告。

R:227 只记录修复后 web build 退出码 0，未新增该构建的 warning/error 计数；R:61–62 的零警告来自旧 caee0a4 运行。保留原零警告成绩，但不把它冒充最新 SHA 的完整零警告日志。

## 7. 通用检查单与旧问题去向

| 检查项 | 裁决 | 证据与范围 |
|---|---|---|
| PRD 全部 P0 | FAIL | 策略/Godot 已关闭；新第二次上传失败及第 9 节未补场景仍在 |
| pnpm golden | PASS | 当前 CI #6 golden 门禁成功；已有本地报告 20/20；继承算法标注验证 |
| E2E 冒烟 | FAIL（完整计划） | R:217–256 已实现矩阵 7/7 PASS；但角标筛选、完整语言/离线等计划断言仍未覆盖，且每例新 context 漏掉 INT-12 |
| 性能预算 | FAIL | 体积 PASS；4K/响应/十次端到端数据缺失 |
| 构建零警告 | FAIL（最新证据不足） | 当前 CI/build 成功，旧版本零警告有记录；最新完整零警告日志未归档 |
| 生产站关键路径 | FAIL | 已有七例生产单例人工走查，关闭“未上生产测试”的旧描述；连续换图实际失败，生产三格式/离线完整覆盖不足 |
| 许可证终审 | FAIL | 213/213 集合 PASS；完整 Comlink 许可仍缺，远端声明与源码相同 |
| 1 Kenney+5 AI 退出标准 | FAIL（剩余证据） | 接受七例 UI 操作路径；逐例最终真实产物记录不足且需明确刷新绕过，见第 4 节 |

本轮独立读取五份合成病例 ZIP，结果：

| ZIP | 结果 |
|---|---|
| 01-grid-2x2-hash.zip / array.zip | 均 4 帧；实际 PNG 54×66 与 meta 相同；旋转感知物理边界合法；animations 顺序与 atlas 帧顺序一致 |
| 13-grid-multicomponent-hash.zip | 6 帧；实际 PNG 79×76；同上几何/顺序检查通过 |
| 07-scatter-5-godot.zip / 16-size-outlier-godot.zip | 各 5 帧；每张 PNG 尺寸与 sequence 帧尺寸相同；动画 frameIds 与帧顺序一致 |

此项关闭 V2 的“浏览器 ZIP 未归档、未核实际 PNG 边界/顺序”缺口。不是重新执行浏览器，也未将合成 ZIP 当作七张真实图的最终产物；F09/完整 Godot offset 对应仍需像素及预览核验。

### 尚未关闭问题清单

| 编号 | 严重级 | 位置 | 问题描述 | 修复建议 |
|---|---|---|---|---|
| INT-12 | P0 阻断 | W:22；App.tsx:108/219/660–668；service.ts:118–119/142–150 | 导出后换图再次上传失败；UI 清引用却未释放 Worker 资产，新 load 被拒绝 | owner 修复资源生命周期；执行手验证同页连续三次和失败/取消后重传，无需刷新 |
| INT-01 | P0 阻断 | V2 第 7 节；本文第 9 节 | 8K、八手柄、完整增删合拆排/历史、输入边界、内存三分支、完整双语/离线等 P0 仍无合格完整记录 | 按剩余场景补执行证据，或由产品主显式作风险/范围裁定；不得记成已验 PASS |
| INT-02 | P0 阻断 | B；PLAYWRIGHT-PLAN.md:28–61；R:217–256 | 已实现矩阵全绿，但完整计划的筛选、初始降级状态、语言及规范化像素等断言未补；新 context 掩盖跨素材失败 | 保留7/7成绩，补原计划断言及同一 context 换图回归 |
| INT-03 | P0 阻断（证据） | W:10–16；PRD:452；acceptance/artifacts | 人工操作已完成；真实图逐例最终文件、格式、产物标识/内容核对记录不足，不能用合成 ZIP 代替 | 执行手补固定六例最终产物清单、哈希/路径和必要检查，注明刷新绕过情况 |
| INT-04 | P0 阻断（证据） | W:18；architecture-m1.md:171–194；PRD:448–450 | 96×96 单次耗时和“秒级”无法覆盖 4K CCL/UI/十次首次结果预算 | 按原预算报告样本、环境、原始数据与 UI trace，不从小图外推 |
| INT-05 | P0 阻断（剩余范围） | W:22；本文第 6–7 节 | 生产单例走查已补；生产连续会话失败，三格式/离线及最新零警告完整记录仍未闭环 | 修 INT-12，补生产其余关键路径及最新构建日志；不重复要求已通过的本地 ZIP 核验 |
| INT-06 | P1 应修 | App.tsx:385–435；V1 第 7.3 节 | 快捷键修饰键隔离未改，Ctrl+S/Ctrl+0/Alt+M 同时触发编辑器动作的旧问题保留 | owner 限定修饰键、工作区焦点/模态作用域，执行手补真实浏览器测试 |
| INT-07 | P1 应修 | THIRD_PARTY_NOTICES.txt:50–64；architecture-m1.md:345 | Comlink 仍只有 Apache 短声明；本轮 GET 生产声明与源码相等、无完整条款 | owner 补完整许可，复核实际发布包；license 脚本绿色不能代替分发义务 |
| INT-08 | P1 应修，可延后 | ui-spec.md:566；产品主本轮第7项 | Firefox 快捷键实测仍缺；Chrome/Edge 也未提供完整快捷键矩阵补证 | 由产品主登记延后范围/责任人；不据此豁免编辑/撤销等 P0 功能 |
| INT-13 | P1 应修，不单独阻断 | W:22；S；App.tsx:145–150/530/603–604 | 已完成任务的 progress 未清，长期显示 busy，误导处理状态 | 按真实任务生命周期复位进度/任务状态，覆盖成功、失败、取消 |
| INT-14 | P1 应修，不单独阻断 | App.tsx:1556–1558；ui-spec.md:358 | 原生 dialog 角色存在；缺可访问名称，模态焦点行为未实现完整/未验证 | 关联标题/正文，处理初始与返回焦点及焦点圈定；用角色+名称和键盘测试，不只补冗余 role |

INT-09、INT-10、INT-11 已关闭，不列入未解决问题。上述证据缺口不是声称相应产品功能已经实测失败；INT-12 是明确的执行失败并有代码原因支持。

## 8. Firefox 及许可的最终裁定建议

Firefox 快捷键缺测维持 P1，可由产品主单独批准延后；不将其升级为此次主要 P0，也不把未测浏览器宣称完整兼容。INT-06 是已发现实现缺陷，不能随 Firefox 环境缺失一起当作“仅缺测”放行。

许可声明问题仍是独立发布终审失败项。本会话未新增法律结论，沿用首轮对完整 Apache-2.0 文本与架构发布要求的核对；本次确认修复提交未触及该文件且生产同样缺失。产品主最终裁定应显式区分“工程发布要求尚未满足”与“依赖清单无 GPL”这两个不同结论。

## 9. PRD 37 场景复核状态

位置均指 `docs/prd-m1.md`。使用 PASS/FAIL 二元裁决；FAIL 备注区分实测错误与证据不足。纯算法已由 golden 证明的项维持 PASS；新证据只关闭它实际覆盖的范围。

| 场景 | 位置 | 裁决 | 证据/剩余项 |
|---|---|---|---|
| F01-A | :120 | FAIL | 本地网络观察已有；生产/静态加载后离线闭环未测 |
| F01-B | :125 | FAIL | 切语言仅检帧数；所有状态文案及编辑历史未覆盖 |
| F02-A | :132 | FAIL | 生产 PNG 拖放有证据；第二次合法上传实测失败，另缺 WebP 全覆盖 |
| F02-B | :138 | FAIL | 本地 PNG 点选通过；连续换图、WebP 与两入口同等验证未全覆盖 |
| F02-C | :143 | FAIL | 非 M1、多个文件、不透明输入拒绝记录未补 |
| F02-D | :149 | FAIL | 99%/略高边界记录未补 |
| F02-E | :157 | FAIL | 损坏输入清理/重新选择记录未补 |
| F03-A | :165 | PASS | 当前 golden 网格数量、策略、索引 bbox 通过；继承 V2 |
| F03-B | :170 | PASS | golden 条带通过，W:11 增加真实 rw-02 六帧 UI |
| F03-C | :175 | PASS | golden pending/included/多组件及本地13下载；继承 V2 |
| F04-A | :185 | PASS | golden 散排/噪点与 UI07五帧；策略文案修复已关闭 |
| F04-B | :190 | PASS | golden 帽子/武器断件匹配；继承 V2 |
| F05-A | :197 | PASS | 74c1218，R:248/250，产品主生产07/16“区域”观察 |
| F05-B | :202 | PASS | W:10/12–14 明确诚实降级与人工网格，R重跑18/20；接受执行手观察 |
| F05-C | :207 | FAIL | 手动行列/合并/导出已补；新增、拆分、删除完整恢复操作未记录 |
| F05-D | :212 | FAIL | golden EMPTY_INPUT/一空帧、本地手动应用通过；初始持续提示及完整编辑分支证据不足 |
| F06-A | :222 | FAIL | 无完整 fit/zoom/pan 坐标与尺寸同步记录；S 不替代交互序列 |
| F06-B | :227 | FAIL | 8192² 路径交互未补 |
| F07-A | :234 | FAIL | 八个手柄/移动未逐项验证 |
| F07-B | :239 | FAIL | W:13 补多选合并；新增/删除/拆分及同步完整性仍缺 |
| F07-C | :244 | FAIL | 无第三帧移首位并核预览/导出的实测 |
| F08 | :251 | FAIL | 无完整编辑序列 undo/redo 与端点禁用实测 |
| F09-A | :258 | FAIL | 规范化 API 已验；源像素、offset、统一画布与 UI preview 完整对应仍缺 |
| F09-B | :266 | FAIL | 已独立解码浏览器 atlas 核边界；padding/extrude/offset 逐像素未验 |
| F09-C | :273 | FAIL | W:10 记录 Kenney 空帧1×1；逻辑画布、时长/顺序完整核验未记录 |
| F10-A | :283 | PASS | 本地01/13实际下载 ZIP；本轮独立解码 PNG、meta/边界/名称顺序与动画引用检查通过 |
| F10-B | :288 | PASS | 本地01 Array 实际下载 ZIP；同上独立核验通过 |
| F11-A | :297 | FAIL | 文件/帧数/PNG尺寸/引用及引擎加载通过；offset 与规范化预览/源像素的完整对照未补 |
| F11-B | :303 | PASS | Godot 4.4.1 原脚本执行、资源加载、顺序/FPS/loop 与拒绝覆盖闭环，INT-11关闭 |
| F12-A | :313 | FAIL | >8192 降采样与取消未补 |
| F12-B | :318 | FAIL | 预计内存不足及降尺寸重试未补 |
| F12-C | :323 | FAIL | 运行时分配失败、数据保留/恢复未补 |
| F13-A | :330 | PASS | golden数据与既有标注独立复核维持；当前CI门禁成功 |
| F13-B | :337 | PASS | 当前 e351176 的 CI #6 golden 成功，不依赖旧提交结果 |
| F18-A | :344 | FAIL | S 支持第八帧单个离群角标；多类角标并存、不改数据的完整标准仍缺 |
| F18-B | :352 | FAIL | 截图有筛选入口，但没有操作筛选/清除且数据不变的记录 |
| F18-C | :360 | FAIL | W:15 补离群确认导出；各类标记确认前后 included/顺序/像素保持的完整证据不足 |

## 10. 提交产品主的最终裁定建议

建议产品主作 **M1 不予通过** 的最终裁定，至少先解决 INT-12 并按原要求补性能及剩余 P0/发布证据。Firefox 快捷键、busy 提示和对话框可访问性可逐项作明确的 P1 延后决定；这不改变现有 P0 阻断，也不改变已通过的修复/Godot/下载产物结论。

本轮不再次安排自动验收打回。产品主如选择接受风险或调整范围，应明确记录被接受的问题、适用范围、责任和后续条件；验收官不代产品主签署豁免，也不将这种决定记成未执行标准已经技术 PASS。

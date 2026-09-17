# SpriteFlow M1 UI 验收裁决（第 1 轮）

> 验收阶段：UI  
> 验收日期：2026-09-17  
> 验收角色：独立验收官  
> 裁决：**FAIL**

## 1. 验收范围与基线

- 工作目录：`D:\projects\new_project1`。
- 本轮为 UI 第 1 轮；`docs/acceptance/` 此前只有 PRD、架构两阶段裁决，没有既有 `ui-verdict-*`。
- 已通读并交叉核对：
  - `docs/technical-design.md`
  - `docs/prd-m1.md`
  - `docs/architecture-m1.md`
  - `docs/ui-spec.md`
  - `docs/interface-contract.md`
  - UI 文案事实表 `docs/copy-m1.md`
- 生效契约基线是 `2.0.0 / r3`：`docs/interface-contract.md:3-8`；UI 规格仍标注 2026-09-16、版本 1.0：`docs/ui-spec.md:3-5`。
- 本轮只检查文档与静态 HTML 稿，没有修改任何生产文件；唯一新增文件是本裁决书。

## 2. 总裁决

**FAIL。**

暗色主题、三份静态 HTML 的直接打开能力和结构可实施性通过；但契约 2.0.0/r3 指定的显式手动网格三项 UI 行为没有完整同步，快捷键表存在浏览器快捷键冲突，状态清单与双语文案表也仍有不一致。当前稿件不能作为无歧义的 R5 实施蓝本。

## 3. UI 检查单逐条核对

### 3.1 布局覆盖 PRD 全流程及异常分支：FAIL

证据：

- PRD 规定单页上传、预检、检测、审校、导出主流程及低置信度、超大图、内存、不支持/不透明/损坏、导出失败/下载阻止等异常分支：`docs/prd-m1.md:368-423`。
- UI 规格给出 S1～S4 状态机与全局浮层：`docs/ui-spec.md:23-61`；全量状态表覆盖常规 PRD 分支：`docs/ui-spec.md:536-632`。
- 但 r3 新增/明确的显式 `manual-grid` 状态迁移没有完整落入 UI 状态机，详见问题 1。由于这是本轮明确必查项，布局流程不能判为完整覆盖。

### 3.2 快捷键表完整且不与浏览器冲突：FAIL

证据：

- UI 规格声明“不占用浏览器保留组合”：`docs/ui-spec.md:501-504`。
- 同一表把 `Ctrl+D` 分配为“取消选择”：`docs/ui-spec.md:522-524`。
- Google Chrome 官方快捷键表将 `Ctrl+D` 定义为“保存当前网页为书签”：<https://support.google.com/chrome/answer/157179?hl=en-HK>。因此当前映射与目标桌面浏览器发生直接冲突，详见问题 2。

### 3.3 状态清单与 PRD 文案表一一对应：FAIL

证据：

- `editor.selection_count` 已存在于双语文案表：`docs/copy-m1.md:129-133`；但 UI 状态 C-22 仍写“计数文案缺词条”：`docs/ui-spec.md:572-576`，设计发现 D-01 也重复宣称缺失：`docs/ui-spec.md:646-651`；HTML 稿继续展示同一过期说明：`design/mockups/review-editor.html:489-494`。
- 手动网格乘积超过 500 的校验态已在控件规格中要求：`docs/ui-spec.md:315-317`，但状态清单没有该状态，规格自己也承认缺少 `manual.grid_too_large` 文案：`docs/ui-spec.md:654-657`；扫描 `docs/copy-m1.md` 的 217 个 Key，确无该 Key。
- r3 要求的手动空结果/清除降级状态也没有独立状态项，详见问题 1。

### 3.4 暗色主题完整：PASS

证据：

- PRD 明确 M1 仅提供暗色主题：`docs/prd-m1.md:18-29`。
- UI 规格提供完整暗色色板、语义色、字体、焦点、组件 default/hover/active/disabled/loading/error 状态和工具 active-tool 状态：`docs/ui-spec.md:114-197`。
- 三份 HTML 实测均使用同一暗色令牌体系并能正常渲染；未发现意外浅色屏或依赖缺失造成的无样式屏。

### 3.5 HTML 稿可直接打开且结构可实施、无仅存图片的屏：PASS

实测步骤与结果：

1. 使用本机 Google Chrome `152.0.7977.84`，分别以 `file:///D:/projects/new_project1/design/mockups/upload.html`、`review-editor.html`、`export-panel.html` 直接打开。
2. 三次均完成加载并成功输出整页截图：
   - `upload.html`：1440×5000，207,452 bytes；
   - `review-editor.html`：1440×9000，477,236 bytes；
   - `export-panel.html`：1440×7000，295,810 bytes。
3. 上传、审校、导出主态及其列出的变体均可见；未出现空白页、损坏资源或仅一张整屏图片的页面。
4. 源码核查显示页面由语义化容器、按钮、输入、选择器、模态、内联 CSS、少量状态/双语演示 JS 和程序化内联 SVG 构成；索引与实现方式见 `docs/ui-spec.md:661-669`，关键 DOM 见 `design/mockups/upload.html:108-294`、`design/mockups/review-editor.html:236-551`、`design/mockups/export-panel.html:142-417`。三个文件中未发现外部 HTTP(S) 资源或 `<img>` 整屏稿。

### 3.6 契约 2.0.0/r3 三项 UI 承接：FAIL

契约事实：

- 显式 `manual-grid` 且 `keepEmptyCells=false` 可成功返回 `frames=[]`，检测本身不报错，后续 pack/export 才按 `NO_FRAMES` 阻断：`docs/interface-contract.md:277-279`、`1024-1028`。
- 显式 `manual-grid` 必须返回 `confidence=1`、`degraded=null`，不产生 `DETECTION_DEGRADED`：`docs/interface-contract.md:297-301`、`310-324`。
- 自动 `EMPTY_INPUT` 后，同一资产应用显式手动网格时，第二次结果不得继承第一次降级，UI 必须清除旧任务降级状态：`docs/interface-contract.md:1029-1032`。

UI 核查结果：

- UI 只有通用零帧态和通用导出禁用说明：`docs/ui-spec.md:254-257`、`572-574`、`608-612`；手动网格规格只定义行/列/应用/重置，没有 `keepEmptyCells` 结果分支或“应用成功但零帧”的状态迁移：`docs/ui-spec.md:315-319`。
- 降级横幅章节仍只有旧的“低置信度/EMPTY_INPUT → 持续横幅 + 手动网格”描述：`docs/ui-spec.md:490-497`；没有明确写出显式手动结果不显示横幅，以及应用后清除旧降级对象/警告/横幅。
- HTML 手动面板同样只有行、列、应用、重置：`design/mockups/review-editor.html:402-417`；唯一手动变体是带持续降级横幅的 B-16 克隆：`design/mockups/review-editor.html:496-530`。没有非降级手动态、手动零帧态或“应用网格后横幅消失”变体。

结论：三项行为没有形成可实施、可验收的 UI 闭环。

## 4. 问题清单

| 编号 | 严重级 | 位置 | 问题描述 | 修复建议 |
|---|---|---|---|---|
| UI-01 | P0 阻断 | `docs/ui-spec.md:25-60, 315-319, 490-497, 536-632`；`design/mockups/review-editor.html:402-417, 496-530` | UI 规格仍基于 r3 前的降级模型，未完整承接三项生效行为：① `manual-grid + keepEmptyCells=false` 成功返回零帧后应显示原因、禁用导出；②显式手动模式 `degraded=null`，不得显示降级横幅；③从自动降级应用手动网格后必须清除旧 `degraded`、`DETECTION_DEGRADED` 与横幅。现稿只有通用零帧态，且唯一手动 HTML 变体仍是持续降级横幅，实施者无法据此写出无歧义状态迁移。 | 在状态机、7.4、全量状态表及 HTML 变体中增加 r3 分支：用当前 DetectResult 的 `degraded !== null` 作为横幅唯一显示条件；显式 manual-grid 成功时原子替换帧与降级/警告状态；对 `frames=[]` 显示手动空结果说明、隐藏规范化预览/禁用预览与导出，并用 `export.disabled_no_frames` 解释。明确 `keepEmptyCells` 的 UI 来源；若 M1 不提供开关，也必须规定调用值及仍可能接收空结果时的呈现。 |
| UI-02 | P1 应修 | `docs/ui-spec.md:501-504, 522-524` | 快捷键表宣称不占用浏览器保留组合，却使用 `Ctrl+D` 取消选择；Chrome 官方定义 `Ctrl+D` 为收藏当前页。该组合会造成产品动作与浏览器动作冲突。 | 改用无浏览器冲突的组合（例如单键 Esc 已有分层取消语义，或另选经 Chromium/Firefox/WebKit 实测无冲突的组合），同步快捷键面板与工具提示，并记录三浏览器实测。 |
| UI-03 | P1 应修 | `docs/ui-spec.md:572-576, 646-651`；`docs/copy-m1.md:129-133`；`design/mockups/review-editor.html:489-494` | 状态清单和 HTML 仍声称多选计数文案缺失，但 `editor.selection_count` 已在文案表中存在，三处事实不一致，破坏“状态清单与文案表一一对应”。 | 删除过期设计发现与 HTML 注释；C-22 明确绑定 `editor.selection_count`，HTML 使用该双语词条展示。 |
| UI-04 | P1 应修 | `docs/ui-spec.md:315-317, 536-632, 654-657`；`docs/copy-m1.md` | 手动网格 rows×columns 超 500 的校验已经写入控件规格，却未进入“全量”状态清单，且缺少双语错误 Key；目前只有红框、没有可读错误说明。 | 增补状态项和 `manual.grid_too_large` 中英文文案，说明当前值、上限与恢复动作；HTML 增加对应错误态，键盘与屏幕阅读器可读。 |
| UI-05 | P2 建议 | `docs/ui-spec.md:131-159, 319, 469, 639` | 规范宣称文本对比度均不低于 4.5:1，但 `--text-3 #6b7688` 对 `--bg-1 #151a22` 实算约 3.80:1、对 `--bg-0 #0e1116` 约 4.12:1；该颜色不仅用于禁用态，还用于帮助文案/摘要等非豁免文本。 | 提亮 `--text-3`，或把非禁用帮助文案改用 `--text-2`；对所有暗色表面重新做 WCAG 对比度矩阵并在规格中记录真实数值。 |

## 5. 复验门槛

第 2 轮复验前至少应满足：

1. `docs/ui-spec.md` 明确写出 r3 三项状态迁移，并在全量状态表中可逐条定位。
2. `review-editor.html` 提供可直接查看的“显式手动非降级”“手动零帧”“自动降级后应用网格并清除横幅”变体。
3. 快捷键冲突已消除并同步快捷键面板。
4. 状态清单、`copy-m1.md` 与 HTML 中的 Key/说明双向一致，不再保留已解决的“缺词条”记录。

本阶段最多打回 2 轮；若第 3 轮仍需裁决，按规则升级产品主人工裁决。

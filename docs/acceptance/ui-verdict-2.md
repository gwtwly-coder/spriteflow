# SpriteFlow M1 UI 验收裁决（第 2 轮）

> 验收阶段：UI  
> 验收日期：2026-09-17  
> 验收角色：独立验收官  
> 复审基线：`docs/acceptance/ui-verdict-1.md` 的 UI-01～UI-05  
> 生产者提交：`61cdf932af69fbb81b862e24276202702899674d`  
> PM 文案提交：`8c61d22eb7f53481e738fcf7f002515c3888abfc`  
> 裁决：**FAIL**

## 1. 复审结论

第 1 轮五项问题中，UI-01、UI-02、UI-03、UI-05 已通过；UI-04 的状态、文案和视觉主体已完成，但同步收尾未完成：PM 已录入 `manual.grid_too_large`，UI 规格与 HTML 仍把它标作“待 PM 录入”。此外，本轮新增的 C-70/C-71 HTML 变体只做了视觉禁用，没有实现规格自己声明的表单可访问语义。

因此第 2 轮裁决为 **FAIL**。本轮没有发现新的契约状态机矛盾，但 HTML 不能在仍含过期占位说明、且键盘禁用语义与规格不符的状态下判 PASS。

## 2. 第 1 轮问题逐项验证

### UI-01｜契约 r3 三项手动网格承接：PASS

契约依据：

- 显式 `manual-grid + keepEmptyCells=false` 可成功返回 `frames=[]`，后续 pack/export 才按 NO_FRAMES 阻断：`docs/interface-contract.md:277-279, 1024-1028`。
- 显式 `manual-grid` 返回 `confidence=1`、`degraded=null`、无 DETECTION_DEGRADED：`docs/interface-contract.md:297-301, 310-324`。
- 自动 EMPTY_INPUT 后应用显式手动网格时，第二次结果不得继承第一次降级，UI 清除旧降级状态：`docs/interface-contract.md:1029-1032`。

修复证据：

- UI 规格已升到 v1.1 并明确绑定契约 `2.0.0/r3`：`docs/ui-spec.md:3-6`。
- 状态机新增显式手动与手动空结果迁移，并明确原子清除旧降级横幅/警告：`docs/ui-spec.md:61-69`。
- 手动网格调用值与结果分支已明确：M1 固定 `keepEmptyCells=true`、`region=null`，同时防御性承接 `frames=[]`；非空和空结果分别进入对应状态：`docs/ui-spec.md:337-345`。
- 横幅唯一显示条件已绑定当前 `DetectResult.degraded !== null`；显式手动及手动空结果不显示：`docs/ui-spec.md:516-529`。
- 全量状态表新增 C-68、C-69、C-70：`docs/ui-spec.md:638-640`。
- HTML 新增三种可见变体及状态类：`design/mockups/review-editor.html:243-275, 561-571, 606-621`。直接打开实测中，C-68 无降级横幅，C-70 显示零帧时间轴且隐藏导出预览，C-69 与 B-16 对照时旧横幅已清除。

结论：三项契约行为的状态语义和可视变体均已承接。HTML 的禁用语义问题另列新增问题 UI2-02，不回退本项契约判断。

### UI-02｜快捷键与浏览器冲突：PASS

证据：

- 取消选择已改为 `Esc`，`Ctrl+D` 不再是有效映射：`docs/ui-spec.md:392-393, 537-561`。
- 规格记录了 v1.0 冲突、v1.1 移除结果及三浏览器实现侧复测要求：`docs/ui-spec.md:565`。
- 全仓 UI 规格/HTML/文案扫描中，`Ctrl+D` 仅出现在修订说明和历史冲突说明，不再出现在当前快捷键表或 HTML 工具提示。

结论：第 1 轮指出的 `Ctrl+D` 冲突已消除。

### UI-03｜selection_count 状态/文案/HTML 同步：PASS

证据：

- `editor.selection_count` 仍在双语文案表：`docs/copy-m1.md:129-133`。
- 状态栏与 C-22 已直接绑定该 Key：`docs/ui-spec.md:313, 606-608`。
- D-01 已标记“已解决（撤回）”：`docs/ui-spec.md:685-687`。
- HTML 状态栏提供中英文计数并明确说明使用 `editor.selection_count`：`design/mockups/review-editor.html:535-546`。

结论：不再存在“文案已存在但规格仍称缺失”的矛盾。

### UI-04｜手动网格超限状态与双语文案：FAIL（部分完成）

已完成证据：

- C-71 已进入全量状态表，规定红框、内联错误、应用按钮禁用及可访问语义：`docs/ui-spec.md:638-641`。
- PM 已将 `manual.grid_too_large` 写入 `copy-m1.md`，中英文及 `{count}` 占位符完整：`docs/copy-m1.md:117-123`。
- HTML 已渲染 12×50=600 的中英文内联错误：`design/mockups/review-editor.html:446-464`。

未完成证据：

- C-71 仍把该 Key 标为“建议词条（待 PM 录入）”：`docs/ui-spec.md:641`。
- D-07 仍标为“部分解决（词条待 PM 录入）”，并要求 HTML 继续保留占位说明：`docs/ui-spec.md:693`。
- HTML 变体说明仍显示 `待 PM 录入`：`design/mockups/review-editor.html:561-563`。
- 全部 HTML 扫描结果中，该行是唯一的“待 PM/待录入”残留；这直接不满足本轮“HTML 稿不再残留‘待 PM 录入’占位标注”的复审要求。

结论：词条本身已录入、视觉错误态已制作，但三方同步未收口，本项不能判通过。

### UI-05｜暗色辅助文字对比度：PASS

证据：

- `--text-3` 已从 `#6b7688` 提亮为 `#808a9b`，并加入表面矩阵与使用限制：`docs/ui-spec.md:141-181`。
- 独立按 WCAG 相对亮度公式复算：对 `--bg-0/#0e1116` 为 5.427:1；对 `--bg-1/#151a22` 为 5.011:1；对 `--bg-2/#1c232e` 为 4.534:1；对仅用于按压/禁用表面的 `--bg-3/#242d3b` 为 3.982:1。与规格四舍五入值 5.4/5.0/4.5/4.0 一致。
- 三份 HTML 均已同步 `--text-3:#808a9b`：`design/mockups/upload.html:16`、`design/mockups/review-editor.html:20`、`design/mockups/export-panel.html:17`。

结论：第 1 轮指出的非禁用帮助文字对比度问题已修复。

## 3. HTML 直接打开实测

环境：Google Chrome `152.0.7977.84`，Windows，直接使用 `file://` 打开，不启动服务器。

步骤与结果：

1. 打开 `design/mockups/upload.html`，成功渲染并输出 1440×5000 截图（207,568 bytes）。
2. 打开 `design/mockups/review-editor.html`，成功渲染并输出 1440×13000 截图（766,097 bytes）；主屏、B-16、C-39、C-43、C-68+C-71、C-70、C-69 共七个屏幕均可见。
3. 打开 `design/mockups/export-panel.html`，成功渲染并输出 1440×7000 截图（296,290 bytes）。
4. 三个页面均无外部 HTTP(S) 素材依赖、无空白页或整屏图片替代结构。Chrome 输出的唯一错误来自本机注册表中已不存在的第三方扩展 CRX，与页面资源无关。
5. `review-editor.html` 的 C-71 错误正文含 `data-zh/data-en`，可随页面双语脚本切换；但其评审说明中的“待 PM 录入”没有双语绑定且已经过期，见 UI2-01。

## 4. 新问题检查

新增 r3/C-71 变体未引入状态机、颜色令牌或文案正文的新矛盾；但发现新增 HTML 变体的交互禁用仅为视觉模拟，和 v1.1 规格的可访问要求不一致，见 UI2-02。

## 5. 问题清单

| 编号 | 严重级 | 位置 | 问题描述 | 修复建议 |
|---|---|---|---|---|
| UI2-01 | P1 应修 | `docs/copy-m1.md:121`；`docs/ui-spec.md:641, 693`；`design/mockups/review-editor.html:561-563` | PM 已正式录入 `manual.grid_too_large`，但 C-71、D-07 和 HTML 仍声称“待 PM 录入”。这使同一仓库同时表达“已录入”和“待录入”，且 HTML 明确残留本轮要求清除的占位标注。 | C-71 直接绑定 `manual.grid_too_large`；D-07 改为“已解决”并引用 `copy-m1.md`；删除 HTML 中“建议词条/待 PM 录入”说明，保留实际 Key 和状态说明即可。 |
| UI2-02 | P1 应修 | `docs/ui-spec.md:338, 640-641, 675-676`；`design/mockups/review-editor.html:251-252, 267-275, 310-311, 449-462, 606-621` | 新增 C-71 声称输入带 `aria-invalid`、应用按钮禁用；C-70 声称确认/导出/预览控件禁用。但 HTML 实际只用 `opacity` 和 `pointer-events:none`，没有 `disabled`/`aria-disabled`；超限 input 也没有 `aria-invalid`。`pointer-events:none` 不会阻止键盘聚焦/激活，因此可实施蓝本与键盘可达/状态语义要求不一致，零帧导出按钮也未提供 `export.disabled_no_frames` 的可读原因。 | 在克隆变体补丁中对超限 input 设置 `aria-invalid=true` 并用 `aria-describedby` 指向 `role=alert`；对 C-71 的应用按钮及 C-70 的确认、导出、播放控件设置真实 `disabled`（或语义正确的 `aria-disabled` + 键盘拦截）；为零帧导出提供 `export.disabled_no_frames` 的 tooltip/可访问描述。HTML 与状态清单同步实测 Tab/Enter 不可触发禁用动作。 |

## 6. 裁决与后续门槛

**FAIL。**

第 2 轮复验通过 4/5 个原问题；UI-04 未完全闭环，并发现 1 项由新增变体暴露的可访问交互问题。再次交付前需清除全部“待 PM 录入”残留，并让 C-70/C-71 的 HTML 禁用/错误语义与 v1.1 规格一致。

本阶段已完成第 2 次打回。若再次提交进入第 3 轮，按项目规则升级产品主人工裁决，不再由自动验收会话直接作最终通过判断。

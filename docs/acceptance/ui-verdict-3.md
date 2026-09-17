# SpriteFlow M1 UI 验收裁决（第 3 轮）

> 日期：2026-09-17  
> 验收角色：独立验收官  
> 复审基线：`a602ea56dbbff29786b15a7b40cca66b114ff6e5`  
> 复审对象：`docs/acceptance/ui-verdict-2.md` 的 UI2-01、UI2-02 及本轮修复引入的回归  
> 流程说明：本轮为同阶段第 3 轮；本文件给出验收官技术裁决，最终裁定由产品主执行。

## 1. 裁决

**PASS。**

UI2-01、UI2-02 均已闭环；未发现本轮修复引入的 P0、P1 或 P2 新问题。按项目手册，第 3 轮结果提交产品主作最终裁定。

## 2. UI2-01｜占位残留全量清零：PASS

第 2 轮问题位置：`docs/acceptance/ui-verdict-2.md:106`。

证据：

1. 正式双语词条仍存在且内容完整：`docs/copy-m1.md:121` 为 `manual.grid_too_large`，包含中文、英文及 `{count}` 占位符。
2. UI 规范已升至 v1.2，并在修订记录中声明闭环 UI2-01：`docs/ui-spec.md:3,7`。
3. C-71 已直接绑定正式词条，不再使用“建议词条/待录入”状态：`docs/ui-spec.md:339,642`。
4. D-07 已改为“已解决（v1.2）”，明确 PM 已录入且 C-71、HTML 均绑定正式词条：`docs/ui-spec.md:695`。
5. HTML 说明直接引用正式 Key，并将 `{count}` 替换为实值 600：`design/mockups/review-editor.html:460-464,563-565`。
6. 全量文本扫描 `docs/` 与 `design/`，排除仅用于保留历史问题证据的 `docs/acceptance/**`，匹配 `待\s*PM\s*录入|待PM录入|词条待\s*PM|词条待录入|待录入`，结果为 **0 条**。浏览器加载后的 `review-editor.html` 可见文本再次扫描，结果同为 **0 条**。

结论：正式文案、状态清单、设计发现与 HTML 稿已同步，占位残留清零。

## 3. UI2-02｜C-70/C-71 真实禁用与 ARIA 语义：PASS

第 2 轮问题位置：`docs/acceptance/ui-verdict-2.md:107`。

### 3.1 规格与源码证据

- 手动网格超限规范明确要求 `aria-invalid="true"`、`aria-describedby` 指向 `role="alert"` 错误行，并以原生 `disabled` 禁用应用按钮：`docs/ui-spec.md:339,642`。
- C-70 明确要求确认审校、导出、预览控件使用真实 `disabled`，导出按钮由 `aria-describedby` 关联 `export.disabled_no_frames`：`docs/ui-spec.md:641`；对应双语词条见 `docs/copy-m1.md:245`。
- 全局可访问规则禁止仅用 `pointer-events:none` 模拟禁用：`docs/ui-spec.md:681`。
- C-71 HTML 提供 `role="alert"` 错误行与正式中英文文案：`design/mockups/review-editor.html:448-464`；运行补丁为错误行生成唯一 ID，给两个输入设置 `aria-invalid`/`aria-describedby`，并设置 `apply-btn.disabled=true`：`design/mockups/review-editor.html:613-622`。
- C-70 HTML 运行补丁给确认、导出及预览控件设置原生 `disabled`，并把导出按钮关联到屏幕阅读器可读说明：`design/mockups/review-editor.html:624-637`；可读说明正文见 `design/mockups/review-editor.html:314`。

### 3.2 Chrome 浏览器实测

环境：Google Chrome `152.0.7977.84`，直接加载 `file:///D:/projects/new_project1/design/mockups/review-editor.html`；页面 `readyState=complete`，主屏加六个动态变体共 7 个 `.screen`，证明以下断言取自脚本执行后的动态 DOM，而非仅检查源码。

| 场景 | 实测步骤 | 实测结果 |
|---|---|---|
| C-71 错误语义 | 读取 `#v-manual` 中 12×50 两个 input、错误行及应用按钮 | 两个 input 的 `aria-invalid` 均为 `true`，两个 `aria-describedby` 均解析到同一运行时唯一错误行；错误行 `role=alert`，正文为“行数×列数是 600，超过了 500 帧上限。调小后再应用。” |
| C-71 真实禁用 | 检查属性与 `:disabled`，随后调用 `focus()`、`.click()` 并监听 click | `disabled=true`、`:disabled=true`；无法成为 `document.activeElement`；click 事件计数为 0 |
| C-70 确认/导出禁用 | 检查 `#v-manual-empty` 的两个按钮，随后调用 `focus()`、`.click()` | 确认与导出均为原生 disabled；导出无法获得焦点；全部点击事件计数为 0 |
| C-70 预览禁用 | 检查 transport 3 个、FPS 2 个、洋葱皮 1 个控件 | 6/6 均为 `disabled=true` 且命中 `:disabled` |
| C-70 导出原因 | 解析导出按钮的 `aria-describedby` | 成功指向同一变体内的 `.export-desc`，可读正文为“至少添加一帧才能导出。” |
| C-70 状态呈现 | 读取关键元素的计算样式 | 降级横幅不可见；导出预览组不可见；零帧时间轴空态可见 |

结论：C-70/C-71 不再只是视觉禁用；原生禁用、焦点/激活抑制及 ARIA 关联均在浏览器运行态成立。

## 4. 修复引入新问题检查

本轮提交只修改 `docs/ui-spec.md`、`design/mockups/review-editor.html`、`design/mockups/export-panel.html`；逐项检查结果：

1. C-39 同步改为真实禁用。浏览器动态 DOM 中，增删/合并/拆分/撤销重做、确认、导出、新增/拆分工具及四个滑杆共 12 个目标，12/12 均命中原生 `:disabled`；选择、平移、缩放仍未被禁用。源码见 `design/mockups/review-editor.html:599-603`，规格见 `docs/ui-spec.md:626`。
2. D-60 “生成并下载”同步改为原生禁用：源码见 `design/mockups/export-panel.html:97,288,292`。Chrome 直接加载后实测 `disabled=true`、`:disabled=true`，调用 `focus()` 后不能获得焦点，调用 `.click()` 的事件计数为 0。
3. `review-editor.html` 动态生成六个变体成功，C-68/C-69 既有状态补丁仍执行；无脚本加载失败迹象。
4. `git diff --check HEAD^..HEAD` 无空白或补丁格式错误。

未发现本轮修复引入的新问题。

## 5. 问题清单

无。

## 6. 第 3 轮流程结论

验收官技术裁决为 **PASS**。本阶段已到第 3 轮，不再自动进入第 4 轮；请产品主依据本裁决作最终人工裁定。

# SpriteFlow M1 UI 规范

> 版本：1.0；日期：2026-09-16；角色：UI/UX 设计师（R2）。
> 事实来源：`docs/prd-m1.md`（功能与流程）、`docs/copy-m1.md`（全部界面文案，本文直接引用其 Key）、`docs/interface-contract.md`（数据字段、进度阶段、错误与恢复动作）、`docs/architecture-m1.md` 第 9 节（UI 状态交接表）。
> 本规范是可直接实施的规格：前端工程师（R5）照此实现，不自行发挥。HTML 静态稿见 `design/mockups/`（结构与样式以稿为准，本文给出尺寸原则与状态语义）。

---

## 1. 设计原则

目标用户是工具重度使用者。优先级从高到低：

1. **键盘效率**：所有帧操作有快捷键；手不离键盘完成「检视 → 修正 → 确认 → 导出」。
2. **大图流畅**：处理在 Worker，主线程只做交互；任何处理期间界面可响应、可取消（对应 PRD 成功指标「UI 心跳」）。
3. **状态清晰**：当前检测方式、待复核数量、未确认数量、任务进度、可否导出，任一时刻一眼可读。
4. **诚实呈现**：降级不用成功语气；进度只用真实值；无假进度动画。
5. **视觉克制**：暗色、低饱和、高对比；色彩只用于表达状态（选中/警告/角标），不做装饰。

M1 只做**暗色单主题**（目标人群默认暗色，PRD 未要求主题切换；是否补浅色主题见第 11 节设计发现 D-04）。中英双语从第一天完整（F-01），语言切换器常驻顶栏。

---

## 2. 信息架构与页面流

单页应用，无路由。整个应用是一个状态机，顶层状态 5 个 + 全局浮层：

```
                 ┌─────────── 拖放/点选文件 ───────────┐
                 ▼                                     │
  [S1 上传空状态] ──预检──> [S2 检测中] ──成功──> [S3 审校工作区] <──┐
                 │            │                        ▲        │
                 │            ├─低置信度/全透明──────────┤(降级进入S3，│
                 │            │        (仍进 S3，带降级横幅) 带手动网格) │
                 │            ├─取消──> [S1]            │        │
                 │            └─检测异常─> S1 + 错误面板   │        │
                 │                                        │        │
                 │              确认审校后，点「导出」         │        │
                 │                    │                   │        │
                 │                    ▼                   │        │
                 │            [S4 导出面板(抽屉)] ──返回编辑──┘        │
                 │                    │                            │
                 │                  成功 ──继续编辑/再导出──> [S3]    │
                 └──换一张图(确认后)────────────────────────────────┘
  全局浮层：确认对话框 / 快捷键面板 / Toast / 内存与超大图恢复面板 / Worker 异常面板
```

状态迁移规则：

| 从 | 到 | 触发 | 备注 |
|---|---|---|---|
| S1 | S2 | 预检全部通过（格式、解码、透明占比、尺寸、内存预估） | 预检中的中间态在 S1 内呈现（第 9 节 A-3/A-4） |
| S1 | S1（错误态） | 预检任一项失败 | 不进检测；错误卡片 + `error.choose_another`；超大图/内存走对话框（A-11/A-12） |
| S2 | S3 | detect 成功（含降级返回，`degraded ≠ null` 也是成功返回） | 降级时 S3 顶部有持续横幅、侧栏为手动网格 |
| S2 | S1 | 用户点「停止检测」 | Toast `detect.cancelled` |
| S2 | S1 | 检测未知错误 | 错误卡片 `detect.failed.*` + `action.retry` / `error.open_manual`（进手动模式后仍到 S3，见第 9 节 B-18） |
| S3 | S4 | 已确认审校后点「导出」 | 未确认时被 `export.review_required.*` 模态拦回（D-52） |
| S4 | S3 | `export.back` / `export.continue_editing` | 全部审校数据保留 |
| S3 | S1 | `action.new_file`（经 `confirm.new_file.*` 确认） | 清空帧与历史 |
| S4 | S4 | `export.again` | 保留面板，改格式再导出 |

任何时候语言切换（顶栏）只改变文案层，不重置状态、不中断进行中的任务（AC-F01 场景 B）。

---

## 3. 全局布局与尺寸原则

### 3.1 应用外壳（App Shell）

设计基准 1440×900；最小支持 1024×640（低于此显示横向滚动，不做移动布局）。

```
┌──────────────────────────────────────────────────────────────────┐ 40  顶栏 topbar
├──────────────────────────────────────────────────────────────────┤ 48  工具栏 toolbar（仅 S3）
│                                              ┌───────────────┐     │
│                  画布区 canvas                │  侧栏 sidebar  │     │
│                  flex: 1, min 560×360        │  292px 固定    │     │
│                                              │  可折叠        │     │
│                                              └───────────────┘     │
├──────────────────────────────────────────────────────────────────┤ 152 时间轴 timeline（仅 S3）
├──────────────────────────────────────────────────────────────────┤ 28  状态栏 statusbar
└──────────────────────────────────────────────────────────────────┘
```

| 区域 | 高度/宽度 | 规则 |
|---|---|---|
| 顶栏 | 高 40px，通栏 | 左：产品名 + 文件名/尺寸（S3 起）；右：快捷键入口、语言切换 |
| 工具栏 | 高 48px，通栏 | 左：工具组；中：编辑动作组；右：确认审校 + 导出 |
| 画布区 | flex 填充 | 最小 560×360（1024 宽 + 侧栏折叠时 ≥ 720×360） |
| 侧栏 | 宽 292px（可折叠至 0，折叠按钮 24px 常驻画布右上角） | 内容见 5.3；内滚动 |
| 时间轴 | 高 152px（头部 40 + 芯片行 ~96 + 预览摘要内含） | 内容见 5.3.4 |
| 状态栏 | 高 28px，通栏 | 左：任务状态点；右：缩放、坐标、检测方式、帧计数 |

S1/S2 无工具栏/侧栏/时间轴：S1 内容居中于画布区；S2 为居中卡片（见 5.2）。

### 3.2 间距与栅格

- 基础栅格 4px：所有间距取 4/8/12/16/24/32。
- 面板内边距 12px；分组间距 16px；组内控件间距 8px。
- 顶栏/工具栏控件左右间距 8px；按钮组之间分隔条（1px `border-1`）+ 左右各 12px。

### 3.3 z-index 层级

| 层 | 值 | 内容 |
|---|---|---|
| 画布内容 | 0 | 图像、帧框、手柄 |
| 画布浮层 | 10 | 缩放控件簇、降级横幅（横幅在画布区内顶部） |
| 侧栏/时间轴 | 1 | 常规布局层 |
| Toast | 200 | 底部居中偏右 |
| 抽屉（导出） | 100 | 右侧滑入 + 轻遮罩 |
| 模态（确认/阻断/恢复面板） | 300 | 居中 + 全屏遮罩 |

---

## 4. 设计系统（暗色，默认且唯一主题）

### 4.1 色板

设计令牌以 CSS 自定义属性给出，实现直接引用：

```css
:root {
  /* 背景与表面 */
  --bg-0: #0e1116;      /* 应用底 */
  --bg-1: #151a22;      /* 面板（顶栏/侧栏/时间轴/状态栏） */
  --bg-2: #1c232e;      /* 输入控件、悬停表面 */
  --bg-3: #242d3b;      /* 按下、芯片激活底 */
  /* 边框 */
  --border-1: #2a3342;  /* 常规分隔 */
  --border-2: #3a465a;  /* 悬停边框、强调分隔 */
  /* 文字 */
  --text-1: #e8edf5;    /* 主文字 */
  --text-2: #a7b1c4;    /* 次要文字、标签 */
  --text-3: #6b7688;    /* 禁用、占位 */
  /* 主色（选中/主按钮） */
  --accent: #4d8dff;
  --accent-hover: #6ea3ff;
  --accent-active: #3b74e0;
  --accent-dim: rgba(77, 141, 255, 0.16);   /* 选中底、焦点 halo */
  /* 语义色 */
  --ok: #43d17c;        /* 成功 */
  --warn: #f0b13e;      /* 降级/待复核摘要/尺寸异常角标 */
  --danger: #f0596a;    /* 错误/危险动作 */
  /* 帧框与角标（画布矢量层） */
  --frame: #98a5bd;     /* 未选中帧框 */
  --frame-selected: var(--accent);
  --badge-outlier: #f0b13e;       /* 尺寸异常 */
  --badge-multi: #b48bff;         /* 可能粘连 */
  --badge-empty: #8b96a8;         /* 空帧 */
  /* 透明棋盘格 */
  --checker-a: #232a35;
  --checker-b: #1a202a;           /* 8px 棋盘 */
}
```

规则：

- 主色蓝只表达「选中/主操作」，警告琥珀只表达「降级与待复核摘要/尺寸异常」，紫只表达「可能粘连」。同一含义只用一个色。
- 文本对比度 ≥ 4.5:1（`--text-2` 对 `--bg-1` 为 7.2:1；角标色作为 11px 文字底时配 `#0e1116` 深字）。
- 语义色不做渐变、不加发光。

### 4.2 字体与字号阶梯

| 级 | px / 行高 | 用途 | 字重 |
|---|---|---|---|
| display | 28/36 | 上传页标题 | 650 |
| h1 | 20/28 | 面板标题（导出抽屉、对话框标题） | 600 |
| h2 | 16/24 | 侧栏分组标题 | 600 |
| body | 13/20 | 正文、按钮、输入 | 400 |
| label | 12/16 | 控件标签、状态栏 | 500 |
| caption | 11/16 | 角标、时间轴序号、tooltip | 500 |
| mono | 12/20 | 坐标、尺寸、文件名、进度百分比 | 400 |

字体栈：UI `system-ui, "Segoe UI", "Microsoft YaHei", sans-serif`；mono `ui-monospace, "Cascadia Mono", Consolas, monospace`（坐标/数值一律 mono，对齐易读）。缩放跟随浏览器默认字号，不做应用内字号设置。

### 4.3 圆角、阴影、焦点

- 圆角：控件 6px；面板/抽屉/模态 8px；角标/芯片 4px。
- 阴影只用于浮层：`0 8px 24px rgba(0,0,0,.45)`；常规面板用边框分层，不用阴影。
- 焦点：`:focus-visible` 统一 `outline: 2px solid var(--accent); outline-offset: 2px`。所有可交互元素必须键盘可达。

### 4.4 组件状态矩阵

| 组件 | default | hover | active/pressed | disabled | loading | error |
|---|---|---|---|---|---|---|
| 主按钮（`tool.confirm_review`、`export.start` 等） | `--accent` 底深字 | `--accent-hover` | `--accent-active` | `--bg-2` 底 `--text-3` 字 + 原因 tooltip | 转圈图标替换左侧图标，文字保留 | 不用（错误走面板/横幅） |
| 次按钮（`export.back` 等） | 透明底 `--border-1` 框 | `--bg-2` | `--bg-3` | 同上 | — | — |
| 危险按钮（`confirm.delete.action`） | `--danger` 底 | 提亮 10% | 压暗 10% | 同 disabled | — | — |
| 图标按钮（工具、撤销/重做） | 透明底，`--text-2` 图标 | `--bg-2` 底 `--text-1` | `--bg-3` | `--text-3`，tooltip 给原因（如 `editor.nothing_to_undo`） | 工具类不进入 loading | — |
| 滑杆 | 轨道 4px `--bg-3`，值块 14px `--accent` | 值块放大 16px | 拖动中同 hover | 整组降透明 40% | 防抖/重算期轨道变 `--warn` 并锁定 | — |
| 数字步进器（行/列、FPS、最大尺寸） | `--bg-2` 底 mono 数字 | 边框 `--border-2` | — | 降透明 40% | — | 越界红框 + `--danger` 文字（内联） |
| 开关（旋转、洋葱皮） | 关：`--bg-3`；开：`--accent` | 提亮 | — | 降透明 | — | — |
| 筛选芯片 | `--bg-2` 底 + 计数 | `--bg-3` | 激活：`--accent-dim` 底 + `--accent` 边 + 文字 | 无匹配的芯片不显示 | — | — |
| 帧角标 | 见 7.1 | tooltip 出现 | — | — | — | — |
| 进度条 | 见 6.9 | — | — | — | 进行中 | — |
| Toast | `--bg-2` 底 + 左侧 3px 语义色条 | — | — | — | — | 错误 toast 用 `--danger` 条 |

工具栏中「工具类按钮」（选择/平移/新增/拆分）有第 5 态 **active-tool**（当前工具）：`--accent-dim` 底 + `--accent` 图标和下边框 2px。

---

## 5. 各屏规格

### 5.1 S1 上传空状态

布局：画布区整体居中一个 560px 宽的列，自上而下：

1. `app.name`（产品名，20px，左上角顶栏也有）+ `app.tagline`（display 28px）。
2. `privacy.local_only`（body，`--text-2`，前面加锁形 14px 图标）——隐私承诺必须在首屏可见。
3. 拖放区：高 220px，`--bg-1` 底、2px 虚线 `--border-2` 边框、圆角 8px。内含 `upload.empty.title`（h1）与 `upload.empty.hint`（body，`--text-2`）。拖放悬停时：边框变 `--accent` 实线、底变 `--accent-dim`、中央文字替换为 `upload.drop_active`。
4. 主按钮 `upload.browse`（主按钮样式，触发文件选择器）。拖放区整体也可点击。
5. 底部说明行：`upload.empty.hint` 重复的格式说明不出现第二次；此处放支持格式徽标（PNG / WebP 小芯片，静态）。
6. 顶栏右侧：`action.learn_shortcuts`、语言切换（`language.label`，下拉：`language.zh` / `language.en`）。

预检/错误态都在本屏内呈现（状态清单 A 组）：预检显示文件信息卡（`upload.file_name` / `upload.file_type` / `upload.file_size` 三行 label+mono 值）+ 阶段文案；错误替换拖放区下沿位置显示错误卡片（标题 h1 + 正文 body + `error.choose_another` 按钮），拖放区保留可用。

超大图（A-11）与内存预检（A-12）用**居中模态**（不是卡片），因为必须等待用户决策：正文含真实值（`{width}×{height}` mono），`oversize.target` 下拉（预设 8192/6144/4096/2048，默认建议值），主按钮 `oversize.continue` / `memory.downscale_retry`，次按钮 `oversize.cancel` / `action.cancel`。

### 5.2 S2 检测中

居中卡片 420px 宽：

1. 标题 `detect.title`（h1）。
2. 阶段清单（5 行，垂直）：`detect.preparing` → `detect.grid` → `detect.components` → `detect.comparing` → `detect.finalizing`。当前阶段 `--text-1` + 行首 14px 旋转 spinner；已完成 `--text-2` + 对勾；未到 `--text-3`。auto 模式按契约执行顺序点亮（grid 恒在 components 前）；仅 grid 命中后 components 行显示「已跳过」样式（对勾灰色）。
3. 进度条（6.9 规格）+ 百分比 mono。`detect.progress` 作为 `aria-label`。
4. 底部左：`detect.cancel`（次按钮）。处理不可取消阶段时该按钮禁用（进度事件 `cancellable=false`）。

进度阶段与文案映射（源自契约 ProgressStage 权重）：

| 契约阶段 | 权重 | 显示文案 |
|---|---|---|
| validate + analyze | .15 | `detect.preparing` |
| grid | .15 | `detect.grid` |
| components | .45 | `detect.components`（grid 已入选时显示「已跳过」） |
| （策略决策边界事件） | — | `detect.comparing` |
| normalize + hash | .25 | `detect.finalizing` |

取消后回 S1，Toast `detect.cancelled`。成功直接切 S3 并 Toast `detect.success.grid` / `detect.success.components`（降级时不发成功 Toast，由降级横幅接管）。

### 5.3 S3 审校工作区

#### 5.3.1 顶栏

左：`app.name`（16px）→ 文件名（mono，`--text-2`）→ `{width}×{height}`（mono `--text-3`）。右：`action.new_file`（次按钮）→ `action.learn_shortcuts`（图标按钮）→ 语言切换。

#### 5.3.2 工具栏（48px）

```
[选择 V][平移 H][新增帧 A][拆分 S] │ [删除][合并 M] │ [撤销][重做] │…弹簧…│ [确认审review][导出]
```

- 工具组 4 个图标按钮（含 active-tool 态），tooltip = `tool.select` 等 + 快捷键（如「选择 (V)」）。
- 编辑动作组：删除（`tool.delete_frame`）、合并（`tool.merge_frames`）。启用条件：删除 = 有选中帧；合并 = 选中 ≥2。不满足时禁用，tooltip 显示 `editor.select_to_merge`（合并）/ 直接禁用无附加文案（删除，因零选中已自明）。
- 撤销/重做：禁用时 tooltip `editor.nothing_to_undo` / `editor.nothing_to_redo`。
- 右侧主按钮组：
  - `tool.confirm_review`（主按钮）。未确认且有 included 帧时为主色；下方状态栏同步显示 `review.pending`。点击后 Toast `review.confirmed`，按钮变为成功描边态（`--ok` 边框 + 对勾图标 + 原文案），**不可再点**；任何新的编辑/撤销/重做/参数重算使按钮回到主色待确认态并刷新 `review.pending` 计数。
  - `tool.export`（次按钮 → 确认审校后变为主按钮）。零 included 帧时禁用，tooltip `export.disabled_no_frames`；未确认时点击弹 `export.review_required.*` 模态（D-52）。

#### 5.3.3 画布区

- 全区 `--bg-0`；图像区域绘制透明棋盘格（8px），图像外区域为纯 `--bg-0`。
- 渲染分层（Canvas2D）：底层图像（1024 预览打底，按需向 Worker 请求可见区域精细 tile，LRU ≤32MiB）→ 帧框矢量层 → 手柄层 → 标注层（序号/尺寸/角标）。
- 画布内右上角浮层：缩放控件簇（`tool.zoom_out` / 百分比 mono 点击回 100% / `tool.zoom_in` / `tool.fit`），垂直排布，`--bg-1` 底圆角 6px。
- 画布内顶部（需要时）：降级横幅（7.3）或重算横幅（6.8），通栏 40px，`--warn` 左边条 3px。
- 帧框视觉：
  - 未选中：1.5px `--frame` 实线；左上角序号标签（caption，mono，`--bg-1` 85% 透明底）。
  - 选中（单选）：2px `--frame-selected` + 外圈 1px `--accent-dim` halo；8 个手柄（见 6.3）；右下角尺寸标注 `editor.frame_size`（mono，accent 底深字）；左上角序号标签保持。
  - 选中（多选）：联合虚线框（1px dash `--frame-selected`），**无手柄**（8 手柄缩放仅单选，见 6.4）；每个成员帧保持 2px 选中边。
  - 带角标的帧：右上角角标芯片（7.1），可多个横排。
  - 空帧：框线改为 1.5px dash `--badge-empty`，内部无内容时仍显示序号与角标。
- 筛选激活时：不符合条件的帧框与序号降到 15% 不透明度（数据不变，见 7.2）。

#### 5.3.4 时间轴（152px）

```
┌ 头部 40px ────────────────────────────────────────────────────────┐
│ [动画预览] [⏮][▶][⏭] [12 FPS] [洋葱皮⏀]   …弹簧…  [筛选帧: 全部帧(n) 全部待复核(n) …] [16 帧] │
├ 芯片行（水平滚动，高 ~96） ────────────────────────────────────────┤
│ [①thumb][②thumb][③thumb•]…                                          │
└───────────────────────────────────────────────────────────────────┘
```

头部左侧（`preview.title` 分组）：播放/暂停（`preview.play` / `preview.pause`，同一按钮按状态切换）、上一帧/下一帧（`preview.previous` / `preview.next`）、FPS 步进器（`preview.fps`，范围 1–120 步进 1，默认 12）、洋葱皮开关（`preview.onion_skin`，开/关态 tooltip 用 `preview.onion_on` / `preview.onion_off`）。
头部右侧：筛选芯片组（7.2）+ `editor.summary`（mono）。

芯片：72×84px；内容 = 缩略图 56×56（统一逻辑画布预览，棋盘格底）+ 底部序号（caption mono）。选中 = `--accent` 2px 边 + `--accent-dim` 底。角标显示为缩略图右上角 8px 色点（颜色同 7.1，tooltip 同文案）。空帧芯片 = 虚线边 + `--badge-empty` 色点。拖拽排序：拖起时芯片半透明跟随指针，目标位显示 2px `--accent` 竖线插入指示；落下提交一个排序事务（6.7）。悬停 tooltip：`editor.frame_index`。

辅助文案（头部下方一行 caption，条件显示）：`editor.reorder_hint`（首次进入且帧 ≥2 时显示 8s）；`preview.empty`（零帧时整个芯片行替换为居中空状态文案，播放控件禁用）。

#### 5.3.5 状态栏（28px）

左→右：任务状态点（空闲=灰点；处理中=`--accent` 呼吸点 + `status.busy` aria）│ 缩放百分比（mono，点击回到 100%）│ 指针坐标 `x, y`（mono，图像像素坐标）│ `detect.method.label`: `detect.method.grid/components/manual` │ `editor.summary` │ （多选时）已选计数（见设计发现 D-01）。

#### 5.3.6 侧栏（292px，可折叠）

自上而下三组（组间距 16px，各自可整体显示/隐藏）：

**组 1 · 检测方式**（始终显示）
- 一行：`detect.method.label` 值芯片（网格/区域/手动）。
- `detect.recalculate` 次按钮（整宽）。点击弹 `confirm.reset_detection.*` 确认（替换当前帧）。
- 策略 ≠ manual 且未降级时，下方文本链接 `fallback.bad_result`（caption，`--accent`）。点击后侧栏切换为组 2 的手动网格面板（不弹窗、不动帧；后续「应用网格」才弹确认）。

**组 2a · 检测设置**（自动模式显示；`settings.detection` 标题）
- 4 个滑杆 + 每个一行 help（caption `--text-3`）：

| 词条 | 绑定参数（契约） | 范围 | 默认 | 备注 |
|---|---|---|---|---|
| `settings.tolerance` (+help) | `alphaThreshold` | 0–254 | 8 | 线性 |
| `settings.min_area` (+help) | `minAreaPx` | 1–1,000,000 | 4 | 对数刻度；值框可直接输入 |
| `settings.dilation` (+help) | `dilationRadiusPx` | 自动 / 0–128 | 自动 | 默认「自动」（值区显示 `detect` 契约的自动值）；拖动即切显式值；0 = 禁用 |
| `settings.merge_distance` (+help) | `mergeDistancePx` | 自动 / 0–512 | 自动 | 同上 |

- `settings.reset` 次按钮：全部回默认（自动档恢复自动）。
- 防抖/重算期整组锁定，组头部右侧显示 `settings.pending`（见 6.8）。

**组 2b · 手动网格**（手动模式显示；`manual.title` 标题）
- 两个步进器：`manual.rows` / `manual.columns`（1–100；乘积超 500 时步进器红框内联报错）。
- `manual.apply` 主按钮（整宽）→ 弹 `confirm.reset_detection.*` → 提交 manual-grid 检测。
- `manual.reset` 次按钮：行列回到当前建议值。
- `manual.draw_hint`（caption）。

**组 3 · 导出预览**（`editor.normalized_preview` 标题）
- 当前选中帧的规范化画布预览：正方形棋盘格区域（约 248×186，等比缩放显示），内容按 `canvas.offset` 摆放；下方一行 mono：画布尺寸 + `editor.frame_size`。多选或未选中时显示提示（复用 `editor.frame_index` 的空态说明——未选中时显示「—」）。
- help：`editor.normalized_preview_help`（caption）。
- 预览数据随草稿变更后台自动重算（轻量 normalize 任务）；重算中预览区显示细进度线，不阻塞编辑；角标以重算完成后的 flags 为准。
- 零帧时组 3 隐藏，`manual.no_frames` 文案已在时间轴空态覆盖。

**降级横幅**（画布区顶部，不是侧栏）：见 7.3。

#### 5.3.7 确认对话框（通用模态规格）

标题 h1 + 正文 body + 按钮行（右对齐：次按钮取消 `action.cancel` / 主或危险按钮）。Enter = 主按钮，Esc = 取消。焦点圈定在模态内。用到：`confirm.delete_one|many`（+ `confirm.delete.body`，危险按钮 `confirm.delete.action`）、`confirm.reset_detection`、`confirm.new_file`。

### 5.4 S4 导出面板（右侧抽屉）

480px 宽抽屉从右滑入，遮罩 rgba(4,6,10,.5)（点击不关闭——防误触，只能用 `export.back` 或 Esc）。内容自上而下：

1. 标题 `export.title`（h1）+ 关闭（= `export.back`，图标按钮）。
2. 摘要 `export.summary`（body，`{count}` mono）。
3. `export.format` 分组：3 张单选卡（整行高 56px，左圆形 radio，标题 = 选项文案，副行 caption 说明产物文件）：
   - `export.phaser_hash` — atlas.png + atlas.json + animations.json
   - `export.phaser_array` — atlas.png + atlas.json + animations.json
   - `export.godot` — frames/ + sequence.json + build_spriteframes.gd + README.txt
4. `export.atlas_settings` 分组（选 Godot 时整组隐藏并显示一行 caption「Godot 导出为帧序列，不打包图集」——此说明性文字复用 `export.godot` 副行，不新增词条）：
   - `export.atlas_size`：单选组 `export.size_auto` / `export.size_pot_2048` / `export.size_pot_4096` / `export.size_pot_8192`。
   - `export.size_limit`：步进器（64–8192，默认 2048；auto 时作为上限，POT 时即页面尺寸）。
   - `export.rotation` 开关（默认关）。
   - 只读行：`export.padding` `2 px`、`export.extrude` `1 px`（M1 固定默认值，控件禁用样式 + caption 注明固定）。
5. 错误内联区（条件显示）：`export.size_too_small`（PACK_OVERFLOW / FRAME_TOO_LARGE 时，danger 文字，建议切 `export.size_auto` 或更大 POT）。
6. 底部按钮行（吸底）：`export.back` 次按钮 + `export.start` 主按钮。

处理中（6.9）：抽屉内容替换为阶段清单 + 进度 + `export.cancel`。阶段映射：pack 任务 → `export.packing`；export 任务 validate+render → `export.preparing`；encode → `export.writing_phaser` / `export.writing_godot`（按所选格式）；archive → `export.zipping`。

成功态：对勾图标（`--ok` 32px）+ `export.success.title` + `export.success.body`（`{name}` mono）+ 按钮行：`export.download` 主按钮 / `export.again` / `export.continue_editing` 次按钮。点击 `export.start` 即尝试自动触发浏览器下载；若被阻止，呈现 `export.download_blocked.*` 错误卡片（此时 `export.download` 按钮保留供用户授权后重试）。

失败态：`export.failed.*` + `action.retry` / `export.back`；内存失败走 `memory.runtime.*` + `memory.downscale_retry` / `memory.back_to_editor`；帧越界走 `export.invalid_frame.*`，`memory.back_to_editor` 词条复用为「返回编辑」动作（`export.back` 同义，优先用 `export.back`），返回后画布上越界帧以 `--danger` 边框高亮闪烁 2 次。

---

## 6. 关键交互规格

### 6.1 帧选择

- 点击帧：单选（替换现有选择）。
- Ctrl+点击：切换该帧选中态。
- Shift+点击（时间轴芯片）：范围选择（从上次锚点芯片到当前）。
- 画布空白处拖动：框选（marquee），松开时选中与拖拽矩形**相交**的全部帧；拖动距离 <3px 视为点击空白 = 取消选择。
- Ctrl+A 全选；Ctrl+D / Esc 取消选择（Esc 优先取消进行中的操作，见 6.10）。
- 画布选中 ↔ 时间轴芯片选中双向同步；从画布选中时时间轴自动滚动到当前芯片。

### 6.2 拖动移动

- 摹柄下（非手柄区域）按下即进入移动预览：所有选中帧整体跟随指针（不限于单帧）。
- 移动过程中帧框实时更新，尺寸标注不显示（位置未提交）。
- pointerup 提交：坐标取整（左/上 floor、右/下 ceil 对齐半开区间），并**钳制到图像范围内**（契约：sourceRect 必须完整在图内，越界请求不能被管线修正，由 UI 负责钳制）；提交 = 一个撤销事务。
- 键盘微调：方向键 1px，Shift+方向键 10px（画布聚焦且无文本输入焦点时）。

### 6.3 8 手柄缩放

手柄 8 个：四角 + 四边中点。视觉 8×8px 方块（`--bg-1` 底 + `--accent` 2px 边），命中区 12×12px。光标：角落 `nwse-resize`/`nesw-resize`，上下边 `ns-resize`，左右边 `ew-resize`（按相对画布旋转不变）。

- 仅单选时显示手柄（多选显示联合虚线框无手柄）。
- 拖动实时预览；**最小尺寸 1×1px，不允许负宽高**（PRD AC-F07 A）；对边固定。
- 越图像边界：允许拖出预览，pointerup 时钳制回图内并取整提交。
- 提交 = 一个撤销事务；尺寸标注全程实时刷新 `editor.frame_size`。

### 6.4 多选语义

- 移动：整体移动（6.2）。缩放：不可用（无手柄）。
- 删除/合并：可用（合并要求 ≥2，正满足）。
- 排序拖拽：仅单芯片（6.7）。

### 6.5 新增帧（`tool.add_frame` / A 键）

- 激活工具后画布光标变十字；按下拖出矩形，实时预览 1.5px `--accent` 虚线框。
- 松开：最小 1×1，钳制图内，取整提交；Toast `editor.frame_added`；工具自动回到「选择」。
- 工具悬停 tooltip 附 `editor.add_hint`。绘制中 Esc 取消。

### 6.6 合并与拆分

**合并**（M 键 / 工具栏）：选中 ≥2 时可用；生成新帧 = 源框并集（新 id，记录来源）；Toast `editor.frames_merged`；一个撤销事务。选中 <2 时按钮禁用 + tooltip `editor.select_to_merge`。

**拆分**（S 键 / 工具栏）：恰选中 1 帧时可用；激活后进入拆分模式：
1. 光标十字 + 顶部提示条显示 `editor.split_hint`。
2. 在帧内点第一点 → 出现预览线跟随指针；点第二点确定切割线。
3. 切割方向按线段主轴：|dx| ≥ |dy| 垂直切（左右两帧），否则水平切（上下两帧）；两个结果均为整数矩形且各边 ≥1px，否则本次点击无效并保持等待第二点（重新显示 `editor.split_hint`）。
4. 完成：帧替换为两个新帧（顺序 = 左/上在前），Toast `editor.frame_split`；一个撤销事务。Esc 取消。
- 选中数 ≠1 时按钮禁用 + tooltip `editor.select_one_to_split`。

### 6.7 删除与排序

**删除**：Delete / Backspace / 工具栏 → 弹确认（`confirm.delete_one` / `confirm.delete_many`，正文 `confirm.delete.body`，危险按钮 `confirm.delete.action`）。确认后 Toast `editor.frame_deleted`。键盘删除在对话框上 Enter 确认、Esc 取消。

**排序**：时间轴单芯片拖拽（5.3.4）。提交后 Toast `editor.order_updated`。顺序 = 播放顺序 = 导出顺序；**帧名不重命名**（PRD F-10：重排只改顺序）。画布序号标签与时间轴序号即时同步为新顺序。

### 6.8 检测参数滑杆：300ms 防抖与重算（F-14）

时间线（与契约 9.2 一致）：

1. **拖动中**：滑杆值实时更新；侧栏组头部出现 `settings.pending`（caption，`--warn`）；滑杆轨道变 `--warn`。帧框不变。
2. **停手 300ms**：提交 preview 质量重算（≤1024 分析副本）：画布顶部横幅 `detect.recalculating`（40px，`--warn` 左条 + spinner），当前帧框降为 40% 不透明度，**几何编辑全部禁用**（移动/缩放/增删/合并/拆分/排序/撤销重做/确认审校禁用；平移缩放与选择仍可用）。横幅右侧 `detect.cancel` 可中止。
3. **preview 结果返回**：原子替换整组帧（旧编辑被替换——正因如此先有 `confirm.reset_detection` 语义的确认才进入该流程？不：滑杆重算不逐次弹窗，**但重算替换本身是一个可撤销事务**，误调可 Ctrl+Z 找回；`confirm.reset_detection` 确认框只用于「重新检测」按钮与「应用网格」）。横幅保持（final 还在跑）。
4. **final 完成**：帧框/角标以 final 为准刷新，横幅消失，编辑恢复。`review.pending` 计数重置（所有帧回到 pending）。
5. 连续拖动只保留最后一次意图：新参数到来时取消在跑任务，等终态后提交最新（契约），期间横幅持续。

诚实性：preview 结果可能缺最终角标（hash/outlier 终值），横幅期间时间轴角标区显示灰点占位，final 后落色。

### 6.9 真实进度呈现（全局规格）

- 进度条：高 6px，圆角 3px，轨道 `--bg-3`，填充 `--accent`；百分比 mono 右侧。
- 数值只来自契约 ProgressEvent 的 `overallProgress`（单调不减）；**禁止定时器假进度**。
- `totalUnits=null` 的阶段（如原生编解码）：该阶段内进度条显示**不定态条纹**（CSS 动画表达「进行中」而非百分比），百分比数字保持上一阶段末值；标签脉冲。
- 取消：进度事件 `cancellable=true` 时显示取消按钮；请求后按钮变「取消中…」禁用，直到终态。
- 全部进度 UI 提供 `detect.progress` / `export.progress` 的 aria 文本；全局 `aria-live=polite` 用 `status.busy` / `status.ready`。

### 6.10 撤销 / 重做

- 历史粒度（一个事务 = 一次 undo 步）：帧几何提交（pointerup）、新增、删除（确认后）、合并、拆分、排序提交、检测重算替换、手动网格应用、**确认审校本身**（可撤销；撤销后回到 pending）。
- 上限 100 事务（架构定版）；耗尽更早即按钮禁用 + tooltip `editor.nothing_to_undo` / `editor.nothing_to_redo`。
- 任何草稿变更（含撤销/重做）使「确认审校」回到待确认态、`review.pending` 刷新、规范化预览触发后台重算。
- Ctrl+Z / Ctrl+Shift+Z / Ctrl+Y；文本输入聚焦时交给浏览器原生行为。

### 6.11 视口（pan / zoom / fit，F-06）

- 滚轮 = 以指针为中心缩放（Aseprite/PS 习惯）；Ctrl+滚轮同义（触控板捏合）。步进 ≈ ×1.1，范围 1/32×–32×，越界钳制。
- 空格按住 = 临时平移（光标变抓手）；H 切换平移工具；中键拖动平移。
- `0` = `tool.fit`（适合窗口）；`1` = 100%；`2` = 缩放到选中帧联合框。
- 图像与帧框永远坐标对齐（同一 viewport 变换）；帧框存储原图坐标，缩放/平移不改变数据。
- 8K 图：先显示 1024 预览，可见区域细节异步补齐（棋盘格上先低清后高清，不闪白）；缩放/平移期间帧框层矢量绘制不受图像分辨率影响。

---

## 7. F-18 承接：待复核角标、筛选与确认

> 本节为 Gate 1 r2 设计交接的落实（PRD F-18 / AC-F18 / 契约第 8 节 / 架构第 9 节交接表）。只承接既有 PRD，不新增功能。

### 7.1 三个角标

| flag（契约 FrameFlags） | 词条 | 颜色 | 呈现位置 |
|---|---|---|---|
| `outlier` | `review.badge.outlier` 尺寸异常 / Size outlier | `--badge-outlier` 琥珀 | 画布帧右上角芯片；时间轴芯片右上色点；tooltip 同文案 |
| `multipleComponents` | `review.badge.multiple_components` 可能粘连 / Possible merge | `--badge-multi` 紫 | 同上 |
| `empty` | `review.badge.empty` 空帧 / Empty frame | `--badge-empty` 灰 | 同上（空帧框线为虚线） |

规则：

- 同一帧可同时带多个角标：画布芯片横排堆叠（每片 11px caption，深底浅字，间隔 4px），时间轴为多色点横排。
- 角标**只提醒**：不改变帧内容、included 状态、顺序；显示条 `review.attention.body` 的语义即产品承诺。
- 角标芯片样式：高 18px，圆角 4px，色底（90% 不透明）+ `#0e1116` 深字。
- 编辑帧（移动/缩放）后 flags 由下一次 normalize 重算；重算前旧角标保留显示（不猜测清除）。

### 7.2 筛选（`review.filter.*`）

- 筛选组位于时间轴头部右侧，5 个芯片：`review.filter.all`（默认激活）/ `review.filter.attention` / `review.filter.outlier` / `review.filter.multiple_components` / `review.filter.empty`，每个附计数（caption mono）。
- `review.filter.attention` = outlier ∨ multipleComponents ∨ empty（与 reviewStatus 独立）。
- 组标签 `review.filter.label` 作为芯片行前缀（caption）。
- 语义：**只影响显示**——时间轴隐藏不匹配芯片；画布上不匹配帧框降到 15% 透明度；included/顺序/导出数据不变。
- 播放与导出始终按完整时间轴（筛选是查看辅助，不裁剪序列）。
- 无匹配：芯片行显示 `review.filter.none`（居中 caption）+ 快捷链接「`review.filter.all`」（点击清除筛选回到全部帧）。
- 计数为 0 的具体类筛选芯片不显示（避免死入口）；`all` 与 `attention` 恒显示。

### 7.3 待复核摘要与确认

- 存在任一 flagged 帧时，时间轴头部下方显示一行摘要条（`--warn` 左条 + 折叠）：`review.attention.title`（caption `--text-1`）+ `review.attention.body`（caption `--text-3`），可点击展开/收起，默认展开首次出现时 8s 后自动收为一行。零 flagged 时整条隐藏。
- 未确认：状态栏与「确认审校」按钮联动显示 `review.pending`（还有 {count} 帧未确认）。
- 「确认审校」（`tool.confirm_review`）：将全部 included 帧 reviewStatus 置 accepted；Toast `review.confirmed`；**flags 与角标保留**（不清除、不自动修复/折叠/排除）；筛选状态不变。
- 确认后：`tool.export` 可用；导出管线校验 REVIEW_REQUIRED 通过。
- 任何编辑后回到 pending（6.10）。
- dHash 数值与 duplicateOf 在 M1 **不暴露**任何 UI（无面板、无 tooltip、无折叠控件）。

### 7.4 降级横幅（画布区顶部，持续显示）

两种文案（同为 `--warn` 左条横幅，含关闭 ✕ 折叠为 40px 细条可再展开）：

1. 低置信度/失败降级：`fallback.title` + `fallback.body`；动作：`fallback.retry_auto`（次按钮）。侧栏已切换为手动网格面板（预填建议行列），画布已是建议网格帧（全部 pending）。
2. 全透明降级（EMPTY_INPUT）：`fallback.empty_input.title` + `fallback.empty_input.body`；无重试按钮（重试无意义），仅关闭；画布为 1 个待确认空帧（虚线框 + 空帧角标）；侧栏手动网格。

「结果不对？切到手动模式」（`fallback.bad_result`）入口仅在**非降级**时显示于侧栏组 1 底部（5.3.6）；点击后：若当前无帧或有帧需替换，进入手动网格面板；用户点 `manual.apply` 时弹 `confirm.reset_detection.*` 确认（主按钮文案用 `fallback.use_manual`），确认后以当前行列执行 manual-grid 检测替换帧。

---

## 8. 快捷键完整表

设计约束：对齐 Aseprite/Photoshop 肌肉记忆；**不占用浏览器保留组合**（Ctrl+W/T/N/F、Ctrl+0、Ctrl+Plus/Minus、F5/F12、Ctrl+S/E 等）；单字母快捷键仅在画布/工作区焦点且无文本输入聚焦时生效；所有快捷键在快捷键面板（`shortcuts.title`，`?` 呼出，`shortcuts.close` 关闭）可查。

| 快捷键 | 动作 | 文案 Key | 肌肉记忆来源 |
|---|---|---|---|
| `V` | 选择工具 | `shortcuts.select` / `tool.select` | PS 移动/选择 |
| `H`（切换）/ `空格`按住（临时） | 平移画布 | `shortcuts.pan` / `tool.pan` | PS 抓手 |
| `滚轮` / `Ctrl+滚轮` | 以指针为中心缩放 | `tool.zoom_in/out`（无词条动作） | Aseprite |
| `中键`拖动 | 平移 | — | PS/Aseprite |
| `+` / `=` | 放大 | `tool.zoom_in` | 通用 |
| `-` | 缩小 | `tool.zoom_out` | 通用 |
| `0` | 适合窗口 | `shortcuts.fit` / `tool.fit` | Figma（避开浏览器 Ctrl+0） |
| `1` | 100% 实际像素 | — | PS Ctrl+1 的避让版 |
| `2` | 缩放到选中帧 | — | Figma Shift+2 简化 |
| `A` | 新增帧工具（拖拽画框） | `shortcuts.add` / `tool.add_frame` | — |
| `S` | 拆分选中帧（两点拉线） | `shortcuts.split` / `tool.split_frame` | — |
| `M` | 合并选中帧 | `shortcuts.merge` / `tool.merge_frames` | — |
| `Delete` / `Backspace` | 删除选中帧（确认框） | `shortcuts.delete` / `tool.delete_frame` | 通用 |
| `Ctrl+Z` | 撤销 | `shortcuts.undo` / `tool.undo` | 全行业 |
| `Ctrl+Shift+Z` / `Ctrl+Y` | 重做 | `shortcuts.redo` / `tool.redo` | PS/Aseprite |
| `Ctrl+A` | 全选帧 | — | 通用 |
| `Ctrl+D` | 取消选择 | — | PS |
| `←→↑↓` | 微调选中帧 1px | — | Aseprite |
| `Shift+方向键` | 微调 10px | — | Aseprite |
| `,` / `.` | 上一帧 / 下一帧 | `preview.previous` / `preview.next` | Aseprite 帧步进 |
| `Enter` | 播放/暂停预览 | `shortcuts.play_pause` | Aseprite（空格已让给平移） |
| `O` | 洋葱皮开关 | `preview.onion_skin` | — |
| `Esc` | 取消当前操作（绘制/拆分/拖动）→ 取消选择 → 关闭浮层 | — | 通用 |
| `?`（Shift+/） | 快捷键面板 | `action.learn_shortcuts` / `shortcuts.title` | 通用 |

注：时间轴帧步进用 `,`/`.` 而非方向键——方向键保留给帧微调（Aseprite 同款分工）；`Enter` 而非空格播放——空格是平移（PS 肌肉记忆优先）。

---

## 9. 界面状态清单（全量）

> 每条：触发 → 呈现位置与形式 → 文案 Key（zh）→ 可用动作。编号用于验收对照。此清单覆盖 PRD 6.1 全部区域与 6.3 全部异常分支。

### A. 上传屏（S1）

| # | 状态 | 呈现 | 文案 | 动作 |
|---|---|---|---|---|
| A-1 | 首次空状态 | 居中列：标语/隐私/拖放区/按钮 | `app.tagline`、`privacy.local_only`、`upload.empty.title`、`upload.empty.hint`、`upload.browse` | 选择图片；语言切换（`language.*`） |
| A-2 | 拖放悬停 | 拖放区高亮态 | `upload.drop_active` | 松开开始预检 |
| A-3 | 预检中 | 拖放区下方文件卡 + 阶段行 | `upload.preflight`、`upload.file_name/type/size` | 等待 |
| A-4 | 解码中 | 同上 | `upload.decode` | 等待 |
| A-5 | 预检通过（瞬态） | 同上，成功色对勾 | `upload.ready` | 自动进入检测 |
| A-6 | 格式不支持 | 错误卡片 | `error.unsupported_type.title/body` | `error.choose_another` |
| A-7 | 多文件 | 错误卡片 | `error.multiple_files.title/body` | `error.choose_another` |
| A-8 | 不透明输入 | 错误卡片 | `error.opaque.title/body` | `error.choose_another`（无去底入口） |
| A-9 | 解码失败 | 错误卡片 + 清理未完成任务 | `error.decode.title/body` | `error.choose_another` |
| A-10 | 重新选择 | 文件卡上的次按钮 | `upload.replace` | 重开选择器 |
| A-11 | 超大图（任一边 >8192） | 居中模态（必须决策） | `oversize.title/body`（真实尺寸）、`oversize.target` | `oversize.continue` / `oversize.cancel`（回空状态） |
| A-12 | 预计内存不足 | 居中模态 | `memory.precheck.title/body` | `memory.downscale_retry`（含目标尺寸选择同 A-11）/ `action.cancel` |

### B. 检测屏（S2）

| # | 状态 | 呈现 | 文案 | 动作 |
|---|---|---|---|---|
| B-13 | 检测进行中 | 居中卡片：阶段清单 + 进度 | `detect.title`、`detect.preparing/grid/components/comparing/finalizing`、`detect.progress`(aria) | `detect.cancel`（不可取消阶段禁用） |
| B-14 | 检测取消 | 回 S1 + Toast | `detect.cancelled` | 重新选择 |
| B-15 | 检测成功 | 切 S3 + Toast | `detect.success.grid` / `detect.success.components` | 进入审校 |
| B-16 | 低置信度降级 | 切 S3 + 持续横幅 + 手动网格侧栏 | `fallback.title/body`、`manual.*` | `fallback.retry_auto`；关闭横幅 |
| B-17 | 全透明降级 | 切 S3 + 横幅 + 1 个待确认空帧 | `fallback.empty_input.title/body` | 关闭横幅；编辑空帧（增删确认均可） |
| B-18 | 检测未知错误 | S1 错误卡片 | `detect.failed.title/body` | `action.retry` / `error.open_manual`（直接进 S3 手动模式） |

### C. 审校屏（S3）

| # | 状态 | 呈现 | 文案 | 动作 |
|---|---|---|---|---|
| C-19 | 正常审校 | 工作区全貌 | `editor.title`（工作区概念）、`editor.summary`、`tool.*` | 全部编辑操作 |
| C-20 | 零帧 | 时间轴空态 + 画布提示 | `manual.no_frames`、`preview.empty` | 应用网格 / 新增帧；导出禁用 `export.disabled_no_frames` |
| C-21 | 单选帧 | 手柄 + 尺寸标注 + 状态栏 | `editor.frame_index`、`editor.frame_size` | 编辑 |
| C-22 | 多选帧 | 联合虚线框 + 状态栏计数 | 计数文案缺词条（设计发现 D-01） | 移动/删除/合并 |
| C-23 | 新增完成 | Toast | `editor.frame_added` | — |
| C-24 | 删除确认 | 模态 | `confirm.delete_one/many`、`confirm.delete.body`、`confirm.delete.action` | 确认/取消 |
| C-25 | 删除完成 | Toast | `editor.frame_deleted` | — |
| C-26 | 合并不可用 | 按钮 disabled + tooltip | `editor.select_to_merge` | — |
| C-27 | 合并完成 | Toast | `editor.frames_merged` | — |
| C-28 | 拆分不可用 | 按钮 disabled + tooltip | `editor.select_one_to_split` | — |
| C-29 | 拆分进行中 | 顶部提示条 + 预览线 | `editor.split_hint` | 两点定线 / Esc |
| C-30 | 拆分完成 | Toast | `editor.frame_split` | — |
| C-31 | 新增工具提示 | tooltip | `editor.add_hint` | — |
| C-32 | 排序提示 | 时间轴辅助行 | `editor.reorder_hint` | — |
| C-33 | 排序完成 | Toast | `editor.order_updated` | — |
| C-34 | 重跑检测确认 | 模态 | `confirm.reset_detection.title/body/action` | 确认/取消 |
| C-35 | 换图确认 | 模态 | `confirm.new_file.title/body/action` | 确认/取消 |
| C-36 | 撤销耗尽 | 按钮 disabled + tooltip | `editor.nothing_to_undo` | — |
| C-37 | 重做耗尽 | 按钮 disabled + tooltip | `editor.nothing_to_redo` | — |
| C-38 | 滑杆防抖中 | 侧栏组头 + 轨道变色 | `settings.pending` | 继续拖/停手 |
| C-39 | 重算中 | 画布横幅 + 帧框 40% + 编辑禁用 | `detect.recalculating` | `detect.cancel` |
| C-40 | 角标显示 | 画布芯片 + 时间轴色点 | `review.badge.outlier/multiple_components/empty` | tooltip |
| C-41 | 待复核摘要条 | 时间轴头部下方 | `review.attention.title/body` | 展开/收起 |
| C-42 | 筛选 | 芯片组 | `review.filter.label/all/attention/outlier/multiple_components/empty` | 切换筛选 |
| C-43 | 筛选空 | 芯片行居中 | `review.filter.none` + 「`review.filter.all`」链接 | 清除筛选 |
| C-44 | 未确认 | 状态栏 + 按钮态 | `review.pending` | `tool.confirm_review` |
| C-45 | 确认完成 | Toast + 按钮成功态 | `review.confirmed` | `tool.export` |
| C-46 | 手动网格面板 | 侧栏组 2b | `manual.title/rows/columns/apply/reset/draw_hint` | 应用/重置/画框 |
| C-47 | 结果不对入口 | 侧栏文本链接 | `fallback.bad_result` | 切手动网格（应用时 `fallback.use_manual` 确认） |
| C-48 | 规范化预览 | 侧栏组 3 | `editor.normalized_preview/help` | 选中帧切换 |
| C-49 | 动画预览控件 | 时间轴头部 | `preview.play/pause/previous/next/fps/onion_skin/onion_on/onion_off` | 播放控制 |
| C-50 | 预览空 | 芯片行空态 | `preview.empty` | — |
| C-51 | 快捷键面板 | 模态 | `shortcuts.*`（第 8 节全表） | `shortcuts.close` |

### D. 导出（S4 + 全局）

| # | 状态 | 呈现 | 文案 | 动作 |
|---|---|---|---|---|
| D-52 | 未确认阻断 | 模态 | `export.review_required.title/body`、`export.review_required.action` | 返回审校 |
| D-53 | 零帧禁用 | `tool.export` disabled + tooltip | `export.disabled_no_frames` | — |
| D-54 | 导出面板主态 | 右抽屉 | `export.title/summary/format/phaser_hash/phaser_array/godot/atlas_settings/atlas_size/size_auto/size_pot_*/size_limit/rotation/padding/extrude` | `export.start` / `export.back` |
| D-55 | 导出处理中 | 抽屉内阶段清单 + 进度 | `export.preparing/packing/writing_phaser/writing_godot/zipping`、`export.progress`(aria) | `export.cancel` |
| D-56 | 导出成功 | 对勾 + 文件卡 | `export.success.title/body` | `export.download` / `export.again` / `export.continue_editing` |
| D-57 | 导出失败 | 错误卡片 | `export.failed.title/body` | `action.retry` / `export.back` |
| D-58 | 下载被阻止 | 错误卡片（成功态内嵌） | `export.download_blocked.title/body` | 授权后 `export.download` 重试 |
| D-59 | 帧越界 | 错误卡片 + 返回后画布高亮 | `export.invalid_frame.title/body` | `export.back`（越界帧 `--danger` 闪烁） |
| D-60 | 尺寸冲突 | 抽屉内联错误 | `export.size_too_small` | 改大尺寸 / auto |
| D-61 | 导出中内存失败 | 错误卡片 | `memory.runtime.title/body` | `memory.downscale_retry` / `memory.back_to_editor` |

### E. 全局

| # | 状态 | 呈现 | 文案 | 动作 |
|---|---|---|---|---|
| E-62 | 运行时内存失败（任意阶段） | 模态，界面保持可交互 | `memory.runtime.title/body` | `memory.downscale_retry` / `memory.back_to_editor` |
| E-63 | Worker 异常 | 模态，保留 File 与草稿 | `error.worker.title/body` | `action.retry`（重启 Worker）/ `memory.downscale_retry` |
| E-64 | 未知异常 | 模态 | `error.unknown.title/body` | `action.retry` |
| E-65 | busy（aria） | 状态栏 + aria-live | `status.busy` / `status.ready` | — |
| E-66 | 本地保留提示 | Toast（保存动作后） | `status.saved_local` | — |
| E-67 | 语言切换 | 顶栏下拉，即时生效 | `language.label/zh/en` | — |

补充规则：错误呈现优先级——能力/协议阻断（WORKER_UNAVAILABLE/PROTOCOL_MISMATCH）为全屏阻断页（无主线程回退），其余按上表位置呈现；恢复动作按钮按契约 `recoveryActions` 生成，文案用上表词条，不显示库的英文 Error.message。

---

## 10. 可访问性与国际化

- 全部功能键盘可达；焦点环不关闭；模态焦点圈定，关闭后焦点还原。
- 进度与状态用 `aria-live=polite`（`status.busy/ready`）；滑杆/开关/筛选芯片带 aria 标签（用对应 copy 词条）。
- 画布提供文本替代摘要（帧数、选中帧尺寸——复用 `editor.summary/frame_index/frame_size`，`role=status`）。
- 中英切换即时、不丢数据、不中断任务；同一界面不中英混排；占位符（`{count}` 等）用真实值。
- 文案渲染为文本节点（React），无 `innerHTML` 拼接（错误 details 仅数值）。

---

## 11. 设计发现（上报，不擅自决定）

| # | 发现 | 建议 | 影响 |
|---|---|---|---|
| D-01 | 多选状态无计数词条：状态栏/工具栏需要「已选 {count} 帧」类文案，copy-m1.md 未提供 | 增补 `editor.selection_count`（zh：已选 {count} 帧 / en：{count} selected） | C-22 当前以纯数字 + `editor.summary` 并列呈现，语义偏弱 |
| D-02 | 「确认审校」按钮的已确认视觉态无专属词条（`review.confirmed` 是 Toast 文案，按钮上沿用 `tool.confirm_review` + 对勾图标） | 可接受；如需更明确可增补 `tool.review_done` | 低 |
| D-03 | Godot 选中时图集设置组隐藏需要一行说明，现复用 `export.godot` 选项副行文字，无独立词条 | 可接受；或增补 `export.atlas_not_used` | 低 |
| D-04 | PRD 未提及主题切换；本规范按暗色单主题实施（目标人群默认暗色） | 请 PM 确认 M1 不做浅色主题 | 如需浅色需补充一套令牌与验收 |
| D-05 | 契约 ManualGrid 支持 `region`（局部区域网格），但 PRD/copy 无区域选择交互与文案；M1 UI 仅提供整图行列（region=null） | 维持整图；局部网格留给后续里程碑 | 契约能力暂不暴露，无功能缺失 |
| D-06 | 导出文件名（baseName）无 UI 词条与字段，M1 固定默认 `atlas`（架构 §9 结论） | 请 PM 确认 M1 不提供导出重命名 | 与 PRD 一致，仅备案 |
| D-07 | 手动网格步进器乘积超上限（500 帧）需内联错误文案，copy 无专属词条；当前用红框 + 通用禁用呈现 | 可增补 `manual.grid_too_large` | 低 |
| D-08 | 拖动/缩放钳制到图内是静默行为（无提示）。符合工具惯例，但若 PM 希望显式提示需补词条 | 维持静默钳制 | 低 |

---

## 12. HTML 稿索引

| 文件 | 覆盖状态（对应第 9 节编号） |
|---|---|
| `design/mockups/upload.html` | A-1、A-2、A-3、A-6~A-9、A-11、A-12 |
| `design/mockups/review-editor.html` | C-19~C-25、C-29、C-38~C-45、C-46~C-50、B-16（降级横幅变体）、C-43（筛选空变体） |
| `design/mockups/export-panel.html` | D-52、D-54~D-58、D-60 |

三个稿均为单文件（内联 CSS + 少量内联 JS 做语言切换演示），浏览器直接打开；假数据为程序化绘制的示意帧。界面文案全部取自 `copy-m1.md`（右上角可切换 zh/EN 预览双语）。结构、类名与令牌即实现蓝本。

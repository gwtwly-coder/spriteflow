# v3 拆部位工作区 UI 独立验收裁决 #1

- **基线**：`9731938`（test(web): v3 拆部位工作区组件测试），验收对象为 `4ddba4d` + `12cf92e` + `c18d5d0` + `d34d977` + `9731938` 共 5 提交，全部位于 `apps/web/**`（4ddba4d 另含 `pnpm-lock.yaml`）。
- **验收人身份披露**：本验收为生产者（两个前后相继的子代理会话）之外的全新上下文；继承父会话模型，具体型号未确认，同族独立上下文，**不声称异族**。生产者回执与自报不采信，以下全部结论仅依据磁盘代码（文件+行号）、测试实测、门禁退出码与 dev-server 运行时探针。
- **验收日期**：2026-09-30。
- **规格依据**：`docs/ui-spec.md` §13（+§2/§4/§9 M1 复用基线）、`docs/prd-v3.md`（V-01~V-06 P0、V-09、AC-V01~V06）、`docs/copy-v3.md` §17–28、`docs/interface-contract-v3.md` :248–328（导出 codec）与 :333（BYOK）、:71（2048 工作边）。

## 裁决：**PASS**（附带 2 项 P1 应修、7 项 P2 建议，均不构成 P0 阻断）

5 项 P0（V-01~V-06）全部有可核验实现并被有效测试锁定；AC-V01~V06 主路径组件级验证通过；四项门禁真实退出码全绿；诚实降级语气与 codec 真实 bug 修复均经受控负例证明受回归保护。P1 两项为边缘路径缺陷（详见问题清单），不破坏 P0 闭环。

---

## 检查单 1：PRD 覆盖

### V-01 拆部位工作区与透明立绘输入（P0）— ✅

| 项 | 证据 |
|---|---|
| 工作区切换分段控件（双向） | `apps/web/src/app/App.tsx:174-205`（ModeSwitch 两个顶栏各挂一份：App.tsx:707 / PartsWorkspace.tsx:596）；`requestSwitch` App.tsx:107-111 |
| 有工作才确认（双向 dirty） | App.tsx:109 `if (slicerDirty \|\| partsDirty)`；slicer dirty 判据 App.tsx:698-699；parts dirty 判据 PartsWorkspace.tsx:141-142（`parts.length>0 \|\| screen!=="upload" \|\| file \|\| busy`） |
| 取消不清数据 | App.tsx:156-158 取消仅 `setPendingSwitch(null)`；组件测试 "keeps parts when the user cancels the workspace switch" 绿（断言 `parts` 仍长 1） |
| 确认后清空（部位+历史+任务+key） | App.tsx:112-124 `performSwitch`：取消任务 + `resetCharacterClient` + `resetAll` + temporal `clear` + `setPartsDirty(false)`（d34d977 修复的 dirty 复位）；测试 "clears parts only after the switch is confirmed" 绿 |
| W1 复用 M1 预检 | PartsWorkspace.tsx:214-273 `validateFile` 镜像 M1 App.tsx:335-395（同格式白名单/多文件错/8192 模态/内存预估模态/解码失败，全部复用 copy-m1 词条经 `errorCopy`）；另按契约 :71 增加 2048 工作边二次确认（loadAndSegment:291-300，选项 2048/1536/1024/768） |
| 隐私说明 | W1 空状态 `privacy.parts_notice`（PartsWorkspace.tsx:826）；L1 调用前同意模态 `llm.privacy_notice` 带 `{provider}`（:1534-1537） |
| BYOK 入口 | W1 `parts.upload.open_llm_settings` 按钮（:856-858）+ 顶栏常驻（:611-613） |

### V-02 L1 语义定位 BYOK（P0）— ✅（附 P1-1）

| 项 | 证据 |
|---|---|
| BYOK 面板 endpoint/model/key | PartsWorkspace.tsx:1388-1500 `ByokPanel`（服务商/endpoint/模型/key/记住勾选/清除/保存）；endpoint 校验 `isValidEndpoint`（byok.ts:24-35，HTTPS + `/chat/completions` + localhost 例外，对应契约 :421） |
| sessionStorage 勾选语义 | byok.ts:78-93 `saveByok`：勾选→sessionStorage，不勾→仅内存 `memoryKey`；`clearKey`（:95-102）在卸载/切换/换图/清除按钮四路触发（PartsWorkspace.tsx:162, 770；App.tsx:117） |
| **key 只进 Worker** | grep 全主线程 `apiKey` 仅 1 处：PartsWorkspace.tsx:208（`buildLlmConfig`），经 `character().run()` Comlink 输入进 `character.worker.ts`；`createFetchLlmTransport` 仅在 worker 引用（character.worker.ts:30,116），HTTP 头组装在 `packages/segment/src/browser/fetchTransport.ts:118`（`Authorization: request.authorization`）。主线程无任何携带 key 的 fetch |
| 路径选择卡（未配 key） | PartsWorkspace.tsx:932-952 `showPathCard`：`llm.not_configured.title/body` + 配置语义定位 + `parts.fallback.use_click` 两条明确路径 |
| L1 失败分类卡 + 重试 + 点击模式 | :953-964：`llm.error.{network,unauthorized,rate_limited,bad_response}` 四类 + `parts.fallback.retry_llm` + `parts.fallback.use_click`；分类来源 worker `classifyLlmFailure`（character.worker.ts:132-138：throw→network、401/403→unauthorized、429→rate_limited、≥500→network、其余 bad_response），经 `RunOutput.llmFailure` 回传；错误码兜底映射 LLM_REASON_BY_CODE（:95-104）。d34d977 修复的"LLM 失败误报模型失败"确认已分流（finishRun:355-365）。组件测试 (AC-V02-C) 绿 |
| 未配 key 零图片外发 | `prepareClick` 仅本地模型（:405-427）；`runSemantic` 无 key 守卫直接返回不发请求（但见 P1-1） |

### V-03 L2 SAM 蒙版精修（P0）— ✅（附 P1-2、P2）

| 项 | 证据 |
|---|---|
| 下载进度/体积呈现 | W2 `model.downloading` 带 `{size}`（:986-991），体积来自冻结清单 `modelBytes()`（worker character.worker.ts:296-303 两档 byteLength 合计；UI 挂载时取 PartsWorkspace.tsx:150-153）；真实进度条 `overallProgress` |
| 校验/初始化子态 | `ModelInitialize`/`ModelDownload` 映射 `inModel`（:924-925）；**`CharacterStage.ModelVerify`（types.ts:54）未映射** → P2-2 |
| WebGPU→WASM 回退提示 | 语义路径：`applySegmentResult` 读 `WEBGPU_FALLBACK_TO_WASM` warning → `humanoidWarning` → W3 渲染 `model.backend_wasm`（:1204）。**点击模式优先路径 `prepareClick`/`ensureInteractive` 把 `webgpuFallback` 写进 `store.backendWasm`（:418, :433）但全 UI 无渲染点** → P1-2 |
| 失败可重试不重传 | W2 模型失败卡 `model.retry`（:965-976）；W3 失败横幅（:1168-1177）；重试走 `ensureInteractive`/`prepare`，图片仍在 Worker `asset`，不重传 |
| 两模式不可用标注（AC-V03-D） | `model.required_hint`"自动拆件和点击模式都依赖这个本地模型"在两处失败呈现均在场（:969, :1172） |

### V-04 部位审校与点击增删（P0）— ✅

| 项 | 证据 |
|---|---|
| 蒙版高亮画布 | PartsCanvas.tsx:194-269 `paint`：棋盘格+图片层+蒙版高亮层+边界框在同一 canvas 同一 translate/scale 变换（同视口）；高亮只染源 alpha>0 像素（:82-93）；按部位对象身份+token 签名缓存（:228-236） |
| 点击加/减区域 | PartsWorkspace.tsx:443-535 `onCanvasClick`：add/remove-region → `refine`（box=当前紧框 + 累积点）→ `updatePartMask` 整幅替换蒙版+即时几何更新 |
| 新增/删除部位 | add-part → `client.refine` 正点 → `createPartAsset`（`part_${nextClickIndex}` 补零命名，:477-495）→ `store.addClickPart`；删除经 `confirm.delete_part` 模态（:752-755）；组件测试 1/2 绿（列表+1、导出启用、refine 收到正点、删除后消失且导出禁用） |
| 撤销/重做 | zundo temporal，`partialize` 仅文档态（parts/prompts/selectedPartId/nextClickIndex，parts-store.ts:194-203）；工具按钮禁用态 + `editor.nothing_to_undo/redo` tooltip（PartsWorkspace.tsx:1104-1121） |
| 零部位空状态导出禁用 | 工具栏导出 `disabled={store.parts.length===0}` + `aria-describedby`→`parts.export.disabled_no_parts`（:1126-1137）；侧栏 `parts.editor.no_parts`（:1208-1210）；抽屉内同样禁用（:1368-1379） |
| 视口（AC-V04-D） | 滚轮指针缩放/pan 拖拽/fit（PartsCanvas.tsx:277-381，`spriteflow-parts-fit` 事件）；同一变换保证蒙版与边界坐标对齐 |

### V-05 部位导出（P0）— ✅

| 项 | 证据 |
|---|---|
| 真实 fflate codec | part-codec.ts:14（`deflateSync/inflateSync`）；PNG 编码 IHDR/IDAT/IEND（:72-99）、解码支持全 5 种 filter 与色彩类型 6/2（:110-184）；ZIP store(PNG)/deflate6(JSON/TXT)、路径排序、mtime 1980-01-01、无权限位、`inspectZip` 中央目录+本地头一致性校验（:200-307）。**12cf92e 两处真实 bug**（PNG 总长漏计 IDAT 块 12 字节开销 → IEND 越界；中央目录 external attrs(38)/local offset(42) 错位）确认已修（part-codec.ts:91, :244-245），且负例③证明测试可捕获回归 |
| 像素校验 stage | UI：`CharacterStage.PixelAssert` → `parts.export.verifying`（:1299-1304）；引擎：`packages/segment/src/exportParts.ts:491`（打包前）与 :520（PNG 编码后解码复验）双断言，失败 `PART_PIXEL_INVARIANT_FAILED`；UI `invariant` 态引导返回审校（:1346-1353） |
| ZIP 下载 | PartsWorkspace.tsx:575-582 Blob + anchor download；成功态 `parts.export.success.*` + 再次导出/返回编辑 |
| 导出命名/kind | `buildExportNames`（kind-display.ts:53-81）：语义部位 kind stem（left_/right_ 前缀），点击/other 从 part_000 起，大小写折叠去重冲突加后缀；组件测试断言 `names:[{fileName:"part_000"}]` 绿 |

### V-06 诚实降级（P0）— ✅

- 三横幅诚实语气映射 `DEGRADED_BANNER`（PartsWorkspace.tsx:67-78）：非人形 `parts.fallback.nonhuman.*`（"没有硬猜"）、无 key `nokey.*`、LLM 失败 `llm_failed.*` 带 `{reason}`；low-confidence 归入 LLM 失败卡。
- 组件测试逐字断言三横幅（测试 3/4/5 全绿）；**负例②**把非人形 body 篡改为"拆件成功！"成功语气 → 语气断言变红，证明该保护有效。
- 非人形降级落入点击模式 + 零部位空状态 + `part_000` 命名（AC-V06-A）；LLM 失败选点击模式后图片保留（顶栏文件名仍在，AC-V06-C）；模型失败重试不重传（AC-V06-D→V-03）；超大图/内存沿用 M1 模态 + 契约 2048 工作边确认（AC-V06-E→V-01）。

### V-09 置信度与遮挡标记（P1）— ✅

部位卡渲染 `part.confidence_label`（置信度 {percent}%）与 `part.occluded` 徽标（title=`part.occluded_help`，仅提示不处理）（PartsWorkspace.tsx:1240-1249）。

## 检查单 2：ui-spec §13 符合性

- **13.1 布局结构**：W3 = 工具栏一行（48px）在上 + 主画布 + 右侧栏 + 状态栏（`.parts-review { grid-template-rows: 48px minmax(0,1fr) 28px }` styles.css:877-879）；工具栏含加区域/减区域/新增部位/删除部位/撤销/重做/重新拆件/导出（PartsWorkspace.tsx:1088-1137）；右侧栏 = 部位列表卡（部位名+kind 徽标+尺寸+置信度+遮挡+选中态，:1206-1256）替代 M1 检测参数侧栏；**底部无时间轴**（PartsReview 无 Timeline，画布吃满 1fr）；抽屉复用 `.drawer`、对话框复用 `.modal`、Toast 复用 `.toast`。✅
- **堆叠规则**：`git diff 064e1e7..9731938 -- apps/web/src/app/styles.css` 中 z-index 新增 0 处；蒙版高亮层与图片层在同一 canvas 同一绘制变换内（同一 stacking context，PartsCanvas.tsx:209-239），不新增全局 z-index。✅
- **13.2 状态清单逐项**：
  - W1：空状态+`privacy.parts_notice` ✅；预检中间/错误复用 M1 词条 ✅
  - W2：路径选择卡 ✅；key 配置面板 ✅；L1 进行中 ✅；模型下载中（体积）/初始化 ✅；**校验（ModelVerify）未映射**（P2-2）；模型失败可重试 + 双模式不可用标注 ✅；**JSON 修复重试无独立呈现**（修复重试期间 stage 仍为 semantic-locate，L1 阶段行属真实呈现，无假进度——P2 记录）；L1 失败分类 ✅
  - W3：审校就绪 ✅；点击模式（part_000）✅；降级横幅三类诚实语气 ✅；零部位空状态导出禁用 ✅；蒙版高亮开关 ✅
  - W4：导出摘要 ✅；PixelAssert 校验中 ✅；导出成功（ZIP）✅；像素校验失败引导返回审校 ✅；**下载被阻止无 UI 状态**（copy-m1 D-58 词条在包但 M1/v3 均未接线，P2-3）
- **13.1 外壳**：顶栏 = 标识+切换+语言 ✅，**快捷键入口缺失**（M1 顶栏有、v3 顶栏无；V-10 快捷键整体未实现，P1 功能不在本批声明范围）→ P2-5。

## 检查单 3：i18n

- **无硬编码中文**：grep 全 `apps/web/src`（除 i18n/index.ts）UI 代码 0 处中文字面量（仅 part-codec.ts 注释）。copy-v3 §18–28 词条抽查（parts.fallback.*、llm.*、model.*、parts.export.*、part.kind.*、part.side.*、dev.visual.*、confirm.switch_mode.*、confirm.delete_part.*、confirm.rerun_split.*）全部命中 zh+en 双语；kind 全集按契约扩展（head/neck/accessory/other）且侧别组合"左/右+部位名"符合 §26。
- **硬编码英文 1 处**：PartsCanvas.tsx:351 `aria-label="Part editor"`（测试锚点，未走 i18n）→ P2-6。
- **切语言不重置状态**：locale 为 App 顶层 useState，store 外置（zustand），`setLocale` 仅改文案层与 `document.lang`；ui-spec §2"语言切换只改变文案层"成立；v3 卸载清理仅绑在组件卸载（工作区切换）而非 locale 变化。

## 检查单 4：视觉调节面板（§13.3）

- **仅 DEV 入口**：`const DevVisualPanel = import.meta.env.DEV ? lazy(...) : null`（PartsWorkspace.tsx:59）+ 入口按钮 DEV 守卫（:614-623）。生产构建核验：dist JS 无组件 JSX 痕迹（`dev-visual` 类名 0 处、`dev-visual-json` 0 处），生产无入口成立。
- **但 dist 有死代码残留**：`.dev-visual` 面板 CSS（styles.css:939-963 无条件打包，dist CSS 1 处命中）与 `dev.visual.*` 12 条词条无条件进 dist JS（"视觉调节"/"visual tuning" 字样在包内）——验收单"无入口无代码"的"无代码"不完全成立 → P2-1。
- **白名单 token**：7 项 = §13.3 要求全集（侧栏宽度/画布背景/蒙版高亮色/蒙版不透明度/卡片圆角/卡片边框/列表间距）（dev-visual-panel.tsx:23-82）；导入时 key 必须命中 TOKENS 否则 `invalid`（:152-155），颜色 hex 校验、数值 min/max/step+格式校验（:157-176）。
- **重置/导入导出**：重置移除 :root 内联属性并重绘（:122-127）；导出 JSON+剪贴板（:128-137）；导入 JSON 校验后应用（:138-181）。蒙版色/不透明度经 `spriteflow-parts-tokens` 事件驱动画布即时重绘（dev-visual-panel.tsx:84-86 ↔ PartsCanvas.tsx:296-301）；画布侧每次 paint 前 `getComputedStyle` 解析 token（d34d977 修复的 var() 直解析 bug，PartsCanvas.tsx:53-59, :224-227）。

## 检查单 5：测试有效性

- **全量复跑**：`pnpm --filter @spriteflow/web run test` → **35/35 passed（8 文件）**，exit 0；恢复后二次复跑同样 35 绿。
- **受控负例（3/3 有效，改后全部恢复，`git status` clean）**：
  1. `parts-store.ts` `addClickPart` 改为不入库 → parts-workspace **6 例红**（含"adds a part"主断言）。
  2. `i18n` 非人形 body 篡改为成功语气"拆件成功！完美识别" → **1 例红**（"surfaces non-humanoid degradation verbatim"逐字语气断言）。
  3. `part-codec.ts` 中央目录回退 12cf92e 修复（offset 写回 external attrs 字段 38）→ part-codec **1 例红**（ZIP 结构断言）。建议的负例③"假 Worker 忘发进度"**无法在现测试面构造**：9 例组件测试无任何进度事件断言（grep progress = 0）→ 记为 P2-4 覆盖缺口，以 codec 负例替代。
- **测试卫生（P2-4）**：parts-workspace.test.tsx:222-233 遗留 `console.log("TOOL"/"REFINE"/"PARTS")` 调试输出；运行时出现 React `act()` 告警。

## 检查单 6：门禁（真实退出码）

| 门禁 | 命令 | 结果 |
|---|---|---|
| web typecheck | `pnpm --filter @spriteflow/web run typecheck` | exit **0** |
| web test | `pnpm --filter @spriteflow/web run test` | exit **0**，35 passed (8 files) |
| web build | `pnpm --filter @spriteflow/web run build` | exit **0**（tsc + vite；产物 index 374KB / workers / ort wasm 28.3MB） |
| root lint | `pnpm run lint` | exit **0**（biome 215 files + check-boundaries OK(40 files) + pipeline build + check:contract PASS） |

## 检查单 7：dev-server 冒烟（运行时验证，含通道限制披露）

- **browser-use 通道在本子代理运行时不可用**（工具层错误：`Browser is not available in subagent`）→ **真浏览器 GUI 操作与截图证据缺失**，如实记录为增量，不以假图充数。
- 已执行的运行时验证（证据 `docs/acceptance/evidence/v3-ui-acceptance/dev-smoke.txt`）：
  - `pnpm --filter @spriteflow/web run dev`（vite 7.3.1，:5173）起服成功；`GET /` = 200（HTML 壳：`<div id="root">` + `/src/main.tsx`）。
  - v3 全部 8 个关键模块经 Vite dev transform **实时编译 200**：PartsWorkspace(230,629B)、PartsCanvas(51,828B)、dev-visual-panel(31,854B)、part-codec(40,789B)、character.worker(34,253B)、i18n(107,946B)、App(273,961B)、main(7,605B)；转换产物保留 `import.meta.env.DEV` 守卫（2 处）。
- **无 key 路径的 W1/路径卡/点击模式入口**（冒烟清单要求的 AC-V06-B 语义）：由 9 例 jsdom 组件测试以真实 React 渲染覆盖——`reachReviewByClickMode`（无 key 上传→路径卡"使用点击模式"→W3 审校）即该语义；W1 空状态渲染（"拖入透明人物立绘"）、零部位空状态、导出抽屉全流程均有组件级断言。
- **需真模型的路径（模型下载→W3 点击增删的浏览器端实况）本验收未覆盖**，记录"该路径需真模型冒烟增量覆盖"（与 73MB 下载边界一致，不强求）。

---

## 问题清单

### P0 阻断
无。

### P1 应修
1. **清除 Key 后触发语义拆件 → W2 假进行中死屏**（PartsWorkspace.tsx:395-401 `runSemantic` 守卫分支）：`store.byok` 仍在而 key 已清时，`buildLlmConfig` 返回 null → 仅 `setDegraded("no-key")+setMode("click")`，但 `screen` 已是 `"process"` 且 `semanticAvailable` 读 `store.byok!==null` → 路径卡不出现、进度空转、取消按钮禁用，界面以"正在拆部位"呈现实际什么都没跑（诚实呈现原则破口）。UI 可达：W3 → 顶栏"配置语义定位" → 清除 Key → 关闭 → "重新拆件"确认 → "同意并开始拆件"。注释声称"回到未配置路径卡片"但未实现（缺 `setScreen`/`setByok(null)` 或等价恢复动作；重配 key 后可恢复，故非永久死锁）。
2. **WebGPU→WASM 回退提示在点击模式优先路径断线**（AC-V03-B 于无 key 主路径不成立）：`prepareClick`/`ensureInteractive` 把 `webgpuFallback` 写进 `store.backendWasm`（PartsWorkspace.tsx:418, :433），但唯一渲染点读的是语义路径专用字段 `store.humanoidWarning`（:1204，仅 `applySegmentResult` 从 result.warnings 置位）→ 未配 key 直接点击模式时，即便回退发生也无任何性能差异提示。顺带：`humanoidWarning` 字段名与其语义（WASM 回退）不符。

### P2 建议
1. 生产 dist 残留调节面板死代码：`.dev-visual` CSS 与 `dev.visual.*` 12 条词条无条件进包（入口确无）。建议样式移入面板模块侧文件或 i18n 按需裁剪。
2. `CharacterStage.ModelVerify` 未映射 W2 阶段呈现（§13.2 列有"校验"子态）；`model.ready_cached` 词条从未渲染（缓存命中无"已就绪"反馈）。
3. W4"下载被阻止"状态未实现（copy-m1 D-58 词条在包，M1/v3 均无接线；浏览器无可靠信号，建议至少记录设计裁决）。
4. W2 进度/阶段呈现零测试断言（负例"忘发进度"不可构造）；测试遗留 console.log 与 act() 告警待清理。
5. v3 顶栏缺快捷键入口；V-10 v3 快捷键未实现（P1 功能，不在本批声明范围，但 §13.1 外壳描述含"快捷键"）。
6. PartsCanvas `aria-label="Part editor"` 硬编码英文（兼测试锚点）。
7. W2 语义阶段三元两分支同文案（:981-983 冗余，无行为差异）。

## 结论

v3 拆部位工作区 UI 五提交在静态契约、组件级行为、门禁与受控负例四个维度均通过独立核验：5 项 P0 全覆盖、ui-spec §13 布局/堆叠合规、i18n 无硬编码、调节面板生产无入口、35 用例真实有效（3 负例全红后恢复）。两项 P1（清 key 假进行中死屏、WASM 提示断线）与七项 P2 建议随本裁决移交修复跟踪，不阻断本批收编；真浏览器 GUI 冒烟与真模型端到端路径留作增量覆盖。

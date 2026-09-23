# SpriteFlow M1 集成验收裁决（第 1 轮）

> 日期：2026-09-23（Asia/Shanghai）  
> 验收官：本独立会话；生产与现场执行：各 owner / R6 的其他会话  
> 代码基线：`caee0a403cb6b3a1bfb21421dab2800ecc8ce916`  
> 实际目录：`D:\projects\new_project1`；提示词中的 `D:\projects\new\_project1` 不存在  
> 生产站：https://spriteflow-doa.pages.dev  
> 写权限：产品主明确允许仅新增裁决书；未修改实现、测试、配置、既有报告或其他文件。

## 1. 裁决

**FAIL。**

CI #4 五个 job 成功已独立核实，当前提交的黄金回归门禁可判 PASS。整体集成验收仍缺 P0 现场执行、六张真实图闭环、Playwright 下载解包、性能及生产站关键路径证据，并存在快捷键修饰键隔离和发布许可文本缺失问题。

证据不足的 FAIL 表示相应验收条件尚未证明，不表示已实测复现该功能失败。按产品主最新分工，执行类证据由 R6 在其会话现场生成，统一放入 `tests/golden/reports/acceptance/`，本验收官只读取并裁决。初检时该目录不存在；最终检查已出现 `p0-real-flow.mjs`（修改时间 2026-09-23 19:40:39 +08:00），尚无已完成报告或执行结果。脚本存在不等于运行通过，未将预计将产生的报告计作已有证据。

这是第 1 轮裁决书的首次落盘，已纳入产品主提供的 CI 网页取证路径，替代先前对话中“CI 未核实”的表述，不另算一次打回。同阶段最多打回两轮，第 3 轮升级产品主人工裁决。

## 2. 依据与证据边界

- 范围：`docs/technical-design.md` 第 9 节、`docs/prd-m1.md:18`；P0 标准为 PRD 第 5 节，退出标准为 `docs/prd-m1.md:444`。
- 架构与性能：`docs/architecture-m1.md:169`、`:281`、`:287`、`:339`。
- 当前契约：`docs/interface-contract.md` 3.0.0/r4；降级规则见第 4.2/13 节，导出见第 6 节，打包快照修订见第 14 节。
- 交互：`docs/ui-spec.md:534`；执行计划：`tests/e2e/PLAYWRIGHT-PLAN.md` 与 `tests/e2e/INTEGRATION-CHECKLIST.md`。
- `tests/golden/GATE3-CORRECTIONS-REVIEW.md:7` 接受 18/19 修正；第 38 行起明确复核边界为两例几何与降级标注。
- `docs/inspections/rw-semantic-review.md:10` 接受 13 项语义目标；RW-06 的确认有限度，不证明动作连续性。这些报告作为既有独立标注依据，不冒充本会话重新目视复核或 UI 实测。
- 本会话执行的只读命令和内存内检查，结果记录于本文；未另建日志文件。此前工作区已有五个未跟踪文件 `_tmp_bridge.py`、`_tmp_cca.py`、`_tmp_gap.py`、`_tmp_rw03_bridge.png`、`_tmp_rw04_hat.png`（均在 `tests/golden/` 下），未触碰。

## 3. CI #4 独立网页核验及前次结论修正

[CI #4 Summary](https://github.com/gwtwly-coder/spriteflow/actions/runs/35714974938) 显示提交 `caee0a4`、整体 Success、耗时 32s。逐个打开 job 页面，均读到 succeeded：

| Job | 结果 | 页面证据 |
|---|---|---|
| lint | PASS，21s | [106704213796](https://github.com/gwtwly-coder/spriteflow/actions/runs/35714974938/job/106704213796) |
| typecheck | PASS，23s | [106704213889](https://github.com/gwtwly-coder/spriteflow/actions/runs/35714974938/job/106704213889) |
| unit | PASS，23s | [106704213697](https://github.com/gwtwly-coder/spriteflow/actions/runs/35714974938/job/106704213697) |
| golden | PASS，21s | [106704213865](https://github.com/gwtwly-coder/spriteflow/actions/runs/35714974938/job/106704213865) |
| build | PASS（job 成功），28s | [106704213930](https://github.com/gwtwly-coder/spriteflow/actions/runs/35714974938/job/106704213930) |

Summary 列出两个 artifact（仅核实存在及页面元数据，未下载、解包）：

- `golden-reports-caee0a403cb6b3a1bfb21421dab2800ecc8ce916`，704 Bytes，digest `sha256:1003026f578bbc1e7adea6df2990214e6f57fcce2eae808567c27845531f129d`。
- `web-dist-caee0a403cb6b3a1bfb21421dab2800ecc8ce916`，127 KB，digest `sha256:39ec52bb467a4e21811526e49d33c8dd170395a14a90658dbafc5025c8d40696`。

当前网页访问状态要求登录才能查看完整日志，未读到构建命令逐行输出。Summary 的 5 warnings 是 Actions 使用 Node 20 运行时并被强制切换 Node 24 的弃用警告；另有 5 notices 为 runner 系统迁移通知。不能把它们称为 Vite/TypeScript 编译警告，也不能由 job 成功推出构建日志零警告。

修正：撤销“当前提交 CI/黄金门禁未核实”的证据缺口。黄金 job 执行 `pnpm golden`（`.github/workflows/ci.yml:108`），根命令先构建管线（`package.json:16`）；runner 强制 20 例、逐例验证夹具和管线、失败置非零退出码（`tests/golden/tools/run.mjs:23`、`:47`、`:95`），因此接受该提交自动黄金门禁通过。R6 后续现场记录补充归档，不把本地重复运行当作承认 CI 成功的前置条件。

## 4. 集成检查单逐项裁决

| 检查项 | 裁决 | 实测或审查证据、结论边界 |
|---|---|---|
| PRD 全部 P0 逐条实测 | FAIL | 第 6 节列出 37 场景；R6 指定目录目前仅出现执行脚本，浏览器/引擎现场结果未到。自动黄金覆盖不等同全部 UI 验收。 |
| pnpm golden 全绿 | PASS | CI #4 golden 成功，命令及 runner 校验路径如第 3 节。本地历史 `tests/golden/reports/golden-report.json:3` 为 2026-09-22 09:07:28Z、pipeline 模式 20/20，仅作补充。 |
| E2E 冒烟 | FAIL | 枚举 `tests/e2e/` 只有两份 Markdown 和两个 JSON 夹具；无 Playwright config/spec 或执行报告。计划第 3 行明确仅交付计划与夹具。 |
| 性能对照预算 | FAIL | 现有 dist 首屏 JS gzip 92.5 KiB、Worker 29.6 KiB，体积子项 PASS。`packages/pipeline/BENCH.md:18` 的历史 Node CCL p95 237.80ms 不作为本轮浏览器 UI 响应或 CI 性能报告。当前 CI 未执行 4K benchmark/UI trace；相关发布指标未证明。 |
| 构建零警告 | FAIL | build job 成功已证明；完整构建日志未取得，零警告尚未证明。可见 Actions 弃用警告单列，不推断为编译警告。 |
| Cloudflare 关键路径 | FAIL | 依产品主补充要求以生产站执行。首页及主 JS/Worker/许可文件 HTTP 200，静态可达子项 PASS；上传至下载解包、离线行为未实测，不能以资源可达替代。未获 preview URL，不声称完成 preview 验收。 |
| 许可证终审 | FAIL | lockfile 与清单 213/213 双向一致、清单内无 GPL 类/禁用依赖，子项 PASS；但 Comlink 完整许可文本未随已检查生产发布物提供，见 INT-07。 |
| 1 Kenney + 5 AI 退出标准 | FAIL | 素材存在且来源清单哈希匹配；尚无逐例 UI 操作、必要人工步骤及 ZIP 产物记录。 |

性能口径：预算见 `docs/architecture-m1.md:171`、`:182`、`:190`、`:194`，4K 指 4096×4096；CCL warmup 5 次、测量 30 次、p95 <500ms；UI p95 帧耗时 ≤16.7ms 且无 >50ms 处理长任务。按产品主要求从 CI 门禁报告取证；报告需明确实际测量环境，不能把五 job 绿色当作未执行指标的结果。

## 5. 问题清单

保留先前对话的 INT 编号，便于 R6/owner 对照；INT-04、INT-05 已按 CI 网页证据收窄。

| 编号 | 严重级 | 位置 | 问题描述 | 修复建议 |
|---|---|---|---|---|
| INT-01 | P0 阻断 | `tests/e2e/INTEGRATION-CHECKLIST.md:15`；PRD 第 5 节；本文第 6 节 | P0 浏览器/引擎现场证据未闭环，尤其 8K、完整编辑历史、内存恢复及 Godot 4.4.x 执行。属于验收证据缺口。 | R6 逐场景执行并在指定目录记录版本、SHA、步骤、实际结果及证据路径；验收官读取复核。 |
| INT-02 | P0 阻断 | `tests/e2e/PLAYWRIGHT-PLAN.md:3`、`:20`、`:26` | 只有 Playwright 计划与夹具，没有可执行 spec/config 或下载解包结果，E2E 门禁未证明。 | R6 通过公开 UI 执行六例计划和 ZIP 校验；如需引入依赖，由 R7 按既有审计流程处理；执行材料放指定目录，不由验收官代写测试。 |
| INT-03 | P0 阻断 | `docs/prd-m1.md:452`；`docs/inspections/rw-semantic-review.md:90` | 缺六张真实图完整操作记录和最终产物；r3/R10 标注复核不满足退出标准。 | 固定 1 张 Kenney 与 5 张透明 AI 图，记录每例修正和最终 ZIP；涉及 RW-04 时恢复一个完整语义帧，涉及 RW-05 时记录人工恢复八帧，不把默认建议网格当作语义答案。 |
| INT-04 | P0 阻断 | `.github/workflows/ci.yml:30`；`docs/architecture-m1.md:182`、`:190`；`packages/pipeline/BENCH.md:18` | CI 五 job 成功已核实，但配置未执行 4K 耗时/UI 响应测量，未取得相应本轮报告。历史 Node benchmark 无法证明浏览器处理响应达标。 | R6/R7 提供绑定 SHA、样本哈希、环境、原始数据的 4K 检测和 UI trace/门禁报告；保留首屏体积结果。 |
| INT-05 | P0 阻断 | `tests/e2e/INTEGRATION-CHECKLIST.md:12`、`:35`；CI #4 build 页面 | 当前 golden/build 成功已核实并关闭相关缺口；仍缺构建零警告完整日志和生产站上传→审校→三种导出→解包实测。属于剩余证据缺口。 | R6 提供现场构建 stdout/stderr/退出码与生产站关键路径记录；注明 Actions 警告和编译警告的区别。 |
| INT-06 | P1 应修 | `apps/web/src/app/App.tsx:369`、`:405`、`:408`、`:409`、`:418`；`docs/ui-spec.md:536` | 普通快捷键没有隔离 Ctrl/Alt/Meta。内存内执行原源码处理函数，Ctrl+S 触发 setTool(split)，Ctrl+0 触发 spriteflow-fit，Alt+M 触发 mergeSelected。浏览器组合键会同时改变应用状态。 | R5 限定快捷键修饰键、焦点与模态作用域；R6 在实际浏览器验证浏览器动作不会同时触发编辑器动作。 |
| INT-07 | P1 应修 | `apps/web/public/THIRD_PARTY_NOTICES.txt:49`；`docs/architecture-m1.md:345` | Comlink 4.4.2 仅附 Apache-2.0 简短声明与网址，缺完整许可；已检查生产站许可文件与本地完全一致。安装包 LICENSE 含完整条款，不能以清单匹配替代分发义务。 | R7 在发布物附完整 Apache-2.0 许可，复核所有实际分发代码及 helper 的声明覆盖；R6 复核重建后的生产产物。 |
| INT-08 | P1 应修 | `docs/ui-spec.md:566`；产品主提供的 R5 缺测说明 | Firefox 快捷键未实测，Chrome/Edge 仅渲染冒烟，无法证明键盘操作正确。 | Firefox 快捷键缺测可独立按 P1 延后并登记补测，不升级为所有 P0 的豁免；Chrome/Edge 补功能操作，涉及编辑和撤销等 P0 仍按 INT-01 验证。 |

INT-07 许可依据：[Apache License 2.0 第 4 节](https://www.apache.org/licenses/LICENSE-2.0) 要求向接收者提供许可副本。此处审查的是本项目发布要求与实际文本差异，不将许可清单无 GPL 表述为完整许可证终审通过。

## 6. PRD P0 的 37 个场景对照

以下位置均指 `docs/prd-m1.md`。FAIL（缺现场证据）不是功能已测失败；除 F13 外，本轮尚未取得 R6 对应场景操作记录。E-G 为第 3 节 CI golden 证据；E-R 为指定 `tests/golden/reports/acceptance/` 目录的只读检查结果：初检不存在，最终检查只有脚本、无已完成执行报告。集成清单第 17–27 行仍列为待执行。

| 标准 | 位置 | 应验证的步骤/结果 | 裁决与证据 |
|---|---|---|---|
| F01-A | :120 | 上传、检测、编辑、导出；网络无素材外传，静态加载后可离线 | FAIL；E-R，无网络记录 |
| F01-B | :125 | 主流程各状态切换中英，文案替换且素材/历史保留 | FAIL；E-R |
| F02-A | :132 | 拖放有效透明 PNG/WebP，显示名称尺寸并检测 | FAIL；E-R |
| F02-B | :138 | 点选有效文件，行为与拖放一致 | FAIL；E-R |
| F02-C | :143 | 非 M1、多个文件、不透明输入被预检拒绝 | FAIL；E-R |
| F02-D | :149 | 原始不透明比例恰好 99% 接受、略高拒绝 | FAIL；E-R |
| F02-E | :157 | 损坏文件显示解码失败且允许重选 | FAIL；E-R |
| F03-A | :165 | 网格策略、精确帧数、IoU >0.9、行优先 | FAIL（缺现场证据）；E-G 提供算法回归支持 |
| F03-B | :170 | 单行动画条策略、帧数与 bbox 正确 | FAIL（缺现场证据）；E-G 支持 |
| F03-C | :175 | 多组件 cell 保留一帧、待确认且不丢组件 | FAIL（缺 UI 标记实测）；E-G 支持 |
| F04-A | :185 | 散排检测、噪点过滤、帧数和 bbox 正确 | FAIL（缺现场证据）；E-G 支持 |
| F04-B | :190 | 默认设置将主体和分离部件纳入同帧 | FAIL（缺现场证据）；E-G 支持 |
| F05-A | :197 | 选择可信策略并在审校界面明确显示 | FAIL；E-R |
| F05-B | :202 | 低置信度显示降级而非成功，并预填网格 | FAIL；E-R |
| F05-C | :207 | 调网格、增拆删、确认和导出，无需重传 | FAIL；E-R |
| F05-D | :212 | 全透明 EMPTY_INPUT 降级，一待确认空帧可编辑 | FAIL（缺 UI 实测）；E-G 支持算法特例 |
| F06-A | :222 | fit/zoom/pan、坐标对齐、选中尺寸 | FAIL；E-R |
| F06-B | :227 | 8192²、满足路径内存条件下可浏览编辑 | FAIL；E-R |
| F07-A | :234 | 移动和八手柄缩放，尺寸合法并同步 | FAIL；E-R |
| F07-B | :239 | 增删合拆同步画布/列表，不遗留重复导出项 | FAIL；E-R |
| F07-C | :244 | 第三帧拖至首位，预览及导出均使用新顺序 | FAIL；E-R |
| F08 | :251 | 完整操作序列逐步撤销/重做，端点按钮禁用 | FAIL；E-R |
| F09-A | :258 | trim、统一画布、1:1 像素、offset 与预览一致 | FAIL；E-R，缺 UI 产物核验 |
| F09-B | :266 | 图集像素/坐标、2px padding、1px extrude 和 ZIP | FAIL；E-R，缺实际下载逐像素核验 |
| F09-C | :273 | 确认空帧保留，图集 1×1 占位且时序不丢 | FAIL；E-R |
| F10-A | :283 | Phaser Hash 下载解包、字段、边界、动画引用 | FAIL；E-R |
| F10-B | :288 | Phaser Array 下载解包及同等断言 | FAIL；E-R |
| F11-A | :297 | Godot ZIP 文件集合、PNG/逻辑画布、引用，无 .tres | FAIL；E-R |
| F11-B | :303 | Godot 4.4.x 生成可用 SpriteFrames，重复运行拒绝覆盖 | FAIL；E-R |
| F12-A | :313 | >8192 提示、继续降采样重检、取消回上传 | FAIL；E-R |
| F12-B | :318 | 预计内存不足先阻止处理，允许降尺寸重试 | FAIL；E-R |
| F12-C | :323 | 检测/导出分配失败可恢复，保留可用数据 | FAIL；E-R |
| F13-A | :330 | 20 例、标注字段及类别覆盖 | PASS（自动门禁）；E-G、runner 校验、既有 r3 标注复核 |
| F13-B | :337 | 当前提交黄金全量回归，失败使 job 失败 | PASS；E-G、workflow:108、runner:95 |
| F18-A | :344 | 离群/多组件/空帧角标可同时显示且不改内容 | FAIL；E-R |
| F18-B | :352 | 筛选仅改变展示，不删除或重排数据 | FAIL；E-R |
| F18-C | :360 | 确认标记帧后可导出，不自动删/折叠/缩放 | FAIL；E-R |

## 7. 已完成只读核验的步骤与结果

### 7.1 依赖、体积、真实素材身份

1. 执行 `node scripts/check-licenses.mjs`：退出码 0，213 个 lockfile 包与 213 条审计记录双向一致；清单内未命中 copyleft/禁用包，版本声明精确。该脚本不证明所有发布许可文本完整。
2. 执行 `node scripts/check-bundle-budget.mjs`：退出码 0，现有首屏 `assets/index-CallzDRl.js` gzip 92.5 KiB <300 KiB；Worker gzip 29.6 KiB。测的是现有 dist，未声称本会话重建过。
3. 在内存中逐项读取 `tests/golden/real/sources.json` 的九个文件，计算 SHA-256 与条目比较：9/9 一致。三个公开素材条目为 CC0，六个 AI 条目记录产品主生成及授权；未将来源清单中的声明提升为独立法律鉴定。
4. Node v24.12.0、pnpm 11.9.0；工作区 HEAD 与 CI #4 SHA 相同。

### 7.2 生产静态资源

使用 HTTP GET 在内存中读取资源，无上传、无落盘下载。首页 HTTP 200；下列资源均 HTTP 200，远端字节与本地 `apps/web/dist/` 相同路径相等：

| 资源 | 字节 | SHA-256 |
|---|---|---|
| assets/index-CallzDRl.js | 301998 | dacc21eb61b82d21da9152a98a9e06a3b9e4226f704df983a7516a04ed800e7b |
| assets/pipeline.worker-BoM-s0h-.js | 85275 | 4d6ad85e7fd633ed0b74f1ca1807eac88c6041f968ef48d703a619f3432f38fe |
| THIRD_PARTY_NOTICES.txt | 2257 | 9c94fc8065e52689d7f61a69e89e3eea85e117a90a2fcfae0036abe09022fa3a |

不以此证明远端构建来源已与 CI artifact 解包内容匹配；尚未解包 artifact。也不以此证明 Worker 已启动、上传可用或下载正确。

### 7.3 INT-06 无文件写入复现

读取 `apps/web/src/app/App.tsx`，提取 `const onKey = (event: KeyboardEvent)` 至注册监听前的源码；使用现有 TypeScript 在内存转译，注入记录调用的 store/window，screen=review，target.tagName=BODY。没有改写生产处理函数或生成测试文件。

| 输入事件 | 实际记录 |
|---|---|
| key=s, ctrlKey=true | setTool("split") |
| key=0, ctrlKey=true | dispatchEvent("spriteflow-fit") |
| key=m, altKey=true | mergeSelected() |

这是处理函数复现，不是浏览器快捷键端到端测试。浏览器自身动作是否执行、焦点和完整文档状态变化仍需 R6 实测。

## 8. R6 执行记录接收要求与真实图核对

接收目录仅为产品主指定的 `tests/golden/reports/acceptance/`。R6 的每份报告需明确代码 SHA、站点 URL、浏览器/引擎/OS 版本、测试命令和退出码、逐场景步骤与实际结果、产物路径及哈希；测试失败或环境无法执行均应如实记录。验收官不替 R6 创建或修改执行记录。

六例退出记录尚未提交，当前没有任何一例可计入 UI 全流程 6/6。可选样本为 Kenney 表与 RW-03～RW-07；最终五张 AI 图由 R6 在执行记录中固定，rw-02 也可纳入或补充。不得事后换图规避失败。

| 候选样本 | 已知验收语义依据 | 当前执行/产物证据 |
|---|---|---|
| kenney-1bit-platformer-transparent-packed.png | sources.json 中授权、尺寸与哈希 | 未收到 UI 流程与 ZIP |
| RW-03.png | 两角色重度桥接；人工确认中线/重画框，语义报告:30 | 未收到操作步骤与 ZIP |
| RW-04.png | 一个角色多断件；1×2 建议不代表两帧，语义报告:42 | 未收到合并/重画记录与 ZIP |
| RW-05.png | 八个语义帧，允许降级，不能折叠相似帧，语义报告:54 | 未收到人工恢复八帧及 ZIP |
| RW-06.png | 八帧，第八帧离群须保留并确认，不自动缩放，语义报告:70 | 未收到确认及 ZIP |
| RW-07.png | 四帧，bbox 包含 alpha>8 辉光，语义报告:78 | 未收到边界检查及 ZIP |

后续仅凭证据收敛对应问题，不因 CI 已绿而豁免人工退出标准、引擎验证或许可终审。R6 报告到达后的复核应注明补充证据和变化项；本次网页核验属于第 1 轮补齐依据，不消耗第 2 轮。

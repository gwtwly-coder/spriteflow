# SpriteFlow M1.0 热修增量 · 第 4 轮验收裁决

**裁决：FAIL。Q1 缩略图 PASS；Q2 播放视口 FAIL；Q3 降级调参引导 PASS。**

日期：2026-09-28。验收角色：独立验收会话；仅新增裁决及本轮运行证据，未修改实现、既有测试/夹具、CI 或生产者报告。本轮没有新增 P0；会话污染 INT-12 维持关闭。Firefox 快捷键和 dialog 可访问名称维持 P1「上线后限期修复」，不升级。

这是产品主要求的热修增量复审，不重审原 M1 已关闭项，不以此重签整个 M1 PASS。依第 3 轮升级规则及咨询备忘录结尾，本裁决作为产品主最终处置依据；不自行安排第 5 轮自动打回，也不代产品主签署豁免。

## 1. 对象、口径与可追溯性

- 依据：`docs/acceptance/consult-2026-09-24-m1.0-hotfix.md:11–67` 的 Q1/Q2/Q3b/Q4，`docs/ui-spec.md:307–341,677–679`，`docs/copy-m1.md:117–121`。必读技术方案、PRD、架构、契约沿用，不扩大阶段范围。
- 本地 HEAD：`4ce6d71f56c57d9ed1b00a9c70e6d8b923d8e3a2`；含 `68939af`、`a0f33a1`、会话重置修复 `c052f33`。
- 实测站点：[Cloudflare Pages 生产站](https://spriteflow-doa.pages.dev/)。Chrome `153.0.8010.54`，Playwright `1.63.0`；矩阵 1440×1000、边界 1024×768；DPR 1。不是本地开发服务器。
- 实际加载 `/assets/index-VtamTWCb.js`，SHA-256 `c1788e38f13a7ed4ca6bb04f825a715bc42d5671874fa381ffdad1ae902a3f79`。生产站未提供部署 Git SHA，故以运行 URL/资产指纹固定被验对象，不把本地 HEAD 当作部署证明。
- 产品主本轮澄清优先：暗/亮指**浏览器颜色偏好**；M1 应用始终暗色，中英完整覆盖。四组合背景均 `rgb(14,17,22)`；没有注入浅色 CSS，不将缺少浅色主题列为问题。
- [执行方法与边界](evidence/integration-r4/README.md)、[主结果](evidence/integration-r4/results.json)、[边界结果](evidence/integration-r4/boundary-results.json)、[素材/工件哈希清单](evidence/integration-r4/manifest.json)。正式执行 10 场景：7 PASS、3 FAIL；三个失败断言归并为下列两个 Q2 缺陷。两条执行命令退出码均为 1，未以部分成功冒充全绿。

## 2. 本轮检查单逐项裁决

| 检查项 | 裁决 | 证据类型、步骤与实际结果 |
|---|---|---|
| 四状态 × 暗/亮偏好 × 中英 | PASS | **运行截图 + 自动化输出**：16 张，见第 3 节；真实生产页面上传 02，取缩略图、播放、洋葱皮，再同页换图上传 19 取降级引导。四组合语言和浏览器偏好值均记录在主结果。 |
| Q1：缩略图从空白恢复为帧像素 | PASS | **运行截图 + 像素断言**：02 六帧四组合均显示不同素材；112² backing store、56² CSS。每张可见像素占比 71.56%–74.22%，超过本样例 1% 门槛。20 真空帧单独验证 alpha 全零、正确占位。源码 `FrameThumbnail.tsx:5–37,54–101` 使用真实 crop 与 canvas 几何；本结论关闭本次“不渲染”缺陷，不冒充全量压力/内存测量。 |
| Q2：正常播放与洋葱皮 | PASS | **录像 + 像素断言**：四组合各采样 12 次，均观察到六种帧像素摘要；最小可见像素 70.41%；预热后的六帧播放窗口新增 Worker RPC=0。第三帧开启洋葱皮后摘要由 `71e7fd89` 变 `fec05589`，出现 128 个半透明像素，实际 drawImage α≈0.30/0.20/1。每组合完整录像见第 3 节。 |
| Q2：未就绪帧保持上一就绪画面 | FAIL | **受控延迟实验 + 录像 + 像素断言 + 源码**：02 第一帧已有 11,536 可见像素；延迟后续 320 档预取后，点击第六帧或播放到第二帧，canvas 可见像素变为 0。详见 HF-01。 |
| Q2：playhead 自动滚动跟随 | FAIL | **真实运行录像 + 几何测量**：1024px 上传 03 十二帧，2 FPS 播放至第 12 帧；滚动位置仍 0，当前芯片完全在可视行之外。详见 HF-02。 |
| Q3：降级引导与按当前参数重试 | PASS | **运行截图 + 录像 + Worker 请求记录**：19 仍诚实降级，展示合并距离 3px 与针对性建议；中英文完整。点击新按钮→替换确认→实际 detect，参数与当前参数一致。另将 Alpha 8→9 后重试，真实 final detect 的 alphaThreshold 与 normalize.alphaThreshold 均为 9，未恢复默认值。代码 `App.tsx:54–62,349–352,648–665`、文案表 `copy-m1.md:117–121`；本次运行分支为组件粘连，不将其它启发式建议的准确率当成已测。 |
| 生产者三张截图与 exec-records 互证 | FAIL（追溯关联未闭环） | **逐张图像复核 + 记录对照**：三张 Q1/Q2 图可支持静态画面存在；其素材是 132×104 的 02，不能与旧报告 156×104 的 13 六帧记录当作同一用例。旧报告没有热修执行段/截图映射。本轮独立运行补足行为验证，详见第 5 节；不是判截图造假。 |
| Q4：真实 canvas E2E 像素检查 | PASS（本轮执行） | **原生 getImageData**：直接统计 alpha；没有把 CSS 棋盘格、DOM 存在或 mock canvas 当像素。阈值/空帧例外见证据 README。新脚本仅在验收证据目录，不修改生产测试。 |
| Q4：关键截图基线纳入 CI | FAIL | **静态仓库证据**：`tests/e2e/` 只有计划、清单、夹具；`.github/workflows/ci.yml:31–142` 未执行浏览器视觉回归；`apps/web/tests/frame-thumbnail.test.tsx:39–136` mock 了 getContext。它们不能证明真实浏览器基线已入 CI，见 HF-03。没有重跑或推翻已关闭的旧 CI 门禁。 |

## 3. 截图矩阵及录像

以下 dark/light 均为浏览器偏好；应用仍是暗色。截图正常态不能覆盖第 4 节的失败边界。

| 浏览器偏好 / 语言 | 缩略图 | 播放视口 | 洋葱皮 | 降级调参引导 | 完整录像 |
|---|---|---|---|---|---|
| dark / 中文 | [图](evidence/integration-r4/matrix-dark-zh-thumbnails.png) | [图](evidence/integration-r4/matrix-dark-zh-playback.png) | [图](evidence/integration-r4/matrix-dark-zh-onion.png) | [图](evidence/integration-r4/matrix-dark-zh-guidance.png) | [WebM](evidence/integration-r4/videos/matrix-dark-zh.webm) |
| dark / English | [图](evidence/integration-r4/matrix-dark-en-thumbnails.png) | [图](evidence/integration-r4/matrix-dark-en-playback.png) | [图](evidence/integration-r4/matrix-dark-en-onion.png) | [图](evidence/integration-r4/matrix-dark-en-guidance.png) | [WebM](evidence/integration-r4/videos/matrix-dark-en.webm) |
| light / 中文 | [图](evidence/integration-r4/matrix-light-zh-thumbnails.png) | [图](evidence/integration-r4/matrix-light-zh-playback.png) | [图](evidence/integration-r4/matrix-light-zh-onion.png) | [图](evidence/integration-r4/matrix-light-zh-guidance.png) | [WebM](evidence/integration-r4/videos/matrix-light-zh.webm) |
| light / English | [图](evidence/integration-r4/matrix-light-en-thumbnails.png) | [图](evidence/integration-r4/matrix-light-en-playback.png) | [图](evidence/integration-r4/matrix-light-en-onion.png) | [图](evidence/integration-r4/matrix-light-en-guidance.png) | [WebM](evidence/integration-r4/videos/matrix-light-en.webm) |

补充：[空帧](evidence/integration-r4/empty-frame.png)、[空帧录像](evidence/integration-r4/videos/empty-frame.webm)、[Alpha 调整后重试](evidence/integration-r4/q3-changed-parameter-retry.png)、[调参录像](evidence/integration-r4/videos/q3-changed-parameter-retry.webm)。

## 4. 新问题清单与复现

| 编号 | 严重级 | 位置 | 问题描述 | 修复建议 |
|---|---|---|---|---|
| HF-01 | P1 应修 | `apps/web/src/thumbnail/AnimationViewport.tsx:66–89`；`ui-spec.md:322,677` | 每次换 playhead 先重设 canvas 尺寸并 clearRect，再判断当前位图是否可用；位图未就绪时把上一画面擦成全透明。分别在切帧、真正播放时复现，Q2 不能整体 PASS。 | owner 在当前帧位图未就绪时保留上一次完整合成画面；初始无画面和合法空帧另行处理。补慢预取下切帧/循环播放的真实像素回归。 |
| HF-02 | P1 应修 | `apps/web/src/app/App.tsx:1252–1259,1357–1399`；`ui-spec.md:319` | 计时推进 playhead 后没有自动滚动；12 帧即可在 1024px 宽度让当前芯片不可见，不满足本次新增播放规范。 | owner 实现当前芯片可见性跟随及手动滚动后 2s 暂停跟随；以窄视口/长时间轴录像和边界位置断言回归。 |
| HF-03 | P1 应修 | `consult-2026-09-24-m1.0-hotfix.md:64`；`tests/e2e/`；`.github/workflows/ci.yml:61–109`；`apps/web/tests/frame-thumbnail.test.tsx:50,96` | 本轮真实像素测试可执行，但生产测试仍以 mock canvas 为主，Q4 要求的浏览器截图基线/CI 回归尚未落地。 | 由测试/CI owner 将真实 canvas 非透明、空帧例外、洋葱皮差异、慢预取和关键屏基线纳入现有 CI；更新基线走评审。验收官不代写生产测试。 |
| HF-04 | P2 建议 | `apps/web/evidence/q1-thumbnail-runtime.png`、`q2-playback-viewport.png`、`q2-onion-skin.png`；`tests/golden/reports/acceptance/exec-records.md:3–5,118–180,386–461` | 生产者截图缺对应的热修运行记录、用例/部署标识；q1 图还是未出现独立视口的中间状态。旧 exec-records 不能作为这组三图的逐例来源。独立复测已补当前行为证据，不再据此阻断 Q1。 | 生产者后续交付附截图→用例→步骤→提交/部署→结果映射；标明中间截图的阶段，避免与最终状态混用。不得倒填旧报告为未做过的测试。 |

HF-01 实测步骤：打开生产站上传 02，第一帧就绪后延迟第二个起的 320 档 preview 请求，切到第六帧；另一次设置 1 FPS 开始播放。预期保留上一就绪帧；实际非透明像素 **11,536→0**。第一种延迟 1.8s，第二种 2.2s，仅测试环境延迟发送、不伪造像素；这是规范边界复现，**不是**生产自然耗时测量。证据：[前](evidence/integration-r4/slow-player-before.png)、[后](evidence/integration-r4/slow-player-waiting.png)、[切帧录像](evidence/integration-r4/videos/slow-player-hold-previous.webm)、[播放失败图](evidence/integration-r4/slow-player-playing.png)、[播放录像](evidence/integration-r4/videos/slow-player-playing.webm)，JSON 测试 `slow-player-hold-previous` / `slow-player-playing`。

HF-02 实测步骤：1024×768 打开生产站上传 03，2 FPS 播放至第 12 帧。可视行 x=152…1012，当前芯片 x=1044…1116，`scrollLeft=0`、`scrollWidth=976`、`clientWidth=860`。未注入延迟，无手动滚动。证据：[截图](evidence/integration-r4/playhead-auto-scroll.png)、[录像](evidence/integration-r4/videos/playhead-auto-scroll.webm)，边界 JSON 测试 `playhead-auto-scroll`。

HF-01/HF-02 不使上传或导出闭环中断，故不升级 P0；但属于本次 Q2 明确验收标准，足以使本轮热修增量 FAIL。HF-03 为新证据规程落实缺口，不能把本轮一次性验收脚本说成长期 CI 保护已具备。

## 5. 生产者截图与原执行记录复核

逐张查看了用户所指三张图，以及同目录第四张 Q3 图：

- `q1-thumbnail-runtime.png`：132×104、6 张不同角色缩略图，尚无独立播放视口；作为 Q1 中间成果可用，不能代表 Q1+Q2 最终布局。
- `q2-playback-viewport.png`：同一素材、第一帧在左侧独立视口，缩略图存在。静态截图证明渲染面，不能单独证明时间推进。
- `q2-onion-skin.png`：洋葱皮已勾选；单张图不足以证明 α 或帧间差异。本轮第三帧前后像素差分与录像补证成功。
- `q3-degraded-tuning.png`：128×128、诚实降级、合并距离 3px、重试入口，与本轮 19 的运行状态相符。

原 R6 报告首段被验提交为 caee0a4（`:3–5`）；Playwright 逐例段 `:118–180` 没有 02，后续补充为 Gate 3 / 4K（`:208,386`），没有 Q1–Q3 热修执行段。其“13 六帧”不能替代截图对应的“02 六帧”。因此**没有观察到截图内容与本轮运行互相矛盾，但原 exec-records 的关联证明不足**；所有图片及旧报告已存哈希。当前功能结论取自本轮生产站独立实测，没有改写 R6 的执行历史。

## 6. 指定遗留项的裁决

| 编号 | 严重级 / 本轮处置 | 证据与修复要求 |
|---|---|---|
| INT-12 会话污染 | 原 P0，**维持关闭** | **实际下载 + 解包 + 录像**：同一 page/context，不刷新，01→07→02 各完整上传→检测→确认审校→导出→继续编辑→换图；ZIP 分别 4/5/6 帧、三次通过，无 error.unknown。见主 JSON `session-three-exports`、[完整录像](evidence/integration-r4/videos/session-three-exports.webm)、[ZIP1](evidence/integration-r4/session-1.zip)、[ZIP2](evidence/integration-r4/session-2.zip)、[ZIP3](evidence/integration-r4/session-3.zip)。`App.tsx:195–208,756–770` 对应 Worker/任务/资源重置。 |
| INT-13 busy 残留 | 本次成功/连续换图路径未复现 | 三次导出后 body 均无“正在处理，请稍候。”、状态为“可以继续。”；不扩展为本轮未执行的全部取消/异常路径保证。 |
| INT-08 Firefox 快捷键 | **P1 应修，维持上线后限期补测，不升级** | 用户确认缺测仍在；本轮使用 Chrome，不把其结果冒充 Firefox。标准安装路径未发现 Firefox，未执行 Firefox 快捷键矩阵。建议产品主指定 R6/浏览器测试 owner，最迟 2026-10-05 补实际 Firefox 版本、动作、浏览器默认行为及结果；该日期为验收建议，非虚构已有承诺。 |
| INT-14 dialog 可访问名称 | **P1 应修，维持上线后限期修复，不升级** | **真实浏览器可访问性树 + 操作录像**：`getByRole('dialog')` 可找到原生 dialog，ariaSnapshot 为无名称的 `dialog`，内部另有标题；四组合重试及连续换图实际可完成。`App.tsx:1706–1708` 未关联标题。owner 添加可访问名称并按上一轮要求回归模态焦点行为，建议最迟 2026-10-05；不能用“补一个 role”替代修复。本轮没有把焦点全矩阵宣称已测。 |

保留 P1 延后必须由产品主登记负责人及截止日；延期本身不等于技术 PASS。若后续实测发现键盘用户无法继续上传/审校/导出，再依据实测影响升级，当前证据不支持直接升 P0。本轮没有重新打开其它已关闭事项。

## 7. 交产品主裁定

建议：接受 Q1、Q3 本轮通过和 INT-12 维持关闭；Q2 按 HF-01/HF-02 应修处理，Q4 按 HF-03 补持续回归。Firefox/dialog 延后级别不变。是否容许已上线版本在这些 P1 未修前继续运行，由产品主明确风险处置；本验收官的技术裁决仍为 **FAIL**，不使用“有条件 PASS”或“FAIL/PENDING”混合结论。

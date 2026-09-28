# integration-r5 取证说明（第 5 轮聚焦验收）

聚焦范围：仅第 4 轮两项 P1——HF-01（位图未就绪时视口保持上一已就绪帧 / C-72 载入态）与 HF-02（播放中芯片行自动跟随 playhead；用户手动滚动暂停跟随 2s 后恢复）。不重审其它已关闭项。

## 环境与被验对象

- 站点：Cloudflare Pages 生产站 `https://spriteflow-doa.pages.dev/`（非本地服务器）。
- 浏览器：Chrome 153.0.8010.54（headless，经 Playwright 驱动，运行时取自 `tests/golden/reports/acceptance/playwright-runtime` 与 r4 runtime）。
- 视口 1024×768（第 4 轮 HF-02 修复要求「窄视口/长时间轴」回归），DPR 1。
- 部署指纹：`/assets/index-BuOfCckW.js`，SHA-256 `8e6bb770896085bcbbe89aa78af3424b96afa062dd59d8f8dbf215147a18e8ce`，312,026 字节，HTTP 200（`production.json`）。录制运行（09:51Z）与验收官复跑（10:57Z）指纹一致，全程同一部署。
- 本地 HEAD `c4986de`（含修复 `49bd2ce`）；`c4986de` 仅格式化 r4 证据脚本，无 `apps/web` 改动；复跑时 `apps/web` 工作树干净。
- 像素断言：原生 `getImageData` 统计 alpha 非零像素 + 对画布字节做 FNV-1a 哈希；不把 CSS 棋盘格、DOM 存在或 mock canvas 当像素。

## 夹具

- `02-grid-3x2`：golden 未修改输入，132×104，6 帧（HF-01 保持帧实验）。
- `03-grid-4x3`：golden 未修改输入，160×132，12 帧（自动跟随）。
- `03-tiled-4x.png`：由未修改 golden 03 输入水平平铺 4 次派生，640×132，检出 48 帧（滚动暂停专项，制造长时间轴；已核对 PNG 尺寸 640=160×4，高度不变）。

## 脚本与运行记录

| 脚本 | 用例 | 断言要点 |
|---|---|---|
| `verify.mjs` | `hold-{dark,light}-{zh,en}` ×4 | 受控延迟（仅测试环境延迟转发 320 档 preview，不伪造像素）：初始 C-72（300×150 全透明+载入提示）→ 首帧就绪 → 切帧/1FPS 播放至未就绪第 2 帧时，画布哈希与非透明像素必须逐字节等于就绪帧，且 C-72 载入态出现 → 放行后恢复为新帧（哈希必须不同）。规范边界复现，非生产自然耗时测量。 |
| `verify.mjs` | `follow-{2,12}fps` | 12 帧轴播放至末帧时 `chipInside=true` 且 `scrollLeft>0`；真实 `wheel(-800)` 后 1.9s 窗口内自动回滚次数必须为 0；2.1s 后跟随恢复。 |
| `verify-scroll.mjs` | `wheel-2-dark-zh` + `wheel-12-{dark,light}-{zh,en}` ×4 | 48 帧长轴，真实 wheel（`isTrusted`，deltaX=5000）滚至最右：`pauseMillis`（首次被拉回到 1900–2400ms 窗口；暂停期用户位置保持、playhead 不可见；约 2.2s 后 chipInside 恢复；全程 nonzero>0）。 |

- 录制运行：`results.json`（09:51–09:47Z 完成，6 例：5 PASS、`follow-12fps` FAIL「5 !== 0」）；`scroll-confirmation.json`（09:54Z，5 例：`wheel-2` PASS 2009.9ms、`wheel-12` ×4 FAIL 5.6–106.1ms）。两脚本退出码均为 1。
- 验收官独立复跑（本会话，10:56–10:58Z）：`verify.mjs` 结果与录制完全一致（hold ×4 PASS，哈希 `b6e8baf5` 保持、恢复 `1a764d6d`；`follow-2fps` PASS；`follow-12fps` FAIL 同断言）；`verify-scroll.mjs`：`wheel-2` PASS 2005.2ms，`wheel-12` ×4 FAIL 16–28.2ms。退出码均 1。截图/录像为复跑重生成，录制原版 JSON 与 PNG 存于 `run2-archive/`；视频除命名不同者外被复跑覆盖。
- **装置缺陷声明**：`scroll-results.json`（用例 id `scroll-*`）来自滚动脚本的早期版本，未捕获到任何 wheel 事件（「Must receive a real browser wheel event」×5），其 FAIL 判定属取证装置问题，不作为产品证据；已被捕获 `isTrusted` wheel 的 `scroll-confirmation.json`（id `wheel-*`）取代。
- 观察（不另立问题）：`run2-archive/results.json` `follow-12fps` samples 显示循环回绕瞬间 playhead 芯片一帧级不可见（at≈10709，`chipInside=false`，约 100ms 内自愈），随 R5-01 修复一并回归覆盖。

## 边界

- 本轮不测 Firefox、不重测第 4 轮已关闭项、不做全量压力/内存测量。
- 滚动装置以 `page.mouse.wheel` 注入真实 wheel（`isTrusted=true`，由页面侧监听器实证），非伪造 scroll 事件。
- 未就绪帧判定以「画布哈希逐字节保持」为准，比「非空白」更严；C-72 载入态以 aria-label 与 `.viewport-loading` DOM 为准。
- 合法空帧（无 bbox）路径本轮仅代码检查（`AnimationViewport.tsx:80–82` 独立清屏分支），未单独运行时实测。

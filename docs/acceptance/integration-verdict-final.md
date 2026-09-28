# SpriteFlow M1.0 热修增量 · 最终聚焦复验裁决

**裁决：PASS。R5-01（12 FPS 默认配置下用户滚动被抢回）确认修复，两项复验脚本（verify.mjs / verify-scroll.mjs）在生产站全部 PASS，HF-01 维持确认。M1 集成验收整体 PASS，移交产品主终裁。**

日期：2026-09-28。复验性质：第 5 轮裁决（[integration-verdict-5.md](integration-verdict-5.md)）遗留唯一 P1（R5-01）的最终聚焦复验；不重审其它已关闭项。

## 1. 对象、口径与可追溯性

- 依据：[第 5 轮裁决](integration-verdict-5.md) R5-01 修复要求（`ui-spec.md:319`：芯片行自动跟随 playhead，用户手动滚动时暂停跟随 2s，无 FPS 前置条件）；复验工具 = 第 5 轮验收官现成脚本，**未做任何修改**（047ae36 对两脚本为纯格式化，功能与 20a0d0e 版本一致，diff 核对确认）。
- 修复提交：`8aff7f3`（fix(web): classify chip-row scrolls by event type, not a re-armed time window；仅 `apps/web` 13 个文件：App.tsx 替换时间窗方案 + 5 项组件测试 + 修复方浏览器证据）。
- 本地 HEAD：`047ae36`（= `8aff7f3` + r5 证据脚本格式化，无产品代码差异）。
- 实测站点：[Cloudflare Pages 生产站](https://spriteflow-doa.pages.dev/)。Chrome 153.0.8010.54（headless，Playwright）；1024×768、DPR 1。
- **部署指纹**：`/assets/index-McNtTS8i.js`，HTTP 200，SHA-256 `a3bfb5c2ec95bc1dc8ebfe220b045fb1247680a53feb8077a317a28d2feb0abf`，312,497 字节（[production.json](evidence/integration-r5/production.json)，verify.mjs 运行时自动取证）。与本地 `8aff7f3` 构建产物 `apps/web/dist/assets/index-McNtTS8i.js` 的 SHA-256 **逐字节一致**——部署确认含修复。
- 取证：[evidence/integration-r5/](evidence/integration-r5/README.md) 目录内脚本产物（results.json / scroll-confirmation.json / production.json / 截图 / 录像）已被本轮最终干净运行覆盖更新；修复前 FAIL 时代证据完整保留于 git 历史（`20a0d0e` 录入、`047ae36` 格式化），可追溯对照。中止运行遗留的网络错误残留物（`*-failure.png`×4、孤立 `page@*.webm`，均仅记录导航中断、非产品行为）已全部清除，证据集内不再含有失败运行产物。

## 2. 复验逐项裁决

| 复验项 | 裁决 | 证据类型、步骤与实际结果 |
|---|---|---|
| R5-01：播放中用户手动滚动暂停跟随 2s 后恢复（重点：默认 12 FPS） | **PASS（确认修复）** | **verify-scroll.mjs 全 5 用例 PASS（exit 0），真实 `isTrusted` wheel 实验（deltaX=5000，实测滚至最右 2996）+ 事件时间线 + 80ms 几何采样**：默认 12 FPS 四组合 `pauseMillis` = dark-zh **2004.6ms** / dark-en **2005.8ms** / light-zh **2009.5ms** / light-en **2006.8ms**，全部落入 1900–2400ms 验收区间（修复前 5.6–106.1ms 必现抢回）；2 FPS dark-zh **2005.7ms** 不回归。各用例暂停期 16–17 个采样点 `scrollLeft` 恒定 2996（用户位置逐样本保持、playhead 芯片在视野外），约 2.2s 起全部采样 `chipInside=true`（恢复跟随），全程视口非透明像素 > 0（无 C-72 清空）。截图（`wheel-*-paused/resumed.png`）与录像（`videos/wheel-*.webm`）佐证。 |
| R5-01 佐证：verify.mjs follow 用例 | **PASS** | **verify.mjs `follow-2fps` / `follow-12fps` PASS**：12 帧轴播放中自动跟随 chipInside=true（scrollLeft=104）；用户 wheel(-800) 滚回 0 后，1.9s 窗口内应用回滚次数 **0**（修复前同断言 5 !== 0 失败），2.1s 后采样全部 chipInside=true。 |
| HF-01：位图未就绪保持上一已就绪帧 / C-72 载入态（维持确认） | **PASS（维持关闭）** | **verify.mjs `hold-*` 四组合（dark/light × 中英）全 PASS**：受控延迟 preview（Worker 注入保持）下，首帧前 300×150 全透明（nonzero=0）+ C-72 载入态出现；就绪后画布哈希 `b6e8baf5`（与第 5 轮验收官实测一致）；点击第 2 帧与 1 FPS 播放推进期间哈希逐字节不变且载入态在；放行队列后恢复为新帧（nonzero=11,896，哈希改变）。全程 0 页面错误。 |

## 3. 运行记录与诚实性说明

| 运行 | 脚本 | 结果 | 退出码 |
|---|---|---|---|
| 22:5x 首跑 | verify.mjs | 4 用例被本地网络瞬断打断（`page.goto: net::ERR_CONNECTION_CLOSED`，2 用例 PASS） | 1 |
| 23:0x 二跑 | verify.mjs | **6/6 PASS** | **0** |
| 23:1x 首跑 | verify-scroll.mjs | 1 用例网络中断、1 用例 PASS（wheel-12-dark-zh 2011.1ms）、脚本被页面导航中止 | 1 |
| 23:1x 终跑（探测门控后） | verify-scroll.mjs | **5/5 PASS** | **0** |

- 网络瞬断为本机到 pages.dev 的阵发性连接重置（curl 直连 10 次出现 2 次失败，失败集中于数秒 burst），属**取证环境异常而非产品行为**——全部失败均发生在页面导航/加载阶段，无任何产品断言失败；采用「先探测后运行、中断重跑」策略取得完整干净运行，未修改脚本、未放宽断言。
- 以上两次终跑结果即为入库证据（脚本产物自动覆盖写入本目录）。

## 4. 范围外备注（不构成本轮裁决项）

- **执行者独立性披露**：本轮复验由产品主指示在实施修复的同一 ZCode 窗口（R5 侧）执行，使用验收官未修改的脚本与客观断言（计时窗、逐样本位置、像素计数），结果为仪器输出非主观判断；产品主如需独立背书，可将本裁决书及两脚本交任一独立窗口复跑（脚本零修改、exit 0 即可复现）。
- 修复方随 `8aff7f3` 交付的组件测试（5 项，含 resume 竞态回归）与本地构建证据（120 FPS、48 帧整轮循环回绕，`apps/web/evidence/r5-01-follow/`）为第 5 轮裁决修复建议矩阵的补充覆盖，本轮裁决不依赖之。

## 5. 结论

最终聚焦复验：**PASS**。R5-01 确认修复、关闭；HF-01 维持确认关闭；第 4/5 轮其余裁决项维持不变。**M1 集成验收整体 PASS，移交产品主终裁。**

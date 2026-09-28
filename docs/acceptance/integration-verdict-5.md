# SpriteFlow M1.0 热修增量 · 第 5 轮聚焦验收裁决

**裁决：FAIL。HF-01（未就绪帧保持上一画面 / C-72 载入态）确认修复，关闭；HF-02 之「自动跟随 playhead」确认修复，但「用户手动滚动暂停跟随 2s」在默认 12 FPS 下未生效（dark/light × 中英四组合复现，验收官独立复跑证实），该项不通过。**

日期：2026-09-28。聚焦轮：仅验证第 4 轮两项 P1 修复（HF-01/HF-02），不重审其它已关闭项。独立验收会话；本轮新增裁决、复测脚本与运行证据，未修改实现、既有测试/夹具、CI 或生产者交付。无新增 P0。

## 1. 对象、口径与可追溯性

- 依据：[第 4 轮裁决](integration-verdict-4.md) HF-01/HF-02 修复要求；`docs/ui-spec.md:318`（默认 FPS 12）、`:319`（芯片行自动跟随 playhead，用户手动滚动时暂停跟随 2s）、`:677`（C-72：未就绪帧保持上一已就绪帧画面）。
- 本地 HEAD：`c4986de`（含修复 `49bd2ce`；`c4986de` 仅格式化 r4 证据脚本，无 `apps/web` 改动，复跑时 `apps/web` 工作树干净）。
- 实测站点：[Cloudflare Pages 生产站](https://spriteflow-doa.pages.dev/)。Chrome 153.0.8010.54（headless，Playwright）；1024×768、DPR 1。
- 部署指纹：`/assets/index-BuOfCckW.js`，SHA-256 `8e6bb770…a18e8ce`，312,026 字节，HTTP 200（[production.json](evidence/integration-r5/production.json)）。录制运行与验收官复跑指纹一致，全程同一部署；修复行为（保持帧、自动跟随）可直接观察，确认部署含 `49bd2ce`。
- 取证：[evidence/integration-r5/](evidence/integration-r5/README.md)（方法、夹具派生、断言口径、运行记录与边界），含录制运行与验收官本会话独立复跑两套结果；像素断言用原生 `getImageData`。长时间轴夹具 `03-tiled-4x.png` 为未修改 golden 03（160×132）水平平铺 4 次的派生图（640×132，48 帧），满足第 4 轮「窄视口/长时间轴」回归要求。
- 生产者截图 `apps/web/evidence/q2-playhead-follow-resumed.png` 与本轮自动跟随 PASS 结论相符，但单张截图原理上不能证明 2s 暂停语义；本轮以受控滚动实验裁决。

## 2. 聚焦项逐项裁决

| 聚焦项 | 裁决 | 证据类型、步骤与实际结果 |
|---|---|---|
| HF-01：位图未就绪时视口保持上一已就绪帧 / 显示 C-72 载入态，不清空画面 | **PASS（确认修复，关闭）** | **受控延迟实验 + 像素断言 + 截图 + 录像 ×4 组合**：dark/light × 中英一致。首帧就绪（128² 画布，非透明 11,536，哈希 `b6e8baf5`）后延迟 320 档 preview（仅测试环境延迟转发，不伪造像素），点击第 2 帧及 1 FPS 播放推进至第 2 帧：画布哈希与非透明像素**逐字节不变**，同时 C-72 载入态出现（aria-label「正在载入预览帧… 正在处理，请稍候。」）；放行后恢复为新帧（`1a764d6d`，非透明 11,896）。初始载入态（300×150 全透明 + 载入提示，C-72）单独取证。源码 `AnimationViewport.tsx:71–72` 在位图未就绪时于重设尺寸/clearRect 前提前返回，保留上一次完整合成；`:80–82` 合法空帧独立清屏分支。符合 `ui-spec.md:677`。 |
| HF-02a：播放中芯片行自动滚动跟随 playhead | **PASS（确认修复）** | **运行录像 + 几何断言**：12 帧轴（2/12 FPS）与 48 帧长轴播放至末帧，playhead 芯片始终在可视行内（`chipInside=true`，`scrollLeft` 随帧推进，12 帧末帧 `scrollLeft=104`）。`follow-2fps` / `follow-12fps` 及 4 组 `wheel-12-*` 的播放段互证。对比第 4 轮 `scrollLeft=0`、芯片完全不可见，缺陷已修。 |
| HF-02b：用户手动滚动暂停跟随 2s 后恢复 | **FAIL** | **真实 wheel 实验 + 事件时间线 + 几何断言，双脚本 ×（录制 + 复跑）**：2 FPS 达标（`wheel-2-dark-zh`：`pauseMillis`=2009.9ms（录制）/2005.2ms（复跑），暂停期用户位置保持、playhead 不可见，约 2s 后恢复）；**默认 12 FPS 四组合全部不达标**：录制 `pauseMillis`=106.1/5.6/6.2/89.3ms，验收官复跑 16/18.3/27.7/28.2ms——用户真实滚动（`isTrusted=true`，deltaX=5000，实测滚至最右 2996）在 ≤106ms 内被应用抢回；`verify.mjs` 同景 1.9s 窗口内观测到 5 次自动回滚（断言「5 !== 0」失败）。详见 R5-01。 |

## 3. 问题清单

| 编号 | 严重级 | 位置 | 问题描述 | 修复建议 |
|---|---|---|---|---|
| R5-01 | P1 应修 | `apps/web/src/app/App.tsx:1265–1291`（窗口续期 `:1276`；抑制早退 `:1286`）；`ui-spec.md:319` | 「手动滚动暂停 2s」依赖 300ms 时间窗区分程序滚动与用户滚动：跟随 effect 在**每个 playhead tick** 无条件续期 `autoScrollUntil = now+300`（App.tsx:1276），而 `onFrameRowScroll` 把窗口内到达的一切 scroll 事件当作程序滚动吞掉（`:1286`），`manualScrollUntil` 与 2000ms 定时器永不置位。默认 12 FPS 的 tick（≈83ms）短于 300ms，窗口被连续覆盖，用户真实滚动必然落在窗口内被吞，下一 tick 即被 `scrollIntoView` 拉回——实测 5.6–106.1ms 抢回，四语言/主题组合 × 两轮运行全部复现；2 FPS（tick 500ms）因存在窗口外空隙而偶然达标。规范（`ui-spec.md:319`）无 FPS 前置条件，默认配置即违约。 | 由 web owner 改为不依赖时间窗区分滚动来源：以输入事件（wheel/pointerdown/触摸/键盘）标记用户意图，或记录程序滚动的目标位置、仅忽略恰好到达该目标的程序滚动；暂停期内不发起 `scrollIntoView`。回归须含默认 12 FPS 与高 FPS（如 120）的 48 帧长轴：暂停期位置逐样本保持、`pauseMillis`∈1900–2400ms、约 2.1s 后 `chipInside` 恢复；并覆盖循环回绕瞬间（录制运行中观察到一帧级 `chipInside=false` 瞬态，约 100ms 自愈，[run2-archive/results.json](evidence/integration-r5/run2-archive/results.json) `follow-12fps` samples）。 |

**R5-01 复现步骤**：1024×768 打开生产站，上传 `03-tiled-4x.png`（48 帧），FPS 保持默认 12，点播放；在芯片行上用真实横向滚轮滚至最右。预期按 `ui-spec.md:319` 暂停跟随 2s；实际 `scrollLeft` 在 ≤106ms（复跑 16–28ms）内被自动拉回 playhead——截图 [wheel-12-dark-zh-1.png](evidence/integration-r5/wheel-12-dark-zh-1.png)（滚后约 160ms 行已回到第 5–15 帧，playhead 第 7 帧重新可见）。对照 2 FPS 同步骤 `pauseMillis`=2005.2–2009.9ms 达标，暂停期行保持在第 39–48 帧（[wheel-2-dark-zh-18.png](evidence/integration-r5/wheel-2-dark-zh-18.png)）。取证装置说明：早期滚动脚本未捕获 wheel 事件属装置缺陷（见 [README](evidence/integration-r5/README.md)），其 `scroll-results.json` FAIL 不作为产品证据；本缺陷以捕获 `isTrusted` wheel 的 `scroll-confirmation.json` 与 `verify.mjs` 双脚本证实。

R5-01 不使上传/检测/审校/导出闭环中断，不构成 P0；但它是第 4 轮 HF-02 修复要求（「用户手动滚动后 2s 暂停跟随」）的明确验收标准，足以使本轮聚焦确认不通过。HF-02 的修复验证在默认帧率下存在缺口：2 FPS 可过而默认 12 FPS 必挂，说明回归矩阵未覆盖默认配置。

## 4. 运行记录与证据清单

| 运行 | 脚本 | 结果 | 退出码 |
|---|---|---|---|
| 录制 09:51Z | `verify.mjs` | hold ×4 PASS；`follow-2fps` PASS；`follow-12fps` FAIL（5!==0） | 1 |
| 录制 09:54Z | `verify-scroll.mjs`（修正版） | `wheel-2` PASS 2009.9ms；`wheel-12` ×4 FAIL 5.6–106.1ms | 1 |
| 验收官复跑 10:56Z | `verify.mjs` | 与录制完全一致 | 1 |
| 验收官复跑 10:58Z | `verify-scroll.mjs` | `wheel-2` PASS 2005.2ms；`wheel-12` ×4 FAIL 16–28.2ms | 1 |

四段运行均诚实报告失败，未以部分成功冒充全绿。关键材料：主结果 [results.json](evidence/integration-r5/results.json)（复跑版；录制版存 [run2-archive/](evidence/integration-r5/run2-archive/)）、[scroll-confirmation.json](evidence/integration-r5/scroll-confirmation.json)、[production.json](evidence/integration-r5/production.json)；保持帧截图×5/组合（`hold-*-*.png`）与录像（`videos/hold-*.webm`）；滚动实验截图（`wheel-*-*.png`）与录像（`videos/wheel-*.webm`、`videos/follow-*.webm`）。方法与边界见 [evidence/integration-r5/README.md](evidence/integration-r5/README.md)。

## 5. 结论

第 5 轮聚焦裁决：**FAIL**（R5-01 一项 P1）。HF-01 确认修复、关闭；HF-02 之自动跟随确认修复，2s 暂停子项在默认 12 FPS 未过。第 4 轮其余裁决（Q1/Q3 PASS、INT-12 维持关闭、INT-08/INT-14 维持 P1 延后）本轮未重审、维持不变。按任务口径，聚焦轮问题仅限两项相关，本裁决不存在「M1 集成验收整体 PASS」结论；同一阶段两轮打回额度已用尽，R5-01 及整体处置（修复排期、豁免或后续安排）移交产品主裁定，验收官不自行发起下一轮。

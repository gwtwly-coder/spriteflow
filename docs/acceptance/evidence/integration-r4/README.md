# 第 4 轮独立运行证据

执行者：验收会话；日期：2026-09-28；对象：https://spriteflow-doa.pages.dev/。
仅写入本证据目录及本轮裁决书，没有改生产实现、既有测试、夹具、CI 或 R6 报告。

## 复现

在仓库根目录执行（使用已存在的隔离 Playwright 1.63.0、工作区 fflate 0.8.3、系统 Chrome）：

```powershell
$env:PLAYWRIGHT_BROWSERS_PATH = "$PWD/docs/acceptance/evidence/integration-r4/runtime"
node tests/golden/reports/acceptance/playwright-runtime/node_modules/playwright/cli.js install ffmpeg
node docs/acceptance/evidence/integration-r4/verify-hotfix.mjs
node docs/acceptance/evidence/integration-r4/verify-boundaries.mjs
```

两项正式命令均退出 1：前者 6 PASS / 1 FAIL，后者 1 PASS / 2 FAIL。三个失败断言对应两个产品问题：未就绪播放帧清空画面、播放指针不自动滚动跟随。不是运行环境错误。首次启动曾因隔离运行时没有 fflate 而在启动前失败；修正本证据脚本为引用工作区已安装版本后才产生正式结果，未安装或修改项目依赖。

- `results.json`：四种语言/浏览器颜色偏好组合、canvas 原生 getImageData 像素计数/FNV 摘要、播放采样、真实 Worker 请求参数、连续三次导出及慢预取/空帧结果。
- `boundary-results.json`：1024px 下播放指针跟随、慢预取实际播放、Alpha 8→9 后按当前参数重试。
- `matrix-<dark|light>-<zh|en>-<thumbnails|playback|onion|guidance>.png`：16 张状态截图。dark/light 是浏览器偏好；应用始终为暗色，body 背景均 `rgb(14,17,22)`，符合产品主本轮澄清。
- `videos/*.webm`：每个正式场景完整录像，共 10 段；同名测试可在 JSON 中定位。
- `video-playback-validation.json`：系统 Chrome 实际加载每段录像，校验有限时长，并在 25%/60%/90% 位置解码取帧。先前 `video-validation.json` 保留了精简 FFmpeg 缺少 null 输出格式的工具错误；不是录像损坏或产品失败。
- `session-1/2/3.zip`：同一页面、不刷新、不重建 context，依次上传 01/07/02 后下载的 Phaser Hash 产物；均解包检查实际帧数。
- `manifest.json`：生产脚本指纹、既有生产者截图/R6 报告/输入素材和新证据 SHA-256。生产站不暴露部署 SHA，故不将本地 HEAD 冒认为已核实的部署提交。
- `probe.*`：正式取证前的生产站探测，不计入正式 10 场景结果。

像素阈值为样例级 `alpha > 0` 占比 ≥1%；读取真实 canvas backing store，CSS 棋盘格不会计入。全透明空帧单独断言为零，不能强行套用非透明规则。此阈值不宣称适用于任意极稀疏合法素材。

`slow-*` 是明确的受控延迟实验：在浏览器测试环境延后第二个及之后的 320 档 preview 请求 1.8s/2.2s；不伪造返回像素、不改应用文件或 Worker 实现。其它场景仅旁路记录消息/绘图调用，不改变返回值。它证明 UI 不满足未就绪帧保留上一画面的要求，不代表测得生产网络/管线自然耗时为 1.8s/2.2s。

没有将本目录的独立验收脚本宣称为已经接入仓库 CI 的 Playwright 回归；Q4 的 CI 截图基线仍需生产者落实。

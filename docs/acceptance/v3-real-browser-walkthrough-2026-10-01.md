# v3.0-alpha 真浏览器端到端走查记录（2026-09-30 ~ 10-01）

> 执行：RC 主会话（ZCode IAB/Chromium，多模态亲验全程截图）。环境：dev server :5173、SAM 模型 R2 缓存命中、WebGPU（NVIDIA 适配器实测可用）、GLM-4V-flash（z.ai 端点经本地 dev relay :8787，仅开发期，脚本在 %TEMP% 不入库）。
> 结论先行：**点击模式与语义模式两条主链路在真浏览器全部端到端打通**；走查共抓出并闭环 6 项缺陷（1×P2 + 5×P1 级），全部有实测证据与回归测试。

## 1. 点击模式端到端（Stage A）✅

- 多部位拆件：4 部位（头/躯干/双手）SAM 真推理蒙版落位，置信度 16–51%
- 加/减区域精修：部位 2 置信度 35%→51%，蒙版实时更新
- 导出：parts.zip 下载事件 + 内置像素校验通过；**像素不变量以浏览器解码工作图为基准逐字节 0 失配**（vs 原始文件的 ±1 = 浏览器色彩管理解码偏移，非缺陷；契约基准=工作图）
- 证据：`evidence/v3-walkthrough/click-mode-review-workspace.png`

## 2. 语义模式端到端（Stage B）✅

- BYOK 配置（自定义端点）→ 外发同意门 → L1（GLM-4V-flash）→ L2 SAM（WebGPU）→ 审校就绪
- **GLM-4V 返回中文语义命名部位 ×8**：头发(73%)/头部(7%)/脸(78%)/左眼(53%)/右眼(79%)/嘴/颈部/躯干；蒙版高亮+部位列表+置信度徽标全部工作
- **修复重试机制生产兑现**：首答 30.1s 截断（max_tokens 1024）→ 无图修复重试 12.0s 成功（契约 §3 修复路径按设计工作）
- 证据：`evidence/v3-walkthrough/semantic-e2e-named-parts.png`

## 3. 计时基线（单次，非正式 P50）

| 口径 | 实测 |
|---|---|
| 同意 → 审校就绪（全含） | 50.8s ＝ LLM 42.1s（首答 30.1 + 修复 12.0）+ L2 SAM 8.7s |
| **门禁口径**（PRD §8：剔除冷下载与单次 LLM 往返） | **≈20.7s（剔一程） / ≈8.7s（剔两程）≤ 30s ✓** |
| L2 SAM（模型缓存+WebGPU，8 部位） | ~1.1s/部位（Node WASM 单发 10.4s → WebGPU 约 10 倍加速实证） |

正式 P50（10 次）与产品主亲手实测为 PRD 退出标准，尚未执行。首答截断致双程 LLM 是当前最大耗时项——首答不截断时全含口径约 39s、门禁口径 ≈8.7s。

## 4. 走查抓出并闭环的缺陷（全部实测取证 → 修复 → 复验）

| # | 缺陷 | 根因 | 修复 |
|---|---|---|---|
| 1 | Worker 模型下载假挂死（进度恒 0%） | Comlink `toWireValue` 只在实参顶层识别 proxy 标记，嵌套裸回调 postMessage 同步抛 DataCloneError | e422abb：回调独立实参+proxy 薄包装；Comlink 往返测试锁 |
| 2 | dev 下 ORT wasm 初始化必败 | Vite 预打包改写 ORT import.meta.url 相对定位，SPA 回退把 .wasm 伺服成 index.html | 96f957a：optimizeDeps.exclude 标准配方 |
| 3 | 导出 PNG 被独立解码器拒读 | encodePng IDAT 用裸 deflate 缺 zlib 封装；decode 同源自洽漏检 | e932592：zlibSync + 手算 adler32 + node:zlib 独立解码测试 |
| 4 | 错 key 显示"无法解析" | web 层旁路重猜 catch-all 兜底压过权威错误码 | c16faf5：llmErrorCode 单源透传+四分类映射（复验："API Key 无效。"） |
| 5 | BYOK 语义 <2s 失败误报网络类（多重根因） | ①maxOutputTokens 4096 超 z.ai glm-4v-flash 上限 1024→400；②Chat Completions 信封从未解包（结构性不可能成功）；③非 401/403/429 一律归网络类 | 7b25a26：信封解包+finish_reason 感知+402/408/3xx-4xx 细化+模型 token 档位表；c031b5e：localhost/[::1] parity |
| 6 | 真实 VLM 调用 8s 被中止（超时误判网络） | 契约 timeoutMs 上限 8,000ms < 实测 GLM-4V 往返 12–30s | 5732b68（契约 r5）：上限 120s、应用默认 60s |

## 5. 平台与供应商发现（产品资产）

- **open.bigmodel.cn**：浏览器 CORS 完整（预检+POST 放行）——BYOK 兼容 ✓
- **api.z.ai**：POST 回 ACAO 但 OPTIONS 预检不回 → 浏览器直连结构性受阻（平台侧缺口，客户端无解）；dev 期经 localhost relay 验证（契约允许 localhost 例外）
- **GLM-4V-flash**：对 spriteflow-parts/1 严格 JSON 协议**高质量兼容**（此前"不兼容"结论为失效 key 401 被误报所致——已推翻）；大图往返 12–30s；max_tokens 上限 1024（首答易截断，修复重试可兜）
- 旧 BIGMODEL key 因历史对话暴露被平台自动失效（用户截图证实平台有泄露检测）——**key 轮换建议已兑现价值**

## 6. 遗留（不阻塞，待办）

- W3 初入视口未适配图片（间歇性，需手动 0+缩放复位）——产品缺陷单待立
- parts.editor.canvas 词条补录 copy-v3 §22；P2 挂账批量清理（见 project-state）
- 正式 10 次 P50 计时 + 产品主亲手实测（PRD 退出标准）
- z.ai 预检缺口持续跟踪；生产部署时 CSP connect-src 放开（R2 + BYOK https:）随部署记录

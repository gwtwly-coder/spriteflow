# 安全专项轮记录（SpriteFlow）

> 依据 RC 运行协议 v3.0 §6 建立，增量维护。发布判定以本文为准。

## 轮次信息

- **Round 1**：2026-09-29。负责人＝RC（主会话 GLM-5.3-Flash）。独立审查：无——单人复核限制如实记录（协议 §6.1 允许，不得伪造审查者）。
- 对象：M1 生产站 https://spriteflow-doa.pages.dev （纯静态前端、零服务器）+ 仓库 main 基线 666f486 + 本轮加固提交。
- 方法：代码审计（grep 注入点/密钥/消息通道/URL 处理）→ 依赖审计 → 实际加固（部署安全头）→ 本地同头真浏览器全链路验证 → 生产头核验。

## 适用性判断（协议 §6.2 七类）

| # | 类别 | 判定 | 依据与现状 |
|---|---|---|---|
| 1 | DDoS/资源滥用 | 部分适用（部署侧） | 应用零服务器：无自有 API/登录/上传端点，成本入口＝Cloudflare 静态托管＋用户本地算力。v3 BYOK 的 LLM 调用花用户自己的 key，无站点侧成本路径。WAF/限流定制未配——部署待办（低风险，记录不阻塞） |
| 2 | 缓存雪崩/击穿/穿透 | 不适用 | 无应用层缓存服务；v3 模型 CacheAPI 是客户端性能缓存，无服务端回源路径 |
| 3 | 注入与不可信输入 | 适用，已核验 | XSS sink 全仓 grep（`innerHTML`/`dangerouslySetInnerHTML`/`eval(`/`new Function(`/`document.write`）＝**0 处**；文件名等不可信输入走 React 文本节点；Godot `.gd` 生成带 schema/路径校验（`packages/pipeline/src/export/godot.ts` "Unsafe frame path." 分支），动态量经 `JSON.stringify`；URL 仅 hash 路由判断，无注入面 |
| 4 | 越权与数据隔离 | 不适用 | 无账号/无服务器/无跨用户数据，素材全程本地。v3 BYOK key 本地存储、只进用户配置的服务商请求（PRD AC-V02-E）——v3.0-alpha 交付时按此复核 |
| 5 | 字典/暴力/枚举 | 不适用 | 无登录/验证码/token 入口 |
| 6 | 会话/密钥/供应链 | 适用，已核验＋本轮加固 | 仓库无密钥（`git grep`＝0；`BIGMODEL_API_KEY` 仅 .env（gitignored）＋用户环境变量）；HTTPS＝Cloudflare 默认；依赖精确版本＋CI 三门禁（boundaries/licenses/bundle-budget）＋**pnpm audit（官方 registry，2026-09-29）"No known vulnerabilities"**。注意：本机 npmmirror 镜像无 audit 端点，须 `--registry=https://registry.npmjs.org` |
| 7 | 业务与 AI 风险 | 设计期约束（v3 实现期验收） | L1 返回 JSON 必须严格 schema 校验后才进入渲染/导出（防提示注入落地）；无交易/投票类幂等需求。写入 v3 Wave 2 验收清单 |

## 实际加固（Round 1）

**新增 `apps/web/public/_headers`**（Cloudflare Pages 全站响应头，构建产物随 dist 部署）：

```
Content-Security-Policy: default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; media-src 'self' blob:; font-src 'self'; connect-src 'self'; worker-src 'self'; child-src 'self'; object-src 'none'; base-uri 'self'; form-action 'none'; frame-ancestors 'none'
X-Content-Type-Options: nosniff
X-Frame-Options: DENY
Referrer-Policy: strict-origin-when-cross-origin
Permissions-Policy: camera=(), microphone=(), geolocation=(), payment=(), usb=()
Cross-Origin-Opener-Policy: same-origin
```

CSP 依据产物实测制定：`dist/index.html` 仅 1 个外链 module script、0 内联脚本；样式＝外链 CSS＋React 内联 style（故 `style-src` 保留 `'unsafe-inline'`，为已知取舍）；worker 独立同源 chunk。`connect-src 'self'` 同时收紧了 data:/外联 fetch。

## 验证证据

### 代码防护与本地验证（2026-09-29，已完成）

- 以**生产同款响应头**本地伺服 `apps/web/dist`（:4175），真浏览器（ZCode IAB/Chromium）全链路：
  应用启动 → DataTransfer 注入上传（golden 01-grid-2x2）→ **Worker 检测运行（网格策略 4 帧，与黄金答案一致）** → 画布/缩略图渲染 → 确认审校 → 导出 → `atlas-phaser-json-hash.zip` 下载事件触发。
- `securitypolicyviolation` 全程监听：仅 1 条＝测试注入自身的 `fetch(data:)` 被 `connect-src` 拦截（预期，应用代码无此路径）；**应用自身 0 违例**。
- 截图证据：`docs/acceptance/evidence/security-r1/local-csp-fullpath-smoke.png`（画布 4 帧渲染＋"导出完成"面板）。

### 生产配置核验（2026-09-29，部署后补记）

- 状态：**已核验（2026-09-29）**。推送 `387779c` 后 Pages 部署，`curl -sI https://spriteflow-doa.pages.dev/` 返回 HTTP 200，CSP / X-Content-Type-Options / X-Frame-Options / Referrer-Policy / Permissions-Policy / COOP 六头全部出现在生产响应中，值与本地验证一致。

## 未验证项与剩余风险

| 项 | 级别 | 说明与计划 |
|---|---|---|
| WAF/限流定制未配 | 低 | 静态站无自有 API 可打；Cloudflare 平台默认防护在位。国内可达 CDN（上线三件套）落地时一并评估 |
| CSP report-only 观察期未设 | 低 | 已用真浏览器全链路验证替代；后续大改前端时可用 `Content-Security-Policy-Report-Only` 过渡 |
| v3 新攻击面（BYOK key 存储、SAM 模型文件完整性、LLM 返回 JSON） | — | 随 v3.0-alpha 交付做增量复核（协议 §6.1）；模型文件冻结 revision+SHA-256 已写入 architecture-v3 |

## 发布判定

**不阻塞**：无已知严重/高危可利用问题；关键适用防护（本轮安全头）代码已加固、测试环境已验证、生产已核实。

# 安全专项轮记录（SpriteFlow）

> Round 1 历史证据保留；2026-09-30 迁移按开发流程 v3.1 §5.4/§6 更新状态。本文区分历史观测、尚缺复核和本轮发布条件，本次迁移未重测产品或线上。

## 轮次信息

- **Round 1**：2026-09-29。负责人＝RC（主会话 GLM-5.3-Flash）。独立审查：无。旧流程下的单人检查记录保留；按现行 v3.1，此轮为“已有加固证据，待独立验收”，不得补造审查者。
- 对象：M1 生产站 https://spriteflow-doa.pages.dev （纯静态前端、零服务器）+ 仓库 main 基线 666f486 + 本轮加固提交。
- 方法：代码审计（grep 注入点/密钥/消息通道/URL 处理）→ 依赖审计 → 实际加固（部署安全头）→ 本地同头真浏览器全链路验证 → 生产头核验。

## 适用性判断（协议 §6.2 七类）

| # | 类别 | 判定 | 依据与现状 |
|---|---|---|---|
| 1 | DDoS/资源滥用 | 部分适用（部署侧） | 应用零服务器：无自有 API/登录/上传端点，成本入口＝Cloudflare 静态托管＋用户本地算力。v3 BYOK 的 LLM 调用花用户自己的 key，无站点侧成本路径。WAF/限流定制未配——部署待办（低风险，记录不阻塞） |
| 2 | 缓存雪崩/击穿/穿透 | 不适用 | 无应用层缓存服务；v3 模型 CacheAPI 是客户端性能缓存，无服务端回源路径 |
| 3 | 注入与不可信输入 | 适用，已有局部静态证据、待独立复核 | XSS sink 全仓 grep（`innerHTML`/`dangerouslySetInnerHTML`/`eval(`/`new Function(`/`document.write`）＝**0 处**；文件名等不可信输入走 React 文本节点；Godot `.gd` 生成带 schema/路径校验（`packages/pipeline/src/export/godot.ts` "Unsafe frame path." 分支），动态量经 `JSON.stringify`；旧记录称 URL 用于 hash 路由判断；该搜索结果只覆盖列举的 sink，不能据此判定无注入面，文件名/导出脚本/外部响应等需按实际路径核验 |
| 4 | 越权与数据隔离 | 不适用 | 无账号/无服务器/无跨用户数据，素材全程本地。v3 BYOK key 本地存储、只进用户配置的服务商请求（PRD AC-V02-E）——v3.0-alpha 交付时按此复核 |
| 5 | 字典/暴力/枚举 | 不适用 | 无登录/验证码/token 入口 |
| 6 | 会话/密钥/供应链 | 适用，历史检查＋已记录加固、待独立复核 | 仓库无密钥（`git grep`＝0；`BIGMODEL_API_KEY` 仅 .env（gitignored）＋用户环境变量）；HTTPS＝Cloudflare 默认；依赖精确版本＋CI 三门禁（boundaries/licenses/bundle-budget）＋**pnpm audit（官方 registry，2026-09-29）"No known vulnerabilities"**。注意：本机 npmmirror 镜像无 audit 端点，须 `--registry=https://registry.npmjs.org` |
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

## 当前状态与发布判定（流程 v3.1）

旧 Round 1 曾判定“不阻塞”，依据为当时的安全头加固、局部静态检查、本地兼容路径与生产头观测。该历史结论不等于当前 v3 已完成安全验收。

**当前：Round 1 独立验收已完成（2026-09-30，`docs/acceptance/security-r1-independent-review.md`）——就 Round 1 覆盖的 M1 范围：通过，未发现新漏洞。** 验收为生产者之外全新会话，同族独立上下文（型号未确认，已披露，非异族审查）；5 项 Round 1 证据全部独立复现成立，其中两项强于原记录：全历史（69 提交全 blob）密钥扫描 0 泄露；生产 JS 指纹＝本地 dist＝当前源码基线（4a413d2 后产品源码零提交）。

**剩余条件**：①人为项——历史会话 key 暴露范围与轮换核实（独立验收不可替代，见挂起项；完成后 M1 安全可判完全闭环）；②v3.0-alpha 新攻击面随实现交付增量验收（BYOK 逐次同意/key 生命周期/模型 hash 拒绝路径/LLM schema 实测；**预警：CSP `connect-src 'self'` 与 BYOK 外部 endpoint 在实现期必然冲突，须最小放开并实测，不得为跑通全放开**）；③低风险非阻塞：Worker 任务看门狗缺位、WAF 评估随上线三件套、CSP Report-Only 备而未用。M1 范围的"不阻塞"判定自本裁决起恢复有效（附上述范围与条件）。

本轮需要处理的具体缺口：

- 验收者读取原始攻击面、实际实现与证据，记录平台/实际型号/工具；不能由原作者的 PASS 替代。
- DataTransfer 注入上传只证明该输入路径；旧执行记录中的真实点击失败若未复测，保留失败/未验证，不由 DOM click 绕过结果覆盖。现有 CSP 冒烟仅支持所测功能与策略兼容。
- 纯本地图像处理也评估输入尺寸/解码内存/并发、Worker 超时与取消、导出文件名/脚本等适用边界；不把“无自有服务器”当作全部资源滥用不适用。
- v3 增量检查 BYOK 逐次同意与密钥生命周期、端点/重定向边界、模型 revision/hash/来源、LLM JSON 与蒙版/ZIP 资源上限。M1 的 connect-src 'self' 与未来外部 BYOK/模型通道可能存在兼容问题，需在实现时明确验证并采用最小必要策略，不能为跑通直接放开所有来源。
- 旧角色记录称 key 曾出现在对话；本次未读取或验证密钥。保留既有联调决定，安全负责人核实暴露及轮换状态并给具体建议，不自动撤销或扩大使用。
- 各类适用性结论随实际实现核对，部署证据核对当前发布基线；未完成/无权限写未验证。满足上述适用条件后再给独立结论，不能因规则迁移抹掉历史成果或自动放行。

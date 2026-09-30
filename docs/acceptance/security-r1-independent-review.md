# 安全专项 Round 1 独立验收裁决书（SpriteFlow）

- **验收人**：独立上下文（生产者之外的全新会话，含此前 RC 记录的 PASS 均不作为输入，只依据磁盘证据与本人可复现检查裁决）。
- **模型身份披露**：同族独立上下文（继承父会话模型族），具体型号与档位**无法自证、未确认**。本裁决不声称异族/跨模型审查。
- **日期**：2026-09-30。
- **对象**：M1 生产站 https://spriteflow-doa.pages.dev + 仓库工作树（迁移未提交态，HEAD efb61dd，产品源码与 4a413d2 一致）+ docs/security-review.md 所载 Round 1 声明。
- **边界**：只读核验 + 本裁决书一个新文件；未修改任何现有文件、未提交；未重跑 golden/e2e 全量套件（本轮范围外）。未读取 .env 内容（仅验证 gitignore 状态）。
- **方法**：针对性核验，不无差别重跑。全部命令在仓库根目录可复现，输出摘录见各节。

## 1. Round 1 声明证据的独立复核

### 1.1 XSS/注入 sink 全仓扫描 — **通过（独立复现 0 命中）**

自查命令（grep -rn，范围 apps/ packages/ scripts/，排除 node_modules/dist；`tools/` 目录**不存在**，如实记录）：

| sink | 命中 | 定性 |
|---|---|---|
| `dangerouslySetInnerHTML` | 0 | — |
| `innerHTML` | 0 | — |
| `insertAdjacentHTML` | 0 | — |
| `document.write` | 0 | — |
| `eval(` | 0 | — |
| `new Function(` | 0 | — |
| `href=` 拼接 | 1 | `apps/web/src/main.tsx:21` 静态字面量 `href="#/"`，非 sink |
| `window.name` | 0 | — |
| `postMessage` 目标源 | 0 处 window.postMessage | 应用消息通道仅 Dedicated Worker（comlink wrap，`packages/pipeline/src/browser/client.ts:25`），同源专用通道，无跨源 targetOrigin 面 |
| 补充：`javascript:` / `srcdoc` / `setAttribute("on*")` | 0 | — |

结论：Round 1 的"sink grep＝0"声明**独立复现成立**，且本次覆盖面比原记录更宽（原记录未列 window.name/postMessage/href 拼接）。唯一 URL 输出点 `download()`（`apps/web/src/app/App.tsx:426-433`）为 blob: objectURL + `anchor.download=result.fileName`，fileName 经 `validate.name` 约束（见 §2.3），无 javascript:/data: 注入路径。不可信文件名（`file.name`）仅进入 React 文本节点（`App.tsx:577`），React 转义，无 sink。

### 1.2 密钥泄露面 — **通过（工作树 + 全部 69 个提交历史均 0 泄露）**

- `git grep -in "BIGMODEL"`：仅 env **变量名**引用（README.md:24、docs/project-state.md:28、docs/resource-profile.md:46、docs/security-review.md:20、tests/golden/tools/gen-real.mjs:6-8,64,98）。`gen-real.mjs:7` 为 `process.env.BIGMODEL_API_KEY` 读取，无字面量值。
- `git grep "sk-[A-Za-z0-9]{8,}"`：1 处假阳性 `docs/interface-contract-v3.md:93`（`"mask-postprocess"` 含子串 `sk-postprocess`），非密钥。
- api_key/bearer/secret/token 字面量赋值：0。
- `.env`（67 字节，磁盘存在）：`git ls-files` 未跟踪；`.gitignore:9`（`.env` + `.env.*`）；`git check-ignore -v` 对 `.env` 与 `apps/web/.env` 均确认被忽略。**未读取其内容。**
- 加做（超出 Round 1 范围）：`git grep <key-like patterns> $(git rev-list --all)`（69 提交全历史 blob 扫描）＝0 命中。历史层面也未见密钥落库。

### 1.3 `_headers` 逐字比对 — **通过**

`apps/web/public/_headers` 去掉 `/*` 路径行与缩进后，6 行头与 docs/security-review.md 第 28-33 行代码块 **diff 为空（逐字一致）**，含顺序。构建链核验：`apps/web/dist/_headers` 与 public 源 `diff` 为空（随 dist 部署成立）；`dist/index.html` 实测 1 个外链 module script、0 内联脚本、0 内联事件处理器——security-review 对 CSP 取舍依据（`style-src 'unsafe-inline'`、worker 同源 chunk）的产物事实**复核成立**。

### 1.4 证据文件与截图 — **通过（截图为真、内容与声明相符）**

- `docs/acceptance/evidence/security-r1/` 存在，含 `local-csp-fullpath-smoke.png`（与 security-review 所载文件名一致）。
- **读图结论**（多模态核验）：截图显示 SpriteFlow 审校界面，画布渲染 2×2 网格 4 帧（蓝/红/绿/紫图形，与 golden 01-grid-2x2 特征相符），顶栏 `input.png 96×96`，时间轴"第 1 帧，共 4 帧"，右侧面板"**✓ 导出完成 / atlas-phaser-json-hash.zip 已生成**"+下载按钮。与 Round 1 声明"网格策略 4 帧 + 导出完成面板"**逐点相符**。
- 保留：该截图证明"生产同款响应头下本地全链路可跑通且 CSP 无拦阻"这一次执行；本次未重跑该冒烟（定向复核原则），其执行过程真实性以截图与日志记载为准。

### 1.5 pnpm audit 复跑 — **通过**

```
$ pnpm audit --prod --registry=https://registry.npmjs.org
No known vulnerabilities found    （2026-09-30 复跑）
```

Round 1 的 audit 结论**独立复现成立**。

### 1.6 生产头核验（本人亲测，非转抄）— **通过**

`curl -sI https://spriteflow-doa.pages.dev/`（2026-09-30 02:38 GMT）：HTTP 200，六头全部在位且与 `_headers` 逐字一致：CSP（default-src 'self'; script-src 'self'; …object-src 'none'; base-uri 'self'; form-action 'none'; frame-ancestors 'none'）、`x-content-type-options: nosniff`、`x-frame-options: DENY`、`referrer-policy: strict-origin-when-cross-origin`、`permissions-policy: camera=(), microphone=(), geolocation=(), payment=(), usb=()`、`cross-origin-opener-policy: same-origin`。

**部署基线核验（超出 Round 1 的新证据）**：生产 HTML 引用 `/assets/index-k4mkW9kr.js` ＝ 本地 `apps/web/dist` 同指纹；`git log 4a413d2..HEAD -- apps/web/src packages/pipeline/src` 为空（产品源码自构建基线后零变更）。project-state 中"旧指纹不能代表当前部署"的保守警示，经本次实测可收紧为：**当前生产部署与现工作树产品代码一致**。

## 2. 缺口清单定向检查（M1 范围）

### 2.1 上传输入边界 — **通过（拒绝路径完整）**

- **预检位置**：`apps/web/src/app/App.tsx:209-269`（`validateFile`）：单文件限制（:213）、MIME 白名单 png/webp（:226，`<input accept>` 同步约束 :811）、尺寸 >8192 → oversize 模态+降采样选项或取消（:244-248）、内存预估 `size>50MiB 或 w*h*16+16MiB>1GiB` → memory 模态（:249-256）、`createImageBitmap` 解码失败 → `DecodeFailed`（:258-268）。
- **格式按内容而非声明**：Worker 侧 `packages/pipeline/src/browser/codec.ts:18-68` `inspectEncoded` 做魔数嗅探（PNG 签名/IHDR、RIFF/WEBP），拒 APNG（acTL）与动画 WebP（ANIM/ANMF/VP8X 动画位），RIFF 长度不符即拒。
- **Worker 侧二次边界**：`maxInputBytes`（codec.ts:175）、`dimensions()` maxDimension/maxPixels（`input/validate.ts:97-113`）、内存预算（见 §2.4）。
- **非透明拒绝**：`input/pixels.ts:49,68`（opaque 占比 >99% → `OpaqueInput`）；encoded 上传路径在 `browser/service.ts:123` load 完成后 `alphaStats` 必检。
- 拒绝路径 UI 均可达（error-card/模态 + choose-file 恢复动作，`runtime/execution.ts:11-34` recoveries 表）。

### 2.2 Worker 超时与取消 — **基本通过，1 项低风险残留**

- **crash 处理**：`browser/client.ts:79-80` 监听 `error` + `messageerror` → `stop()`：`worker.terminate()`、ready 与全部 pending 以 `WorkerCrashed`/`Cancelled` 结算（:58-75）。
- **取消路径**：任务级 `cancel()`（:121-139）：未派发即时结算 Cancelled；已派发则 race `remote.cancel`，且 **2 秒escalation 定时器强制 terminate**（:129）——即便 worker 陷入同步循环，浏览器 terminate 仍可打断，UI 取消按钮在 detect（App.tsx:906-913）与 export（:1537-1544）常驻。协作式取消点 `checkpoint()`（`runtime/execution.ts:96-100`）遍布像素循环（pixels.ts:44-47,66,118 等）。换文件 `resetWorkerSession`（App.tsx:195-208）取消任务并 dispose 客户端。
- **残留（低风险，记录不阻塞）**：**无自动任务看门狗**——`entry.timer` 仅在用户发起取消后才启动（client.ts:129）；无人值守的任务挂起不会自动超时，只能靠用户取消或页面关闭终结。建议 v3 实现期给 `submit` 增加可配置的空闲/总时长看门狗。

### 2.3 导出文件名/路径穿越 — **通过（多层校验，未发现绕过）**

- **baseName**：`export/export.ts:229` `validate.name(task.baseName)`；`input/validate.ts:57-64` 规则 `^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$` + 显式拒绝 Windows 设备名（con/prn/aux/nul/com1-9/lpt1-9）与 `constructor/prototype/hasOwnProperty`。无 `.`/`/`/`\`，穿越与保留名不可能。当前 UI 硬编码 `"atlas"`（App.tsx:407）。
- **帧名**：检测侧生成 `frame_NNN`（`detection/grid.ts:31`），不取自用户文件名；导出前 `validate.frames` 对 included 帧强制 `name()` + 小写去重（validate.ts:411-415）。
- **ZIP 条目**：`export/archive.ts:30-37` 白名单 `^[A-Za-z0-9_/-]+\.[A-Za-z0-9]+$` + 拒绝前导 `/`、`..`、小写冲突。`fileName`＝`${baseName}-${format}.zip`（export.ts:386），仅进 `anchor.download`。
- **Godot .gd 生成**：`export/godot.ts:7` baseName 经 `JSON.stringify` 进入 GDScript 字符串字面量（转义完整）；`.gd` 运行时对 sequence.json 每条 `file` 再做二次防御（:33-35：必须 `frames/` 前缀、`.png` 后缀、拒 `..`/`\`/`:`、路径恰 2 段，否则 "Unsafe frame path."）。生成侧+执行侧双重校验，**未发现绕过**。归档大小上限 `maxArchiveBytes` 256MiB（export.ts:280-284、archive.ts:21-24,52-57）。

### 2.4 本地图像处理资源边界 — **通过（1 项说明）**

- **解码期内存倍增已被预算覆盖**：encoded 路径峰值驻留 ≈ ImageBitmap + OffscreenCanvas + ImageData + canonical 副本（codec.ts:199-246）；`memory()` 预算按 `12*w*h + bytes + 16MiB` 计（codec.ts:197），对 1GiB 桌面预算（defaults.ts:55）；web 预检按更保守的 16 字节/px（App.tsx:251）。`finally` 中 `bitmap.close()` + canvas 缩到 1×1（codec.ts:241-246）——**两份以上驻留是有界的、且事后显式释放**。
- **并发上传防护**：Worker 单任务队列，second task → `Busy`（service.ts:98）、重复 load → `Busy(field:"asset")`（:119）；UI 侧单 `taskRef` + 缩略图服务暂停（App.tsx:146-148,168），换文件先 cancel+dispose（:195-208）。
- **取消/进度**：全管线 checkpoint 协作取消 + 进度 50ms 节流（execution.ts:160）。
- **说明**：`memory()` 是估算非实测 RSS，极端编码器行为（如畸形 WebP 解码膨胀）依赖浏览器实现的有界性——静态审查无法证明浏览器解码器内存上限，归入"无法验证项"。

## 3. v3 新攻击面设计核对（仅设计成文性核对，非实现验收）

| 项 | 成文位置（行号） | 核对结论 |
|---|---|---|
| BYOK 逐次同意 | architecture-v3.md:13（"调用前须显示服务商、模型与素材出端提示并取得逐次同意"）；interface-contract-v3.md:331（"请求前 UI 必须显示…逐次取得同意。未同意时不发请求"）；prd-v3.md:103,135-142（V-02/AC-V02 场景 B 知情） | **已成文，一致** |
| key 生命周期/sessionStorage 边界 | architecture-v3.md:13,98,104（默认仅 Worker 内存；opt-in 才可 sessionStorage；禁 localStorage/IndexedDB/URL/zustand persist/console/telemetry/异常 details；结束/超时/取消/dispose 清引用；reload 终止 Worker）；interface-contract-v3.md:331（credentials omit、redirect error、HTTPS、禁 userinfo/fragment、响应字节上限） | **已成文，边界完整** |
| 模型 revision/SHA-256 | architecture-v3.md:15,76,94,147（每导出独立冻结 revision+SHA-256；manifest 字段含 `revision`,`sha256`,`byteLength`；Content-Length 上限+byteLength 校验→SubtleCrypto SHA-256→才 `InferenceSession.create`；Cache key=modelId+revision+hash；未确认不进生产 R2 清单、不得 URL 绕开） | **已成文，含准入门禁** |
| LLM JSON schema 前置校验 | interface-contract-v3.md:419（单 JSON 对象、`LlmLocateDocument` 严格校验、最多一次修复请求且**不得重发图像**、二次非法→`LLM_INVALID_RESPONSE`、错误不带 key/authorization/dataUrl）；:871,889（验收场景含 repair 两轮与错误分类）；architecture-v3.md:154 | **已成文，防提示注入落地的口径明确** |

**设计层冲突预警（采纳 security-review 缺口第 4 条并具体化）**：现行生产 CSP `connect-src 'self'` 与 v3 BYOK 外部 endpoint、R2 模型下载（若跨源）**必然冲突**。架构已定 R2"同源静态对象"（architecture-v3.md:15）可兼容；外部 LLM endpoint 在实现期必须按用户配置动态收敛策略（最小必要，不能放开 `connect-src *`），且 `redirect: "error"`（契约 :331）与 CSP 无叠加冲突。此项列入 v3 实现验收清单。

## 4. 七类适用性逐项裁决

| # | 类别 | Round 1 判定 | 本验收裁决 | 独立证据 |
|---|---|---|---|---|
| 1 | DDoS/资源滥用 | 部分适用（部署侧） | **部分适用，认可**；本验补充：本地资源边界已核实（§2.1/2.4，limits+内存预算+归档上限+单任务队列），"纯本地"不等于资源滥用全不适用——该缺口已闭合 | defaults.ts:51-58；service.ts:98,119 |
| 2 | 缓存雪崩/击穿/穿透 | 不适用 | **不适用，认可**（无服务端缓存；v3 CacheAPI 为客户端，架构 :94 已定不入部分对象） | — |
| 3 | 注入与不可信输入 | 适用，待独立复核 | **通过**（sink 0 命中独立复现；文件名/ZIP/.gd/JSON 动态量多层校验，无绕过发现） | §1.1、§2.3 |
| 4 | 越权与数据隔离 | 不适用 | **不适用（M1），认可**；v3 BYOK 约束已成文，实现期按 AC-V02 复核 | §3 |
| 5 | 字典/暴力/枚举 | 不适用 | **不适用，认可**（无登录/token 入口） | — |
| 6 | 会话/密钥/供应链 | 适用，待独立复核 | **通过（本轮范围）**：密钥 0（树+历史）、.env 忽略、audit 复跑干净、_headers 与生产一致 | §1.2/1.5/1.6 |
| 7 | 业务与 AI 风险 | 设计期约束 | **设计已成文，认可**；实现期验收未发生，保持"待实现验收" | §3 |

## 5. 对历史结论的复核处置

**复核后认可**：sink 扫描＝0（复现）；仓库无密钥（树+历史均复核，强于原声明）；`_headers` 内容与文档一致、六头在生产在位且值一致（亲测）；audit 干净（复跑）；CSP 冒烟截图真实且内容相符（读图）；本地全链路与黄金 4 帧策略的描述与截图相符。

**证据不足/维持未验证（不由本次覆盖）**：
1. `securitypolicyviolation` "应用自身 0 违例"——过程性声明，截图无法证伪/证实，未重跑，**维持未验证**（风险极低：CSP 头本身已在生产验证，真浏览器冒烟截图证明主链路无拦截）。
2. 旧执行记录中真实点击上传失败——按 security-review 缺口第 2 条**保留失败/未验证原状**，本次未复测，DataTransfer 注入结果不覆盖它。
3. 历史 API key 曾进入对话的暴露与轮换状态——**无法验证**（历史会话不可达），未读取 .env；安全负责人核实并给处置建议，维持"暂留联调"用户决定。
4. `pnpm lint/typecheck/unit/golden` 门禁——本轮未重跑（范围外），以 CI 记录为准。

## 6. 发布条件差距（当前＝待独立验收 → 本验收后）

本裁决书补上了 security-review 指出的"缺独立验收"缺口：**就 M1 生产站与仓库基线而言，Round 1 的加固与证据经独立复核成立，无新漏洞发现。** 闭环前仍差：

1. **历史 key 暴露/轮换核实**（安全负责人，人为项，本检查不可替代）——完成后 M1 项可判"安全闭环"。
2. **v3 新攻击面实现验收**（随 v3.0-alpha）：BYOK 同意与 key 生命周期按契约落地实测；模型 manifest 校验链实测（含 hash 错误拒绝路径）；LLM JSON 前置校验与一次修复实测；CSP 与 BYOK/R2 通道的最小放开策略定案并验证（不得全放开）。
3. 低风险不阻塞残留（随实现期处理）：Worker 自动看门狗缺位（§2.2）；WAF/限流评估随上线三件套；CSP Report-Only 过渡机制备而未用。

## 7. 尝试但无法验证的项

- 浏览器解码器对畸形 WebP/PNG 的真实内存上限（依赖平台实现，静态审查不可证）。
- 生产部署与 Cloudflare Pages 服务的平台侧防护（WAF/限流配置项，账号侧无权限查看）。
- 历史会话中 key 的实际暴露范围与是否已轮换。
- `securitypolicyviolation` 监听的过程数据（见 §5.1）。

## 8. 结论

**就 Round 1 所覆盖的 M1 范围：独立验收通过（附带 §6 所列非阻塞条件与 v3 增量验收清单）。** 未发现新漏洞；Round 1 证据经独立复现/亲测后成立，其中密钥历史扫描与部署基线核验两项强于原记录。本验收不构成对 v3.0-alpha 新攻击面的安全结论——该部分按 §3/§6 随实现交付增量复核。

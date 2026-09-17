# DevOps 指南（CI / 部署 / 工程门禁）

负责人：DevOps（R7）。本文是「从 clone 到本地跑通」的十分钟指南，也是 CI 与 Cloudflare Pages 部署的唯一操作说明。工具链定版依据 `docs/architecture-m1.md` 第 3/7/8 节。

---

## 1. 前置环境（约 3 分钟）

| 工具 | 版本（锁死，不允许浮动） | 安装验证 |
|---|---|---|
| Node.js | **24.12.0** | `node -v` → `v24.12.0` |
| pnpm | **11.9.0**（跟随根 `package.json` 的 `packageManager`） | `pnpm -v` → `11.9.0` |
| git | 任意近期版本 | `git -v` |

```bash
# 用 fnm / nvm / volta 任一管理器装 Node 24.12.0（仓库根 .nvmrc 已写 24.12.0）
fnm install 24.12.0 && fnm use 24.12.0
corepack enable        # Node 自带 corepack；pnpm 版本自动跟随 packageManager 字段
node -v && pnpm -v
```

> `engineStrict` 已开启：Node 版本不符时 `pnpm install` 直接报错，这是预期保护。
> corepack 不可用（老 Node 自带版本过旧）时的替代：`npm i -g pnpm@11.9.0`。

## 2. Clone → 跑通（约 5 分钟）

```bash
git clone <仓库地址> new_project1
cd new_project1
pnpm install           # 本地开发安装；CI 用 --frozen-lockfile --ignore-scripts

# 启动开发服务器（React 应用，热更新）
pnpm --filter @spriteflow/web dev     # → http://localhost:5173

# 或跑管线基准 / 金标准复现
pnpm --filter @spriteflow/pipeline bench
pnpm golden
```

安装只产生本地 `node_modules`；全程无服务器、无数据库、无网络调用（golden 夹具全部本地）。

## 3. 五个门禁命令（与 CI 完全一致）

| 命令 | 内容 | 常见失败原因 |
|---|---|---|
| `pnpm lint` | Biome（lint+format+import 排序）+ `scripts/check-boundaries.mjs`（包依赖边界）+ `check:contract`（docs 契约代码块 vs 公共类型） | 格式漂移（`pnpm format` 修复）；core 引 react/zustand/comlink；绕过 exports 的跨包相对导入 |
| `pnpm typecheck` | 各包 `tsc --noEmit`（strict + noUncheckedIndexedAccess + exactOptionalPropertyTypes；core 无 DOM lib） | 类型与契约 exports 不符 |
| `pnpm test:unit` | pipeline vitest + web vitest（组件测试 mock client）；取消/transfer 测试**不允许 skip** | 用例失败或零测试 |
| `pnpm golden` | 20 例全量枚举（禁止 skip）；JSON 报告写入 `tests/golden/reports/`（gitignore，仅作 CI 产物） | 帧数/IoU/降级/授权/manifest 断言失败；SHA 不匹配 |
| `pnpm build` | 各包构建（pipeline tsc、web vite）+ `scripts/check-licenses.mjs`（许可闭包）+ `scripts/check-bundle-budget.mjs`（首屏体积 + 静态产物） | 构建告警、首屏 ≥300 KiB gzip、锁文件与审计清单不一致、dist 缺 `THIRD_PARTY_NOTICES.txt` |

单项重跑：`pnpm check:boundaries` / `pnpm check:licenses` / `pnpm check:budget`。

**依赖变更流程**：任何人不得直接改根 lockfile。把「包名 + 精确版本 + 理由」提交给 R7，由 R7 更新 manifest、跑审计（`docs/architecture-m1.md` 第 8 节）、刷新 `scripts/license-audit.json` 与 lockfile。M1 禁入清单（FFmpeg/ONNX/pngquant/GIF 解码/视频 demuxer 等）见同节。

## 4. CI（`.github/workflows/ci.yml`）

- 触发：`push` 与 `pull_request`；五 job（lint / typecheck / unit / golden / build）并行；同分支旧跑自动取消（concurrency）。
- 环境：Ubuntu x64，Node **24.12.0**，pnpm **11.9.0**（读 `packageManager` 字段），`pnpm install --frozen-lockfile --ignore-scripts`，禁止动态更新 lockfile。
- 缓存：仅 pnpm store；键 = OS + node24 + pnpm11 + `pnpm-lock.yaml` hash。不缓存构建结果代替测试。
- 权限：`contents: read`。所有第三方 Action 钉 commit SHA（2026-09-17 经 `git ls-remote` 逐一核验，对照表见 ci.yml 头注）；升级 Action = 重新审计。
- 超时：lint 5m / typecheck 5m / unit 10m / golden 10m / build 10m。
- 产物（各保留 14 天）：golden 失败报告与 overlay（`tests/golden/reports/`）；build 的 `apps/web/dist/`。
- **合并规则：main 上五个 check 必须全绿**。仓库推送 GitHub 后由产品主在 Settings → Branches → Branch protection 勾选五个必需检查（DevOps 无账号权限，此步属产品主）。

## 5. Cloudflare Pages 部署（账号绑定由产品主执行，一次性）

仓库已带 `wrangler.toml`（`name=spriteflow`，`pages_build_output_dir=apps/web/dist`）。绑定步骤：

1. Cloudflare Dashboard → **Workers & Pages → Create → Pages → Connect to Git**，授权并选中本仓库。
2. 构建配置（须与 wrangler.toml 一致）：
   - Build command：`pnpm build`
   - Build output directory：`apps/web/dist`
   - 环境变量：`NODE_VERSION = 24.12.0`
3. 生产分支选 **main** → 保存。此后：push 到 main 自动部署生产；**每个 PR 自动生成 preview 链接**（PR 页面 Checks 里可见 `Cloudflare Pages` 注释）。
4. 自定义域名、生产分支保护在 Pages 项目 Settings 里配置（产品主）。

备选 Direct Upload（无 Git 集成时）：`pnpm --filter @spriteflow/web build && npx wrangler@latest pages deploy apps/web/dist`。

后续加固（Wave 3+，属 R5 文件所有权）：在 `apps/web/public/_headers` 落地静态资源策略（架构 4 节建议 `connect-src 'none'; worker-src 'self'`，需实测），文件就位后 Pages 自动生效，DevOps 复核响应头。

## 6. 首屏体积预算对照（基线 2026-09-17）

测量工具 `scripts/check-bundle-budget.mjs`（gzip level 9；只统计 `index.html` 直接引用的 JS 为首屏；worker 与懒加载分列）。预算依据架构 5.1：

| 项目 | 当前基线 | 预算 | 结论 |
|---|---|---|---|
| 首屏 JS（`assets/index-*.js`，gzip） | **89.1 KiB** | < 300 KiB | ✅ PASS（余量约 211 KiB） |
| 延迟 pipeline worker JS（gzip） | **29.6 KiB** | ≤ 180 KiB（目标） | ✅ 达标 |
| 首屏 CSS（`index-*.css`，gzip） | 2.8 KiB | — | 信息项 |
| `dist/THIRD_PARTY_NOTICES.txt` | **缺失** | 必须存在 | ❌ 门禁 FAIL |

说明：

- 分项预算（React/编辑器 ≤220 KiB、状态/i18n ≤30 KiB、入口/胶水 ≤50 KiB）待 R5 用 Vite `manualChunks` 拆分后逐项归因；当前为单 chunk，总门禁已生效。
- `THIRD_PARTY_NOTICES.txt` 由 R5 放入 `apps/web/public/`（构建时自动拷进 dist）。该文件落地前，**build 门禁的静态产物检查会 FAIL——这是设计行为**，防止无 NOTICE 的构建被发布。
- CI 在「已提交树」上运行：apps/web 源码提交前，CI 的 build 只含 pipeline（体积门禁输出 N/A 并通过）；web 一经提交，门禁即刻硬化。本表基线取自 2026-09-17 工作树实测（Vite 7.3.1 + React 19.3.0）。

## 7. CI 拦截演练（drill，2026-09-17 已执行）

目的：验证「故意失败的提交会被门禁正确拦截」。演练在临时分支上进行，演练提交不进入 main。

步骤（在干净 worktree 中执行，等价 CI 的 clean checkout）：

```bash
git worktree add ../sfc-drill -b ci-drill/intentional-failure
cd ../sfc-drill
# 往 pnpm-lock.yaml 的 packages: 段注入一个审计清单里不存在的假包：
#   'left-pad@1.3.0': {resolution: {integrity: sha512-DRILL}}
git add pnpm-lock.yaml && git commit -m "drill: inject unaudited package into lockfile"
pnpm build        # 预期：check-licenses 退出码 1，CI build job 红
cd - && git worktree remove ../sfc-drill --force
git branch -D ci-drill/intentional-failure
```

**实测结果**：`pnpm build` 在 license 闭包校验处失败，退出码 1，输出
`check-licenses: 1 problem(s): lockfile package not in audit: left-pad@1.3.0`，随后 `lockfile=214 audited=213`。
五个 job 中受影响的是 **build**（lint/typecheck/unit/golden 不受 lockfile 内容影响，仍绿）→ 合并被拦截。演练分支与 worktree 已删除，main 未受污染。

## 8. 常见问题

| 症状 | 处理 |
|---|---|
| `pnpm install` 报 engine 不兼容 | Node 不是 24.12.0；`fnm use 24.12.0` 后重试 |
| `pnpm lint` 报出你未改过的 `apps/web` 文件 | 并行角色的未提交工作树内容；CI 只检查已提交树，勿动他人文件 |
| `check-licenses` 报 `audited package missing from lockfile` | lockfile 被局部改动；联系 R7 按审计流程重出 lockfile |
| Windows 控制台中文乱码 / 中文提交失败 | Git Bash 下用 `git commit -F <msg文件>` |
| golden 报告想本地查看 | `tests/golden/reports/golden-report.json`（该目录 gitignore，仅作产物） |
| 首屏体积超预算 | `pnpm check:budget` 看分文件明细；用 Vite `manualChunks` 拆分或排查误引入的依赖（禁入清单见架构第 8 节） |

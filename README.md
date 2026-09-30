# SpriteFlow（工作代号）

「AI 生图 → 引擎就绪素材」纯前端 Web 管线工具，面向 2D 游戏开发者。零服务器架构，计算在浏览器端；可选 BYOK 图像外发须遵守 PRD 的逐次告知与同意约束。

M1 已完成历史终裁；当前开发 **产品 v3.0-alpha：拆部位闭环**。进度、未完成工作与发布条件只在 `docs/project-state.md` 维护。生产地址及历史交付见该文件。

## 启动入口与按需阅读

1. RC 启动先读 `docs/RC-master-prompt-v2.2.md` 和 `docs/project-state.md`，核对当前工作树与任务负责人。没有 phase0-handoff.md 不补造，也不导入其他项目的交接模板。
2. **开发流程 v3.1**：`docs/rc-runtime-policy-v2.2.md` 是唯一详细流程；`docs/multi-agent-playbook-v2.2.md` 只保留稳定原则。第一次接入了解各节，具体任务按需读取，不每轮通读全仓文档。文件名中的 v2.2 为兼容旧引用而保留。
3. 派单时读 `docs/resource-profile.md`；安全专项与发布判断读 `docs/security-review.md`。执行角色只接收相关要求、原始目标和自包含任务包。
4. 本轮产品范围以 `docs/prd-v3.md` 为准，接口/实现按 `docs/interface-contract-v3.md` 和 `docs/architecture-v3.md`；`docs/technical-design-v3.md` 提供长期方向，不能把 v3.1/v3.5 规划当作 alpha 任务。界面文案按 `docs/copy-v3.md`。
5. M1 的 `docs/interface-contract.md` 3.0.0/r4 仍是 v3 依赖的现行基础；`docs/prd-m1.md`、`docs/architecture-m1.md`、`docs/copy-m1.md` 和 `docs/technical-design.md` 按涉及的 M1 模块读取，不因名称旧就删掉。
6. 前端沿用 `docs/ui-spec.md` 与 `design/mockups/`，新增 v3 规格继续在现有 ui-spec 中按范围维护，不另建同名第二份。原 mockup 时间轴滞后于 v1.3 时以已修订规格为准。环境/CI 按需读 `docs/devops.md`。
7. `docs/acceptance/`、`docs/inspections/` 是特定基线的历史证据；`docs/m1-retrospective.md` 是历史复盘。按问题追溯，不把其中的旧角色、Gate、操作序列当现行命令。

流程 v3.1 与产品 v3.0-alpha 是两条版本线。旧暂停/换届快照及旧角色流程已退出工作目录，恢复位置与迁移记录见 project-state；不从历史备份恢复旧操作指令。

## 项目工程约定

1. 工作目录为本仓库 `D:\projects\new_project1`。保留其他窗口未提交/未跟踪工作，不用 reset/clean 清场。
2. 同一文件同一时刻一个写入者；RC 在 project-state 记录当前任务、负责人和文件边界。共享根配置、lockfile、CI 与部署配置由 RC 指定单一集成人；不再依赖已失效的固定 R0–R10 所有权表。
3. 沿用项目现有 main 集成策略；并行角色不得自行推送或覆盖共享文件。变更分支策略、产品方向和公开契约时说明影响，按已有授权处理；范围/语义未获授权则提交具体决定。规则迁移不授权提交、推送或发布。
4. BIGMODEL_API_KEY 的既有配置与用户保留用于 BYOK 联调的决定继续保留；不读取、打印、提交密钥内容。实际联调遵守用户授权和数据外发约束。
5. 文档中文，代码/注释/标识符英文，UI 文案中英双语走 i18n。
6. 测试先明确行为、预期与证据，按改动范围复用或复测。文档迁移检查引用、版本和状态一致性，不触发产品全套测试；现有 CI 检查继续保留。
7. 保留 M1 实证教训：视觉结论需查看真实渲染；交互检查验证数据/导出实际变化，不能止于弹窗或 Toast；相关图像测试覆盖大图、调色板 PNG 和极端宽高比；CI 问题按 job 隔离复现。用户的产品取舍与选稿不代替技术验收。

## 快速开始

环境要求（已定版锁死，不允许浮动）：

- Node.js **24.12.0**（根 `package.json` 的 `engines` + `.npmrc` 的 `engine-strict` 双重锁定，其他版本 `pnpm install` 直接报错）
- pnpm **11.9.0**（`packageManager` 字段已声明；推荐 `corepack enable` 让版本自动跟随）

```bash
corepack enable   # 已装 pnpm 11.9.0 的机器可跳过
pnpm install
```

Workspace 结构（`pnpm-workspace.yaml`）：

| 路径 | 包名 | 内容 |
|---|---|---|
| `packages/pipeline/` | `@spriteflow/pipeline` | 纯 TS 管线（检测/规范化/打包/导出），根入口无 DOM，`./browser` 子入口为 Worker 适配 |
| `apps/web/` | `@spriteflow/web` | React + Canvas2D 应用，构建产物即 Cloudflare Pages 静态站 |
| `tests/golden/` | `@spriteflow/golden` | 黄金回归（Node 直连纯 API；`reports/` 仅作 CI 产物，不入库） |

常用命令（根目录执行）：

| 命令 | 作用 |
|---|---|
| `pnpm lint` / `pnpm format` | Biome 全仓检查 / 自动修复（lint + format + import 排序） |
| `pnpm typecheck` `pnpm test:unit` `pnpm build` | 递归调用各包同名脚本（包脚本就绪前自动跳过） |
| `pnpm golden` | 黄金回归：`pnpm --filter @spriteflow/golden run golden` |
| `pnpm --filter @spriteflow/pipeline test` | 按完整 scoped 包名过滤执行；**不要**依赖 `-F pipeline` 模糊匹配 |

## 包内修改与依赖规则

- 包内 `src/`、包级 `tsconfig`、包 `package.json` 的 **scripts 字段**自由修改，不需协调；
- **依赖增删改、根 lockfile、根配置由 RC 指定单一集成人处理**：给出包名、精确版本与理由，禁止并行改写根 lockfile；
- 依赖必须使用精确版本（无 `^/~`），新依赖先过许可/peer 审计（`docs/architecture-m1.md` 第 8 节），M1 禁入清单见同节。

## CI 与部署

- CI：`.github/workflows/ci.yml`，五 job（lint / typecheck / unit / golden / build）并行，Node 24.12.0 + pnpm 11.9.0，全部绿才可合并 main；细节与演练记录见 `docs/devops.md`。
- 部署：Cloudflare Pages，push main → 生产，PR → 自动 preview；账号绑定由产品主执行，步骤见 `docs/devops.md` 第 5 节。
- 变更记录：`CHANGELOG.md`（合并 PR 必须登记，规范见文件头）；PR 描述模板已配置于 `.github/pull_request_template.md`。
- 工程门禁：`scripts/check-boundaries.mjs`（依赖边界）、`scripts/check-licenses.mjs`（许可闭包 vs 审计清单）、`scripts/check-bundle-budget.mjs`（首屏 <300 KiB gzip + THIRD_PARTY_NOTICES）。

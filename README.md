# SpriteFlow（工作代号）

「AI 生图 → 引擎就绪素材」纯前端 Web 管线工具，面向 2D 游戏开发者（vibe coder）。零服务器成本，全部计算在浏览器端。

## 文档地图（任何 agent 或人，开工前必读）

| 文档 | 内容 | 状态 |
|---|---|---|
| `docs/technical-design.md` | 技术方案（唯一事实来源） | ✅ 已定稿 |
| `docs/agent-roles.md` | 多 agent 角色提示词、模型分配、验收流程、文件所有权 | ✅ 已定稿 |
| `docs/prd-m1.md` | M1 产品需求文档 | ✅ 已通过验收（Gate 1） |
| `docs/architecture-m1.md` | 仓库结构与架构决策（CI 设计、依赖审计） | ✅ 已通过验收（Gate 1, r2） |
| `docs/interface-contract.md` | 管线 ↔ 前端接口契约（公共 API 唯一规范） | ✅ r2，并行双方以此开工 |
| `docs/ui-spec.md` | UI 设计规范 + HTML 稿 | ⬜ UI 设计师待产出（Wave 2） |
| `docs/devops.md` | 本地环境十分钟指南 + CI/部署说明 | ✅ DevOps 已交付（五 job CI + Cloudflare Pages） |

## 工作规则（对所有 agent 生效）

1. 工作目录必须是本仓库根目录 `D:\projects\new_project1`。
2. 严格遵守 `docs/agent-roles.md` 的**文件所有权表**——只写属于自己的文件，越界一律视为事故。
3. 分支策略：**直接提交 main**，不另开分支（文件所有权已保证并行角色互不冲突）；仅在出现文件所有权争议时临时开分支，由产品主裁决。
4. 密钥：`BIGMODEL_API_KEY` 已配置为用户级环境变量（新窗口自动可见），并备份于根目录 `.env`（已 gitignore）。**严禁把密钥写进任何会被提交的文件。**
5. 产出语言：文档中文，代码/注释/标识符英文，UI 文案中英双语走 i18n。

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

## 包负责人规则（R4 / R5 / R6）

- 包内 `src/`、包级 `tsconfig`、包 `package.json` 的 **scripts 字段**自由修改，不需协调；
- **依赖增删改、根 lockfile、根配置一律由 DevOps（R7）唯一维护**：把依赖需求（包名 + 精确版本 + 理由）提交给 R7，禁止并行改写根 lockfile；
- 依赖必须使用精确版本（无 `^/~`），新依赖先过许可/peer 审计（`docs/architecture-m1.md` 第 8 节），M1 禁入清单见同节。

## CI 与部署（DevOps / R7 维护）

- CI：`.github/workflows/ci.yml`，五 job（lint / typecheck / unit / golden / build）并行，Node 24.12.0 + pnpm 11.9.0，全部绿才可合并 main；细节与演练记录见 `docs/devops.md`。
- 部署：Cloudflare Pages，push main → 生产，PR → 自动 preview；账号绑定由产品主执行，步骤见 `docs/devops.md` 第 5 节。
- 变更记录：`CHANGELOG.md`（合并 PR 必须登记，规范见文件头）；PR 描述模板已配置于 `.github/pull_request_template.md`。
- 工程门禁：`scripts/check-boundaries.mjs`（依赖边界）、`scripts/check-licenses.mjs`（许可闭包 vs 审计清单）、`scripts/check-bundle-budget.mjs`（首屏 <300 KiB gzip + THIRD_PARTY_NOTICES）。

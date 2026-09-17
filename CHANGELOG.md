# Changelog

All notable changes to SpriteFlow are documented here.

## 规范（提交变更时必须遵守）

1. 格式遵循 [Keep a Changelog](https://keepachangelog.com/en/1.1.0/)；版本号遵循语义化版本（M1 期间为 `0.x.0` 里程碑）。
2. 每个合并到 main 的 PR **必须**在 `Unreleased` 段落加一条记录，格式：`- <摘要>（PR #<编号>，<角色>）`。
3. 分类固定使用以下七节，按顺序排列；不用的节删除：

   - `Added`：新功能
   - `Changed`：对既有行为的变更
   - `Deprecated`：即将移除的功能
   - `Removed`：已移除的功能
   - `Fixed`：缺陷修复
   - `Security`：安全相关修复
   - `Tooling`：CI / 构建 / 依赖 / 工具链变更（**依赖增删与 lockfile 变更必须记入本节**）

4. 禁止发布时把 `Unreleased` 原样改名了事：发布人需核对每条记录、补充发布日期与版本号，并将 `Unreleased` 重置为空段。
5. 依赖变更条目须写明：包名、精确版本、许可审计结论（引用 `docs/architecture-m1.md` 第 8 节的复审要求）。
6. golden 基线变更条目须写明：差异内容、原因、是否经产品主授权。

## [Unreleased]

- Root engineering infrastructure landed for Wave 3: five-job GitHub Actions CI (lint / typecheck / unit / golden / build, Node 24.12.0, pnpm 11.9.0), Cloudflare Pages config (production on main, preview per PR), PR template, license-closure + boundary + bundle-budget gates, devops guide. (DevOps / R7)
- Tooling: `.gitattributes` enforces LF checkouts (Windows clones no longer fail `pnpm lint`); `design/` mockups excluded from the Biome lint surface; `pnpm golden` now builds the pipeline first so it runs on a clean clone. (DevOps / R7)

## [0.1.0] - 2026-09-16

- Initial workspace skeleton: pnpm workspace, pinned toolchain (Node 24.12.0 / pnpm 11.9.0), Biome, shared tsconfig, package manifests. (DevOps / R7)
- `@spriteflow/pipeline` M1 core pipeline with contract r4 source-geometry verification. (R4)
- Golden regression workspace with 20-case suite, real-world wishlist and generator tooling. (R6)
- Docs: PRD, technical design, architecture, interface contract (r4), UI spec, copy deck, acceptance verdicts.

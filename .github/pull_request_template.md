<!-- PR 标题建议格式：<type>(<scope>): <一句话改动>，与 CHANGELOG 规范一致 -->

## 改了什么

<!-- 动机 + 改动范围。改了多个角色名下的文件时逐个列出并说明依据。 -->

## 自测清单（本地全部执行过再发 PR）

- [ ] `pnpm lint`（Biome + 包依赖边界 + docs 契约代码块）
- [ ] `pnpm typecheck`
- [ ] `pnpm test:unit`
- [ ] `pnpm golden`（golden 基线变更需在下方说明差异与原因）
- [ ] `pnpm build`（含许可闭包校验与首屏 <300 KiB gzip 预算）

## 是否触碰契约（docs/interface-contract.md）

- [ ] 未触碰
- [ ] 触碰 —— 必须附依据（架构师 Gate 决议或产品主明确委托；禁止单方临时加字段）

## 文件所有权确认

- [ ] 只修改了本人名下的文件（见 docs/agent-roles.md 所有权表）
- [ ] 根配置 / pnpm-lock.yaml / 依赖增删的改动已交由 DevOps（R7）执行或确认

## 补充说明（可选）

<!-- golden 基线差异、体积预算变化、部署影响等。 -->

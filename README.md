# SpriteFlow（工作代号）

「AI 生图 → 引擎就绪素材」纯前端 Web 管线工具，面向 2D 游戏开发者（vibe coder）。零服务器成本，全部计算在浏览器端。

## 文档地图（任何 agent 或人，开工前必读）

| 文档 | 内容 | 状态 |
|---|---|---|
| `docs/technical-design.md` | 技术方案（唯一事实来源） | ✅ 已定稿 |
| `docs/agent-roles.md` | 多 agent 角色提示词、模型分配、验收流程、文件所有权 | ✅ 已定稿 |
| `docs/prd-m1.md` | M1 产品需求文档 | ⬜ PM 待产出（Wave 1） |
| `docs/architecture-m1.md` | 仓库结构与架构决策 | ⬜ 架构师待产出（Wave 1） |
| `docs/interface-contract.md` | 管线 ↔ 前端接口契约 | ⬜ 架构师待产出（Wave 1） |
| `docs/ui-spec.md` | UI 设计规范 + HTML 稿 | ⬜ UI 设计师待产出（Wave 2） |

## 工作规则（对所有 agent 生效）

1. 工作目录必须是本仓库根目录 `D:\projects\new_project1`。
2. 严格遵守 `docs/agent-roles.md` 的**文件所有权表**——只写属于自己的文件，越界一律视为事故。
3. 分支策略：**直接提交 main**，不另开分支（文件所有权已保证并行角色互不冲突）；仅在出现文件所有权争议时临时开分支，由产品主裁决。
4. 密钥：`BIGMODEL_API_KEY` 已配置为用户级环境变量（新窗口自动可见），并备份于根目录 `.env`（已 gitignore）。**严禁把密钥写进任何会被提交的文件。**
5. 产出语言：文档中文，代码/注释/标识符英文，UI 文案中英双语走 i18n。

## 快速开始

（M1 项目脚手架建立后由架构师/前端工程师补充）

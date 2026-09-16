# SpriteFlow M1 Playwright 冒烟计划

本阶段只交付计划与数据夹具，不安装 Playwright，也不复制管线算法。自动化接入时由
DevOps 审核精确版本与 lockfile；测试通过公开 UI 和下载产物观察系统。

## 目标链路

覆盖 `上传本地图片 → 预检 → 检测/降级 → 审校确认 → 导出 → 内存中解包 → 校验契约`
的最短闭环。默认使用合成黄金样例，另用 CC0 真实图做非门禁抽检。

## 建议目录与职责

```text
tests/e2e/
  PLAYWRIGHT-PLAN.md
  INTEGRATION-CHECKLIST.md
  fixtures/
    smoke-cases.json
    export-contracts.json
  # Wave 3 再新增：playwright.config.ts、specs/*.spec.ts、helpers/*.ts
```

测试不得从 `apps/web` 内部 store 注入状态，也不得调用 pipeline 跳过 UI。允许在浏览器侧
监听 download、拦截网络、读取 ZIP 字节和解析 JSON。

## 固定冒烟矩阵

1. `01-grid-2x2`：拖放上传，断言 `grid`、4 帧、顺序；确认后分别导出 Phaser Hash 与
   Array。
2. `07-scatter-5`：文件选择器上传，断言 `components`、5 帧；导出 Godot。
3. `13-grid-multicomponent`：断言 6 个候选仍保留，显示“可能粘连”筛选；确认后可导出。
4. `16-size-outlier`：断言只有标注帧显示“尺寸异常”，筛选不改变时间轴或导出数据。
5. `18-single-frame-degrade`：断言低置信度文案、手动网格入口和可继续编辑。
6. `20-empty-transparent`：断言 `EMPTY_INPUT` 降级、1 个空待确认帧，不显示上传错误。

## 测试步骤

每个自动检测病例：

1. 进入静态站，等待 Worker ready；记录静态资源请求基线。
2. 用 `setInputFiles` 或 `DataTransfer` 上传 fixture；两种入口至少各覆盖一次。
3. 等待真实检测进度结束，断言文件名、尺寸、策略、帧数和角标。
4. 对自动病例执行确认审校；对降级病例先应用夹具指定手动网格，再确认。
5. 打开导出面板，选择格式；用 `page.waitForEvent("download")` 捕获 ZIP。
6. 在 Node 测试侧用已审计的 `fflate` 解压内存字节，不写用户下载目录。
7. 按 `fixtures/export-contracts.json` 校验文件集合、JSON schema、引用和 PNG 数量。
8. 检查本次新增网络请求：只能是同源静态资源，任何含输入/帧/导出字节的请求立即失败。
9. 切换中英语言后重复关键断言，确认文档状态和帧数不丢失。

## Phaser ZIP 断言

- Hash 与 Array ZIP 均恰含 `atlas.png`、`atlas.json`、`animations.json`。
- atlas JSON 可解析，格式形状与所选入口一致；帧数量、稳定名称、顺序与审校结果一致。
- 每个物理 atlas rect 在 PNG 边界内；旋转帧按契约换算边界。
- `sourceSize`、`spriteSourceSize`、`trimmed` 与规范化预览一致。
- animations 中只引用存在的帧名，默认顺序不被 pack 改变。

## Godot ZIP 断言

- 存在 `frames/`、`sequence.json`、`build_spriteframes.gd`、`README.txt`，不存在 `.tres`。
- `frames/*.png` 数量与 included 帧数严格一致，文件名与 `sequence.json` 一一对应。
- 每张 PNG 尺寸等于统一逻辑画布；空帧仍存在且保持顺序。
- 脚本中引用的相对路径与动画名均能在 ZIP 内解析。
- 自动化结构校验通过后，发布候选再按集成清单用 Godot 4.4.x 人工执行脚本。

## 故障与恢复用例

- 非 M1 格式、完全不透明 PNG、损坏 PNG：停在预检且允许重新选择。
- 人为终止 Worker：显示可恢复错误，保留原 File/可用草稿并能重建。
- 导出失败注入：保留审校结果与设置，可重试，不要求重新上传。
- 超过 8192 边界和内存预算：显示原尺寸/限制及降采样或取消动作。
- 所有失败截图、trace、console 和 ZIP 摘要作为 CI artifact；不得提交用户素材。

## 稳定性规则

- 只等待可访问名称、状态或下载事件，不用固定 sleep。
- 每个测试创建新 browser context，语言和下载目录不跨例污染。
- fixture 路径由仓库根解析，禁止依赖启动命令的当前目录。
- 检测结果取自 `ground-truth.json`，导出结构取自 `export-contracts.json`；测试代码不再
  维护第三份帧数真相。
- CI 重试最多 1 次并保留首次失败；算法断言失败不可用重试掩盖。

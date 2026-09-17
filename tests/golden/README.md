# SpriteFlow M1 黄金测试集

本目录是检测管线的可执行规格。`cases/` 中恰有 20 个程序化合成病例；每例包含
`input.png`、`ground-truth.json` 与 `source.json`。真实素材放在 `real/`，用于人工与端到端
抽检，不参与 20 例确定性门禁。

## 快速开始

```powershell
# 重建全部合成图片与标注
pnpm --filter @spriteflow/golden run generate

# 管线尚未实现时，只校验数量、schema、PNG 哈希、bbox 与 flags 标注自洽性
pnpm --filter @spriteflow/golden run golden:fixtures

# 管线构建完成后，运行完整回归；仓库根目录可直接执行 pnpm golden
pnpm golden
```

完整回归会动态加载 `@spriteflow/pipeline`。若包尚未生成可导入的 `dist`，命令以退出码 2
明确失败，不把“未执行管线”伪装成通过。JSON 报告写到
`tests/golden/reports/golden-report.json`，该目录已被 gitignore。

单例排障：

```powershell
pnpm --filter @spriteflow/golden run golden -- --case 16-size-outlier
```

## 20 例覆盖

- 01～04：A 类透明底规整网格，含 2×2、3×2、4×3 和轮廓轻微变化。
- 05～06：D 类单行动画条带，含内容位置不齐。
- 07～08：C 类透明散排与间距不齐。
- 09～10：E 类断件；帽子/武器须经膨胀或近邻合并成为单帧。
- 11～12：低于有效面积阈值的单像素与小簇噪点。
- 13～14：网格 cell 内多连通域，必须保留整格并标记 `multipleComponents`。
- 15：重复视觉帧；dHash 必须一致，但 M1 不折叠且 `duplicateOf=null`。
- 16：尺寸突变，异常帧必须标记 `outlier`。
- 17：E 类叙事型不规则透明排布。
- 18～20：单主体不足、嵌套 bbox 近邻合并后不足、全透明输入的显式降级。
  第 19 例原“尺寸簇歧义”标注不符合默认近邻合并规则，已按产品主授权修正；
  真正的尺寸簇歧义分支由管线单测独立覆盖。详见 `R3-CORRECTIONS.md`。

技术方案 3.1 的 A/C/D/E 类均有覆盖。B 类“不透明底网格表”需要先去底，而 PRD 明确 M1
不实现去底并拒绝不透明输入，因此不进入可运行的 M1 黄金 20 例；它保留在 `real/` 和
`REAL-WORLD-WISHLIST.md`，用于 M2 预研，不能反向扩大 M1 范围。

## ground truth 约定

`ground-truth.json` 的核心字段如下：

- `schemaVersion`：固定 `spriteflow-golden/1`。
- `input`：尺寸、MIME、文件名与 SHA-256，防止图片和标注错配。
- `run.detectOptions`：`null` 表示契约默认值；非空时是对
  `DEFAULT_DETECT_OPTIONS` 的深层覆盖。
- `expected.frameCount`：最终返回的帧数。降级例断言建议手动网格实际生成的帧，而不是
  被拒绝的自动候选。
- `expected.strategy`：严格为 `grid`、`components` 或 `manual-grid`。
- `expected.layout`：网格/条带记录明确的 `rows` 与 `columns`；非网格为 `null`。
- `expected.degraded`：非降级为 `null`；降级时精确断言 `reason` 与 `attempted`。
- `expected.frames`：契约顺序中的 `sourceRect`、紧内容 `bbox` 与完整 `FrameFlags`。
- `expected.warningCodes`：按契约枚举顺序精确匹配。
- `expected.hashEqualityGroups`：只断言组内 dHash 相同，不要求跨实现硬编码哈希值。

矩形均为整数半开区间。`bbox=null` 只用于空帧。自动结果按契约顺序匹配，不做“找一个
最像的框”式宽松配对，以免错误顺序逃过回归。

## 回归断言

完整 runner 对每例执行以下硬断言：

1. 帧数精确相等。
2. 每个非空帧按契约顺序计算 bbox IoU，必须严格大于 0.9；空帧必须保持 `bbox=null`。
3. 策略精确相等；降级原因和已尝试策略精确相等。
4. 六个 flags 整体深比较：`outlier`、`merged`、`multipleComponents`、`empty`、
   `edited`、`duplicateOf`。
5. warning code 顺序及集合精确相等。
6. 自动帧必须 `included=true`、`reviewStatus=pending`，origin 与期望一致。
7. 重复病例只验证 dHash 元数据一致，绝不要求 M1 自动删除或折叠。

夹具预检还会重新解码 PNG，从像素独立计算每个标注框的紧 bbox 和 8 连通域数，避免
“生成脚本和 JSON 一起写错”后仍显示通过。

## 如何新增坏例

M1 配额固定为 20；新增回流例时先由产品主决定是替换现有薄弱例，还是提升后续里程碑
配额。流程如下：

1. 为病例分配稳定 kebab-case ID，不复用旧 ID。
2. 可程序化复现的病例写入 `tools/generate.mjs`；真实坏例先去除隐私信息，放入 `real/`，
   并补来源、作者、授权或用户明确许可凭据。
3. 根据肉眼确认的真实前景填写 ground truth，不从当前管线输出反抄答案。
4. 运行 `pnpm --filter @spriteflow/golden run generate` 两次，确认文件 SHA-256 不变。
5. 运行 `golden:fixtures`，再由另一人复核 bbox、策略、降级与 flags。
6. 管线回归失败时保留样例并建立 `tests/golden/bugs/SF-BUG-xxx.md`，记录版本、命令、
   期望、实际结果与最小复现；禁止在 QA 目录修改管线实现。

## 确定性边界

合成集只使用 `pngjs` 与整数像素绘制，没有系统字体、浏览器 Canvas、时间、随机数或网络
依赖。PNG 编码参数固定，透明像素 RGBA 全为 0。CogView 输出本身不具备字节级确定性，
所以 `tools/gen-real.mjs` 固定的是模型、prompt、尺寸和病例 ID，并把每次响应元数据、哈希
落盘；其结果仅供真实世界抽检，不冒充可重现的合成门禁。

## 真实素材

逐文件证据见 `real/sources.json`。当前纳入：

- Kenney “1-Bit Platformer Pack” 的透明 packed tilemap，CC0。
- OpenGameArt “8x8 Character and Sprite Sheet”，作者 Glacialan，CC0。
- OpenGameArt “Spritesheet of a man CC0” v14，作者 Vander96，站点标注 CC0；该文件完全
  不透明，属于 M2 去底预研，不进入 M1 自动检测门禁。

真实素材不得只有“网上找到”这一条说明。来源页、直接下载 URL、作者、许可证、下载日期、
SHA-256、尺寸和 alpha 统计缺一不可；来源许可不清晰的文件不得提交。

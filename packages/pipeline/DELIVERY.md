# R4 管线交付记录

日期：2026-09-17。生效基线：[interface-contract.md](../../docs/interface-contract.md) 3.0.0 / r4，协议版本1。交付范围为 `packages/pipeline`；本轮没有修改契约、apps/web、根配置、锁文件或黄金集，没有新增第三方依赖。

## 实现结果

根入口提供全部契约类型、常量和纯 API；输入像素校验/降采样、投影网格、两遍8连通域与并查集、精确膨胀/近邻合并、面积过滤/聚类、策略决策及降级、trim/dHash/flags/统一画布、MaxRects、五种导出与流式 ZIP 已实现。浏览器子入口提供原生编解码、单任务 Worker 缓存、Comlink transfer、取消/进度/崩溃清理。

r3 的 EMPTY_INPUT 特例、显式手动网格优先级和稀疏 alpha 防误报继续由54项参数化回归锁定。r4 在实现之前新增回归，最初39项中17项失败，修复后全绿；补充原Frame.bbox变更后的快照独立性后，r4文件共40项回归。

## r4 条款与回归对应

- §5，第341–381行：公共 PackedFrame 新增必填 sourceRect/bbox；pack 逐帧创建独立 Rect，不共享输入引用，保留空帧源框。旋转/出血不改变源几何。
- §6.0，第471–483行：导出先做输入/资源/审校校验，再按“缺字段 → 新字段合法性 → 源几何及原布局一致性”验证。STALE_RESULT 在 validate 阶段返回、recoverable=true、recoveryActions=[retry]，逐帧详情使用 source.pack.frames 的字段路径与 frameIds；旧 DTO 不回填。
- §9.2，第874行；§14.3，第1103行：Worker 响应包含快照，旧 normalizationId/packId 即使几何相同仍失效，ready 精确验证3.0.0，2.0.0 Worker 被阻断。协议仍为1。
- §14.3，第1096–1101行：003红/绿主体原例、alphaThreshold单独改变bbox、单独改变sourceRect、空帧移动与空/非空转换、trim=false、非零offset、旋转/出血、多页、缺字段/undefined/null/非法Rect/越界/未知字段、structuredClone/JSON/新模块实例、属性插入顺序、重复值复用、双向快照独立性均覆盖。
- §14.3，第1102–1103行：保留资产revision、ID/数量/顺序/name、canvas、empty、布局/旋转、excluded和NO_FRAMES/REVIEW_REQUIRED优先级检查。Phaser hash/array、generic校验源几何；PNG/Godot序列继续pack=null。真实PNG恢复与下载JSON断言证明不泄漏sourceRect/bbox、文件schema不变。

`tools/repro-stale-result.mjs` 已删除“两个公开pack深相等”旧断言，当前独立命令成功：公开pack不同，当前pack解码像素为绿色，旧pack返回STALE_RESULT，旧路径codec调用次数为0。

## 最终验证

以下在本机执行通过：

- `pnpm -F pipeline build`：根入口及browser声明/ESM构建。
- `pnpm -F pipeline typecheck`：核心、browser和全部测试严格类型检查。
- `pnpm -F pipeline check:contract`：公开导出名精确匹配、API类型双向赋值、根入口ES2022无DOM、契约完整调用示例及README示例编译。
- `pnpm -F pipeline test`：9个文件，**144/144**；含r3的54项、r4的40项、真实PNG往返、Comlink MessageChannel与2000ms取消截止回归。
- `pnpm -F pipeline test:stale`：003独立回归成功。
- `pnpm golden`：**20/20**，帧数、bbox IoU>0.9、策略/降级、flags/hash分组按R6 runner执行。
- `pnpm -F pipeline test:browser`：**Chrome 153.0.8010.48 / Windows 11**，真实模块Worker、PNG/WebP解码、原生PNG编码、输入/输出transfer、五种ZIP、r3空帧切手动、r4响应快照通过。机器报告在忽略目录 `.smoke-output/browser-report.json`。
- `pnpm -F pipeline bench`：预热5轮、测量30轮；4096×4096连通域 **p95=237.80ms <500ms**；500帧完整打包 **p95=48.48ms <200ms**。设备、夹具hash、参数、排除项及全部原始值见[BENCH.md](./BENCH.md)。未放宽预算。
- `pnpm exec biome check packages/pipeline`：通过，无错误或警告。循环边界已验证的类型数组访问及确定性测试夹具对 noNonNullAssertion 使用文件内单项说明，不改变根规则或算法行为。
- `git diff --check`：通过。

测试覆盖每个算法模块；没有安装未经审计的coverage插件，也没有声明行/分支覆盖率100%。基准限定本机与所列代表输入，不将其当作全部噪声分布的最坏耗时证明。

## 黄金集所有权与 Gate 3 交接

本轮r4只改变pack/export DTO，黄金20例仅消费检测结果，因此不需要改动黄金断言，也没有申请或使用新的目录例外权限。

此前产品主授权的r3 ground-truth修正独立提交为 **6172e32**，提交说明为“产品主授权的 ground-truth 修正（对应契约 r3）”。全部差异、契约§4.2/§13.2/§13.3行号、独立核验和两次generate确定性证据见[R3-CORRECTIONS.md](../../tests/golden/R3-CORRECTIONS.md)。降级三例核对结果：

- 18：原1帧，修正为2列×1行、2帧，N=1使用非EMPTY_INPUT通用公式。
- 19：原4帧/尺寸歧义；原始3组件经默认近邻合并成为1候选，N=1，修正为1×1、1帧/候选不足。
- 20：EMPTY_INPUT特例，保持1×1、1帧不变。

**R6仍拥有tests/golden，须在Gate 3复核6172e32及对应报告，不能将产品主例外授权视为所有权转移。** R5须同步旧持久化PackResult/手写fixture到r4；旧pack重新normalize/pack，不按当前Frame补字段。

Phaser3.90.0/Godot4.4.x引擎内导入与运行、Firefox/WebKit及架构参考设备复测尚属Gate 3验收任务。本次Node像素/JSON回归和Chrome Worker冒烟不代替这些结果；没有安装引擎或修改其他角色文件。

# Gate 3：用例 18/19 修正复核意见

复核日期：2026-09-22

复核对象：提交 `6172e326993032c77b05ed33268ea54917c280ff`、`R3-CORRECTIONS.md`、当前契约 `3.0.0/r4`

结论：**通过，无异议。** r4 对降级返回帧和建议网格的约束延续了本次修正所依据的公式；打包协议变化不影响检测 ground truth。

## 独立复核方法

- 直接用 `pngjs` 解码两张输入图，按 `alpha > 8` 建立 mask，以 8 邻域统计原始连通域。
- 按短边 1% 的默认半径做方形 Chebyshev 膨胀；以原始 mask 回填各膨胀分组的面积与紧框。
- 依契约用严格条件 `bbox gap < mergeDistance` 做并查集合并，再按有效候选数计算非空降级建议网格。
- 最后逐格扫描原始 mask 求 bbox；未运行管线，也未读取管线输出作为答案。

## 18-single-frame-degrade：通过

独立测量得到一个有效候选，原始紧框为 `[22,13,51,54]`，所以 `N=1`。非全透明输入不走 `EMPTY_INPUT` 特例：

`columns = ceil(sqrt(N × W/H)) = ceil(sqrt(1 × 96/80)) = ceil(sqrt(1.2)) = 2`

`rows = ceil(N/columns) = ceil(1/2) = 1`

切点为 `x=48`。左右 cell 与主体相交后的紧框分别为 `[22,13,26,54]`、`[48,13,25,54]`，和现标注完全一致。两个 cell 内各只有一个有效原始连通域，因此 `multipleComponents=false`；降级原因仍为 `INSUFFICIENT_COMPONENTS`，`attempted=[grid,components]`。帧数、布局、bbox、flags、warning 均通过。

## 19-ambiguous-degrade：通过

独立测量得到三个原始组件：

- 外环 `[6,6,116,116]`
- 内主体 `[27,29,17,19]`
- 内条块 `[68,72,34,11]`

默认膨胀半径为 `round(128 × 1%) = 1`，膨胀后三组仍分离。短边为 `116、17、11`，中位数 `17`，所以 `mergeDistance = round(17 × 0.15) = 3`。两个内部 bbox 均被外环 bbox 包含，bbox gap 为 `0`，满足严格条件 `0 < 3`，并查集最终合为一个候选；原始总面积为 `3326`，高于有效面积阈值 `4`。

因此 `N=1`，方形图按通用公式得到 `columns=1、rows=1`；降级原因应是 `INSUFFICIENT_COMPONENTS`，不是 `AMBIGUOUS_COMPONENTS`。返回的是建议手动网格生成的整图 frame，所以 `sourceRect=[0,0,128,128]`、bbox 为 `[6,6,116,116]`、`merged=false`。该整图 sourceRect 内仍有三个原始组件，所以 `multipleComponents=true`。现标注及两个 warning 均正确。

## 复核边界

本意见只确认 18/19 的像素几何、降级公式和标注一致性。r4 的打包快照/归档字段变化不参与这两例检测断言；r4 参数化的宽高比和显式手动网格变体也不应占用这两个黄金用例。

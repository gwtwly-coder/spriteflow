# 管线实现交付说明：等待契约修订

日期：2026-09-16。核对版本：`docs/interface-contract.md`，目标版本 1.0.0、文档修订 r2。

本次在实现前发现下述契约冲突，按任务要求“发现契约缺口或错误→停下，在交付说明中列出，等架构师修订”暂停编码。本文是 R4 的变更申请，不修改契约，也不替代 R9 的验收裁决。

## SF-CONTRACT-001：全透明宽图的建议网格帧数冲突

位置：`docs/interface-contract.md:304`，第 4.2 节。

同一段要求：

- 无有效候选时 N=1；columns=`ceil(sqrt(N*W/H))`，rows=`ceil(N/columns)`，随后限制行列范围；立即返回该建议网格实际生成的 frames。
- “全透明图因此返回 1 个 empty 的待确认帧”。

复现：200×100 的全透明 RGBA，默认 auto/final，maxFrames=500。所有参数均合法，无前景、无候选，N=1。

公式计算 columns=ceil(sqrt(2))=2、rows=ceil(1/2)=1；限幅不改变结果。因此建议网格实际生成 2 帧，与必须返回 1 帧冲突。已用本地 Node 独立计算复核；这不是管线运行结果，目前尚未实现管线。

影响：无法同时为建议网格、frames.length 与 EMPTY_INPUT 黄金样例写出满足全部条款的测试。

建议架构师明确：EMPTY_INPUT 独立于通用建议网格公式，固定 `{rows:1, columns:1, region:null, keepEmptyCells:true}`，返回整张工作图的一个空帧；其他降级仍使用通用公式。这是修订建议，尚未作为实现规则采用。

修订后的必要回归：全透明正方形、横图、竖图、极端长宽比；逐项断言 suggestedGrid、frames.length、sourceRect、empty、pending、confidence、reason 和 attempted。

## SF-CONTRACT-002：全透明输入与显式手动网格的优先级冲突

位置：`docs/interface-contract.md:300`、`:304`、`:306`、`:652`。

- 第 4.2 节规定 manual-grid 完全按给定网格切，confidence=1、degraded=null。
- 同节又规定 EMPTY_INPUT 在 alpha 检查后直接触发、attempted=[]，全透明返回一个待确认空帧。
- 第 8 节没有排除手动模式，规定“全透明走降级”。

复现：200×100 的全透明 RGBA，mode=manual-grid，manualGrid=`{rows:2, columns:3, region:null, keepEmptyCells:true}`，其余参数默认。

按显式手动规则，应返回 6 帧、confidence=1、degraded=null；按全透明提前降级规则，应返回 EMPTY_INPUT、confidence=0，并使用建议网格。两者的帧数、网格、置信度、warnings 和 degraded 均不同。

请架构师明确优先级并同步两处文字。建议自动模式对 EMPTY_INPUT 提前降级；合法的显式 manual-grid 尊重用户配置、保留指定空格。若产品要求所有模式的全透明输入均提前降级，则应给 manual-grid 的无降级规则增加明确例外。R4 不自行选择。

修订后的必要回归：同一全透明资产分别使用 auto/grid/components/manual-grid，且手动模式覆盖 keepEmptyCells=true/false，验证优先级和空格保留规则。

## 当前交付状态与恢复条件

- 实际目录为 `D:\projects\new_project1`；架构第 1 节已明确提示词中的另一路径不存在，不创建第二份仓库。
- `packages/pipeline` 当前只有 package.json；本次只新增本说明，未开始算法、browser 适配器或单元测试实现。
- `tests/golden` 当前只有 package.json，尚无 README、样例或 runner。后续需对接 R6 的黄金集；当前不能宣称黄金回归通过。
- 未修改 docs/interface-contract.md、apps/web、根配置或锁文件；未引入依赖。
- 未运行管线单测、黄金回归或性能基准，也不宣称完成任何实现验收。

恢复条件：架构师在契约中修订以上两项并同步新文档版本。随后按测试先行实现各模块，以契约确定的空输入行为编写回归断言。

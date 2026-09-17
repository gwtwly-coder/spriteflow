# 管线契约问题与实现状态

## 2026-09-17 当前状态：001/002/003 均已按生效契约解决

产品主已批准3.0.0/r4，SF-CONTRACT-003采用公开源几何快照方案。R4实现PackedFrame必填sourceRect/bbox独立复制、跨克隆逐字段校验、缺失字段STALE_RESULT、非法字段INVALID_ARGUMENT、Worker快照响应与精确版本门禁。实现条款见契约§5（341–381行）、§6.0（471–483行）、§9.2（874行）、§14.3（1088–1103行）。

`tools/repro-stale-result.mjs` 已转为正向回归：删除“两次pack深相等”的旧断言，验证快照不同、fresh路径绿色像素、旧pack被拒绝且codec调用为零。当前测试覆盖两种几何独立变化、空帧、克隆/JSON/新模块实例、快照双向独立性、原有布局及审校优先级、Worker失效ID及版本不兼容。最终验证、性能与Gate 3交接见[DELIVERY.md](./DELIVERY.md)。

本轮没有发现仍需架构师裁定的契约缺口，没有修改契约、apps/web或tests/golden。以下为当时的申请与暂停记录，不代表当前仍阻塞；旧脚本行为与旧测试数量仅属于历史快照。

## 2026-09-17 历史申请：001/002 已解决，003 当时待裁定

产品主已批准契约 2.0.0/r3，001/002 按 §13.2 生效决议恢复实现。§13.3 的54项参数化回归现已通过。以下保留原申请历史，不再以001/002阻塞。

### SF-CONTRACT-003：纯导出 API 无法验证原始 bbox 是否属于该 PackResult

契约位置：第6节“图集格式要求 source.pack 非 null，且与 source.frames 的资产、顺序、name、canvas、bbox 完全一致；pure API 逐项验证几何一致性；任何 mismatch 返回 STALE_RESULT”；第5节 PackedFrame/PackResult 类型；第7节纯函数 API 与“函数不依赖 this，不缓存调用者数组”；第9节“小对象 structured clone”。

合法复现：同一200×100资产中有两个8×8主体，位置分别为(10,10)和(110,10)。先对同一帧ID/name审校规范化左侧50×50框并pack；随后移动草稿至右侧50×50框、edited=true，重新normalize并接受审校，资产像素和revision不变。两次bbox分别为 `{x:10,y:10,width:8,height:8}` 与 `{x:110,y:10,width:8,height:8}`。

两次pack结果的所有契约字段完全相同：同一AssetRef、frameId/name、frameOrder、页面、allocation/rect、rotated、sourceSize、spriteSourceSize、empty、options和warnings。PackedFrame没有源bbox/sourceRect；PackResult没有normalizationId或包含源位置的签名。不同原始bbox无法从这些字段还原。

因此，对相同新frames，传入旧pack或新pack的序列化数据逐字段相同，但契约要求前者STALE_RESULT、后者成功。纯API在接收structured clone后的DTO时无法区分。依赖JS对象身份或模块级私有缓存不能解决跨克隆/跨实例调用，也不能作为未经契约声明的新输入限制。Worker已有normalizationId/packId可以拒绝旧缓存，但它不能替代根入口exportAssets的此项要求。

复现脚本：`pnpm -F pipeline build` 后运行 `node packages/pipeline/tools/repro-stale-result.mjs`。脚本仅调用公共API，并使用黄金集已审计pngjs编码器；验证两个PackResult深相等、两个源bbox不同，并对旧pack应返回STALE_RESULT做失败断言。当前应明确退出1，不能将它描述为通过。

请架构师二选一并经产品主确认后同步：

- 在公开打包结果中增加可校验的源几何/规范化版本信息，使pure API可比较原始bbox；同时同步类型、版本、Worker及测试。
- 明确pure API只验证PackResult现有字段所能表达的布局一致性；源位置变化的历史过期拒绝由Worker结果ID承担。此方案需要修订当前“bbox完全一致”的纯API承诺，R4无权自行解释为例外。

本次没有选择任一方案、没有修改接口契约、没有增加未声明的公开字段。按用户“发现契约缺口或错误即停下”要求停止实现，等待修订。

### 已完成与未完成边界

- 已实现根入口类型、校验/归一化、双策略检测、规范化/hash、打包、五种导出、browser Worker/client及对应测试；仍为待完成验收的工作区代码，不能宣称已完全满足契约。
- 已通过黄金20/20；经产品主例外授权修正的标注已单独提交为 `6172e32`，详见 `tests/golden/R3-CORRECTIONS.md`。R6保留目录所有权并须在Gate 3复核。
- 4K连通域代表输入预热5轮、测量30轮，p95=376.83ms；硬件、原始测量、范围见BENCH.md。
- Chrome真实模块Worker/原生PNG编解码/Comlink transfer/五种ZIP导出已冒烟通过；WebP能力探测的假阴性已修复。真实Phaser/Godot运行时、Firefox/WebKit尚未验收。
- 完整README、最后一轮全量检查、管线完成提交尚未交付；不把003失败复现隐藏成通过。下面的旧“当前交付状态”仅属于2026-09-16历史。

---

## 2026-09-16 历史申请（001/002）

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

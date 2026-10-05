# 高质量拆件 GPU 推理成本核算（2026-10-02）

> 背景：路线 C 的高质量档需要 see-through 级扩散推理（layerdiff 8.1GB UNet + marigold 深度，30 步去噪）。本机 RTX 4060 Laptop 8GB（显存不足走 group_offload）实测 **78 分钟/张**。本文核算云端 GPU 的真实成本。**商业模式已由产品主定调：算力用户自付，平台不经手（或仅过手抽成）。**

## GPU 租用市价（2026-10 查证）

| 平台/卡 | 价格 | 来源 |
|---|---|---|
| 智星云 RTX 4090 24G | ¥1.31–1.50/时 | 智星云官网（经 CSDN 报道） |
| AutoDL RTX 4090 24G | 包月折后 ≈¥1.61/时（阿里/腾讯 ¥1.8+） | AutoDL |
| 智星云 A100 | ≈¥2.4/时 | 同上 |
| 恒源云 4090 | ¥1.32/时 起 | 恒源云 |
| RunPod A100 80G（海外） | **$1.19/时**（on-demand，spot 更低） | [DeployBase GPU 比价 2026](https://deploybase.ai) |
| Modal serverless A100 80G | $2.50/时等价（**按秒计费**，零闲置成本） | [Modal 定价](https://modal.com) |

## 每张图成本推算

耗时外推（4060 笔记本+offload 78 分钟为基准；24G 卡免 offload、A100 再快 2~3 倍）：

| 执行环境 | 预估耗时/张 | GPU 成本/张 |
|---|---|---|
| 本机 4060 Laptop（已实测） | 78 分钟 | ¥0（用户自己的电费） |
| 云 4090 24G | ~8–15 分钟 | **≈¥0.20–0.40** |
| 云 A100 80G | ~3–6 分钟 | **≈¥0.15–0.60**（国内 A100 最便宜） |
| Modal 按秒 serverless | ~3–6 分钟 | **≈$0.15–0.30（¥1.1–2.2）**，但零闲置 |

## 结论

1. **B 路线（API 高质量档）成本成立**：每张 GPU 直接成本 **¥0.2~2** 量级。若向用户收 ¥2~4/张或积分制，有健康毛利；按秒 serverless（Modal/RunPod serverless）与"用户按次付费"天然匹配——无人拆图时我们零支出。
2. **隐私让步必须明示**：高质量档图片需上送推理平台（与 L1 BYOK 同级的知情同意 UI）。
3. **工程量**：把 see-through 打包成 serverless 服务（容器化+按秒冷启动优化）是以天计的工作，且模型 9.5GB 的冷启动拉镜像时间需要实测（TTL 保活 vs 按秒计费之间的权衡）。
4. **验证期用本地**：质量验证阶段继续用本机（免费已跑通）；API 化在"质量终态获产品主确认"之后投入。

来源：[智星云价格报道（CSDN）](https://openeuler.csdn.net)、[DeployBase GPU Cloud Pricing Comparison 2026](https://deploybase.ai)、[IntuitionLabs 云 GPU 分析](https://intuitionlabs.ai)、[RunPod 官方定价](https://docs.runpod.io)、[Modal 定价](https://modal.com)（2026-10-02 查证；实际价格随供需波动，落地前复核）。

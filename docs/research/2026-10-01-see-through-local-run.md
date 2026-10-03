# see-through 本地推理实测（2026-10-01 通宵，RC 自动执行）

> 对象：`tests/golden/characters/05-tall-elf-woman.png`；机器：RTX 4060 Laptop 8GB。
> 产出已交产品主：`D:\桌面\see-through-result\`（24 层 PSD + 独立层 PNG + 重建图 + 三方对比 `D:\桌面\see-through-vs-sam.jpg`）。

## 运行事实

- 引擎：[See-through](https://github.com/shitagaki-lab/see-through)（SIGGRAPH 2026，单图动漫角色分层分解，layerdiff 扩散 + marigold 深度 + 层提取）
- 参数：`--resolution 1024 --group_offload --save_to_psd`；总耗时 **78 分钟**（layerdiff 15min + 深度 55min + 提取 8min）
- 环境：`D:\projects\tools\see-through\.venv`（7.9GB）；模型 22.5GB 全部在 `D:\projects\tools\see-through\hf-cache\`（**C 盘零占用**，经 hf-mirror 补齐 marigold）
- 复跑：`run-inference.bat <图片>`（脚本内置缓存路径）

## 结果与对比（客观测量）

| 维度 | see-through | 当前 SAM 管线 |
|---|---|---|
| 语义完整性 | **24 层 Live2D 语义**（前后发/五官/虹膜/上下衣/袜/鞋/手套/饰品），每层完整连贯（后发 122k px、下衣 185k px） | 23 个解剖学部位命名正确，但蒙版按框碎裂（torso 仅腰带 4.3k px） |
| 像素保真 | **扩散重绘**——神似而非逐字节（前景覆盖 92.6%，边缘有重绘感） | **逐字节一致**（产品核心承诺，PIL 独立验证 0 失配） |
| 遮挡补全 | 有（被挡区域按上下文补全，v3.1 规划的能力它已实现） | 无（v3.1 范围） |
| 单机耗时 | 78 分钟（8GB 笔记本） | 数秒（浏览器 WebGPU） |
| 部署形态 | Python+CUDA 本地批处理 / 需 API 化才能进纯前端产品 | 已在产品内 |

## 路线建议（待产品主拍板，2026-10-02）

- **A. 守保真**：维持像素不变量承诺，改进 SAM（点提示策略/multi-box/mask 后处理膨胀）缩小语义碎裂——差异化卖点"无损拆件"。
- **B. 高质量档**：see-through 式扩散分解作为可选档（本地批处理或 BYOK API），UI 明示"重绘非原像素"。
- **C. 混合**（技术最优，工程量最大）：SAM 语义定位 + 扩散模型只做遮挡补全（对应 v3.1 规划，升级实现）。

RC 倾向：A 为产品底线继续做，B/C 作为 v3.1+ 演进方向评估（B 的"本地 78 分钟"对目标用户可接受度存疑，API 化成本需另查）。

# SAM 2.1 Hiera-Tiny 浏览器端 ONNX 产物调研（2026-09-30）

> 调研：RC 委派的资源调研子代理（公开资料核实，逐条标来源）；产物哈希由 RC 本机下载实测冻结。
> 用途：v3.0-alpha L2 蒙版精修的模型选型、许可结论、托管方案与来源链冻结记录。落实前结合 onnxruntime-web 官方文档复核最新口径。

## 1. 官方 ONNX 导出：不存在

[facebookresearch/sam2](https://github.com/facebookresearch/sam2) 只发布 PyTorch checkpoint，无官方 ONNX 导出（README 全文核实）。上游 2.1 checkpoint：`https://dl.fbaipublicfiles.com/segment_anything_2/092824/sam2.1_hiera_tiny.pt`（092824=2.1；072424=2.0，勿混）。

## 2. 选型：Geo-IA/evo-sam2.1-onnx（来源链最完整）

- encoder 与 HF 官方 onnx-community 导出**字节级一致**；decoder 从 Meta 092824 checkpoint 重导出，转换脚本开源（github.com/geoia/evo），导出与 `SAM2ImagePredictor` 做 **logit parity 0.0000** 校验；repo 明示 `license: apache-2.0`。
- 次选 onnx-community/sam2.1-hiera-tiny-ONNX：无 model card、无 license tag（元数据缺失），且 q4f16 变体是 `.onnx + .onnx_data` 外部数据双文件（缓存/加载复杂化）。

## 3. 产物清单与哈希冻结（RC 2026-09-30 本机实测）

| 条目 | 字节 | SHA-256 |
|---|---|---|
| vision_encoder_fp16.onnx | 67,313,499 | `f4ca896cf99816ad0cb7062e9ebef44a211e6f0d0a0656a7eb13349204cb6caa` |
| prompt_encoder_mask_decoder_fp16.onnx | 8,755,200 | `f362ed5bbcfbece283ce970a2162486da9f018645a382b927755677b9d267e6d` |
| vision_encoder.onnx（fp32，WASM 回退档） | 134,429,092 | `276054aed484eca872f3a6c7b705abf554033de6d5d3e13c1b3b8f84e1866584` |
| prompt_encoder_mask_decoder.onnx（fp32） | 17,068,058 | `40bd6810e8a6a432ebae892635480489300ab1a65f01964df0a46ac31c179d93` |

URL（暂用 hf-mirror 占位，正式托管待 R2 就绪替换）：`https://hf-mirror.com/Geo-IA/evo-sam2.1-onnx/resolve/main/sam2.1_hiera_tiny/<file>`。本地暂存：`D:\projects\tools\sam2.1-onnx-staging\`（上传 R2 后可删）。

## 4. License：Apache-2.0，可商用闭源内嵌

官方 README 原文："The SAM 2 model checkpoints, SAM 2 demo code (front-end and back-end), and SAM 2 training code are licensed under [Apache 2.0]"（[LICENSE](https://github.com/facebookresearch/sam2/blob/main/LICENSE) 为标准 Apache-2.0），**覆盖 2.1 (092824) checkpoints**——不存在 Llama 式"代码/权重双许可"分裂。义务：随分发保留 LICENSE/NOTICE。**坑：Ultralytics 是 AGPL-3.0，严禁经它加载/再分发**；直接用 Meta checkpoint 衍生物无碍。

## 5. 运行时事实（onnxruntime-web）

- WebGPU EP：fp16（fp16 权重 + fp32 I/O 组合）；真实先例 [Xevion/WebSAM](https://github.com/Xevion/WebSAM)（SAM 2.1 Tiny fp32 跑通，Chrome/Edge 121+）、Labelbox/sam2-web、DiffusionStudio（ort-web 1.30 + WebGPU）。
- WASM 回退：**r4 定版=沿用 fp16 工件**（PRD AC-V03-B 只要求回退可用；fp32 不上架省 128MB 下载）。fp32 产物哈希保留备查：encoder `276054ae…`/decoder `40bd6810…`（暂存目录可删）。
- opset/算子不兼容：未查到公开口径；集成时以 onnx.checker/runtime 日志自证（已列入适配层验证清单）。

## 5.1 真模型冒烟实测（2026-09-30 RC，Node + ort-web WASM 单线程，R2 真实工件）

**端到端完整性**：R2 下载的 fp16 双件 SHA-256 与冻结值逐字节一致（`f4ca896c…`/`f362ed5b…`）——上传无损确认。

**实测 IO 契约**（HF transformers 导出约定，与早期惯例假设不同）：
- 编码器：输入 `pixel_values` [1,3,1024,1024] float32（RGB [0,1] NCHW）→ 输出 `image_embeddings.0` [1,32,256,256]、`.1` [1,64,128,128]、`.2` [1,256,64,64]（全 float32）。
- 解码器：输入 `input_points` [1,1,N,2] float32（**1024 绝对网格**）、`input_labels` [1,1,N] **int64**（1=正点；box=两角点标签 2/3，实测覆盖 1.000）、`image_embeddings.0/1/2` 直通、`input_masks` [1,1,256,256] float32、`has_mask_input` [1] float32 → 输出 `iou_scores` [1,4]、`pred_masks` [1,4,256,256]（argmax(iou) 后阈值 >0）、`object_score_logits` [1,1]。
- **坐标空间验证**：合成亮方块中心打点 → 覆盖率 1.000/区外 0.000/IoU 0.988（1024 网格经验钉死）。
- 性能参考（Node WASM 单线程）：encoder 会话 666ms、推理 10.4s；浏览器 WebGPU 待实测。
- 教训：Geo-IA 该导出为 HF transformers 风格（`pixel_values`），**没有 box_coords 输入**——box prompt 由适配器转换为两角点+标签 2/3。


## 6. 托管：模型必须走 Cloudflare R2

[Pages 官方限制](https://developers.cloudflare.com/pages/platform/limits/)：**单静态资产上限 25 MiB** → 任何 SAM2 encoder（64/128MB）都放不进 Pages。[R2 限制](https://developers.cloudflare.com/r2/platform/limits/)：单对象 5 TiB → 无障碍。浏览器 fetch 需桶配 CORS。先例：WebSAM = Pages 应用 + R2 权重。

## 7. 对架构假设的修正（✅ 已裁定）

technical-design-v3/architecture-v3 的"模型 ~40MB 级"假设与 SAM2.1-Tiny 现实冲突：**fp16 已 64.2MiB（+decoder 8.4MiB ≈ 73MB）**。契约 `maxModelBytes=41,943,040`（40MiB）会拒绝 fp16 encoder。选项：
- **A（RC 推荐）**：fp16 为主档（约 73MB 一次性下载、CacheAPI 长缓存），质量最优；契约 maxModelBytes 修订 40→80MiB（minor，附本调研）。
- B：onnx-community q4f16（encoder 27.5MB 达标不动契约），4-bit 质量损失（边缘蒙版质量风险，恰是产品卖点），且外部数据双文件增加缓存复杂度。
- C：MobileSAM（fp32 原生 ~40MB 达标），质量明显低于 SAM2。

**裁定（2026-09-30 产品主）：选 A。** 已落地：契约 0.2.1-r3（maxModelBytes=83,886,080）；architecture-v3 §6 权重预算行同步；fp16 为主档、fp32 为 WASM 回退档（manifest 四条目哈希已冻结）。R2 托管操作卡已交产品主（见 project-state）。

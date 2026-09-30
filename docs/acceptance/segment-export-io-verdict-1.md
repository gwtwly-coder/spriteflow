# segment ZIP 导出与 IO 映射增量独立验收裁决（verdict 1）

- 日期：2026-09-30
- 验收基线：commit `90ae953`（HEAD，main，工作树干净）
- 验收对象（三个已推送提交）：
  1. `07cc766` feat(segment): 部位 ZIP 导出（契约 §2 导出节 :248-328 + §5 :312-328）
  2. `9de61a4` fix(segment): 真模型 IO 映射（RC 实测张量名/形状）
  3. `68d0f5f` chore(segment): 工件 URL 切产品主 R2 桶
- 规格依据：docs/interface-contract-v3.md §2 导出节（:248-328，含 :312-328 的 codec/断言/结构校验段）；docs/research/2026-09-30-sam2-onnx-model-sources.md §3（哈希冻结）与 §5.1（实测 IO 契约）。
- 验收方法：只读代码/规格 + 本机复跑全部门禁 + 三个受控负例（改生产代码做变异、验证既有断言真实受力后逐字恢复）+ R2 线上全量下载独立复算 SHA-256。生产者回执与自报 PASS 不作为证据。
- **身份披露**：本验收由独立子代理会话执行，继承父会话模型（型号未确认，GLM 同族），同族独立上下文，不声称异族；与生产者无共享对话上下文。

---

## 1. 检查单逐项

### 1.1 ZIP 导出契约语义（契约 :248-328 逐条）

| 检查点 | 结论 | 证据 |
|---|---|---|
| 空部件表 → `NO_PARTS` | PASS | `exportParts.ts:444-448`；测试 `exportParts.test.ts:240-252` |
| 只接受同一 revision 的已确认部件（漂移=ASSET_MISMATCH） | PASS | 逐部件 `validatePartAsset`（`exportParts.ts:449-452`）→ `partAsset.ts:92-99`（refsEqual 比 assetId+revision → `ASSET_MISMATCH`）；测试 `exportParts.test.ts:254-267` |
| 空 mask 报错、不悄悄少导 | PASS | `exportParts.ts:473-484`（maskBounds null → PART_EXPORT_INVALID + partIds，Stage=part-crop）；测试 `:269-290` 断言 `calls === []`（零编码动作）实证"未悄悄少导" |
| names 与部件 ID 集一一对应（缺失/未知/重复/case-fold 冲突/非法名） | PASS | `exportParts.ts:302-357`：`EXPORT_STEM_PATTERN`（:43，M1 帧名 1..64 字符）+ `EXPORT_STEM_RESERVED`（:44-45，con/prn/aux/nul/com1-9/lpt1-9/constructor/prototype/hasOwnProperty 大小写不敏感）+ case-fold Set（:346-350）；点击模式缺省 `part_000` 起补零（:321-327，宽度 3，契约 :327）；9 类非法名测试 `exportParts.test.ts:292-388`（且断言零 codec 调用） |
| tight crop 源坐标 = sourceRect + maskBounds.origin + 局部点 | PASS | 断言体 `exportParts.ts:255-260`（`sourceRect.y+bounds.y+ly` / `sourceRect.x+bounds.x+lx`）；manifest bbox 同构（:548-553）；测试 `:403-418` 断言 hair bbox {0,0,8,4}、torso bbox {4,8,8,8} 与源图绘制区域一致 |
| 打包前三断言 + 解码后三断言双执行 | PASS | `exportParts.ts:491-492`（beforePack）与 `:520-521`（afterDecode）逐部件执行；断言本体 `:203-292` 实现契约 :246 三条（mask 外 alpha=0 → :242-253；alpha ≤ 源 alpha（源 0 强制 0）→ :261-271；alpha>0 处 mask=1 且 RGB 逐字节相等 → :273-288）；报告 checkedPixels/visiblePixels/passed（:291），测试 `:135-159` 精确值 32/31、64/63 |
| 解码不符 = PART_PIXEL_INVARIANT_FAILED 且不返回归档 | PASS | 尺寸/数据不符 `:226-235`；decodePng 抛错归一同码 `:508-519`；解码后断言失败沿 `assertPartPixelInvariant` 原错误返回（:520-521），此时 archive 尚未构造（encodeZip 在 :573，位于全部件断言之后）→ 归档必不产生；负例①变异验证见 §3 |
| parts.json 字节级格式 | PASS | `exportParts.ts:557-558`：`JSON.stringify(manifest, null, 2)` + 末尾 `\n`，经根内自研 `utf8Bytes`（:153-177，无 BOM、全码点）；测试 `:435-449` 逐字节断言（首字节 0x7b 无 BOM、末尾恰一个 LF、次行 2 空格、`JSON.parse` 深等于 manifest）；`file` 形如 `parts/<stem>.png` 且与 bbox 一一对应（:541-555，测试 :403-418） |
| README.txt 内容（UTF-8/LF、版本、目录说明、bbox 规则、像素不变量） | PASS | `buildReadme()` `:359-381`（V3_CONTRACT_VERSION 3.0.0 + 协议版本、目录布局、半开区间 bbox 规则、不变量与双断言说明）；测试 `:451-462`（无 \r、含 3.0.0/parts.json/half-open/No blur） |
| 归档固定且只有 parts/*.png、parts.json、README.txt | PASS | files 数组仅由 prepared PNG + 两固定条目构成（`:560-568`）；结构校验拒绝任何额外条目（:410-413 unexpectedEntry，测试 :576 注入 ghost 条目被拒） |
| 路径安全（无 ..、非绝对、ASCII case-fold 唯一、设备保留名） | PASS | `ARCHIVE_PATH_PATTERN`（:49）字符类不含点 → `..` 按构造不可能，且 :402-404 再显式拒绝 `..`/前导 `/`（正则类含 `/`，故显式检查必要且存在）；case-fold 唯一 :405-409（测试 :589-591 `PARTS/HAIR.PNG` 被拒）；stem 设备保留名在 validateTask 拦截（见上）；7 类归档撒谎测试 `:573-618` 全拒 |
| ZIP 结构校验（条目数/重复/MIME/长度/manifest 一一映射） | PASS | `validateArchiveEntries` `:383-427`：entryCount（:392）、folded 重复（:405-408）、path 白名单（:399-404）、expectedByPath 精确映射 + MIME（:414-416）+ byteLength limit/actual（:417-424）；负例②变异验证见 §3 |
| maxArchiveBytes 上限 | PASS | `exportParts.ts:585-593`（超出 → ARCHIVE_LIMIT，details 带 limit/actual）；测试 `:557-571` |
| 进度阶段单调 + 仅成功终态 complete + 逐阶段取消 | PASS | `ProgressReporter` `:56-100`（overall 取 max 钳位单调、complete 幂等一次、cancellable=false）；阶段序 Validate→PartCrop→PixelAssert→PngEncode→Archive（:457,486,490,494,570-608）；取消检查 :443,493,507,531,582；测试 `:649-679`（单调、六阶段精确序、单一 complete、cancellable=false）与 `:622-647`（预取消零 codec 调用、中途取消不出 encodeZip） |
| codec 注入零依赖、浏览器导出面不变 | PASS | `exportParts.ts` 无任何第三方 import（仅包内模块）；`PartExportCodec` 注入为第四参（:436-442）；根入口仍精确导出 `assertPartPixelInvariant`/`exportPartAssets`（`index.ts:15`）；segment 包 dependencies 仅 onnxruntime-web（browser 子入口），fflate 只进 apps/web（`90ae953`）；`check-contract` PASS（exact root exports） |
| codec 契约要求成文 | PASS | `exportPartAssets` 文档注释 `:429-435` 逐项写明 PNG store、JSON/文本 deflate 6、按路径排序、mtime 1980-01-01、无权限/绝对路径；测试 codec `exportCodec.ts` 按此实现（method 0/8、DOS 0x0021、CRC32、central directory，诚实格式非桩） |

### 1.2 IO 映射与实测真值一致性（研究 §5.1 逐项）

| 检查点 | 结论 | 证据 |
|---|---|---|
| encoder 输入 `pixel_values` [1,3,1024,1024] float32 RGB[0,1] NCHW | PASS | `manifest.ts:62,92`（imageInputName="pixel_values"、inputSize 1024×1024）；`onnxBackend.ts:232-251`（三平面 NCHW、/255、dims [1,3,H,W]）；测试 `browserBackend.test.ts:164-167`（[1,3,4,4]、Float32Array） |
| encoder 三路输出 image_embeddings.0/1/2（[1,32,256,256]/[1,64,128,128]/[1,256,64,64]）直通 | PASS | `manifest.ts:46-49` 注释逐形状；`onnxBackend.ts:363`（`{...embedding.outputs}` 原样进 feeds）；假 ORT 按实测名返回三路（`samHelpers.ts:147-159`）；测试 `browserBackend.test.ts:141-149` 键集精确七键 |
| decoder `input_points` [1,1,N,2] float32、1024 绝对网格 | PASS | `onnxBackend.ts:321-322,340-341,364-369`（scaleX=inputSize/asset 尺寸，源坐标×scale，dims [1,1,count,2]）；测试 `:150-153`（(6,4)→(3,2)，4×4 网格）；研究 §5.1"1024 绝对网格"与缩放方向一致（embed 源→网格最近邻采样 `:233-247`，点为网格绝对坐标，mask 回映网格→源 `:401-408`，三处方向互洽） |
| `input_labels` [1,1,N] int64（1 正/0 负） | PASS | `onnxBackend.ts:342,348-355,370-374`（BigInt64Array、dims [1,1,count]，1n/0n）；测试 `:154-156` |
| box → 两角点、SAM 标签 2/3、显式点在前角点在后 | PASS | `onnxBackend.ts:329-338`（`[...prompt.points]` 后 push 角点；半开区间保守取 x+width-1 并注释实测覆盖 1.000）；label 映射 2n/3n（:348-355）；测试 `:170-186`（纯 box [1n 无，2n,3n]，角点 (1,1)/(2.5,2.5)）与 `:188-210`（显式 1n,0n 在前 + 2n,3n 追加，N=3+1=4） |
| `input_masks` [1,1,256,256] float32 全零 + `has_mask_input` [1]=[0] | PASS | `onnxBackend.ts:102-104`（SAM_MASK_GRID=256）+ `:377-382`（零张量 + [0]）；测试 `:157-162`（dims 与全零、[1]==[0]） |
| 输出 `iou_scores` [1,4] argmax + `pred_masks` [1,4,256,256] 阈值>0；object_score_logits 忽略 | PASS | argmax `onnxBackend.ts:297-301`（严格 >，首最大者胜，argmax 惯例）；阈值 `:406`（`logit > 0`）；平面选择 `:392-398`（dims[1]>1 时 bestIndex*planeSize）；object_score_logits 不读取（results 仅取 masks/scores :292-293）；测试 `:131-136`（HALF_POSITIVE_LOGITS → 左半 mask，argmax 选 scores[1]=0.9 :127） |
| 无独立 box 输入 → promptInputNames.box 承载 input_points | PASS | `manifest.ts:63-70`（box/points 同为 "input_points"、pointLabels="input_labels"，注释说明实测依据）；测试 `browserManifest.test.ts:85-93` |
| manifest 常量 vs 研究 §5.1 其余（has_mask 语义、[1,4] 输出、忽略项） | PASS | `manifest.ts:43-59` 注释块逐行对齐 §5.1 文本（含"上一帧蒙版 logits、首发零+has_mask=0""argmax(iou) 后阈值>0""object_score_logits [1,1] unused"） |

### 1.3 测试有效性（复跑 + 受控负例）

- 复跑：`pnpm --filter @spriteflow/segment test` → **179/179 PASS**（10 文件，762ms，本机复现）。根 `test:unit` → 344/344 PASS（segment 179 + pipeline 144 + web 21）；根 `typecheck` EXIT=0；`node scripts/check-boundaries.mjs` OK；`pipeline check:contract` PASS。
- 三个受控负例（变异生产代码 → 期望既有断言失败 → `git checkout --` 逐字恢复，全程未 commit，终态工作树 CLEAN）：

| 负例 | 变异 | 预期 | 实测 |
|---|---|---|---|
| NEG-① 篡改解码像素防线 | `exportParts.ts` 禁用解码后断言（`!afterDecode.ok && false`） | 解码篡改用例失败 | **2 个用例失败**（"fails PART_PIXEL_INVARIANT_FAILED and skips the archive when decode tampered a pixel"、"fails when decoded dimensions differ"）——双断言真实受力，归档确实被丢弃 |
| NEG-② 伪造 inspectZip 撒谎 | `exportParts.ts` 将 `validateArchiveEntries` 短路为恒 null | 结构校验用例失败 | **恰好 1 个用例失败**（"validates the unpacked archive structure item by item"，7 类撒谎 override 全部穿透）——五项结构校验真实受力 |
| NEG-③ 假 decoder 缺必需 feed 键 | `onnxBackend.ts` 删除 `has_mask_input` feed | 假 decoder 必需键守卫抛错 + 键集断言失败 | **4 个用例失败**（feed 七键精确断言 + box/组合/回退三用例经 `decoder feeds missing: has_mask_input` 包装为 InferenceUnavailable）——feed 完整性双重受力 |

- 结论：三类防线（解码后不变量、归档结构校验、decoder feed 完整性）都不是摆设，对应测试在防线失效时必然变红。

### 1.4 R2 URL 与哈希一致性

| 检查点 | 结论 | 证据 |
|---|---|---|
| manifest.ts 常量 = 产品主 R2 桶 | PASS | `manifest.ts:77-78` `SAM2_TINY_BASE_URL = "https://pub-84f26155f7ef4247b3632fcd308d941e.r2.dev"`，两工件 URL 由 :89 拼接 |
| 注册表字节/哈希 = 研究 §3 逐值 | PASS | encoder `vision_encoder_fp16.onnx` 67,313,499 B / `f4ca896c…cb6caa`；decoder `prompt_encoder_mask_decoder_fp16.onnx` 8,755,200 B / `f362ed5b…7e6d`（`manifest.ts:111-134`）与研究文档 §3 表两行逐字符一致；测试 `browserManifest.test.ts:15-25,59-63` 将冻结值钉进断言 |
| 线上实证（本验收独立新增，超出检查单要求） | PASS | 对两 URL 发 HEAD → 200，Content-Length 67,313,499 / 8,755,200（与冻结字节精确一致，cloudflare 边缘）；随后**全量下载两文件独立重算 SHA-256**：`f4ca896c…cb6caa` / `f362ed5b…7e6d`，与注册表常量、研究 §3 冻结值三方逐字节一致——上传无损与常量正确性均由本验收独立复证，不依赖 RC 自报 |

---

## 2. 门禁与问题清单

门禁实测（基线 `90ae953`）：segment test 179/179 绿；根 typecheck / test:unit / check-boundaries / check:contract 全绿；**根 `pnpm run lint` 退出码 1（红）**。

| 级别 | 问题 | 证据与影响 |
|---|---|---|
| **P1** | `68d0f5f` 引入 biome 格式回归，根 lint 门禁在 HEAD 红：`packages/segment/src/browser/manifest.ts:77-78` 的 `SAM2_TINY_BASE_URL` 因 URL 由 hf-mirror 长 占位换成较短 R2 域名后不再需要折行，biome 要求并为一行；`pnpm run lint` 报 "Formatter would have printed the following content" 唯一 1 错。生产者 `9de61a4` 回执"根 lint 退出码 0"在当时为真，但随后提交破坏且未复跑门禁。 | 修复为一行常量（行为零影响），须在 RC 整合开始时最先落地（可单独 fix commit）；除此之外 lint 其余子步（boundaries/contract）本机代跑全绿 |
| P2 | `onnxBackend.ts:323` `prompt.type === "box" ? prompt.box : prompt.box` 两分支同 expression 的死三元（SamPrompt 恒带 box 字段）。行为无害，建议 RC 整合时随手清理为直接取值 | 纯代码卫生 |
| P2 | `infer()` 未交叉校验 `pred_masks` 平面数与 `iou_scores` 长度（`onnxBackend.ts:292-302`）：若解码器两输出数量不一致，argmax 索引可能越界读 undefined → 软失败为空 mask。冻结注册表下真实解码器恒输出 [1,4,·]，不可达；记录备查，alpha 不要求处理 | 防御性观察项 |

无 P0。

---

## 3. 最终裁决

**最终：PASS**（带 1 项 P1 门禁回归，须在 RC 整合开始时最先修复；三项增量全部行为语义逐项通过）。

- `07cc766` ZIP 导出：契约 :248-328 逐条 PASS，双三断言/结构校验经变异负例证明真实受力，32 用例全绿。
- `9de61a4` IO 映射：manifest 常量与 backend feeds 同研究 §5.1 实测真值逐项一致，七键精确、box 角点 2/3、坐标缩放与蒙版回映方向正确，负例③证明 feed 完整性受测试保护。
- `68d0f5f` R2 切换：常量、冻结哈希、线上对象三方独立复算一致；唯一遗留为该提交引入的 P1 lint 格式回归。

结论句：**segment ZIP 导出与 IO 映射增量独立验收：PASS（1×P1 lint 格式回归随 RC 整合首修，行为语义零问题），移交 RC 整合。**

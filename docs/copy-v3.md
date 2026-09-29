# SpriteFlow v3 界面文案（中英双语）

> 适用范围：`docs/prd-v3.md` 中 v3.0-alpha 全部新增界面状态
> 与 `docs/copy-m1.md` 的关系：M1 词条（第 1–16 节）继续在 v3 工作区对适用状态生效（上传/预检错误、超大图与内存、通用异常、导出失败与下载拦截、快捷键面板框架等）；本表从第 17 节起收录 v3 新增词条，**编号延续 copy-m1**，不重复收录沿用词条
> 语气：延续 copy-m1 规则——直接、具体、像开发者对开发者说话；不夸大，不使用"魔法""一键完美""万能"等营销表达；降级如实承认，错误不责怪用户
> 用法：Key 是实现与测试的稳定标识；UI 必须按当前语言只显示对应列，不在同一句中中英混排

## 17. 文案规则补充

- "part" 统一译为"部位"，"mask" 统一译为"蒙版"，"occluded" 统一译为"被遮挡"，"semantic detection" 统一译为"语义定位"。
- 服务商与模型名（GLM-4V、CogVLM、SAM 等）为专有名词，中英文一致，不翻译。
- v3 隐私口径与 M1 不同且必须如实：本地处理是默认；启用语义定位会把图片发送到用户配置的服务商，必须显式说明，不得复用 `privacy.local_only` 的"绝不上传"表述。
- 新增占位符：`{provider}`（服务商名）、`{part}`（部位显示名）、`{index}`（序号）、`{size}`（模型体积 MB）、`{reason}`（失败原因短句）、`{mode}`（目标工作区名）。既有占位符 `{name}`、`{count}`、`{width}`、`{height}`、`{percent}`、`{fps}` 沿用。
- 降级与失败文案先说发生了什么，再给下一步动作；两条路径（重试 / 改用点击模式）都写成明确按钮，不藏在正文里。

## 18. 工作区切换与入口

| Key | 场景/组件 | 中文 | English |
|---|---|---|---|
| nav.mode.slicer | 模式入口 | 切帧 | Slice sheets |
| nav.mode.parts | 模式入口 | 拆部位 | Split parts |
| parts.workspace.title | 工作区标题 | 拆部位 | Character parts |
| parts.workspace.tagline | 工作区副标题 | 把一张人物立绘拆成独立部位素材 | Turn a character illustration into separate part assets |
| confirm.switch_mode.title | 切换确认 | 切换到{mode}工作区？ | Switch to the {mode} workspace? |
| confirm.switch_mode.body | 切换确认 | 当前部位和编辑记录会被清空。 | Current parts and edit history will be cleared. |
| confirm.switch_mode.action | 确认按钮 | 切换 | Switch |

## 19. 拆部位上传空状态

| Key | 场景/组件 | 中文 | English |
|---|---|---|---|
| parts.upload.empty.title | 首次空状态标题 | 拖入透明人物立绘 | Drop a transparent character illustration |
| parts.upload.empty.hint | 首次空状态说明 | PNG 或 WebP，单张图片，最大 8192×8192 | PNG or WebP, one image, up to 8192×8192 |
| parts.upload.subject_hint | 适用范围说明 | 人形角色效果最好；其他图可以用点击模式手动拆。 | Humanoid characters work best. Other images can be split manually in click mode. |
| privacy.parts_notice | 隐私说明 | 拆部位在浏览器本地完成。启用语义定位后，图片会发送到你选择的服务商。 | Splitting runs locally in your browser. If you enable semantic detection, the image is sent to the provider you choose. |
| parts.upload.open_llm_settings | 配置入口按钮 | 配置语义定位 | Set up semantic detection |

拖放悬停、文件信息、预检与解码状态沿用 copy-m1 第 3 节；上传类错误沿用第 4 节。

## 20. BYOK 配置面板

| Key | 场景/组件 | 中文 | English |
|---|---|---|---|
| llm.settings.title | 面板标题 | 语义定位设置 | Semantic detection settings |
| llm.provider.label | 字段标签 | 服务商 | Provider |
| llm.provider.glm_4v | 选项 | GLM-4V | GLM-4V |
| llm.provider.cogvlm | 选项 | CogVLM | CogVLM |
| llm.provider.openai_gpt | 选项 | OpenAI（GPT 系） | OpenAI (GPT) |
| llm.api_key.label | 字段标签 | API Key | API Key |
| llm.api_key.help | 辅助说明 | Key 只保存在你的浏览器，只发送给你选择的服务商。 | The key stays in your browser and is only sent to the provider you choose. |
| llm.save | 主按钮 | 保存 | Save |
| llm.clear | 次按钮 | 清除 Key | Clear key |
| llm.saved | Toast | 已保存，语义定位可用了。 | Saved. Semantic detection is ready. |
| llm.not_configured.title | 未配置状态标题 | 语义定位还没配置 | Semantic detection isn't set up |
| llm.not_configured.body | 未配置说明 | 配置 API Key 后可自动命名部位；不配置也能用本地点击模式拆件。 | Add an API key for automatic part naming. Without one, you can still split parts with local click mode. |
| llm.privacy_notice | 外发告知 | 语义定位会把这张图片发送到你配置的 {provider}。 | Semantic detection sends this image to your configured {provider}. |

服务商清单以 v3 接口契约定稿为准；新增服务商时按 `llm.provider.<id>` 命名补充词条。

## 21. 拆件过程（模型加载、L1、L2）

| Key | 场景/组件 | 中文 | English |
|---|---|---|---|
| parts.detect.title | 过程页标题 | 正在拆部位 | Splitting parts |
| parts.detect.llm | L1 阶段状态 | 正在识别部位（{provider}）… | Finding parts ({provider})… |
| parts.detect.masks | L2 阶段状态 | 正在精修蒙版… | Refining masks… |
| parts.detect.finalizing | 收尾状态 | 正在准备审校器… | Preparing the editor… |
| parts.detect.progress | 进度可访问文本 | 已完成 {percent}% | {percent}% complete |
| parts.detect.cancel | 处理按钮 | 停止拆件 | Stop splitting |
| parts.detect.cancelled | 取消后状态 | 拆件已停止。 | Splitting stopped. |
| parts.detect.success | 成功摘要 | 识别到 {count} 个部位。 | Found {count} parts. |
| model.loading | 模型状态 | 正在加载本地模型… | Loading the local model… |
| model.downloading | 模型下载 | 正在下载本地模型（{size} MB）… | Downloading the local model ({size} MB)… |
| model.ready_cached | 模型就绪 | 本地模型已就绪。 | The local model is ready. |
| model.backend_wasm | 后端回退提示 | 当前浏览器不支持 WebGPU，已切换到兼容模式，速度会慢一些。 | WebGPU isn't available, so we switched to compatibility mode. It runs slower. |
| model.failed.title | 模型加载失败 | 本地模型加载失败 | Couldn't load the local model |
| model.failed.body | 模型加载失败 | 可能是网络或浏览器存储的问题。 | It may be a network or browser storage issue. |
| model.required_hint | 模型依赖说明 | 自动拆件和点击模式都依赖这个本地模型。 | Both auto splitting and click mode need this local model. |
| model.retry | 失败动作 | 重试加载 | Retry loading |

## 22. 部位审校与点击增删

| Key | 场景/组件 | 中文 | English |
|---|---|---|---|
| parts.editor.title | 工作区标题 | 审校部位 | Review parts |
| parts.editor.summary | 工作区摘要 | {count} 个部位 | {count} parts |
| part.list.title | 面板标题 | 部位列表 | Part list |
| part.selected | 选中态 | 已选部位：{part} | Selected part: {part} |
| part.size | 尺寸标注 | {width}×{height} px | {width}×{height} px |
| part.default_name | 无语义命名显示 | 部位 {index} | Part {index} |
| tool.add_region | 工具 | 加区域 | Add region |
| tool.remove_region | 工具 | 减区域 | Remove region |
| tool.add_part | 工具 | 新增部位 | Add part |
| tool.delete_part | 工具 | 删除部位 | Delete part |
| parts.mask_highlight | 显示开关 | 蒙版高亮 | Mask highlight |
| parts.editor.add_region_hint | 工具提示 | 点击图中区域，把它加入选中部位。 | Click an area to add it to the selected part. |
| parts.editor.remove_region_hint | 工具提示 | 点击部位里多余的区域，把它减掉。 | Click an area inside the part to remove it. |
| parts.editor.add_part_hint | 工具提示 | 点击图中区域，新建一个部位。 | Click an area to create a new part. |
| part.region_updated | Toast | 已更新部位区域。 | Part region updated. |
| part.added | Toast | 已新增部位。 | Part added. |
| part.deleted | Toast | 已删除部位。 | Part deleted. |
| parts.editor.no_parts | 零部位空状态 | 还没有部位。用"新增部位"点击图中区域。 | No parts yet. Use Add part, then click the image. |
| parts.rerun | 工具栏按钮 | 重新拆件 | Split again |
| part.confidence_label | 置信度展示（P1） | 置信度 {percent}% | Confidence {percent}% |
| part.occluded_badge | 遮挡角标（P1） | 被遮挡 | Occluded |
| part.occluded_help | 遮挡说明（P1） | 被挡住的区域暂不补全；补全属后续版本。 | Occluded areas aren't filled yet. Inpainting comes in a later version. |
| part.rename | 重命名入口（P1） | 重命名 | Rename |
| part.name_invalid | 命名非法（P1） | 这个名字不能用作文件名，换一个。 | This name can't be used as a filename. Try another. |

撤销/重做、平移缩放等通用工具与空状态沿用 copy-m1 第 8 节对应词条。

## 23. 降级模式与 LLM 错误

| Key | 场景/组件 | 中文 | English |
|---|---|---|---|
| parts.fallback.nonhuman.title | 非人形降级横幅 | 这张图不像人形角色 | This doesn't look like a humanoid character |
| parts.fallback.nonhuman.body | 非人形降级说明 | 没有硬猜。已切到纯点击模式，逐个点出你需要的部位。 | We didn't guess. You're in click mode—click out the parts you need. |
| parts.fallback.nokey.title | 无 key 引导 | 语义定位还没配置 | Semantic detection isn't set up |
| parts.fallback.nokey.body | 无 key 引导说明 | 可以配置 API Key 自动命名部位，或直接用本地点击模式拆件。 | Add an API key for automatic part naming, or split parts with local click mode. |
| parts.fallback.llm_failed.title | LLM 失败降级 | 语义定位没成功 | Semantic detection failed |
| parts.fallback.llm_failed.body | LLM 失败降级说明 | {reason} | {reason} |
| parts.fallback.use_click | 主按钮 | 使用点击模式 | Use click mode |
| parts.fallback.retry_llm | 次按钮 | 重试语义定位 | Retry semantic detection |
| llm.error.network | 失败原因 | 连不上服务商，或请求超时。 | Couldn't reach the provider, or the request timed out. |
| llm.error.unauthorized | 失败原因 | API Key 无效。 | The API key is invalid. |
| llm.error.rate_limited | 失败原因 | 请求太频繁，或额度不足。 | Too many requests, or the quota is used up. |
| llm.error.bad_response | 失败原因 | 服务商返回了无法解析的结果。 | The provider returned a result we couldn't parse. |
| parts.mode.semantic | 模式标签 | 模式：语义定位 + 点击精修 | Mode: Semantic + click refine |
| parts.mode.click | 模式标签 | 模式：点击 | Mode: Click |

## 24. 部位导出

| Key | 场景/组件 | 中文 | English |
|---|---|---|---|
| parts.export.title | 面板标题 | 导出部位包 | Export parts |
| parts.export.summary | 导出摘要 | 将导出 {count} 个部位 PNG | {count} part PNGs will be exported |
| parts.export.format_hint | 格式说明 | 每个部位一张透明 PNG，附 parts.json 清单。 | One transparent PNG per part, plus a parts.json manifest. |
| parts.export.start | 主按钮 | 生成并下载 | Build and download |
| parts.export.preparing | 处理状态 | 正在准备部位… | Preparing parts… |
| parts.export.verifying | 校验状态 | 正在校验像素一致性… | Verifying pixel consistency… |
| parts.export.zipping | 处理状态 | 正在创建 ZIP… | Creating ZIP… |
| parts.export.progress | 进度可访问文本 | 导出已完成 {percent}% | Export {percent}% complete |
| parts.export.success.title | 成功状态 | 导出完成 | Export ready |
| parts.export.success.body | 成功状态 | `{name}` 已生成。 | `{name}` is ready. |
| parts.export.again | 成功按钮 | 再次导出 | Export again |
| parts.export.back | 次按钮 | 返回编辑 | Back to editor |
| parts.export.disabled_no_parts | 零部位禁用说明 | 至少保留一个部位才能导出。 | Keep at least one part before exporting. |
| parts.export.invariant_failed.title | 像素校验失败 | 像素校验未通过 | Pixel check failed |
| parts.export.invariant_failed.body | 像素校验失败说明 | 有部位包含非原图像素，已停止导出。返回编辑后重试。 | A part contains pixels that aren't from the source image, so the export stopped. Go back to the editor and retry. |

通用导出失败、下载被拦截沿用 copy-m1 第 13–14 节。

## 25. 删除与重新拆件确认

| Key | 场景/组件 | 中文 | English |
|---|---|---|---|
| confirm.delete_part.title | 删除部位 | 删除这个部位？ | Delete this part? |
| confirm.delete_part.body | 删除说明 | 可以用"撤销"恢复。 | You can restore it with Undo. |
| confirm.delete_part.action | 危险按钮 | 删除 | Delete |
| confirm.rerun_split.title | 重新拆件 | 重新拆件并替换当前部位？ | Replace current parts with a new split? |
| confirm.rerun_split.body | 重新拆件 | 当前修改会被替换，但仍可撤销。 | Your edits will be replaced, but you can still undo. |
| confirm.rerun_split.action | 确认按钮 | 重新拆件 | Split again |

更换文件确认沿用 copy-m1 `confirm.new_file.*`。

## 26. 部位名称词表（标准件显示名）

| Key | 中文 | English |
|---|---|---|
| part.kind.hair | 头发 | Hair |
| part.kind.face | 脸 | Face |
| part.kind.eye | 眼睛 | Eye |
| part.kind.eyebrow | 眉毛 | Eyebrow |
| part.kind.mouth | 嘴 | Mouth |
| part.kind.torso | 躯干 | Torso |
| part.kind.upper_arm | 上臂 | Upper arm |
| part.kind.forearm | 前臂 | Forearm |
| part.kind.hand | 手 | Hand |
| part.kind.thigh | 大腿 | Thigh |
| part.kind.lower_leg | 小腿 | Lower leg |
| part.kind.foot | 脚 | Foot |

- 词表以 v3 接口契约定稿为准；契约新增 kind 时同步补充 `part.kind.<id>` 词条，不得以英文原文直接上屏。
- 带侧别的部位显示为"左/右 + 部位名"（如"左上臂"/"Left upper arm"）；导出文件名使用 kind 与 `left_`/`right_` 前缀的组合，遵循文件名合法字符规则。
- 无语义命名（点击模式或降级）的部位显示 `part.default_name`，导出文件名从 `part_000` 起三位补零。

## 27. 快捷键名称（P1）

快捷键最终按键映射由 UI 规范确认，沿用 copy-m1 第 15 节框架；本节仅新增 v3 功能名称。

| Key | 场景/组件 | 中文 | English |
|---|---|---|---|
| shortcuts.add_region | 功能名 | 加区域 | Add region |
| shortcuts.remove_region | 功能名 | 减区域 | Remove region |
| shortcuts.add_part | 功能名 | 新增部位 | Add part |
| shortcuts.delete_part | 功能名 | 删除选中部位 | Delete selected part |

## 28. 状态覆盖核对

| 状态 | 文案覆盖位置 |
|---|---|
| 工作区切换、入口确认 | 第 18 节 |
| 上传空状态、隐私差异、BYOK 入口 | 第 19 节（通用上传/预检沿用 copy-m1 第 3–5 节） |
| BYOK 配置、key 存储、外发告知、未配置状态 | 第 20 节 |
| 模型下载/加载/就绪/后端回退/失败、拆件各阶段、取消、成功 | 第 21 节 |
| 审校工具、点击增删提示、Toast、零部位、置信度与遮挡（P1）、重命名（P1） | 第 22 节（撤销/重做空状态沿用 copy-m1 第 8 节） |
| 非人形/无 key/LLM 失败降级、失败原因、模式标签 | 第 23 节 |
| 导出各阶段、像素校验、成功、零部位禁用 | 第 24 节（导出失败/下载拦截沿用 copy-m1 第 13–14 节） |
| 删除部位、重新拆件确认 | 第 25 节（换图确认沿用 copy-m1 第 11 节） |
| 部位名称词表、侧别与默认命名规则 | 第 26 节 |
| 快捷键名称（P1） | 第 27 节（面板框架沿用 copy-m1 第 15 节） |

# SpriteFlow M1 界面文案（中英双语）

> 适用范围：`docs/prd-m1.md` 中 M1 全部界面状态  
> 语气：直接、具体、像开发者对开发者说话；不夸大，不使用“魔法”“一键完美”“万能”等营销表达  
> 用法：Key 是实现与测试的稳定标识；UI 必须按当前语言只显示对应列，不在同一句中中英混排

## 1. 文案规则

- 先说发生了什么，再给用户下一步。
- 检测没有把握时直接承认，不把降级包装成成功。
- 错误不责怪用户，不使用“非法文件”“操作错误”。
- 文件、像素、帧数和尺寸使用真实值替换占位符：`{name}`、`{count}`、`{width}`、`{height}`、`{percent}`、`{fps}`。
- 按钮使用动作动词；危险动作写清对象。
- “Frame”统一译为“帧”，“sprite sheet”统一译为“精灵表”，“atlas”统一译为“图集”。

## 2. 全局与导航

| Key | 场景/组件 | 中文 | English |
|---|---|---|---|
| app.name | 产品名 | SpriteFlow | SpriteFlow |
| app.tagline | 上传页副标题 | 把透明精灵表变成引擎素材 | Turn transparent sprite sheets into engine-ready assets |
| privacy.local_only | 全局隐私说明 | 文件只在你的浏览器中处理，不会上传。 | Your files stay in your browser. Nothing is uploaded. |
| language.label | 语言选择 | 语言 | Language |
| language.zh | 语言选项 | 中文 | Chinese |
| language.en | 语言选项 | 英文 | English |
| action.back | 通用按钮 | 返回 | Back |
| action.cancel | 通用按钮 | 取消 | Cancel |
| action.close | 通用按钮 | 关闭 | Close |
| action.retry | 通用按钮 | 重试 | Retry |
| action.continue | 通用按钮 | 继续 | Continue |
| action.done | 通用按钮 | 完成 | Done |
| action.learn_shortcuts | 工具栏入口 | 快捷键 | Shortcuts |
| action.new_file | 工作区按钮 | 换一张图 | Choose another image |

## 3. 上传空状态与文件预检

| Key | 场景/组件 | 中文 | English |
|---|---|---|---|
| upload.empty.title | 首次空状态标题 | 拖入透明精灵表 | Drop a transparent sprite sheet |
| upload.empty.hint | 首次空状态说明 | PNG 或 WebP，单张图片，最大 8192×8192 | PNG or WebP, one image, up to 8192×8192 |
| upload.browse | 主按钮 | 选择图片 | Choose image |
| upload.drop_active | 拖放悬停 | 松开开始处理 | Drop to start |
| upload.file_name | 文件信息标签 | 文件 | File |
| upload.file_type | 文件信息标签 | 格式 | Format |
| upload.file_size | 文件信息标签 | 尺寸 | Dimensions |
| upload.preflight | 预检状态 | 正在检查图片… | Checking image… |
| upload.decode | 解码状态 | 正在读取图片… | Reading image… |
| upload.ready | 预检通过 | 图片可用，开始检测。 | Image ready. Starting detection. |
| upload.replace | 文件信息按钮 | 重新选择 | Choose another |

## 4. 上传与预检错误

| Key | 场景/组件 | 中文 | English |
|---|---|---|---|
| error.unsupported_type.title | 非 PNG/WebP | 暂不支持这个格式 | This format isn't supported yet |
| error.unsupported_type.body | 非 PNG/WebP | M1 只处理透明 PNG 和 WebP。 | M1 only handles transparent PNG and WebP files. |
| error.multiple_files.title | 拖入多文件 | 一次只能处理一张图 | One image at a time |
| error.multiple_files.body | 拖入多文件 | 只保留一张 PNG 或 WebP，再试一次。 | Keep one PNG or WebP file and try again. |
| error.opaque.title | 完全不透明像素占比 >99% | 这张图基本没有透明背景 | This image is effectively opaque |
| error.opaque.body | 完全不透明像素占比 >99% | M1 不做去底。请先去掉背景，再上传 PNG 或 WebP。 | M1 doesn't remove backgrounds. Remove it first, then upload a PNG or WebP. |
| error.decode.title | 文件损坏/解码失败 | 无法读取这张图 | Couldn't read this image |
| error.decode.body | 文件损坏/解码失败 | 文件可能已损坏，或实际格式与扩展名不一致。 | The file may be damaged, or its contents may not match the extension. |
| error.choose_another | 错误动作 | 换一张图 | Choose another image |
| error.open_manual | 可恢复错误动作 | 进入手动模式 | Open manual mode |

## 5. 超大图与内存状态

| Key | 场景/组件 | 中文 | English |
|---|---|---|---|
| oversize.title | 任一边 >8192 | 图片超过 M1 上限 | Image exceeds the M1 limit |
| oversize.body | 超大图说明 | 当前是 {width}×{height}。M1 最多处理 8192×8192；可以缩小后继续。 | This image is {width}×{height}. M1 handles up to 8192×8192. You can downscale it and continue. |
| oversize.target | 降采样选项标签 | 最长边 | Longest side |
| oversize.continue | 主按钮 | 缩小后继续 | Downscale and continue |
| oversize.cancel | 次按钮 | 取消上传 | Cancel upload |
| memory.precheck.title | 预计内存不足 | 这台设备可能放不下这张图 | This image may not fit in memory |
| memory.precheck.body | 预计内存不足 | 直接处理可能让页面失去响应。缩小图片后再试更稳。 | Processing it as-is may make the page unresponsive. Downscale it first. |
| memory.runtime.title | 运行时内存失败 | 内存不够，处理已停止 | Not enough memory. Processing stopped |
| memory.runtime.body | 运行时内存失败 | 你的原图和已完成编辑还在。降低尺寸后重试。 | Your source image and completed edits are still here. Downscale and try again. |
| memory.downscale_retry | 恢复按钮 | 降低尺寸后重试 | Downscale and retry |
| memory.back_to_editor | 导出失败恢复 | 返回编辑 | Back to editor |

## 6. 检测过程与结果状态

| Key | 场景/组件 | 中文 | English |
|---|---|---|---|
| detect.title | 检测页标题 | 正在找帧 | Finding frames |
| detect.preparing | 阶段状态 | 正在准备图片… | Preparing image… |
| detect.grid | 策略 A 状态 | 正在检查网格… | Checking for a grid… |
| detect.components | 策略 B 状态 | 正在查找独立区域… | Finding separate regions… |
| detect.comparing | 决策状态 | 正在选择更可靠的结果… | Choosing the more reliable result… |
| detect.finalizing | 收尾状态 | 正在准备审校器… | Preparing the editor… |
| detect.progress | 进度可访问文本 | 已完成 {percent}% | {percent}% complete |
| detect.cancel | 处理按钮 | 停止检测 | Stop detection |
| detect.cancelled | 取消后状态 | 检测已停止。 | Detection stopped. |
| detect.success.grid | 成功摘要 | 已用网格检测找到 {count} 帧。 | Found {count} frames using grid detection. |
| detect.success.components | 成功摘要 | 已用区域检测找到 {count} 帧。 | Found {count} frames using region detection. |
| detect.method.label | 审校器信息 | 检测方式 | Detection method |
| detect.method.grid | 值 | 网格 | Grid |
| detect.method.components | 值 | 区域 | Regions |
| detect.method.manual | 值 | 手动 | Manual |
| detect.recalculate | 参数侧栏按钮 | 重新检测 | Run detection again |
| detect.recalculating | 参数改变后 | 正在重新检测… | Re-running detection… |
| detect.failed.title | 未知检测错误 | 检测中断了 | Detection stopped unexpectedly |
| detect.failed.body | 未知检测错误 | 可以重试，或直接进入手动模式。 | Retry, or continue in manual mode. |

## 7. 低置信度与手动降级

| Key | 场景/组件 | 中文 | English |
|---|---|---|---|
| fallback.title | 降级横幅标题 | 这张图没法可靠地自动切 | This image can't be split reliably |
| fallback.body | 降级横幅正文 | 我们没有硬猜。已切到手动网格，你可以调行列或直接画框。 | We didn't guess. You're in manual grid mode—adjust rows and columns or draw frames. |
| fallback.bad_result | 用户发现结果不对 | 结果不对？切到手动模式 | Wrong result? Switch to manual mode |
| fallback.use_manual | 主按钮 | 使用手动网格 | Use manual grid |
| fallback.retry_auto | 次按钮 | 重试自动检测 | Retry auto detection |
| fallback.empty_input.title | 全透明检测降级 | 没找到可见像素，已切到手动模式 | No visible pixels found. Switched to manual mode |
| fallback.empty_input.body | 全透明检测降级 | 已放入一个待确认空帧。你可以保留、删除，或直接画新的帧框。 | We added one empty frame for review. Keep it, delete it, or draw new frames. |
| manual.title | 侧栏标题 | 手动网格 | Manual grid |
| manual.rows | 输入标签 | 行数 | Rows |
| manual.columns | 输入标签 | 列数 | Columns |
| manual.apply | 按钮 | 应用网格 | Apply grid |
| manual.reset | 按钮 | 重置网格 | Reset grid |
| manual.draw_hint | 辅助说明 | 也可以用“新增帧”直接画框。 | You can also draw a frame with Add frame. |
| manual.no_frames | 零帧状态 | 还没有帧。应用网格或画一个帧框。 | No frames yet. Apply a grid or draw a frame. |

## 8. 审校器：标题、工具栏与帧信息

| Key | 场景/组件 | 中文 | English |
|---|---|---|---|
| editor.title | 工作区标题 | 审校帧 | Review frames |
| editor.summary | 工作区摘要 | {count} 帧 | {count} frames |
| editor.selection_count | 多选计数 | 已选 {count} 帧 | {count} selected |
| editor.frame_index | 选中帧 | 第 {index} 帧，共 {count} 帧 | Frame {index} of {count} |
| editor.frame_size | 尺寸标注 | {width}×{height} px | {width}×{height} px |
| editor.normalized_preview | 规范化预览标签 | 导出预览 | Export preview |
| editor.normalized_preview_help | 规范化预览说明 | 显示裁紧后的内容在统一透明画布中的位置。 | Shows trimmed content on the shared transparent canvas. |
| tool.select | 工具 | 选择 | Select |
| tool.pan | 工具 | 平移 | Pan |
| tool.zoom_in | 工具 | 放大 | Zoom in |
| tool.zoom_out | 工具 | 缩小 | Zoom out |
| tool.fit | 工具 | 适合窗口 | Fit to view |
| tool.add_frame | 工具 | 新增帧 | Add frame |
| tool.delete_frame | 工具 | 删除帧 | Delete frame |
| tool.merge_frames | 工具 | 合并帧 | Merge frames |
| tool.split_frame | 工具 | 拆分帧 | Split frame |
| tool.undo | 工具 | 撤销 | Undo |
| tool.redo | 工具 | 重做 | Redo |
| tool.confirm_review | 审校主按钮 | 确认审校 | Confirm review |
| tool.export | 主按钮 | 导出 | Export |
| editor.select_to_merge | 合并不可用提示 | 至少选择两个帧才能合并。 | Select at least two frames to merge. |
| editor.select_one_to_split | 拆分不可用提示 | 选择一个帧后再拆分。 | Select one frame to split. |
| editor.split_hint | 拆分工具提示 | 在帧内点两下，画出切割线。 | Click two points inside the frame to draw a cut line. |
| editor.add_hint | 新增工具提示 | 拖动以画出新帧。 | Drag to draw a new frame. |
| editor.reorder_hint | 时间轴提示 | 拖动帧可调整导出顺序。 | Drag frames to change export order. |
| editor.frame_added | Toast | 已新增帧。 | Frame added. |
| editor.frames_merged | Toast | 已合并 {count} 个帧。 | Merged {count} frames. |
| editor.frame_split | Toast | 已拆分帧。 | Frame split. |
| editor.frame_deleted | Toast | 已删除帧。 | Frame deleted. |
| editor.order_updated | Toast | 帧顺序已更新。 | Frame order updated. |
| editor.nothing_to_undo | 禁用说明 | 没有可撤销的操作 | Nothing to undo |
| editor.nothing_to_redo | 禁用说明 | 没有可重做的操作 | Nothing to redo |
| review.attention.title | 待复核摘要 | 有 {count} 帧需要看一眼 | {count} frames need a look |
| review.attention.body | 待复核说明 | 这些标记只是提醒，不会自动删除或修改帧。 | These flags are just warnings. Frames won't be removed or changed automatically. |
| review.badge.outlier | 帧角标 | 尺寸异常 | Size outlier |
| review.badge.multiple_components | 帧角标 | 可能粘连 | Possible merge |
| review.badge.empty | 帧角标 | 空帧 | Empty frame |
| review.filter.label | 筛选组标签 | 筛选帧 | Filter frames |
| review.filter.all | 筛选项 | 全部帧 | All frames |
| review.filter.attention | 筛选项 | 全部待复核 | All flagged |
| review.filter.outlier | 筛选项 | 尺寸异常 | Size outliers |
| review.filter.multiple_components | 筛选项 | 可能粘连 | Possible merges |
| review.filter.empty | 筛选项 | 空帧 | Empty frames |
| review.filter.none | 筛选空状态 | 没有符合条件的帧。 | No frames match this filter. |
| review.pending | 确认前状态 | 还有 {count} 帧未确认。 | {count} frames still need confirmation. |
| review.confirmed | 确认后 Toast | 审校已确认，可以导出。 | Review confirmed. Ready to export. |

## 9. 检测参数侧栏

| Key | 场景/组件 | 中文 | English |
|---|---|---|---|
| settings.detection | 侧栏标题 | 检测设置 | Detection settings |
| settings.tolerance | 滑杆标签 | 容差 | Tolerance |
| settings.tolerance_help | 辅助说明 | 调高会把更多接近透明的像素算进主体。 | Higher values include more near-transparent pixels in the subject. |
| settings.min_area | 滑杆标签 | 最小面积 | Minimum area |
| settings.min_area_help | 辅助说明 | 小于这个值的区域会当作噪点忽略。 | Regions smaller than this are ignored as noise. |
| settings.dilation | 滑杆标签 | 膨胀半径 | Join radius |
| settings.dilation_help | 辅助说明 | 调高可把靠近的身体、帽子或武器并成一帧。 | Higher values join nearby body parts, hats, or weapons into one frame. |
| settings.merge_distance | 滑杆标签 | 合并距离 | Merge distance |
| settings.merge_distance_help | 辅助说明 | 距离小于这个值的区域会尝试合并。 | Regions closer than this may be merged. |
| settings.reset | 按钮 | 恢复默认值 | Reset defaults |
| settings.pending | 防抖状态 | 松开后重新检测 | Release to re-run detection |

## 10. 时间轴与动画预览

| Key | 场景/组件 | 中文 | English |
|---|---|---|---|
| preview.title | 区域标题 | 动画预览 | Animation preview |
| preview.play | 按钮 | 播放 | Play |
| preview.pause | 按钮 | 暂停 | Pause |
| preview.previous | 按钮 | 上一帧 | Previous frame |
| preview.next | 按钮 | 下一帧 | Next frame |
| preview.fps | 输入标签 | {fps} FPS | {fps} FPS |
| preview.onion_skin | 开关标签 | 洋葱皮 | Onion skin |
| preview.onion_on | 开关状态 | 已开启洋葱皮 | Onion skin on |
| preview.onion_off | 开关状态 | 已关闭洋葱皮 | Onion skin off |
| preview.empty | 零帧空状态 | 添加至少一帧后才能预览。 | Add at least one frame to preview. |

## 11. 删除、重置与离开确认

| Key | 场景/组件 | 中文 | English |
|---|---|---|---|
| confirm.delete_one.title | 删除单帧 | 删除这个帧？ | Delete this frame? |
| confirm.delete_many.title | 删除多帧 | 删除选中的 {count} 帧？ | Delete {count} selected frames? |
| confirm.delete.body | 删除说明 | 可以用“撤销”恢复。 | You can restore them with Undo. |
| confirm.delete.action | 危险按钮 | 删除 | Delete |
| confirm.reset_detection.title | 重跑检测 | 重新检测并替换当前帧？ | Replace current frames with a new detection? |
| confirm.reset_detection.body | 重跑检测 | 当前手动修改会被替换，但仍可撤销。 | Your manual edits will be replaced, but you can still undo. |
| confirm.reset_detection.action | 确认按钮 | 重新检测 | Run detection again |
| confirm.new_file.title | 更换文件 | 换一张图？ | Choose another image? |
| confirm.new_file.body | 更换文件 | 当前帧和编辑记录会被清空。 | Current frames and edit history will be cleared. |
| confirm.new_file.action | 确认按钮 | 换图 | Choose another image |

## 12. 导出面板与设置

| Key | 场景/组件 | 中文 | English |
|---|---|---|---|
| export.title | 面板标题 | 导出引擎素材 | Export engine assets |
| export.summary | 导出摘要 | 将导出 {count} 帧 | {count} frames will be exported |
| export.format | 字段标签 | 格式 | Format |
| export.phaser_hash | 格式选项 | Phaser 3 · JSON Hash | Phaser 3 · JSON Hash |
| export.phaser_array | 格式选项 | Phaser 3 · JSON Array | Phaser 3 · JSON Array |
| export.godot | 格式选项 | Godot 4 · 帧序列 + 构建脚本 | Godot 4 · Frames + build script |
| export.atlas_settings | 分组标题 | 图集设置 | Atlas settings |
| export.atlas_size | 字段标签 | 图集尺寸 | Atlas size |
| export.size_auto | 选项 | 自动 | Auto |
| export.size_pot_2048 | 选项 | 2048×2048（POT） | 2048×2048 (POT) |
| export.size_pot_4096 | 选项 | 4096×4096（POT） | 4096×4096 (POT) |
| export.size_pot_8192 | 选项 | 8192×8192（POT） | 8192×8192 (POT) |
| export.size_limit | 字段标签 | 最大尺寸 | Maximum size |
| export.rotation | 开关标签 | 允许旋转 90° | Allow 90° rotation |
| export.padding | 只读/设置标签 | 间距 | Padding |
| export.extrude | 只读/设置标签 | 出血边 | Extrude |
| export.start | 主按钮 | 生成并下载 | Build and download |
| export.back | 次按钮 | 返回编辑 | Back to editor |
| export.disabled_no_frames | 零帧禁用说明 | 至少添加一帧才能导出。 | Add at least one frame before exporting. |
| export.review_required.title | 尚未确认审校 | 先确认审校结果 | Confirm the review first |
| export.review_required.body | 尚未确认审校 | 检查待复核帧，然后点“确认审校”。 | Check the flagged frames, then select Confirm review. |
| export.review_required.action | 恢复按钮 | 返回审校 | Back to review |
| export.size_too_small | 尺寸冲突 | 这些帧放不进所选尺寸。请选择更大尺寸或自动。 | These frames don't fit the selected size. Choose a larger size or Auto. |

## 13. 导出过程、成功与失败

| Key | 场景/组件 | 中文 | English |
|---|---|---|---|
| export.preparing | 处理状态 | 正在准备帧… | Preparing frames… |
| export.packing | 处理状态 | 正在打包图集… | Packing atlas… |
| export.writing_phaser | 处理状态 | 正在生成 Phaser 文件… | Building Phaser files… |
| export.writing_godot | 处理状态 | 正在生成 Godot 文件… | Building Godot files… |
| export.zipping | 处理状态 | 正在创建 ZIP… | Creating ZIP… |
| export.progress | 进度可访问文本 | 导出已完成 {percent}% | Export {percent}% complete |
| export.cancel | 处理按钮 | 停止导出 | Stop export |
| export.success.title | 成功状态 | 导出完成 | Export ready |
| export.success.body | 成功状态 | `{name}` 已生成。 | `{name}` is ready. |
| export.download | 成功按钮 | 下载 ZIP | Download ZIP |
| export.again | 成功按钮 | 用其他格式再导出 | Export another format |
| export.continue_editing | 成功按钮 | 继续编辑 | Keep editing |
| export.failed.title | 通用导出失败 | 没能完成导出 | Couldn't finish the export |
| export.failed.body | 通用导出失败 | 你的编辑还在。重试，或返回编辑后调整设置。 | Your edits are still here. Retry, or go back and change the settings. |
| export.download_blocked.title | 浏览器阻止下载 | 浏览器拦住了下载 | Your browser blocked the download |
| export.download_blocked.body | 浏览器阻止下载 | 允许本站下载文件，然后再试一次。 | Allow downloads from this site, then try again. |
| export.invalid_frame.title | 帧越界/无效 | 有帧超出了图片范围 | A frame is outside the image |
| export.invalid_frame.body | 帧越界/无效 | 返回编辑并修正标出的帧。 | Go back and fix the highlighted frame. |

## 14. 通用处理异常与可访问状态

| Key | 场景/组件 | 中文 | English |
|---|---|---|---|
| error.worker.title | 后台任务异常 | 处理任务意外停止 | Processing stopped unexpectedly |
| error.worker.body | 后台任务异常 | 你的原图还在。可以重试，或降低尺寸后再试。 | Your source image is still here. Retry, or downscale it first. |
| error.unknown.title | 未分类异常 | 出了点问题 | Something went wrong |
| error.unknown.body | 未分类异常 | 没有改动你的原文件。请重试。 | Your original file wasn't changed. Try again. |
| status.busy | 通用 aria-live | 正在处理，请稍候。 | Processing. Please wait. |
| status.ready | 通用 aria-live | 可以继续。 | Ready. |
| status.saved_local | 结果提示 | 修改已保留在当前页面。 | Changes are kept in this page. |

## 15. 快捷键说明

快捷键的最终按键映射由 UI 规范确认；本表提供 M1 必需的界面名称与说明文案，不在文案层擅自定义与浏览器冲突的组合键。

| Key | 场景/组件 | 中文 | English |
|---|---|---|---|
| shortcuts.title | 面板标题 | 快捷键 | Keyboard shortcuts |
| shortcuts.select | 功能名 | 选择工具 | Select tool |
| shortcuts.pan | 功能名 | 临时平移画布 | Temporarily pan canvas |
| shortcuts.fit | 功能名 | 适合窗口 | Fit to view |
| shortcuts.add | 功能名 | 新增帧 | Add frame |
| shortcuts.delete | 功能名 | 删除选中帧 | Delete selected frames |
| shortcuts.merge | 功能名 | 合并选中帧 | Merge selected frames |
| shortcuts.split | 功能名 | 拆分选中帧 | Split selected frame |
| shortcuts.undo | 功能名 | 撤销 | Undo |
| shortcuts.redo | 功能名 | 重做 | Redo |
| shortcuts.play_pause | 功能名 | 播放/暂停预览 | Play/pause preview |
| shortcuts.close | 面板按钮 | 关闭快捷键 | Close shortcuts |

## 16. 状态覆盖核对

| 状态 | 文案覆盖位置 |
|---|---|
| 首次空状态 | 第 3 节 |
| 拖放悬停、文件预检、解码 | 第 3 节 |
| 不支持格式、多文件、不透明、损坏 | 第 4 节 |
| 超大图、处理前内存风险、运行时内存不足 | 第 5 节 |
| 检测各阶段、取消、成功、重算、异常 | 第 6 节 |
| 低置信度降级、全透明降级、手动网格、零帧 | 第 7 节 |
| 审校工具、规范化预览、待复核角标/筛选、确认审校、编辑反馈、撤销/重做空状态 | 第 8 节 |
| 检测参数与 300ms 重算等待状态 | 第 9 节 |
| 预览播放、洋葱皮、预览空状态 | 第 10 节 |
| 删除、重跑检测、更换文件确认 | 第 11 节 |
| 导出格式、设置、零帧禁用、未确认审校、尺寸冲突 | 第 12 节 |
| 导出各阶段、取消、成功、重试、下载拦截、无效帧 | 第 13 节 |
| 后台任务异常、未知错误、通用可访问状态 | 第 14 节 |
| 快捷键帮助 | 第 15 节 |

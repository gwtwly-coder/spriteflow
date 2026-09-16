# SpriteFlow M1 管线公共接口契约

> 生效基线：`1.0.0 / r2`（Gate 1 已通过，产品主已确认冻结）。
>
> 本文候选契约版本：`2.0.0`；协议版本：`1`；文档修订：`r3`；状态：**待产品主确认，尚未生效，不作为恢复实现的依据**。日期：2026-09-16。
> 包名：`@spriteflow/pipeline`。本文自包含，类型、默认值、坐标、错误、生命周期和导出格式均为规范性要求。代码块是接口声明或调用示例，不是功能实现。

本轮仅处理`SF-CONTRACT-001`与`SF-CONTRACT-002`。下文是拟生效的完整候选文本；修订依据、差异、回归矩阵及生效条件见第13节。确认前，生效基线为Git提交`2817208830f276469e5dad89daf05d30f6b1b23b`中的本文件（1.0.0/r2），其旧文件头的“尚未冻结”已被产品主后续Gate 1拍板覆盖；该提交保留首轮冻结全文以供追溯。候选文本不解除R4对这两项冲突的暂停状态，不授权同步修改实现、PRD、黄金标注或其他角色文档。

## 1. 产品范围与调用入口

SpriteFlow 是完全在浏览器处理本地素材的工具。M1 接受**静态、已有透明背景的 PNG / WebP**，执行网格/连通域检测、审校后的规范化、图集打包、Phaser 3 / Godot 4 / 通用导出。静态不透明图返回明确错误，不自动去底；全透明图在自动检测模式下返回可编辑的降级结果，显式manual-grid则执行用户给定网格而不降级。JPEG、BMP、GIF、APNG、动画 WebP、视频、输入 ZIP、模型、网络 URL 均不属于此输入协议。以文件签名和容器动画标记为准，不能仅凭扩展名接受 APNG 的第一帧。

公共入口分为：

- `@spriteflow/pipeline`：纯 TypeScript 类型与异步算法函数。只使用 ECMAScript / TypedArray，不访问 DOM、文件系统、网络、Worker 或 Canvas；Node 黄金测试调用此入口。
- `@spriteflow/pipeline/browser`：浏览器解码/PNG 编码适配器、Worker 服务与客户端封装。客户端负责 Comlink、传输、事件和异常映射；解码与像素运算在 Worker。
- `apps/web/src/workers/pipeline.worker.ts`：应用自己的 Worker 启动文件，只把 `createWorkerService()` 交给 `Comlink.expose()`；无算法。

调用顺序：`createPipelineClient → ready → load → detect → 审校 → normalize → pack（图集类）→ export → release → dispose`。序列 ZIP 与 Godot 导出跳过 pack。load 保存一个源资产；后续命令传资产引用，不反复传 RGBA。M1 每个 Worker 只保留一个源资产、一个规范化结果和一个打包结果，一次运行一个耗时任务。

无隐含上传、账号、云缓存、错误上报或后端调用。原文件由 UI 保留为 `File`，用于取消后重启或用户明确选择降采样后重新导入。

## 2. 基础类型与像素约定

下面各节的 `ts` 声明块按顺序组成公共类型声明；所有标识符均导出。没有注明可选的字段必须存在；无值用 `null`，数组用空数组，不用 `undefined`。函数输入的 options 整体可省略；传入时必须为完整对象，推荐从默认常量展开。未知字段、非有限数和不合法组合在边界验证时返回 `INVALID_ARGUMENT`。

```ts
export declare const CONTRACT_VERSION: "2.0.0";
export declare const PROTOCOL_VERSION: 1;
export type AssetId = string;
export type FrameId = string;
export type ClusterId = string;
export type TaskId = string;
export type ResultId = string;

export interface Size { width: number; height: number }
export interface Point { x: number; y: number }
export interface Rect extends Point, Size {}
export interface AssetRef { assetId: AssetId; revision: number }

export interface PixelBuffer extends Size {
  format: "rgba8";
  colorSpace: "srgb";
  alphaMode: "straight";
  data: Uint8ClampedArray;
}

export interface InputAsset {
  ref: AssetRef;
  name: string;
  sourceMime: "image/png" | "image/webp" | "application/x-rgba8";
  originalSize: Size;
  pixels: PixelBuffer;
  scaleFromOriginal: { x: number; y: number };
}

export interface AssetInfo {
  ref: AssetRef;
  name: string;
  sourceMime: InputAsset["sourceMime"];
  originalSize: Size;
  workingSize: Size;
  scaleFromOriginal: { x: number; y: number };
  alpha: { transparent: number; translucent: number; opaque: number };
}
```

坐标原点为左上，x 向右、y 向下，单位为**工作图像像素**；导入时若用户选择缩小，工作图像即缩小后的图，导出也使用该分辨率，绝不悄悄恢复原图。`scaleFromOriginal.x = workingWidth / originalWidth`，y 同理。originalSize 是 EXIF 方向已归一后的尺寸。画布缩放、设备 DPR、CSS 坐标不进入契约。

`Rect` 使用整数半开区间 `[x,x+width) × [y,y+height)`，width/height 至少 1，必须完整在源图内；两矩形仅碰边时不相交。UI 拖动完成时将左/上取 floor、右/下取 ceil，然后裁到源图；越界请求不能由管线偷偷修正。面积 = width×height，IoU 的并集为面积之和减交集。

RGBA 按行紧密排列，行跨度固定 width×4；`data.byteOffset === 0`，`data.byteLength === data.buffer.byteLength === width*height*4`，底层必须为普通 `ArrayBuffer`。不接受共享内存、视图切片、预乘 alpha、线性 RGB。透明像素 RGB 归零；浏览器色彩转换结果以 sRGB 为准，不承诺跨浏览器 ICC 舍入逐字节相等。纯算法不修改输入像素。数据只读是调用约定，不能靠 TypedArray 的 `readonly` 保证。

`AssetId` 由调用方生成，匹配 `[A-Za-z0-9_-]{1,64}`；revision 是从 1 开始的安全整数。相同 ref 必须代表相同像素。缩小、替换或修改源像素时递增 revision；Worker 禁止覆盖当前已加载 ref。frame/result/task ID 也遵循同样字符集；result/task ID 在客户端整个生命周期不复用。

## 3. 帧、审校与规范化

```ts
export interface PerceptualHash {
  algorithm: "dhash64-v1";
  hex: string;
}

export interface FrameFlags {
  outlier: boolean;
  merged: boolean;
  multipleComponents: boolean;
  empty: boolean;
  edited: boolean;
  duplicateOf: FrameId | null;
}

export interface FrameCanvas extends Size {
  offset: Point;
}

export interface Frame {
  id: FrameId;
  asset: AssetRef;
  name: string;
  sourceRect: Rect;
  bbox: Rect | null;
  canvas: FrameCanvas;
  pHash: PerceptualHash | null;
  clusterId: ClusterId | null;
  flags: FrameFlags;
  origin: "grid" | "components" | "manual";
  sourceFrameIds: FrameId[];
  included: boolean;
  reviewStatus: "pending" | "accepted";
}

export interface FrameDraft {
  id: FrameId;
  name: string;
  sourceRect: Rect;
  origin: Frame["origin"];
  sourceFrameIds: FrameId[];
  edited: boolean;
  included: boolean;
  reviewStatus: Frame["reviewStatus"];
}

export interface NormalizeOptions {
  alphaThreshold: number;
  componentMinAreaPx: number;
  trim: boolean;
  padding: number;
  canvasMode: "per-frame" | "uniform";
  alignment: "top-left" | "center";
  computeHash: boolean;
  outlierThreshold: number;
  clusterTolerance: number;
}

export interface NormalizeResult {
  asset: AssetRef;
  frames: Frame[];
  options: NormalizeOptions;
  warnings: PipelineWarning[];
}
export declare const DEFAULT_NORMALIZE_OPTIONS: Readonly<NormalizeOptions>;
```

`Frame.canvas` 是**逻辑输出画布描述**，不是 HTMLCanvasElement、OffscreenCanvas 或像素缓存。`sourceRect` 是可编辑的源图框；`bbox` 是 sourceRect 内 `alpha > alphaThreshold` 的紧内容框，完全无内容时为 null。`trim=false` 时非空帧 bbox 等于 sourceRect。alphaThreshold 仅用于检测/裁剪，实际保留区域的像素 alpha 不二值化，不羽化。

`canvas.offset` 是 bbox 左上在帧输出画布中的位置；bbox 为 null 时 offset=(0,0)，帧为全透明，hash=null，clusterId=null，outlier=false。帧画布不是原图坐标，不能当成裁图框。有效像素按 `(sourceX-bbox.x+offset.x, sourceY-bbox.y+offset.y)` 写入，比例始终 1:1。

规范化默认值与有效范围：

| 字段 | 默认 | 范围与含义 |
|---|---|---|
| alphaThreshold | 8 | 整数 0…254；前景严格 `alpha > threshold` |
| componentMinAreaPx | 4 | 整数 1…1,000,000；仅用于 multipleComponents 标记的原始组件面积下限，不删除像素 |
| trim | true | 内容紧框；false 保留整个 sourceRect |
| padding | 0 | 整数 0…64；帧画布内部透明留边 |
| canvasMode | uniform | uniform 对本次所有 included 帧统一宽高；per-frame 各自大小 |
| alignment | center | 居中用 floor 分配左/上余量，奇数多出的 1px 在右/下 |
| computeHash | true | 生成 hash 元数据；M1 不据此自动去重或折叠 |
| outlierThreshold | 0.4 | 有限数 0…1，严格超过才标记 |
| clusterTolerance | 0.3 | 有限数 0…1，用于尺寸簇 |

先对每个非空帧取 bbox，再取 `baseWidth = bbox.width+2*padding`、baseHeight 同理；空帧基准尺寸为 sourceRect 尺寸加两侧 padding。uniform 使用 included 帧最大基准宽高；excluded 帧仍返回自己的 per-frame 画布，以免删除帧影响剩余帧。top-left 的 offset=(padding,padding)，center 的 offset=(floor((canvas.width-bbox.width)/2), floor((canvas.height-bbox.height)/2))。M1 不做内容锚点/质心对齐、不缩放主体；这些属于后续里程碑。

尺寸聚类是检测后处理，不是第三种对外 strategy：按 bbox 面积升序、id 打破平局，依次分配给宽高相对当前簇中位数偏差均 ≤ clusterTolerance 的首个簇，否则新建簇；簇按首个成员索引编号。偶数中位数取中间两数平均。以全体 included 非空帧的宽、高、宽高比中位数为参考，任一相对偏差严格大于 outlierThreshold 即 outlier=true；不足 3 个有效帧不标离群。自动检测结果中这些标记只提示复核，不自动删除帧。

字段名 `pHash` 保留通用感知哈希容器，M1 算法明确为 **dHash 而非 DCT pHash**：对 bbox 内容在黑色背景上按 alpha 合成灰度 `floor((77R+150G+29B)*alpha/(256*255))`，以像素面积加权平均缩到 9×8，再逐行比较相邻灰度，左严格大于右则为 1；第一位为 64 位最高位，输出 16 位小写十六进制、前导零保留。尺寸不足时同样用面积覆盖重采样；不要使用浏览器 canvas 缩放得到 golden hash。duplicateOf 在 M1 固定 null，不做相似帧误删。

帧数组顺序即时间轴顺序；pack 不能改变它。自动结果初始顺序为 bbox/sourceRect 的 y、x、height、width 升序；网格则行优先。自动 id 为 `g_<row>_<col>` 或 `c_<sortedIndex>`，只保证**同一资产、同一参数、同一结果**可重现；重新检测不承诺跨参数稳定 ID，UI 必须原子替换整次结果，不能按旧 ID 套用编辑。初始 name 为 `frame_000` 起的三位补零顺序名，序号超过三位自然扩展；重排不自动重命名。

审校只编辑 FrameDraft，normalize 重新计算 bbox/canvas/hash/flags。移动/缩放保留 id，edited=true；新增使用 `m_<uuidWithoutHyphens>`；合并生成新 id、框取源框并集、sourceFrameIds 保存直接来源且至少 2 个；拆分使用两个新 id、各保存父 id，sourceRect 为用户确认的两个整数矩形，斜线交互最终也必须生成矩形（M1 无多边形 mask）。merged 等于 sourceFrameIds.length≥2。normalize 重新统计 sourceRect 原始 mask 中面积≥componentMinAreaPx的8连通域，两个以上则 multipleComponents=true，不相信前端传回衍生标记。自动CCL合并前的原始组件来源使用 `p_<scanIndex>`，其ID不要求仍在当前Frame数组中；未经合并的初始帧sourceFrameIds=[]。删除用 included=false 或移出草稿均可，导出不含被删除帧。

undo/redo 保存 FrameDraft[]、NormalizeOptions 和时间轴选项的小对象，不保存 RGBA/Worker 代理或任务状态。一次拖动在 pointerup 时提交一次历史。任何审校改动/撤销/重做都使已有 normalizationId、packId 失效，必须重新 normalize；不能直接修改 Frame 后绕过规范化导出。

## 4. 检测参数与结果

```ts
export interface GridOptions {
  gutterOccupancyThreshold: number;
  minGutterPx: number;
  minCellPx: number;
  periodTolerance: number;
  confidenceThreshold: number;
  keepEmptyCells: boolean;
}

export interface ManualGrid {
  rows: number;
  columns: number;
  region: Rect | null;
  keepEmptyCells: boolean;
}

export interface DetectOptions {
  mode: "auto" | "grid" | "components" | "manual-grid";
  quality: "preview" | "final";
  alphaThreshold: number;
  minAreaPx: number;
  minAreaRatio: number;
  dilationRadiusPx: number | null;
  mergeDistancePx: number | null;
  mergeDistanceRatio: number;
  connectivity: 8;
  analysisMaxDimension: number;
  componentConfidenceThreshold: number;
  maxFrames: number;
  grid: GridOptions;
  manualGrid: ManualGrid | null;
  normalize: NormalizeOptions;
}

export type DetectStrategy = "grid" | "components" | "manual-grid";
export enum DegradedReason {
  LowConfidence = "LOW_CONFIDENCE",
  EmptyInput = "EMPTY_INPUT",
  InsufficientComponents = "INSUFFICIENT_COMPONENTS",
  AmbiguousComponents = "AMBIGUOUS_COMPONENTS",
  FrameLimitExceeded = "FRAME_LIMIT_EXCEEDED",
}

export interface Degradation {
  reason: DegradedReason;
  attempted: ("grid" | "components")[];
  suggestedGrid: ManualGrid;
}

export interface DetectDiagnostics {
  gridConfidence: number;
  componentConfidence: number;
  componentCount: number;
  filteredComponentCount: number;
  foregroundPixels: number;
  effectiveMinAreaPx: number;
  effectiveDilationRadiusPx: number;
  effectiveMergeDistancePx: number;
}

export interface DetectResult {
  asset: AssetRef;
  quality: DetectOptions["quality"];
  frames: Frame[];
  strategy: DetectStrategy;
  confidence: number;
  degraded: Degradation | null;
  options: DetectOptions;
  diagnostics: DetectDiagnostics;
  warnings: PipelineWarning[];
}
export declare const DEFAULT_DETECT_OPTIONS: Readonly<DetectOptions>;
```

### 4.1 默认值与合法组合

| 参数 | 默认 | 有效范围/规则 |
|---|---|---|
| mode / quality | auto / final | preview 仅用于滑杆预览，不能作为导出结果 |
| alphaThreshold | 8 | 整数 0…254；必须与 normalize.alphaThreshold 相等 |
| minAreaPx | 4 | 整数 1…1,000,000 |
| minAreaRatio | 0.00001 | 有限数 0…0.1 |
| dilationRadiusPx | null | null 自动；显式整数 0…128，0 禁用 |
| mergeDistancePx | null | null 使用相对系数；显式整数 0…512，0 禁用 |
| mergeDistanceRatio | 0.15 | 有限数 0…1；显式 px 优先 |
| connectivity | 8 | 固定为 8，不支持悄悄切为 4 |
| analysisMaxDimension | 1024 | 整数 128…1024，最长边上限 |
| componentConfidenceThreshold | 0.75 | 有限数 0…1；通过条件 `>=` |
| maxFrames | 500 | 整数 1…2000；大于资源限制时取资源上限 |
| grid.gutterOccupancyThreshold | 0.005 | 有限数 0…0.2；前景计数/该行或列长度 ≤ 此值为空槽 |
| grid.minGutterPx | 2 | 整数 1…64，以工作图像像素计 |
| grid.minCellPx | 4 | 整数 1…1024 |
| grid.periodTolerance | 0.08 | 有限数 0…0.5 |
| grid.confidenceThreshold | 0.9 | 有限数 0…1；通过条件严格 `>` |
| grid.keepEmptyCells | false | 自动网格跳过空 cell；跳过后保持其余 cell 的行优先顺序 |
| manualGrid | null | mode=manual-grid 时必须提供；其他模式必须 null |
| normalize | DEFAULT_NORMALIZE_OPTIONS | 完整嵌套对象；默认常量应深冻结，调用方先复制再更改 |

ManualGrid.rows/columns 为 1…100 的整数，乘积不得超过 maxFrames；region=null 表示整张工作图。region 非空时需在图内；每个格子的整数宽高至少 1。用户手动模式通常 keepEmptyCells=true，但它是必填项，没有隐含值。对宽 W、高 H 的区域，各切点固定 `x_i = region.x + floor(i*W/columns)`、`y_j = region.y + floor(j*H/rows)`，最后一个边界刚好覆盖完整区域，不用反复累加浮点 cell 尺寸。

显式manual-grid的keepEmptyCells=true保留所有cell，包括空cell；false仅跳过其中原始mask没有前景像素的cell，其他cell维持行优先顺序。整图全透明时，true返回rows×columns个空帧，false成功返回frames=[]；两者都不触发检测降级、不补造1×1网格。空结果在后续pack/export按NO_FRAMES处理，detect本身不因此返回错误。用户提供的region与整数切点规则不因全透明而改变。

参数间的单位、优先级与检测规则：

1. 有效面积阈值 `max(minAreaPx, ceil(W*H*minAreaRatio))`，与**原始前景像素数**比较，不是膨胀后的面积或 bbox 面积。
2. 自动膨胀半径 `min(64, max(0, round(min(W,H)*0.01)))`。这是技术方案“短边 1%~2%”在 M1 的保守具体值；UI 必须可调到 0。膨胀用 Chebyshev 方形结构元，只改变连通分组，不改变导出像素。先分组/合并，再按合并组的原始前景总面积过滤，避免先删除断开的细小武器。
3. 近邻距离为 bbox 两个轴间隙的最大值，重叠/碰边时为 0。自动距离为 `round(median(min(componentWidth, componentHeight))*mergeDistanceRatio)`，median 基于膨胀分组后、面积过滤前的原始内容框；空集合取 0。严格 `gap < distance` 才合并；distance=0 不合并。对所有候选边做并查集合并，链式合并到固定点；结果 bbox 总以原始 mask 求紧框。
4. alpha threshold 边界固定为严格大于；面积刚好相等保留。final 的 CCL、细化、统计在工作原图做；缩略图只用于网格候选探测。不能把 1024 缩略图检测后简单放大冒充 final。
5. preview 允许在分析副本上近似 CCL；面积阈值乘缩放面积再向上取整，半径/距离乘最短轴缩放再四舍五入。返回 sourceRect/bbox 仍映射到工作图坐标（左上 floor、右下 ceil、裁到图内），但 hash=null，quality=preview。所有 options 和 diagnostics 的有效 px 值以工作图单位表达。

grid.minGutterPx按工作图单位判定连续空槽长度，grid.minCellPx按工作图单位限制候选格子每边的最小长度；分析副本中分别乘轴缩放比例、向上取整且至少1。网格候选中任一cell小于限制时整个候选无效。minAreaPx/minAreaRatio作用于自动策略，manual-grid仍生成用户指定格子。analysis副本采用确定性面积平均alpha，preview可省略RGB计算，不能依赖浏览器缩放差异决定golden结果。

diagnostics.foregroundPixels为工作图原始前景数；componentCount为膨胀/近邻合并完成且面积过滤前的组数，filteredComponentCount为面积过滤后的组数。未运行CCL时两者为0、componentConfidence=0；未运行grid时gridConfidence=0。effectiveMinAreaPx为解析后的工作图阈值；有效膨胀/合并距离在对应阶段未执行时为0。preview的计数按实际分析副本测量，再按面积缩放反算foregroundPixels并四舍五入，其余组件数量保持实际计数，属于近似诊断，不能用于final验收。

### 4.2 置信度、级联与降级

置信度是可复现的几何评分，不是“正确概率”。所有评分截断到 [0,1]；舍入仅用于显示，决策使用未舍入值。

**模式与全透明判定的固定优先级：**

1. 先执行既有输入/资源/参数校验，包括manualGrid合法组合、范围、格子尺寸及帧数上限；非法请求返回原有错误，不以全透明降级掩盖参数错误。M1不透明输入拒绝规则仍适用于所有模式。
2. mode=manual-grid时，执行合法的显式网格并立即返回该路径结果；不执行自动策略或EMPTY_INPUT提前降级。其confidence=1、degraded=null，无DETECTION_DEGRADED warning，所有保留帧仍需人工确认。
3. 仅mode∈{auto,grid,components}属于此处的自动检测模式。若整张工作图所有原始alpha均为0，直接返回下述EMPTY_INPUT特例，attempted=[]，不运行网格探测或CCL。该判定使用工作图原始alpha统计，不能因preview缩小丢失微小前景就将非全透明图判为EMPTY_INPUT。
4. 非全透明的自动检测输入才进入下面的级联。非零alpha全部低于检测阈值的输入不等同于PRD定义的“整图全透明”，继续按既有候选/置信度规则决定结果。

网格候选来自行/列透明槽与占用信号自相关周期；有多候选时依次按评分高、cell 总数少、行数少、列数少选取。每轴以正的相邻切点间距的中位数为周期；周期一致性为 `max(0, 1 - median(abs(gap-medianGap))/max(1,medianGap))`；只有一个 cell 的轴记 1。至少一个轴必须存在内部切点，否则 gridConfidence=0。`periodTolerance` 为相邻 gap 相对周期偏差的允许上限，超过它的 gap 不算有效周期匹配。每轴周期得分还要乘其有效 gap 比例。

设 R 为两轴周期得分平均，G 为所有内部切线像素的透明比例（alpha≤threshold；交点只计一次），O 为网格非空 cell 数/cell 总数，gridConfidence=`0.45R+0.35G+0.20O`。final 在原图验证切线和 cell 内容后重新算分。切割线坐标取槽中心 floor；首尾是图像边界。网格格内有两个以上面积≥normalize.componentMinAreaPx的原始连通域时 multipleComponents=true，保留一个 cell 帧交人工审校，不擅自拆分。自动网格非空cell原始前景总面积低于有效面积阈值时作为噪声丢弃；空cell是否保留按keepEmptyCells处理。显式手动网格不使用自动最小面积过滤。

CCL 有效帧数至少 2 时，令 S 为最大尺寸簇成员数/有效帧数，C 为保留组的原始前景像素数/原图前景总像素数，componentConfidence=`0.7S+0.3C`；前景数为零或帧数不足 2 时评分为 0。尺寸簇按第 3 节确定。

- auto：gridConfidence 严格大于 grid.confidenceThreshold 则选 grid；否则计算 CCL，帧数≥2 且 componentConfidence≥阈值选 components；否则显式降级。
- grid：通过上述全透明分流后只尝试网格，低于门槛降级，attempted=[grid]。
- components：通过上述全透明分流后只尝试CCL，低于门槛降级，attempted=[components]。
- manual-grid：优先完全按给定网格切，即使整图全透明也不进入自动降级；confidence=1、degraded=null。keepEmptyCells决定保留或跳过空格；此处1表示严格执行用户配置，不表示检测质量。

自动检测降级原因优先级（不适用于显式manual-grid）：整图全透明→EMPTY_INPUT；超过上限→FRAME_LIMIT_EXCEEDED；有效连通域少于2→INSUFFICIENT_COMPONENTS；已有至少2个但尺寸置信不足→AMBIGUOUS_COMPONENTS；仅网格未通过→LOW_CONFIDENCE。grid候选超过上限也不能静默截断；auto可继续尝试CCL，只有没有可用策略时才按上述优先级降级。

降级是成功返回DetectResult，strategy=manual-grid，confidence=0，degraded非null，warnings含恰好一条DETECTION_DEGRADED；这不排除按帧flags聚合的其他warning。建议网格按以下两个互斥分支产生：

- **EMPTY_INPUT特例：**suggestedGrid固定为`{rows:1, columns:1, region:null, keepEmptyCells:true}`，完全跳过下面的通用估算公式与宽高比推算。不论工作图为方图、横图、竖图或极端长宽比，返回整图恰好一个空帧：sourceRect={x:0,y:0,width:W,height:H}、bbox=null、flags.empty=true、included=true、reviewStatus=pending、origin=manual；degraded.reason=EMPTY_INPUT、degraded.attempted=[]。帧canvas继续按第3节由整图sourceRect与normalize选项生成，offset=(0,0)，pHash=null、clusterId=null。warnings按既有顺序为DETECTION_DEGRADED（reason=EMPTY_INPUT、frameIds=[]）与EMPTY_FRAMES（reason=null、frameIds=[该帧id]）。即使grid.keepEmptyCells=false，也必须保留这个降级默认帧。
- **其他降级：**仍使用原通用公式：建议帧数N取未超过上限的有效候选数，若无候选取1；columns=`ceil(sqrt(N*W/H))`、rows=`ceil(N/columns)`，随后把columns限于1…min(100,W,maxFrames)，rows限于1…min(100,H,floor(maxFrames/columns))。region=null、keepEmptyCells=true；该分支不要求N=1时一定只有一个格子。

**立即返回所选suggestedGrid实际生成的frames**，每帧reviewStatus=pending；不返回错误自动切出的候选作为最终帧。用户可新增/删除/确认降级帧，或用显式manual-grid重新应用自己指定的网格。DetectResult.options保持实际请求的options，不把原mode或manualGrid偷偷改成建议网格；建议网格只放在degraded.suggestedGrid。正常自动检测也为pending；导出前统一“确认审校”将included帧设为accepted。

所有自动/建议网格及显式手动网格的返回帧初始included=true。grid/manual-grid的sourceRect为完整cell，components的sourceRect为最终合并组的原始内容紧框；bbox再按normalize.trim计算。clusterId按第3节簇编号生成`cluster_<index>`，仅在本次结果内有意义。EMPTY_INPUT只在上述三个自动检测模式的全透明分流中触发、attempted=[]；其他降级attempted只列实际执行的策略，auto的顺序始终grid在components之前。显式manual-grid的degraded=null，没有degraded.attempted字段；保留空格时只有EMPTY_FRAMES等对应flags的warning，跳过全部空格时warnings=[]。WARNING列表按枚举声明顺序排列，同一code聚合为一条，frameIds按帧数组顺序；DETECTION_DEGRADED的reason为实际DegradedReason且frameIds=[]，其他warning的reason=null并列出对应flags为true的帧。没有对应异常帧时不生成空warning。

## 5. 打包协议

```ts
export interface PackOptions {
  maxWidth: number;
  maxHeight: number;
  sizeMode: "auto" | "pot";
  padding: number;
  extrude: number;
  border: number;
  allowRotation: boolean;
  maxPages: number;
  heuristic: "max-edge" | "max-area";
}

export interface PackedFrame {
  frameId: FrameId;
  name: string;
  pageIndex: number;
  allocation: Rect;
  rect: Rect;
  rotated: boolean;
  sourceSize: Size;
  spriteSourceSize: Rect;
  empty: boolean;
}

export interface AtlasPage extends Size {
  index: number;
  frameIds: FrameId[];
}

export interface PackResult {
  asset: AssetRef;
  options: PackOptions;
  pages: AtlasPage[];
  frames: PackedFrame[];
  frameOrder: FrameId[];
  warnings: PipelineWarning[];
}
export declare const DEFAULT_PACK_OPTIONS: Readonly<PackOptions>;
```

默认：maxWidth=maxHeight=2048、sizeMode=auto、padding=2、extrude=1、border=0、allowRotation=false、maxPages=1、heuristic=max-edge。

width/height 上限为 64…8192 的整数，且受资源限制；pot 时上限自身必须为二次幂，输出宽高分别向上取最近的二次幂，不要求正方形。padding 0…32、extrude 0…8、border 0…32，maxPages 1…16。heuristic仅有两值：max-edge映射maxrects-packer 2.7.3的`PACKING_LOGIC.MAX_EDGE`（1），max-area映射`PACKING_LOGIC.MAX_AREA`（0）。实现须使用具名枚举，不把任意数字强转成枚举；M1不提供fill-width，传入该字符串应返回INVALID_ARGUMENT，details.field="options.heuristic"。库默认值不作为本契约默认值。该结论以[2.7.3源码枚举及排序分支](https://github.com/soimy/maxrects-packer/blob/v2.7.3/src/maxrects-packer.ts)和[放置评分分支](https://github.com/soimy/maxrects-packer/blob/v2.7.3/src/maxrects-bin.ts)为准，不沿用README中未被该版本实现的第三选项。

pack 仅消费 included=true 且 reviewStatus=accepted 的规范化帧；未审校返回 REVIEW_REQUIRED，空数组返回 NO_FRAMES。每帧 name 必须唯一（ASCII 不区分大小写），匹配 `[A-Za-z0-9][A-Za-z0-9_-]{0,63}`，禁止 Windows 设备保留名（CON、PRN、AUX、NUL、COM1…9、LPT1…9），以及constructor、prototype、hasOwnProperty（均不区分大小写，避免JSONHash消费端对象属性冲突）。UI 改名后必须 normalize。重复名不静默加后缀。

默认图集只存 bbox 内容；sourceSize 为逻辑 canvas 宽高，spriteSourceSize=(canvas.offset.x,canvas.offset.y,bbox.width,bbox.height)。空帧以透明 1×1 占位，sourceSize 仍为原 canvas，spriteSourceSize=(0,0,1,1)，保留时间轴时长。

分配给 packer 的矩形为内容宽高各加 `2*extrude`，packer 间距为 padding、外边界为 border。`allocation` **含出血、不含间距**；rect 是其内实际内容区域，x/y 各加 extrude，rect 不含出血；相邻 allocation 的空隙至少 padding。extrude 复制最近边缘像素（包括 alpha），四角复制最近角像素，不新增半透明采样、不缩放。`rotated=true` 表示内容顺时针旋转 90° 存放，rect.width/height 交换，spriteSourceSize 与 sourceSize 保持未旋转方向；出血随旋转后像素生成。

确定性排序：max-edge按allocation最长边降序、面积降序、frameId字典序；max-area按allocation面积降序、最长边降序、frameId字典序。管线先排序，再按该顺序逐个调用packer.add，并把所选具名logic传给packer用于放置评分；不再调用会重新排序的addArray/repack。这样逐帧取消检查与平局顺序均可控。输出 frames 和 frameOrder 恢复审校时间轴顺序，pages 以首次创建顺序编号。相同版本和参数必须产生同一布局。超过单页可产生多页（maxPages>1），超过页数失败 PACK_OVERFLOW；任一 allocation 加双侧 border 超过最大页面且旋转也无法容纳时失败 FRAME_TOO_LARGE。不丢帧、不自动缩小、不偷偷生成额外页面。

## 6. 导出任务与文件格式

```ts
export enum ExportFormat {
  PhaserJsonHash = "phaser-json-hash",
  PhaserJsonArray = "phaser-json-array",
  GodotFramesZip = "godot-frames-zip",
  PngSequenceZip = "png-sequence-zip",
  GenericJson = "generic-json",
}

export interface AnimationSpec {
  name: string;
  frameIds: FrameId[];
  fps: number;
  loop: boolean;
}

export interface ExportTask {
  format: ExportFormat;
  baseName: string;
  animations: AnimationSpec[];
}

export interface OutputFile {
  path: string;
  mime: "image/png" | "application/json" | "text/plain";
  bytes: ArrayBuffer;
}

export interface FileManifestEntry {
  path: string;
  mime: OutputFile["mime"];
  byteLength: number;
}

export interface ExportResult {
  format: ExportFormat;
  fileName: string;
  mime: "application/zip";
  archive: ArrayBuffer;
  files: FileManifestEntry[];
  warnings: PipelineWarning[];
}

export interface ExportSource {
  asset: InputAsset;
  frames: Frame[];
  pack: PackResult | null;
}

export interface GenericAtlasDocument {
  schemaVersion: "spriteflow-atlas/1";
  generator: "SpriteFlow M1";
  coordinateSystem: "top-left-half-open-pixels";
  asset: AssetRef;
  pages: { index: number; file: string; size: Size }[];
  frames: {
    id: FrameId;
    name: string;
    pageIndex: number;
    rect: Rect;
    rotated: boolean;
    sourceSize: Size;
    spriteSourceSize: Rect;
    empty: boolean;
  }[];
  frameOrder: FrameId[];
  animations: AnimationSpec[];
}

export interface SequenceDocument {
  schemaVersion: "spriteflow-sequence/1";
  frames: { id: FrameId; name: string; file: string; size: Size }[];
  animations: AnimationSpec[];
}
```

所有五种格式的 API 返回均为一个 ZIP；generic-json 也包含配套图集 PNG。`files` 只有条目目录，不再次携带各文件 bytes，以免同时保留两份导出内存。OutputFile 是编码器/归档器之间的纯类型，不是第二条下载 API。纯函数 exportAssets 也返回 ExportResult。

baseName 使用与 frame.name 相同规则。动画名同样遵守此规则且 ASCII 不区分大小写唯一；fps 为有限数 1…120，frameIds 非空且每个都引用 included 帧，**允许重复 ID 表示重复播放**，一个帧可用于多动画。animations=[] 表示自动生成一个 name=default、fps=12、loop=true、按完整 frameOrder 播放的动画。有显式动画时，未被引用的 included 帧仍导出，动画仅控制播放列表。M1 每帧等时长，未提供逐帧 duration 字段。

图集格式要求 source.pack 非 null，且与 source.frames 的资产、顺序、name、canvas、bbox 完全一致；序列格式要求 pack=null。pure API 逐项验证几何一致性；Worker 使用不可变 result ID 更早检查。任何 mismatch 返回 STALE_RESULT，不允许旧图集搭配新审校帧。

### 6.1 Phaser JSONHash / JSONArray

产物固定 `<baseName>.png`、`<baseName>.json`、`animations.json`。M1 Phaser 目标兼容 3.90.0，单页；pages.length>1 返回 EXPORT_INCOMPATIBLE，UI 引导加大上限或改 generic-json，不能把 multipack JSON 冒充普通 atlas JSON。

JSONHash 顶层 `frames` 是以 Frame.name 为键的对象；JSONArray 顶层 `frames` 为时间轴顺序的数组，每条多一个 `filename: Frame.name`。共同字段：

```json
{
  "frames": {
    "frame_000": {
      "frame": { "x": 1, "y": 1, "w": 20, "h": 30 },
      "rotated": false,
      "trimmed": true,
      "spriteSourceSize": { "x": 6, "y": 2, "w": 20, "h": 30 },
      "sourceSize": { "w": 32, "h": 32 }
    }
  },
  "meta": {
    "app": "SpriteFlow",
    "version": "2.0.0",
    "image": "sprites.png",
    "format": "RGBA8888",
    "size": { "w": 64, "h": 64 },
    "scale": "1"
  }
}
```

示例 baseName=sprites；尺寸与实际页面一致时才合法。Phaser的`frame.x/y`映射PackedFrame.rect.x/y，**frame.w/h使用未旋转的内容宽高**：rotated=false时取rect.width/height；rotated=true时取rect.height/width。这是Phaser3.90解析器与Frame.updateUVsInverted的语义，不能直接把物理存储宽高抄入旋转帧。例如源内容30×10，顺时针存成rect={x:1,y:1,width:10,height:30}，Phaser字段应为frame={x:1,y:1,w:30,h:10},rotated=true；实际页面边界验证用x+h、y+w。通用JSON仍使用物理rect，两个格式不可共用未经转换的frame对象。

`trimmed` 当 offset≠0 或 sourceSize≠未旋转内容尺寸时为 true，否则 false。Phaser 描述不带源图 bbox、canvas 对象或 pHash，也不把 extrude 算入 frame。`animations.json` 固定 `{schemaVersion:"spriteflow-animations/1", animations:[{name, frames:[Frame.name...], fps, loop}]}`，使用帧名而非内部 ID；它是辅助文件，不伪称 Phaser Loader 的内建动画格式。消费者用 `this.load.atlas("sprites", "sprites.png", "sprites.json")`，两种 atlas JSON 均能加载。动画配置代码生成属于后续，不在 M1 内嵌 Phaser 运行时。

映射依据：[Phaser 3.90 JSONHash parser](https://github.com/phaserjs/phaser/blob/v3.90.0/src/textures/parsers/JSONHash.js)、[JSONArray parser](https://github.com/phaserjs/phaser/blob/v3.90.0/src/textures/parsers/JSONArray.js)、[Frame.updateUVsInverted](https://github.com/phaserjs/phaser/blob/v3.90.0/src/textures/Frame.js)。

### 6.2 通用图集

产物 `<baseName>.json` 和 `<baseName>-0.png` 起的页面 PNG；JSON 严格为 GenericAtlasDocument。frames 顺序等于 frameOrder，pages 文件名为相对路径。不嵌入二进制、不含本地绝对路径/用户名/创建时间。支持多页和旋转。

### 6.3 PNG 序列与 Godot

PNG 序列 ZIP 包含 `frames/<Frame.name>.png` 和 `sequence.json`；每张 PNG 是完整 Frame.canvas，bbox 按 offset 放入，保留透明边缘，**不使用 atlas rotation/padding/extrude**。JSON 严格为 SequenceDocument，frames 按审校顺序。仅编码 included 帧一次，动画重复引用通过 manifest 表达。

Godot ZIP 在同一结构上增加 `build_spriteframes.gd`、`README.txt`。最低验证目标 Godot **4.4.x**；支持 Godot 4 的 API，但后续小版本须冒烟验证。脚本为 `@tool extends EditorScript`，用户将整个解压目录放入项目 `res://` 内，等待 PNG 导入完成，在脚本编辑器打开该文件并执行 Run（Ctrl+Shift+X）。脚本以自身 `get_script().resource_path.get_base_dir()` 定位，读取相邻 sequence.json，按 animations 创建 SpriteFrames、设置 speed 和 loop，按 frameIds 加载对应 PNG Texture2D 并 `add_frame(..., 1.0)`，保存相邻 `<baseName>.tres`。先移除 SpriteFrames 自动提供的 default 再按 manifest 创建，避免重名。

脚本模板不插入用户提供的 GDScript 片段；名称通过 JSON 读取或正确转义的常量使用。路径只允许本 ZIP manifest 中的 frames/ 文件，不接受绝对路径或 `..`。读取/解析/加载失败与 ResourceSaver 返回非 OK 时终止并给编辑器错误信息，不生成半成品；已存在目标 .tres 时终止并提示用户移动/删除旧文件后再运行，**不静默覆盖**。README 必须含这一步骤、版本、输出位置和失败处理。M1 不直接拼写 .tres，也不在 Web 端执行 Godot。

脚本 API 依据：[SpriteFrames](https://docs.godotengine.org/en/4.4/classes/class_spriteframes.html)、[EditorScript](https://docs.godotengine.org/en/4.4/classes/class_editorscript.html)、[ResourceSaver](https://docs.godotengine.org/en/4.4/classes/class_resourcesaver.html)。

### 6.4 归档与确定性

PNG 为 RGBA8，无量化/有损压缩/WebP 编码。JSON UTF-8、无 BOM、2 空格缩进、末尾换行；文本文档 LF。ZIP 条目按路径字典序，mtime 固定 1980-01-01 00:00:00、无宿主权限/当前时间/绝对路径；PNG 用 store（level=0），JSON/文本 deflate level=6。文件名 `<baseName>-<format>.zip`。重复路径（ASCII case-fold 后）、路径穿越和未列入文件 manifest 的条目均为错误。

同一编码器/版本可做字节回归；跨浏览器原生 PNG 编码只保证解码后像素与 JSON 语义一致，ZIP 哈希不作为跨浏览器通用验收标准。构建 THIRD_PARTY_NOTICES 属于应用发布物，不注入用户素材 ZIP；生成的 Godot 模板由项目自行编写，不复制引擎实现。

## 7. 纯函数公共 API

```ts
export interface ResourceLimits {
  maxInputBytes: number;
  maxDimension: number;
  maxPixels: number;
  memoryBudgetBytes: number;
  maxFrames: number;
  maxArchiveBytes: number;
}

export interface PngCodec {
  encode(pixels: PixelBuffer, context: ExecutionContext): Promise<ArrayBuffer>;
}

export interface ExecutionContext {
  taskId: TaskId;
  limits: ResourceLimits;
  isCancelled(): boolean;
  yieldControl(): Promise<void>;
  onProgress(event: ProgressEvent): void;
}

export type Outcome<T> =
  | { ok: true; value: T }
  | { ok: false; error: PipelineError };

export declare const DESKTOP_LIMITS: Readonly<ResourceLimits>;
export declare const MOBILE_LIMITS: Readonly<ResourceLimits>;
export declare function createExecutionContext(
  taskId: TaskId, overrides?: Partial<ExecutionContext>
): ExecutionContext;
export declare function detect(
  asset: InputAsset, options?: DetectOptions, context?: ExecutionContext
): Promise<Outcome<DetectResult>>;
export declare function normalizeFrames(
  asset: InputAsset, drafts: FrameDraft[], options?: NormalizeOptions,
  context?: ExecutionContext
): Promise<Outcome<NormalizeResult>>;
export declare function packFrames(
  asset: AssetRef, frames: Frame[], options?: PackOptions,
  context?: ExecutionContext
): Promise<Outcome<PackResult>>;
export declare function exportAssets(
  source: ExportSource, task: ExportTask, codec: PngCodec,
  context?: ExecutionContext
): Promise<Outcome<ExportResult>>;
```

缺省 context 由 createExecutionContext 生成本次唯一 taskId、DESKTOP_LIMITS、无取消、无监听、基于普通计时器的宏任务 yield。context 回调不能跨 Worker 传递；浏览器封装在 Worker 内自行创建 context。函数不依赖 this，不缓存调用者数组；输入对象不会被修改。预期错误都通过 Outcome 返回；同步输入异常、codec 抛错也必须捕获归类；不把普通 Error 当可序列化公共 API。客户端应用自行抛错不由管线负责。

Node 消费者提供自己的 PngCodec（测试使用 pngjs）；浏览器实现使用 OffscreenCanvas.convertToBlob，二者没有共享 DOM 类型。`ImageData` 调用方可以用 `{format:"rgba8", colorSpace:"srgb", alphaMode:"straight", width, height, data: imageData.data}` 适配 PixelBuffer，必要时复制为满足紧密缓冲约定的数组；核心不要求全局存在 ImageData。

资源默认：desktop maxInputBytes=52,428,800（50 MiB）、maxDimension=8192、maxPixels=67,108,864、memoryBudgetBytes=1,073,741,824（1 GiB）、maxFrames=2000、maxArchiveBytes=268,435,456（256 MiB）。mobile 对应 20 MiB、4096、16,777,216、256 MiB、500、64 MiB。设备类别由 UI 明确选择并在 init 传入，不依赖 UA 推断无限可用内存；调用方可以降低限制，Worker 不接受超过 desktop 上界的值。

预算是保守预估上界策略，不等于浏览器实际可用内存承诺。分配之前预估并在失败时映射 MEMORY_LIMIT；不捕获不住 OOM 还声称能恢复。detect 预估至少 `16*W*H + 16 MiB`，load 原生解码预估至少 `12*W*H + encodedBytes + 16 MiB`；pack/export 需计入源 RGBA、输出页面/帧暂存、编码缓冲、ZIP 与一个 1024 预览，取与实际分配模型更大的上界。8K 视口支持不等于 8K 自动 CCL 在默认预算内必定成功。超限时返回建议缩小尺寸，但只有用户同意后新 load 才执行，不能自动降画质。

## 8. 错误与 UI 呈现

```ts
export enum PipelineErrorCode {
  InvalidArgument = "INVALID_ARGUMENT",
  UnsupportedFormat = "UNSUPPORTED_FORMAT",
  AnimatedInputUnsupported = "ANIMATED_INPUT_UNSUPPORTED",
  DecodeFailed = "DECODE_FAILED",
  OpaqueInput = "OPAQUE_INPUT",
  MemoryLimit = "MEMORY_LIMIT",
  DimensionLimit = "DIMENSION_LIMIT",
  AssetNotFound = "ASSET_NOT_FOUND",
  StaleResult = "STALE_RESULT",
  ReviewRequired = "REVIEW_REQUIRED",
  NoFrames = "NO_FRAMES",
  FrameTooLarge = "FRAME_TOO_LARGE",
  PackOverflow = "PACK_OVERFLOW",
  ExportIncompatible = "EXPORT_INCOMPATIBLE",
  EncodeFailed = "ENCODE_FAILED",
  ArchiveLimit = "ARCHIVE_LIMIT",
  Cancelled = "CANCELLED",
  Busy = "BUSY",
  WorkerUnavailable = "WORKER_UNAVAILABLE",
  WorkerCrashed = "WORKER_CRASHED",
  ProtocolMismatch = "PROTOCOL_MISMATCH",
  InternalError = "INTERNAL_ERROR",
}

export enum PipelineWarningCode {
  DetectionDegraded = "DETECTION_DEGRADED",
  OutlierFrames = "OUTLIER_FRAMES",
  MultipleComponents = "MULTIPLE_COMPONENTS",
  EmptyFrames = "EMPTY_FRAMES",
}

export type RecoveryAction =
  | "fix-options" | "choose-file" | "downsample" | "manual-edit"
  | "review" | "repack" | "change-format" | "retry" | "restart-worker"
  | "release-asset";

export interface PipelineError {
  code: PipelineErrorCode;
  messageKey: string;
  stage: ProgressStage;
  recoverable: boolean;
  recoveryActions: RecoveryAction[];
  details: {
    field?: string;
    limit?: number;
    actual?: number;
    estimatedBytes?: number;
    suggestedSize?: Size;
    frameIds?: FrameId[];
  };
}

export interface PipelineWarning {
  code: PipelineWarningCode;
  messageKey: string;
  frameIds: FrameId[];
  reason: DegradedReason | null;
}
```

messageKey 固定为 `pipeline.error.<code>` 或 `pipeline.warning.<code>`，code 使用枚举原值（大写）；details 是 i18n 插值，不含用户图片、完整路径、堆栈、网络内容或未转义 HTML。UI 不展示库的英文 Error.message，也不用字符串匹配推断错误。recoverable 表示按 recoveryActions 可以继续当前用户工作，不代表内部自动重试。

| code / warning | UI 表现与恢复约定 |
|---|---|
| INVALID_ARGUMENT | 对应参数内联错误；fix-options；保留原结果 |
| UNSUPPORTED_FORMAT / ANIMATED_INPUT_UNSUPPORTED | 上传区域提示 M1 支持的静态透明格式；choose-file |
| DECODE_FAILED | 上传错误；choose-file/retry；UI保留原File和已保存草稿，不提交解码半成品 |
| OPAQUE_INPUT | 提示先在外部去底；choose-file；M1 不出现抠图按钮 |
| DIMENSION_LIMIT / MEMORY_LIMIT | 显示 actual/limit 或 estimatedBytes，提供 suggestedSize；downsample/choose-file；必须等待用户选择 |
| ASSET_NOT_FOUND / WORKER_CRASHED | 保留 UI 草稿与原 File；restart-worker，重导入后再 normalize |
| STALE_RESULT | 废弃旧结果、重新规范化/打包；retry；不能下载 |
| REVIEW_REQUIRED | 定位尚未确认的 included 帧；review |
| NO_FRAMES | 空时间轴提示；manual-edit |
| FRAME_TOO_LARGE / PACK_OVERFLOW | 标出帧或页数限制；repack；不自动缩小 |
| EXPORT_INCOMPATIBLE | 显示格式限制；change-format/repack |
| ENCODE_FAILED / ARCHIVE_LIMIT | 导出面板错误；retry/repack；不触发空文件下载 |
| CANCELLED | 普通“已取消”状态，无错误 toast；无 recoveryActions |
| BUSY，details.field="task" | 有任务运行；等待其终态，或取消后等终态再重试；recoveryActions=["retry"]；不释放仍在处理的资产 |
| BUSY，details.field="asset" | Worker空闲但仍持有旧资产；释放客户端当前AssetRef后重试load；recoveryActions=["release-asset","retry"]。单纯等待或取消已结束任务无效 |
| WORKER_UNAVAILABLE / PROTOCOL_MISMATCH | 能力/版本阻断页；无主线程计算回退；restart-worker（版本错须刷新应用） |
| INTERNAL_ERROR | 错误面板，保留草稿；restart-worker；内部诊断仅在本地开发日志 |
| DETECTION_DEGRADED | 持续黄色提示、展示手动网格控件，允许编辑/确认后导出；非失败弹窗 |
| OUTLIER_FRAMES | 按当前PRD F-18显示“尺寸异常”角标与筛选；这是M1明确暴露的尺寸复核提示，不显示hash、不自动排除或修复帧 |
| MULTIPLE_COMPONENTS / EMPTY_FRAMES | 显示“可能粘连”/“空帧”角标与筛选；不自动拆分或删除；用户审校确认后可导出 |

本轮离群UI采用验收问题2的方案（b），依据当前PRD的F-18/AC-F18及已补齐的双语review词条；不采用“仅传数据但UI隐藏”的方案（a）。消费者即使只拿到本文，也须遵守以下显示规则：同一帧可同时有三个角标；支持全部、全部待复核、尺寸异常、可能粘连、空帧筛选；全部待复核指三个flags的逻辑或，与reviewStatus独立。筛选只影响列表显示，不修改included/顺序/导出数据；无匹配时显示筛选空状态。确认只将reviewStatus置为accepted，保留flags与角标，不清除筛选或自动修复。尚未确认时按REVIEW_REQUIRED回到审校，确认后可导出。dHash元数据与duplicateOf继续仅作数据通道，M1无hash数值展示或重复帧折叠。词条由前端适配到`review.badge.*`、`review.filter.*`、`review.pending`、`review.confirmed`和`export.review_required.*`。

除 CANCELLED（recoverable=true，动作空）及能力/协议不匹配（recoverable=false）外，上表错误 recoverable=true；INTERNAL_ERROR 可重启但不保证同一坏输入能成功。阶段为出错时实际阶段，传输/初始化问题为 validate。DETECTION_DEGRADED 属 warning，禁止同时抛出“低置信度异常”导致前端丢失手动候选。

输入alpha统计以原始像素计：完全透明alpha=0、半透明1…254、完全不透明255。opaque/总像素**严格大于0.99**返回OPAQUE_INPUT；等于0.99允许。对已解码纯函数输入也做相同校验，不能绕过；纯手动裁图模式亦遵守M1透明输入边界。整图全透明不走OPAQUE_INPUT：detect在auto/grid/components模式按第4.2节固定返回EMPTY_INPUT的1×1建议网格；显式manual-grid优先执行用户配置，不降级。load只完成加载与alpha统计，不产生DetectResult或代替用户执行模式选择。

## 9. Worker 消息、进度、取消和内存所有权

### 9.1 公共消息类型

```ts
export enum ProgressStage {
  Validate = "validate",
  Decode = "decode",
  Analyze = "analyze",
  Grid = "grid",
  Components = "components",
  Normalize = "normalize",
  Hash = "hash",
  Pack = "pack",
  Render = "render",
  Encode = "encode",
  Archive = "archive",
  Complete = "complete",
}

export interface ProgressEvent {
  protocolVersion: 1;
  type: "progress";
  taskId: TaskId;
  asset: AssetRef | null;
  stage: ProgressStage;
  stageProgress: number;
  overallProgress: number;
  completedUnits: number;
  totalUnits: number | null;
  cancellable: boolean;
}

export interface InitOptions {
  protocolVersion: 1;
  limits: ResourceLimits;
}

export interface WorkerCapabilities {
  protocolVersion: 1;
  contractVersion: "2.0.0";
  decode: ("image/png" | "image/webp")[];
  encode: ["image/png"];
  offscreenCanvas: true;
  limits: ResourceLimits;
}

export type LoadInput =
  | {
      kind: "encoded";
      ref: AssetRef;
      name: string;
      mimeHint: string;
      bytes: ArrayBuffer;
      resizeTo: Size | null;
    }
  | { kind: "rgba"; asset: InputAsset };

export interface LoadResult {
  asset: AssetInfo;
  preview: PixelBuffer;
}

export interface PreviewRequest {
  asset: AssetRef;
  sourceRect: Rect | null;
  maxDimension: number;
}

export interface NormalizeRequest {
  asset: AssetRef;
  drafts: FrameDraft[];
  options: NormalizeOptions;
}

export interface StoredNormalizeResult extends NormalizeResult {
  normalizationId: ResultId;
}
export interface StoredPackResult extends PackResult {
  normalizationId: ResultId;
  packId: ResultId;
}

export interface CommandPayloads {
  load: LoadInput;
  detect: { asset: AssetRef; options: DetectOptions };
  preview: PreviewRequest;
  normalize: NormalizeRequest;
  pack: { asset: AssetRef; normalizationId: ResultId; options: PackOptions };
  export: {
    asset: AssetRef;
    normalizationId: ResultId;
    packId: ResultId | null;
    task: ExportTask;
  };
  release: { asset: AssetRef };
}

export interface CommandResults {
  load: LoadResult;
  detect: DetectResult;
  preview: PixelBuffer;
  normalize: StoredNormalizeResult;
  pack: StoredPackResult;
  export: ExportResult;
  release: { released: boolean };
}

export type Command = keyof CommandPayloads;
export type TaskRequest<K extends Command = Command> = {
  [P in K]: {
    protocolVersion: 1;
    taskId: TaskId;
    command: P;
    payload: CommandPayloads[P];
  }
}[K];

export type TaskResponse<K extends Command = Command> = {
  [P in K]: {
    protocolVersion: 1;
    taskId: TaskId;
    command: P;
    outcome: Outcome<CommandResults[P]>;
  }
}[K];

export interface CancelResult {
  taskId: TaskId;
  status: "requested" | "already-finished" | "unknown";
}

export interface PipelineWorkerApi {
  init(options: InitOptions): Promise<Outcome<WorkerCapabilities>>;
  execute<K extends Command>(
    request: TaskRequest<K>, onProgress: (event: ProgressEvent) => void
  ): Promise<TaskResponse<K>>;
  cancel(taskId: TaskId): Promise<CancelResult>;
  dispose(): Promise<void>;
}

export interface PendingTask<K extends Command> {
  taskId: TaskId;
  result: Promise<TaskResponse<K>>;
  cancel(): Promise<CancelResult>;
}

export interface PipelineClient {
  ready: Promise<Outcome<WorkerCapabilities>>;
  submit<K extends Command>(
    command: K, payload: CommandPayloads[K],
    onProgress?: (event: ProgressEvent) => void
  ): PendingTask<K>;
  dispose(): Promise<void>;
}
```

以下声明仅从 `/browser` 导出（共享类型仍从根入口导出）；`Worker` 只在此入口引用浏览器类型：

```ts
export declare function createPipelineClient(
  worker: Worker, options?: InitOptions
): PipelineClient;
export declare function createWorkerService(): PipelineWorkerApi;
```

Comlink 是唯一 RPC 传输；`TaskRequest/TaskResponse` 是其 execute 的应用层负载，不另外创建一个同名 postMessage 分发器。init 必须先完成，重复同配置 init 幂等，不同配置返回 INVALID_ARGUMENT。版本不一致返回 PROTOCOL_MISMATCH，不能忽略新字段后继续。客户端 ready 未成功前 submit 返回相应失败响应，不开始任务。默认 InitOptions 为协议 1 + DESKTOP_LIMITS。

### 9.2 任务与结果生命周期

客户端同步生成 taskId；submit 立即返回 PendingTask，以便结果未到就可取消。UI 不自行生成 RPC request ID。响应原样带 taskId/command/protocolVersion；客户端据此校验对应关系。每个任务有且只有一个终态响应，业务错误仍 resolve；Worker error/messageerror/被终止等由客户端转换为 WORKER_CRASHED 并结算所有 pending Promise，不能永久悬挂。

忙碌时除 cancel/dispose 外的新 execute 返回 BUSY，details.field="task"、recoveryActions=["retry"]；不建立隐式无限队列。正在运行的任务检查优先于“旧资产仍加载”检查。UI 每类交互仅保留最后一个待执行意图：300ms 防抖→取消在跑任务→等待其终态→提交最新 preview→停手后 final。取消与新请求不能同时假定 Worker 空闲。即便旧响应晚到，UI 只接受当前 taskId、asset ref 和本地 editRevision 均匹配的结果；editRevision 是 UI 自己的递增计数，不作为资产 revision。

load 前需 release 旧资产；Worker空闲但仍有旧资产时，新load返回BUSY，stage=validate、recoverable=true、details.field="asset"、recoveryActions=["release-asset","retry"]。UI先完成既有“更换文件”确认，再以当前已加载AssetRef调用release，等待成功后重试load；不得使用被拒绝新文件的AssetRef去释放旧资产，也不得自动释放用户仍要保留的素材。新load的encoded bytes可能已经transfer，应从保留的File重新取得ArrayBuffer；rgba调用者须重新提供有效缓冲，不能复用detached视图。load 失败不提交新缓存；release 未找到资产返回 released=false，正常释放返回 true。load 成功返回最大边≤1024 的独立预览 RGBA；完整工作像素保留 Worker。preview 可取 sourceRect 子区域、maxDimension 整数 1…1024，null 表示全图，返回独立像素；用于大图视口可见区域精细显示，UI 以有限 LRU 缓存，不把全尺寸图多次复制进主线程。

encoded load 先从容器头部读原尺寸、动画标记并校验预算，再解码；mimeHint仅辅助错误文案，实际格式按签名决定。resizeTo=null保持原分辨率；非null必须是正整数、不上采样、保持宽高比（各边与等比缩放取整的误差≤1px），并满足limits。resizeTo只代表用户授权的工作尺寸，不代表浏览器解码器一定免除原尺寸临时分配；若无法在预算内安全缩小，仍返回MEMORY_LIMIT，建议用户先在外部缩小。原生缩小可用高质量采样，之后重新统计alpha，不把缩小图用于恢复原尺寸导出。rgba输入不提供隐式resize，必须由调用方准备符合尺寸/比例关系的InputAsset。

preview输出保持裁取区域的宽高比，scale=min(1,maxDimension/max(crop.width,crop.height))，各边取max(1,floor(original*scale))；不自动放大小图。load.preview按同一规则用maxDimension=1024。所有像素缓冲仍满足第2节紧密排列约定。normalize的draft数量与pack/export的总帧数不得超过limits.maxFrames；超出返回INVALID_ARGUMENT并在details给出field/actual/limit。

normalize 成功生成 normalizationId，原子替换旧规范化缓存并清除所有 packId；失败或取消保留旧缓存。pack 成功生成 packId 并替换旧打包缓存；失败/取消保留旧缓存。detect 是无副作用候选检测，不自动成为可导出规范化结果，也不替 UI 接受草稿。release/dispose 清除所有缓存/预览/结果并关闭 ImageBitmap。所有结果只绑定一个 AssetRef，不允许跨资产引用。

### 9.3 Transfer 所有权

| 数据 | 传送方式 | 发送后谁可使用 |
|---|---|---|
| load.encoded.bytes | 客户端 `Comlink.transfer(request, [bytes])` | Worker 拥有；UI 原 ArrayBuffer 被 detach，不能重试复用；原 File 可重新 arrayBuffer() |
| load.rgba.asset.pixels.data.buffer | 同样 transfer 唯一底层 ArrayBuffer | Worker 拥有；UI 所有引用该 buffer 的视图均失效 |
| load/preview 返回预览 | Worker 对整个 TaskResponse transfer，列出独立预览 buffer | 主线程拥有；Worker 不保存该预览视图 |
| Frame / DetectResult / PackResult / 参数 | structured clone | 双方独立小对象；不含像素/函数/类实例 |
| ExportResult.archive | Worker transfer 完整 TaskResponse 的 archive | 主线程拥有；Worker 立即放弃 ZIP 引用 |
| onProgress | 客户端 `Comlink.proxy(callback)` | Worker持有该回调的远程代理；Worker在任务finally调用其releaseProxy，客户端清掉本地任务监听引用 |

原图 RGBA 永不为了预览或导出结果而 transfer 出 Worker，否则后续任务会拿到 detached buffer。结果 buffer 不得是缓存 buffer 的 subarray。客户端在 transfer 前完成所有结构校验；submit 调用后即视为放弃传入 buffer 使用权，即使 BUSY 或后续失败也不承诺返还。需要重试的 UI 应保留 File，不为“保险”保留第二份 full RGBA。无 SharedArrayBuffer、无跨源隔离头要求。

### 9.4 真实进度与取消

stageProgress、overallProgress 都是有限数 [0,1]，后者在一个 task 内单调不减；进度事件按 taskId 隔离，只有成功终态允许 overallProgress=1、stage=complete、cancellable=false。取消/错误没有伪造 complete。completedUnits 为非负整数；totalUnits 为已知正整数或 null，已知时 completed≤total。未知总量阶段 stageProgress 在启动/完成时从 0 跳到 1，期间保持原值，不做定时器假进度。decode/原生 PNG encode 无细粒度计数时 totalUnits=null，UI 显示该阶段不定进度。

每类任务阶段权重固定，总和 1：

| 任务 | 阶段权重 |
|---|---|
| load | validate .10、decode .75、analyze .15 |
| detect | validate .05、analyze .10、grid .15、components .45、normalize .15、hash .10 |
| normalize | validate .05、normalize .75、hash .20 |
| pack | validate .10、pack .90 |
| preview | validate .10、render .90 |
| export | validate .05、render .30、encode .45、archive .20 |
| release | validate 1.00 |

overallProgress=已完成阶段权重之和+当前阶段权重×stageProgress。未执行的 grid/components/hash 阶段在决定跳过时一次性标完成，不能消耗假等待时间。像素扫描以处理行数、CCL 第二遍以行数、规范化/编码以帧或页面数、pack 以已插入矩形数计数。每 50ms 最多发一条普通进度，阶段切换与终态不节流；避免 4K 每像素/每行一次 RPC。

cancel 是独立 Comlink 调用，设置 Worker 内任务 token；不能把 AbortSignal 当 transferable。像素长循环每≤16ms或每≤64行检查 token 并执行一次**宏任务 yield**（`await Promise.resolve()` 不能让 cancel 消息进入）。packer 按矩形分批并检查；单次原生 decode/encode 不可中断时仍接受 cancel，操作完成后丢弃输出，绝不发成功结果。Archive 使用可分块执行的 fflate 流式路径，不阻塞一个不可抢占的大 zipSync。

请求成功返回 requested 仅表示取消已登记，必须等 task.result 得到 CANCELLED 才能提交下一任务。任务成功先于 cancel 线性化时返回 already-finished，不能把已完成下载追溯改成取消；未知 ID 返回 unknown。终态 ID 记录最近 128 条，其余视为 unknown。取消后每个中间数组/bitmap/编码器尽快释放，不能损坏已提交缓存。

若 cancel 后 2000ms 尚无终态，客户端终止 Worker：目标任务结算 CANCELLED，其余任务结算 WORKER_CRASHED；所有资产/结果 ID 失效，UI 保留 File/草稿并提示重建 Worker。Worker error/messageerror 与 dispose 同样必须结算 Promise。dispose 幂等，最多等待 2000ms 后 terminate；此后 submit 返回 WORKER_UNAVAILABLE。onProgress 回调错误由客户端捕获，不能使计算失败。

浏览器能力门槛：模块 Worker、createImageBitmap、OffscreenCanvas 2D/getImageData/convertToBlob、PNG 编码、ArrayBuffer transfer。init 使用内存内小 PNG 做能力探测，不网络请求。缺少任一必须能力返回 WORKER_UNAVAILABLE；不把长循环搬回主线程。WebP 解码不支持时 capabilities.decode 只含 PNG，选择 WebP 返回 UNSUPPORTED_FORMAT。

## 10. 最小完整调用示例

以下是前端接线示例，假定 `file` 为用户选中的静态透明 PNG。UI 应按第 8 节呈现失败；示例的 throw 只用于精简消费端控制流，管线本身返回 Outcome。

Worker启动文件只需从comlink导入expose，从`@spriteflow/pipeline/browser`导入createWorkerService，并执行`expose(createWorkerService())`；client内部负责wrap/proxy/transfer，应用不重复包装。示例使用sprites文件名；产品默认导出名称采用atlas，与Phaser上传/验收文案保持一致。

```ts usage
import {
  DEFAULT_DETECT_OPTIONS,
  DEFAULT_NORMALIZE_OPTIONS,
  DEFAULT_PACK_OPTIONS,
  DESKTOP_LIMITS,
  ExportFormat,
  type FrameDraft,
} from "@spriteflow/pipeline";
import { createPipelineClient } from "@spriteflow/pipeline/browser";

const worker = new Worker(
  new URL("./workers/pipeline.worker.ts", import.meta.url),
  { type: "module" },
);
const client = createPipelineClient(worker, {
  protocolVersion: 1,
  limits: { ...DESKTOP_LIMITS },
});
const ready = await client.ready;
if (!ready.ok) throw ready.error;

const asset = { assetId: crypto.randomUUID(), revision: 1 };
const load = client.submit("load", {
  kind: "encoded",
  ref: asset,
  name: file.name,
  mimeHint: file.type,
  bytes: await file.arrayBuffer(),
  resizeTo: null,
});
const loaded = await load.result;
if (!loaded.outcome.ok) throw loaded.outcome.error;

const detection = client.submit("detect", {
  asset,
  options: structuredClone(DEFAULT_DETECT_OPTIONS),
}, (event) => { console.log(event.stage, event.overallProgress); });
// Bind a cancel button to: void detection.cancel().
const detected = await detection.result;
if (!detected.outcome.ok) throw detected.outcome.error;
const drafts: FrameDraft[] = detected.outcome.value.frames.map((frame) => ({
  id: frame.id,
  name: frame.name,
  sourceRect: frame.sourceRect,
  origin: frame.origin,
  sourceFrameIds: frame.sourceFrameIds,
  edited: frame.flags.edited,
  included: frame.included,
  reviewStatus: frame.reviewStatus,
}));

// Render drafts for user editing. Continue only after explicit review acceptance.
const accepted = drafts.map((draft) => ({
  ...draft, reviewStatus: "accepted" as const,
}));
const normalized = await client.submit("normalize", {
  asset,
  drafts: accepted,
  options: { ...DEFAULT_NORMALIZE_OPTIONS },
}).result;
if (!normalized.outcome.ok) throw normalized.outcome.error;
const normalizationId = normalized.outcome.value.normalizationId;

const packed = await client.submit("pack", {
  asset, normalizationId, options: { ...DEFAULT_PACK_OPTIONS },
}).result;
if (!packed.outcome.ok) throw packed.outcome.error;
const exported = await client.submit("export", {
  asset,
  normalizationId,
  packId: packed.outcome.value.packId,
  task: { format: ExportFormat.PhaserJsonHash, baseName: "sprites", animations: [] },
}).result;
if (!exported.outcome.ok) throw exported.outcome.error;
const result = exported.outcome.value;
const url = URL.createObjectURL(new Blob([result.archive], { type: result.mime }));
// Offer a download link: href=url, download=result.fileName.
// Revoke url after download/link teardown, not before the click.

await client.submit("release", { asset }).result;
await client.dispose();
```

Godot 调用沿用 load/detect/审校/normalize；省略 pack，export.payload.packId=null，task.format=ExportFormat.GodotFramesZip。手动降级可直接编辑返回的 frames；改变网格时提交 detect mode=manual-grid、manualGrid 为用户选择的配置，再重新审校。

## 11. 兼容与验收要求

- 实现必须公开本文全部类型、常量和函数，不添加未记录的跨包 API。包本身 ESM；类型声明可在 `lib: ["ES2022"]` 的纯算法消费者下编译，browser 子入口才需要 DOM lib。
- 文档示例要作为 typecheck fixture 编译；枚举值、默认参数、坐标/旋转/trim/空帧/取消/BUSY/旧结果都是契约测试对象。
- 新增非必需能力须升级契约 minor；改变必填字段、默认输出、像素语义或错误语义须 major。协议版本用于消息兼容，不与 npm patch 号混淆。未声明的新枚举不能由实现者单方面加上。
- 工程师发现无法实现或缺口时报告架构师；冻结后的变更须依次经过“架构师拟修订并升版本/修订号→产品主确认→同步受影响方”。候选修订在确认前不生效，不作为恢复冲突项实现或修改黄金标注的依据。M1 当前文档不代表运行时、性能或引擎测试已经通过。

## 12. Gate 1 第 2 轮修订记录（r2历史）

r2形成时修正的是尚未发布、尚未冻结的1.0.0候选文档，完整替代首轮草案。随后产品主明确确认Gate 1通过并冻结1.0.0/r2，因此r2现为生效基线；不能再套用“未冻结草稿可直接改”的处理方式。本节保留历史整改记录，不是当前r3的生效授权。后续变更严格按第11节与产品主明确的“架构师修订→产品主确认→同步受影响方”流程执行。

- 问题2：根据最新PRD/copy采取方案（b），第8节独立列明离群UI及全部状态，hash仍不展示。UI设计师在Wave2按角色交接要求落入ui-spec，本轮不声称尚不存在的ui-spec已完成。
- 问题3：PackOptions仅保留两个真实库枚举映射，补齐各自确定性排序，非法第三值返回INVALID_ARGUMENT。
- 问题4：BUSY区分task/asset，旧资产场景明确release-asset→retry，并处理旧ref及buffer重建。
- 问题1/5：所有权与ignore规则在agent-roles.md、根.gitignore落盘；完整逐项整改索引见architecture-m1.md第10节。首轮裁决文件保留原样，是否通过由独立复审决定。

## 13. SF-CONTRACT-001 / 002 变更提案（r3，待确认）

### 13.1 申请、依据与版本决定

申请来源为[packages/pipeline/CONTRACT-ISSUES.md](../packages/pipeline/CONTRACT-ISSUES.md)。独立核验确认：200×100全透明输入令旧通用公式得到columns=ceil(sqrt(2))=2、rows=1，与“一个空帧”冲突；同一资产显式2行3列网格时，旧条文又同时要求6帧不降级与提前EMPTY_INPUT降级，不能同时实现。

对照[PRD v1.1](./prd-m1.md)：AC-F05场景D与AC-F13场景A后的澄清段（本次核对时第334行）明确整图全透明自动检测返回一个待确认空帧；AC-F05场景C允许降级后应用用户网格继续工作。故拟将场景D/黄金澄清的“一帧”限定为自动检测初次降级，将后续显式手动网格交还用户配置，两者共同成立，不把手动重新应用网格再次强制重置为1×1。

本修订改变冻结条文中通用公式可产生的默认帧数，并明确返回confidence/degraded/warnings的分支优先级，按第11节“改变默认输出或错误语义须major”保守升级为**候选契约2.0.0 / 文档r3**，不以文字澄清为由绕过冻结规则。数据结构、枚举成员和消息负载形状不变，PROTOCOL_VERSION仍为1；CONTRACT_VERSION与WorkerCapabilities.contractVersion同步拟升为2.0.0，Phaser导出meta.version示例随契约版本更新。major是接口行为版本，不表示产品进入M2或新增产品范围；generic/sequence文件schema版本不变。

### 13.2 两项决定及边界

- **SF-CONTRACT-001：采纳特例。**仅EMPTY_INPUT绕过通用估算，固定`{rows:1, columns:1, region:null, keepEmptyCells:true}`，返回整张工作图一个空帧；其他降级的公式保持原样。
- **SF-CONTRACT-002：采纳显式手动优先。**在输入/资源/参数校验后，manual-grid先执行并不降级；仅auto/grid/components对整图全透明提前EMPTY_INPUT。手动keepEmptyCells=true保留用户指定的全部空cell，false可成功返回零帧，随后打包/导出才按既有NO_FRAMES处理。显式region同样被尊重。
- auto/grid/components与manual-grid以上规则均适用于quality=preview/final；options保留请求原值，返回quality保留请求值，preview仍不得用作最终导出结果。整图全透明按原始工作图alpha全为0判定，不能由缩略图或alphaThreshold替代。
- 不更改OPAQUE_INPUT阈值、检测参数默认值、几何坐标/画布语义、空帧哈希、ID命名、审校确认、导出格式、依赖或黄金集20例总配额。

### 13.3 结果断言矩阵与测试交接

下面是需在确认后由R4/R6落地的回归要求，不是已运行的管线测试。公共前提：输入/参数/资源限制合法、整图原始alpha均为0；options.mode与quality均保留请求值，所有保留帧included=true、reviewStatus=pending、bbox=null、pHash=null、flags.empty=true。未运行网格/CCL时对应diagnostics评分和组件计数均为0。

| 输入/请求 | frames / sourceRect | strategy / confidence / degraded | warnings |
|---|---|---|---|
| 100×100、200×100、100×200、8192×1、1×8192；分别auto/grid/components | 恰好1帧，sourceRect={x:0,y:0,width:W,height:H} | manual-grid / 0 / EMPTY_INPUT，attempted=[]，suggestedGrid精确等于固定1×1配置 | 恰好DETECTION_DEGRADED、EMPTY_FRAMES各一条，顺序固定 |
| 200×100；manual-grid 2×3，region=null，keepEmptyCells=true | 6个空帧，x切点[0,66,133,200]、y切点[0,50,100]，按行优先 | manual-grid / 1 / null；无suggestedGrid、无attempted字段 | 恰好一条EMPTY_FRAMES，列出6个frameId |
| 同上，keepEmptyCells=false | frames=[]，不额外补帧 | manual-grid / 1 / null | []；detect成功，pack/export对零帧返回NO_FRAMES |
| 200×100；manual-grid 2×3，region={x:20,y:10,width:120,height:60}，keepEmptyCells=true | 6个40×30空帧，覆盖用户region；不扩为整图 | manual-grid / 1 / null | 恰好一条EMPTY_FRAMES |
| 同上，keepEmptyCells=false | frames=[] | manual-grid / 1 / null | [] |
| 全透明但manualGrid缺失、region越界、rows=0或rows×columns超有效上限 | 无成功DetectResult；INVALID_ARGUMENT | 参数校验优先，不进入EMPTY_INPUT | 不发成功结果warning |
| auto先产生EMPTY_INPUT，随后同一AssetRef应用合法manual-grid 2×3 | 第一次1帧，第二次按keepEmptyCells为6帧或0帧，无需重新上传 | 第二次degraded=null，不继承第一次降级对象 | 第二次无DETECTION_DEGRADED；UI清除旧任务降级状态 |

补充反例：非全透明但无有效候选时仍走原通用公式，不受1×1特例影响；稀疏非零alpha即使在preview分析图中消失，也不得误报EMPTY_INPUT。对表内前三种模式分别覆盖preview/final，手动模式同时覆盖两种keepEmptyCells与quality；检验完整suggestedGrid、帧数、sourceRect、flags、pending、confidence、reason、attempted及warnings，而非只断言frames.length。

R6的AC-F13黄金集仍只占“整图全透明1例”（对应AC-F05场景D），不新增“局部空帧”类别或把变体算作新配额。方图/横图/竖图/极端比例、显式网格及keepEmptyCells变体作为R4单测和同一夹具的参数化回归，不增加20例计数；该黄金用例的基准请求为auto/final。

本次文档核验已完成：独立算术复现001的旧公式2帧结果，并核对002的2×3网格整数切点；TypeScript5.9.3严格编译8个无DOM根声明块、browser声明及完整调用示例通过，候选版本常量与能力字面量一致；JSON示例与git diff --check通过。检查材料只在临时目录生成，未实现管线、未运行或声称通过上述单测/黄金回归。

### 13.4 生效与同步门禁

当前状态：**架构师已提交候选修订，等待本窗口产品主确认；尚未生效、尚未通知R4恢复实现。** 本次申请不构成对候选内容的预先批准。确认前仍以冻结的1.0.0/r2为基线，冲突项继续暂停，不把Git工作区中的候选字面量当作已批准版本。

产品主确认后，按顺序记录确认结果与生效版本，再同步：R4（detect分流、常量/能力版本与单测）、R6（同一全透明黄金用例及参数化断言）、R5（手动结果替换旧降级状态、零帧导出阻断、客户端版本核对）、R2（承接手动空结果/降级提示状态）、R1（核对AC-F05场景D的自动检测上下文）、R9（变更验收依据）。由各文件owner修改对应实现/文档；架构师不直接改写其文件。若产品主要求调整，继续修订候选并重新提交，不能把未确认稿当作迁移指令。

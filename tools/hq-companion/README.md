# hq-companion —— SpriteFlow 高质量拆件本地伴生服务

让纯前端网站（`http://localhost:5190`）把整图交给本机 GPU 跑 see-through 扩散分层，
并产出 **SpriteFlow 部位 ZIP 同构**的保真导出。本服务只做编排：模型推理全部在
see-through 仓库（`D:\projects\tools\see-through`）内完成，本目录不复制任何模型代码。

## 启动（一条命令）

```bat
D:\projects\tools\see-through\.venv\Scripts\python.exe D:\projects\new_project1\tools\hq-companion\server.py
```

看到 `listening on http://127.0.0.1:8790` 即就绪。依赖只有标准库 + venv 已装包
（http.server / numpy / Pillow），无新增安装。

## 网站侧对接

```js
// 1. 提交（PUT 原始 PNG 字节，不用 multipart）
const res = await fetch("http://127.0.0.1:8790/jobs?name=hero.png&quality=standard", {
  method: "PUT",
  headers: { "Content-Type": "image/png" },
  body: pngUint8Array,
});
const { jobId } = await res.json();

// 2. 轮询（建议 5~10s 一次）
const st = await (await fetch(`http://127.0.0.1:8790/jobs/${jobId}`)).json();
// st.status: queued | running | done | error
// st.stage:  layerdiff | depth | extract | splice | pack
// st.etaMinutes / st.logTail 可直接展示

// 3. 下载结果 ZIP
const blob = await (await fetch(`http://127.0.0.1:8790/jobs/${jobId}/result`)).blob();
```

所有响应带 `Access-Control-Allow-Origin: *`，OPTIONS 预检返回 204；
`GET /health` → `{ok, gpu, busy, version, jobs}` 可用作开跑前探测。

## 质量档位与预期耗时（RTX 4060 Laptop 8GB + group_offload 实测口径）

| quality | inference_psd 参数 | 预计耗时 | 用途 |
|---|---|---|---|
| `standard` | `--resolution 1024`（30 steps） | 约 75~85 分钟（1254px 图实测 78 分钟） | 正式产出 |
| `draft` | `--resolution 512 --inference_steps 15 --inference_steps_depth 10` | 约 8~15 分钟 | 快速验证链路/构图 |

同时刻只跑 **1 个** GPU 任务，其余排队（`status: queued`，`etaMinutes` 已含排队等待）。

## 结果 ZIP 结构

```
parts/<名>.png             纯保真部位：非透明像素与原图逐字节相同（产品像素断言只对这些成立）
parts-completed/<名>.png   含补全像素的部位完整层：可见区=原图字节，
                           被身体遮挡区与轮廓外=扩散层像素（补全）。与纯保真部位分目录，绝不混放
parts.json                 清单 schemaVersion=spriteflow-parts/1，bbox 为原图像素坐标（左上半开），
                           每部位 {name, kind, file, bbox, occluded, completed}
splice-report.json         每部位 total/visible/completed/occludedByBody/outsideOutline 像素数
preview.png                完整层按遮挡顺序拼回的预览
result.psd                 see-through 原始 PSD 拷贝
README.txt                 目录说明（给解包的人看）
```

选择「独立 parts-completed/ 子目录 + parts.json.completed 标志」而不是同目录加后缀：
网站的像素保真断言（部件 PNG 与原图逐字节相等）只应施加于 `parts/`，目录级隔离让断言
不用逐文件查标志，也避免把补全像素误当原图像素。

## LAYER_MAP（Live2D 层 → SpriteFlow PartKind）

| 导出部位 | kind(PartKind) | 来源层（后→前） | behind_body | 说明 |
|---|---|---|---|---|
| hair | hair | back hair + front hair | 是 | 任务约定合并 |
| wings / tail | accessory | wings / tail | 是 | 背后件，身体遮挡区补全 |
| neck | neck | neck | 否 | |
| torso | torso | bottomwear + topwear | 否 | 合并为一条（映射表决策） |
| legwear / footwear | other | legwear / footwear | 否 | PartKind 无对应裤袜/鞋枚举 |
| arms | other | handwear | 否 | 该层实际含手臂皮肤+袖子，无合并手臂枚举 |
| head | head | face, ears, nose, mouth, eyebrow, eyelash, irides, eyewhite | 否 | 五官子层过小（数百 px），并入头部 |
| neckwear / earwear / headwear / eyewear | accessory | 同名层 | 否 | |
| objects | other | objects | 否 | 手持物 |

- kind 全部落在 PartKind 24 枚举内（见 `packages/segment/src/types.ts`）；无法映射的层**跳过并写日志**（如聚合文件 head.png）。
- 蒙版 alpha 阈值 128：在该图上复现了 v2 验证数值（hair 总量 171k、dress 纯保真 301k）。
- 眼/眉等不支持左右拆分（需要 see-through `--tblr_split`，当前未启用，见遗留）。

## 常见故障

- **GPU 被占用**：`GET /health` 看 `gpu.memoryUsedMiB`。8GB 卡上若已有大进程（>4GB），
  推理可能 OOM 或极慢；先关掉其它占用者再提交。
- **HF 断网**：模型已全部在 `D:\projects\tools\see-through\hf-cache`（22.5GB），正常离线可用。
  若日志出现 huggingface.co 连接重试拖慢启动，给 server 进程加环境变量
  `HF_ENDPOINT=https://hf-mirror.com` 再重启服务。
- **显存不足（CUDA OOM）**：确认日志里有 `--group_offload`（服务默认带上）。仍 OOM 就降档
  draft（512 分辨率）。
- **杀进程**：关服务用 Ctrl+C；若子进程残留，`taskkill /F /IM python.exe` 前先确认没有别的
  python 在跑，或按 PID 杀（日志第一行有命令行）。任务产物在 `jobs/<id>/`，重启服务后
  队列不恢复（内存态，见遗留）。

## 文件

- `server.py` —— HTTP 服务（8790）：健康检查、提交、轮询、取件；单 worker 队列编排子进程。
- `splice.py` —— 可独立运行的保真拼接：`python splice.py --src 原图.png --layers <层目录> --out <输出目录> [--psd x.psd]`。
- `jobs/` —— 运行期任务产物（已 gitignore）。

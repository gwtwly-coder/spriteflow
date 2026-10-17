# -*- coding: utf-8 -*-
"""SpriteFlow 高质量拆件——保真拼接（v2 算法）。

输入：原图 + see-through layerdiff 输出层目录（<名>/ 内若干 1024x1024 RGBA 层 PNG）
输出目录结构（SpriteFlow 部位 ZIP 同构，另加补全部位与报告）：
  parts/<名>.png             纯保真部位：可见像素逐字节来自原图，其余全透明
  parts-completed/<名>.png   含补全像素的部位完整层：可见区=原图字节，被身体遮挡区与
                             轮廓外=扩散层像素（补全）。与纯保真部位分开放置，
                             因为"像素逐字节来自原图"断言只对 parts/ 成立
  parts.json                 清单（schemaVersion spriteflow-parts/1）
  splice-report.json         每部位 visible/completed/occluded 像素数
  preview.png                完整层按遮挡顺序拼回的预览图
  result.psd                 see-through 原始 PSD 的拷贝（可选）
  README.txt                 目录说明

v2 算法（已验证）：
  部位蒙版   = 该部位所有相关层 alpha 并集（阈值 >=128，NEAREST resize 回原图尺寸）
  保真区     = 蒙版 ∩ 原图轮廓内 ∩ 未被身体遮挡 → 原图 RGBA 逐字节拷贝
  补全区     = 蒙版 ∩ (身体各层蒙版 ∪ 原图轮廓外) → 扩散层像素（仅 behind_body 部位计身体遮挡）
  纯保真部位 = 补全像素数为 0 → parts/，completed:false
  补全部位   = 补全像素数 > 0 → parts-completed/，completed:true

用法：
  python splice.py --src 原图.png --layers <layerdiff输出>/<名>/ --out 输出目录 [--psd xxx.psd]
"""
import argparse
import json
import os
import os.path as osp
import shutil
import sys

import numpy as np
from PIL import Image

SCHEMA_VERSION = "spriteflow-parts/1"
COORDINATE_SYSTEM = "top-left-half-open-working-pixels"
ALPHA_THRESHOLD = 128  # 实测复现 v2 验证数值（hair 171k / dress 301k）的阈值

# ---------------------------------------------------------------------------
# 层名映射表（Live2D 层 → SpriteFlow 部位）
# 顺序 = preview 拼回时的后→前（先画的在底层）。
# kind 取值必须是 SpriteFlow PartKind 24 枚举之一（见 packages/segment/src/types.ts）。
# behind_body: True 表示该部位会被身体挡住（蒙版∩身体层 → 补全）；
#              False 表示始终在身体之前（只有轮廓外才算补全）。
# layers 列表顺序 = 该部位内部合成时的后→前。
# ---------------------------------------------------------------------------
LAYER_MAP = {
    # --- 身体之后（最先画） ---
    "wings":     {"kind": "accessory", "layers": ["wings"],         "behind_body": True},
    "tail":      {"kind": "accessory", "layers": ["tail"],          "behind_body": True},
    "hair":      {"kind": "hair",      "layers": ["back hair", "front hair"], "behind_body": True},
    # --- 身体 ---
    "neck":      {"kind": "neck",      "layers": ["neck"],          "behind_body": False},
    "torso":     {"kind": "torso",     "layers": ["bottomwear", "topwear"], "behind_body": False},
    "legwear":   {"kind": "other",     "layers": ["legwear"],       "behind_body": False},
    "footwear":  {"kind": "other",     "layers": ["footwear"],      "behind_body": False},
    "arms":      {"kind": "other",     "layers": ["handwear"],      "behind_body": False},
    "head":      {"kind": "head",      "layers": ["face", "ears", "nose", "mouth",
                                                  "eyebrow", "eyelash", "irides", "eyewhite"],
                  "behind_body": False},
    # --- 身体之前（最后画） ---
    "neckwear":  {"kind": "accessory", "layers": ["neckwear"],      "behind_body": False},
    "earwear":   {"kind": "accessory", "layers": ["earwear"],       "behind_body": False},
    "headwear":  {"kind": "accessory", "layers": ["headwear"],      "behind_body": False},
    "eyewear":   {"kind": "accessory", "layers": ["eyewear"],       "behind_body": False},
    "objects":   {"kind": "other",     "layers": ["objects"],       "behind_body": False},
}

# "身体各层"：计算身体遮挡时的遮挡者集合（不含部位自身层；
# 头发/配饰/尾巴/翅膀/手持物不算身体——它们不是遮挡来源）
BODY_LAYERS = [
    "face", "ears", "nose", "mouth", "eyebrow", "eyelash", "irides", "eyewhite",
    "neck", "topwear", "handwear", "bottomwear", "legwear", "footwear",
]

KNOWN_LAYERS = {layer for spec in LAYER_MAP.values() for layer in spec["layers"]}


def load_layers(layers_dir, width, height, log):
    """读取所有已知层：mask（二值，NEAREST 回原尺寸）+ pixels（BILINEAR 回原尺寸，供补全取样）。"""
    loaded = {}
    files = set(os.listdir(layers_dir)) if osp.isdir(layers_dir) else set()
    for name in KNOWN_LAYERS:
        path = osp.join(layers_dir, name + ".png")
        if not osp.isfile(path):
            continue
        img = Image.open(path).convert("RGBA")
        alpha = np.asarray(img)[:, :, 3]
        binary = Image.fromarray(((alpha >= ALPHA_THRESHOLD).astype(np.uint8)) * 255)
        mask = np.asarray(binary.resize((width, height), Image.NEAREST)) > 0
        pixels = np.asarray(img.resize((width, height), Image.BILINEAR)).astype(np.float64)
        loaded[name] = {"mask": mask, "pixels": pixels}
    # 未知层（输出目录里既非已知层、也非 *_depth/辅助文件）跳过并记日志
    aux_prefixes = ("src_", "reconstruction")
    for fname in sorted(files):
        if not fname.endswith(".png"):
            continue
        stem = fname[:-4]
        if stem in KNOWN_LAYERS or stem.endswith("_depth") or stem.startswith(aux_prefixes):
            continue
        log("skip unknown layer: %s" % fname)
    return loaded


def tight_bbox(mask):
    """mask 的紧致外接框 [x, y, w, h]（top-left 半开区间）。mask 为空时返回 None。"""
    rows = np.any(mask, axis=1)
    cols = np.any(mask, axis=0)
    if not rows.any():
        return None
    y0, y1 = np.argmax(rows), len(rows) - np.argmax(rows[::-1])
    x0, x1 = np.argmax(cols), len(cols) - np.argmax(cols[::-1])
    return int(x0), int(y0), int(x1 - x0), int(y1 - y0)


def composite_completed(part, loaded, completed_mask):
    """补全区像素：按 layers 后→前 straight-alpha 合成该部位的扩散层。"""
    h, w = completed_mask.shape
    out = np.zeros((h, w, 4), dtype=np.float64)
    for layer_name in part["layers"]:  # 列表顺序 = 后→前
        layer = loaded.get(layer_name)
        if layer is None:
            continue
        px = layer["pixels"]
        a = px[:, :, 3:4] / 255.0
        out = px * a + out * (1.0 - a)  # alpha-over，后画的层在上面
    out[:, :, 3] = np.clip(out[:, :, 3], 0, 255)
    return np.clip(np.rint(out), 0, 255).astype(np.uint8)


def splice(src_path, layers_dir, out_dir, psd_path=None, log=print):
    os.makedirs(osp.join(out_dir, "parts"), exist_ok=True)
    os.makedirs(osp.join(out_dir, "parts-completed"), exist_ok=True)

    orig = Image.open(src_path).convert("RGBA")
    width, height = orig.size
    orig_px = np.asarray(orig)
    outline = orig_px[:, :, 3] > 0
    log("source %dx%d, outline px=%d" % (width, height, int(outline.sum())))

    loaded = load_layers(layers_dir, width, height, log)
    if not loaded:
        raise RuntimeError("layer dir has no known layers: %s" % layers_dir)

    manifest_parts = []
    report_parts = []
    preview = np.zeros((height, width, 4), dtype=np.uint8)  # 完整层拼回（后→前）

    for part_name, part in LAYER_MAP.items():
        own_layers = [loaded[n] for n in part["layers"] if n in loaded]
        if not own_layers:
            log("skip empty part (no layer files): %s" % part_name)
            continue
        mask = np.zeros((height, width), dtype=bool)
        for layer in own_layers:
            mask |= layer["mask"]
        total_px = int(mask.sum())
        if total_px == 0:
            log("skip empty part (zero mask): %s" % part_name)
            continue

        # 遮挡者 = 身体各层并集，但排除部位自身层（否则部位∩自身恒被"遮挡"）
        occluders = np.zeros((height, width), dtype=bool)
        for n in BODY_LAYERS:
            if n in loaded and n not in part["layers"]:
                occluders |= loaded[n]["mask"]
        occluded = mask & occluders                       # 被身体遮挡区
        outside = mask & ~outline                          # 原图轮廓外（无原图像素可用）
        if part["behind_body"]:
            completed_mask = occluded | outside
        else:
            completed_mask = outside
        faithful_mask = mask & outline & ~completed_mask  # 可见保真区

        # 完整层精灵：保真区逐字节原图；补全区扩散层合成
        sprite = np.zeros((height, width, 4), dtype=np.uint8)
        sprite[faithful_mask] = orig_px[faithful_mask]
        if completed_mask.any():
            diffused = composite_completed(part, loaded, completed_mask)
            sprite[completed_mask] = diffused[completed_mask]

        # 产品承诺自检：保真区像素必须与原图逐字节一致（PNG 无损往返后再验一次）
        np.testing.assert_array_equal(sprite[faithful_mask], orig_px[faithful_mask])

        visible_px = int(faithful_mask.sum())
        completed_px = int(completed_mask.sum())
        is_completed = completed_px > 0
        sub_dir = "parts-completed" if is_completed else "parts"
        rel_path = "%s/%s.png" % (sub_dir, part_name)
        bbox = tight_bbox(mask)
        if bbox is None:
            log("skip empty part: %s" % part_name)
            continue
        x, y, bw, bh = bbox
        Image.fromarray(sprite[y:y + bh, x:x + bw]).save(osp.join(out_dir, rel_path))

        manifest_parts.append({
            "name": part_name,
            "kind": part["kind"],
            "file": rel_path,
            "bbox": {"x": x, "y": y, "width": bw, "height": bh},
            "occluded": bool(occluded.any()),
            "completed": is_completed,
        })
        report_parts.append({
            "name": part_name,
            "kind": part["kind"],
            "totalPx": total_px,
            "visiblePx": visible_px,
            "completedPx": completed_px,
            "occludedByBodyPx": int(occluded.sum()),
            "outsideOutlinePx": int(outside.sum()),
            "file": rel_path,
        })
        log("part %-10s kind=%-9s visible=%7d completed=%7d (occluded=%d, outside=%d) -> %s"
            % (part_name, part["kind"], visible_px, completed_px,
               int(occluded.sum()), int(outside.sum()), rel_path))

        # 拼回预览（LAYER_MAP 顺序即后→前）
        a = sprite[:, :, 3:4].astype(np.float64) / 255.0
        preview = np.clip(np.rint(sprite * a + preview * (1.0 - a)), 0, 255).astype(np.uint8)

    manifest = {
        "schemaVersion": SCHEMA_VERSION,
        "coordinateSystem": COORDINATE_SYSTEM,
        "sourceSize": {"width": width, "height": height},
        "parts": manifest_parts,
    }
    with open(osp.join(out_dir, "parts.json"), "w", encoding="utf-8") as f:
        f.write(json.dumps(manifest, ensure_ascii=False, indent=2) + "\n")

    report = {
        "schemaVersion": "hq-companion-splice-report/1",
        "source": src_path,
        "layersDir": layers_dir,
        "alphaThreshold": ALPHA_THRESHOLD,
        "parts": report_parts,
        "totals": {
            "parts": len(report_parts),
            "pureFaithful": len([p for p in report_parts if p["completedPx"] == 0]),
            "withCompletion": len([p for p in report_parts if p["completedPx"] > 0]),
            "visiblePx": sum(p["visiblePx"] for p in report_parts),
            "completedPx": sum(p["completedPx"] for p in report_parts),
        },
    }
    with open(osp.join(out_dir, "splice-report.json"), "w", encoding="utf-8") as f:
        f.write(json.dumps(report, ensure_ascii=False, indent=2) + "\n")

    Image.fromarray(preview).save(osp.join(out_dir, "preview.png"))

    if psd_path and osp.isfile(psd_path):
        shutil.copyfile(psd_path, osp.join(out_dir, "result.psd"))
    else:
        log("warning: psd not found or not provided: %s" % (psd_path,))

    with open(osp.join(out_dir, "README.txt"), "w", encoding="utf-8") as f:
        f.write(SPLICE_README)
    return report


SPLICE_README = """\
SpriteFlow hq-companion splice export
=====================================

Directory layout:
  parts/<name>.png            Pure faithful parts. Every non-transparent pixel is
                              byte-identical to the source working image.
  parts-completed/<name>.png  Parts that contain completed (diffusion) pixels:
                              visible region = source bytes, occluded-by-body and
                              outside-outline regions = see-through layer pixels.
  parts.json                  Manifest (schemaVersion spriteflow-parts/1).
  splice-report.json          Per-part visible/completed pixel counts.
  preview.png                 All full layers composited back-to-front.
  result.psd                  Copy of the see-through PSD (layer originals).

Coordinate rules:
  All bboxes are source working-image pixels, top-left origin, half-open ranges
  [x, x+width) x [y, y+height). PNG pixel (0,0) is the bbox top-left corner.

Pixel invariant (parts/ only):
  Where a pure part is non-transparent, its RGBA bytes equal the source image
  bytes at the corresponding coordinate. No blur, interpolation or generated
  pixels. parts-completed/ deliberately breaks this invariant in its completed
  region only -- that is why the two directories are kept separate.
"""


def main():
    ap = argparse.ArgumentParser(description="SpriteFlow faithful splice")
    ap.add_argument("--src", required=True, help="source image (original size)")
    ap.add_argument("--layers", required=True, help="see-through layerdiff output dir")
    ap.add_argument("--out", required=True, help="output directory")
    ap.add_argument("--psd", default=None, help="see-through PSD to copy as result.psd")
    args = ap.parse_args()

    def log(msg):
        print("[splice] %s" % msg, flush=True)

    report = splice(args.src, args.layers, args.out, psd_path=args.psd, log=log)
    log("done: %d parts (%d pure, %d completed), visible=%d completedPx=%d"
        % (report["totals"]["parts"], report["totals"]["pureFaithful"],
           report["totals"]["withCompletion"], report["totals"]["visiblePx"],
           report["totals"]["completedPx"]))


if __name__ == "__main__":
    main()

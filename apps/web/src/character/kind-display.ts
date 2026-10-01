// 部位 kind 显示与导出文件名映射（copy-v3 §26 + 契约 PartKind 封闭枚举）。
// 显示名 = 侧别前缀（左/右）+ 基础部位词条；导出 stem = left_/right_ 前缀 + kind。
import type { PartAsset, PartKind } from "@spriteflow/segment";
import { type Locale, translate } from "../i18n";
import { isClickNamed, kindStem } from "./parts-store";

const KIND_BASE_KEY: Record<string, Parameters<typeof translate>[1]> = {
  hair: "part.kind.hair",
  head: "part.kind.head",
  face: "part.kind.face",
  eye: "part.kind.eye",
  eyebrow: "part.kind.eyebrow",
  mouth: "part.kind.mouth",
  neck: "part.kind.neck",
  torso: "part.kind.torso",
  "upper-arm": "part.kind.upper",
  forearm: "part.kind.forearm",
  hand: "part.kind.hand",
  thigh: "part.kind.thigh",
  shin: "part.kind.shin",
  foot: "part.kind.foot",
  accessory: "part.kind.accessory",
  other: "part.kind.other",
};

/** kind 词条显示名：带侧别组合为「左/右 + 部位名」（copy-v3 §26）。 */
export function kindLabel(kind: PartKind, locale: Locale): string {
  if (kind === "other") return translate(locale, "part.kind.other");
  for (const [base, key] of Object.entries(KIND_BASE_KEY)) {
    if (kind === base) return translate(locale, key);
    if (kind.startsWith(`${base}-`)) {
      const side = kind.slice(base.length + 1);
      if (side === "left") return `${translate(locale, "part.side.left")}${translate(locale, key)}`;
      if (side === "right")
        return `${translate(locale, "part.side.right")}${translate(locale, key)}`;
    }
  }
  return translate(locale, "part.kind.other");
}

/** 部位卡显示名：点击命名（part_###）显示 part.default_name；标准件用 kind 词条。 */
export function partDisplayName(part: PartAsset, locale: Locale, listIndex: number): string {
  if (isClickNamed(part.name))
    return translate(locale, "part.default_name", { index: listIndex + 1 });
  if (part.kind === "other") return part.name;
  return kindLabel(part.kind, locale);
}

/**
 * 导出名映射（契约 :327）：语义部位用 kind stem（left_/right_ 前缀 + 下划线组合），
 * 点击/other 部位从 part_000 起补零；大小写折叠去重，冲突加序号后缀。
 */
export function buildExportNames(parts: PartAsset[]): Array<{ partId: string; fileName: string }> {
  const used = new Set<string>();
  const names: Array<{ partId: string; fileName: string }> = [];
  let clickIndex = 0;
  const claim = (stem: string): string => {
    const safe = stem.replace(/[^A-Za-z0-9_-]/g, "_").slice(0, 48) || "part";
    let candidate = safe;
    let suffix = 1;
    while (used.has(candidate.toLowerCase())) {
      candidate = `${safe}_${suffix}`;
      suffix += 1;
    }
    used.add(candidate.toLowerCase());
    return candidate;
  };
  for (const part of parts) {
    const stem = kindStem(part.kind);
    if (stem !== null && part.kind !== "other") {
      names.push({ partId: part.id, fileName: claim(stem) });
    } else {
      names.push({
        partId: part.id,
        fileName: claim(`part_${String(clickIndex).padStart(3, "0")}`),
      });
      clickIndex += 1;
    }
  }
  return names;
}

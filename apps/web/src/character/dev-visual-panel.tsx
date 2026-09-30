// v3 视觉调节面板（ui-spec §13.3，仅开发构建加载——入口经 import.meta.env.DEV
// 守卫 + 动态 import，生产构建不含本模块）。白名单 token 写在 :root 内联样式
// 上即时预览：纯 CSS token 自动生效，蒙版色/不透明度经 spriteflow-parts-tokens
// 事件驱动 PartsCanvas 重绘；支持 JSON 导入导出与重置。确认后由 Agent 把调好
// 的值固化进 styles.css 令牌。

import { useState } from "react";
import { type Locale, translate } from "../i18n";

type TokenSpec =
  | { kind: "color"; key: string; label: Parameters<typeof translate>[1]; fallback: string }
  | {
      kind: "number";
      key: string;
      label: Parameters<typeof translate>[1];
      fallback: number;
      min: number;
      max: number;
      step: number;
      unit: "px" | "";
    };

const TOKENS: readonly TokenSpec[] = [
  {
    kind: "number",
    key: "--parts-sidebar-width",
    label: "dev.visual.sidebar_width",
    fallback: 292,
    min: 240,
    max: 420,
    step: 4,
    unit: "px",
  },
  {
    kind: "color",
    key: "--parts-canvas-bg",
    label: "dev.visual.canvas_bg",
    fallback: "#0e1116",
  },
  {
    kind: "color",
    key: "--parts-mask-color",
    label: "dev.visual.mask_color",
    fallback: "#b48bff",
  },
  {
    kind: "number",
    key: "--parts-mask-opacity",
    label: "dev.visual.mask_opacity",
    fallback: 0.45,
    min: 0,
    max: 1,
    step: 0.05,
    unit: "",
  },
  {
    kind: "number",
    key: "--parts-card-radius",
    label: "dev.visual.card_radius",
    fallback: 6,
    min: 0,
    max: 16,
    step: 1,
    unit: "px",
  },
  {
    kind: "color",
    key: "--parts-card-border",
    label: "dev.visual.card_border",
    fallback: "#2a3342",
  },
  {
    kind: "number",
    key: "--parts-list-gap",
    label: "dev.visual.list_gap",
    fallback: 8,
    min: 2,
    max: 24,
    step: 1,
    unit: "px",
  },
];

const repaint = () => {
  window.dispatchEvent(new Event("spriteflow-parts-tokens"));
};

const readCurrentValues = (): Record<string, string> =>
  Object.fromEntries(
    TOKENS.map((token) => {
      const inline = document.documentElement.style.getPropertyValue(token.key).trim();
      const fallback = token.kind === "number" ? `${token.fallback}${token.unit}` : token.fallback;
      return [token.key, inline.length > 0 ? inline : fallback];
    }),
  );

const applyToken = (key: string, value: string) => {
  document.documentElement.style.setProperty(key, value);
  repaint();
};

const normalizeHex = (value: string): string | null => {
  const trimmed = value.trim().toLowerCase();
  if (/^#[0-9a-f]{6}$/.test(trimmed)) return trimmed;
  if (/^#[0-9a-f]{3}$/.test(trimmed)) {
    const [hash, r, g, b] = trimmed;
    return `${hash}${r}${r}${g}${g}${b}${b}`;
  }
  return null;
};

export default function DevVisualPanel({ locale, onClose }: { locale: Locale; onClose(): void }) {
  const t = (key: Parameters<typeof translate>[1]) => translate(locale, key);
  const [values, setValues] = useState<Record<string, string>>(readCurrentValues);
  const [json, setJson] = useState("");
  const [invalid, setInvalid] = useState(false);
  const change = (token: TokenSpec, raw: string) => {
    const value = token.kind === "number" ? `${raw}${token.unit}` : (normalizeHex(raw) ?? raw);
    setValues((current) => ({ ...current, [token.key]: value }));
    applyToken(token.key, value);
  };
  const reset = () => {
    for (const token of TOKENS) document.documentElement.style.removeProperty(token.key);
    setValues(readCurrentValues());
    repaint();
    setInvalid(false);
  };
  const exportJson = () => {
    const payload = JSON.stringify(
      Object.fromEntries(TOKENS.map((token) => [token.key, values[token.key]])),
      null,
      2,
    );
    setJson(payload);
    setInvalid(false);
    void navigator.clipboard?.writeText(payload)?.catch(() => {});
  };
  const importJson = () => {
    let parsed: unknown;
    try {
      parsed = JSON.parse(json);
    } catch {
      setInvalid(true);
      return;
    }
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
      setInvalid(true);
      return;
    }
    const next: Record<string, string> = { ...values };
    for (const [key, rawValue] of Object.entries(parsed)) {
      const token = TOKENS.find((entry) => entry.key === key);
      if (token === undefined || typeof rawValue !== "string") {
        setInvalid(true);
        return;
      }
      if (token.kind === "color") {
        const color = normalizeHex(rawValue);
        if (color === null) {
          setInvalid(true);
          return;
        }
        next[key] = color;
        continue;
      }
      const numeric = Number.parseFloat(rawValue);
      if (
        !Number.isFinite(numeric) ||
        numeric < token.min ||
        numeric > token.max ||
        !/^-?\d+(\.\d+)?(px)?$/.test(rawValue.trim())
      ) {
        setInvalid(true);
        return;
      }
      next[key] = `${numeric}${token.unit}`;
    }
    for (const [key, value] of Object.entries(next)) applyToken(key, value);
    setValues(next);
    setInvalid(false);
  };
  return (
    <div className="modal-wrap">
      <dialog
        open
        className="modal dev-visual"
        aria-modal="true"
        aria-label={t("dev.visual.title")}
      >
        <h1>{t("dev.visual.title")}</h1>
        {TOKENS.map((token) => (
          <div className="field dev-visual-row" key={token.key}>
            <label htmlFor={`dev-visual-${token.key.slice(8)}`}>{t(token.label)}</label>
            {token.kind === "color" ? (
              <input
                id={`dev-visual-${token.key.slice(8)}`}
                type="color"
                value={normalizeHex(values[token.key] ?? "") ?? token.fallback}
                onChange={(event) => change(token, event.target.value)}
              />
            ) : (
              <>
                <input
                  id={`dev-visual-${token.key.slice(8)}`}
                  type="range"
                  min={token.min}
                  max={token.max}
                  step={token.step}
                  value={Number.parseFloat(values[token.key] ?? String(token.fallback)) || 0}
                  onChange={(event) => change(token, event.target.value)}
                />
                <b className="mono">
                  {Number.parseFloat(values[token.key] ?? String(token.fallback)) || 0}
                  {token.unit}
                </b>
              </>
            )}
          </div>
        ))}
        <textarea
          className="dev-visual-json"
          rows={6}
          spellCheck={false}
          aria-label={t("dev.visual.export")}
          value={json}
          onChange={(event) => setJson(event.target.value)}
          placeholder='{"--parts-sidebar-width": "292px", …}'
        />
        {invalid && (
          <p role="alert" className="inline-error">
            {t("dev.visual.import_invalid")}
          </p>
        )}
        <footer>
          <button type="button" className="secondary" onClick={exportJson}>
            {t("dev.visual.export")}
          </button>
          <button type="button" className="secondary" onClick={importJson}>
            {t("dev.visual.import")}
          </button>
          <button type="button" className="secondary" onClick={reset}>
            {t("dev.visual.reset")}
          </button>
          <button type="button" className="primary" onClick={onClose}>
            {t("action.close")}
          </button>
        </footer>
      </dialog>
    </div>
  );
}

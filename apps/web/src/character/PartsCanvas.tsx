// W3 部位审校画布：图片层 + 部件蒙版高亮层（同视口变换，同一 canvas 视口容器）
// + 部件边界框；视口 pan/zoom/fit 沿用 M1 模式（滚轮指针缩放 / 平移工具 / fit）。
import type { PixelBuffer, Rect } from "@spriteflow/pipeline";
import type { BitMask, PartAsset } from "@spriteflow/segment";
import { maskBounds } from "@spriteflow/segment";
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { type PartsTool, usePartsStore } from "./parts-store";

/** 根入口未导出 getMaskBit：bitset-lsb0-row-major 读位（契约 §2）。 */
function maskBitAt(mask: BitMask, x: number, y: number): boolean {
  const index = y * mask.width + x;
  return ((mask.data[index >> 3] ?? 0) & (1 << (index & 7))) !== 0;
}

interface Props {
  preview: PixelBuffer | null;
  sourceSize: { width: number; height: number } | null;
  tool: PartsTool;
  busy: boolean;
  canvasBackground: string;
  onImageClick(point: { x: number; y: number }): void;
}

const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));

let checkerTile: HTMLCanvasElement | null = null;
const getCheckerTile = () => {
  if (checkerTile) return checkerTile;
  const tile = document.createElement("canvas");
  tile.width = 16;
  tile.height = 16;
  const ctx = tile.getContext("2d");
  if (!ctx) return null;
  ctx.fillStyle = "#1a202a";
  ctx.fillRect(0, 0, 16, 16);
  ctx.fillStyle = "#232a35";
  ctx.fillRect(0, 0, 8, 8);
  ctx.fillRect(8, 8, 8, 8);
  checkerTile = tile;
  return tile;
};

interface HighlightCacheEntry {
  part: PartAsset;
  canvas: HTMLCanvasElement;
  signature: string;
}

/**
 * 视觉调节面板（§13.3）把 token 写在 :root 内联样式上；画布无法直接用 var()，
 * 每次 paint 前解析计算值（未设置时用缺省）。
 */
export function resolveVisualToken(name: string, fallback: string): string {
  const value = window
    .getComputedStyle(window.document.documentElement)
    .getPropertyValue(name)
    .trim();
  return value.length > 0 ? value : fallback;
}

/** 部件蒙版高亮缓存：按部位对象身份失效（蒙版替换 = 新对象）。 */
function buildHighlight(
  part: PartAsset,
  preview: PixelBuffer | null,
  sourceSize: { width: number; height: number },
  color: { r: number; g: number; b: number },
  opacity: number,
): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = part.sourceRect.width;
  canvas.height = part.sourceRect.height;
  const ctx = canvas.getContext("2d");
  if (!ctx) return canvas;
  const image = ctx.createImageData(part.sourceRect.width, part.sourceRect.height);
  const scaleX = preview ? preview.width / sourceSize.width : 1;
  const scaleY = preview ? preview.height / sourceSize.height : 1;
  for (let y = 0; y < part.sourceRect.height; y++) {
    for (let x = 0; x < part.sourceRect.width; x++) {
      if (!maskBitAt(part.mask, x, y)) continue;
      const target = (y * part.sourceRect.width + x) * 4;
      let alpha = Math.round(opacity * 255);
      if (preview) {
        const sampleX = Math.min(preview.width - 1, Math.round((part.sourceRect.x + x) * scaleX));
        const sampleY = Math.min(preview.height - 1, Math.round((part.sourceRect.y + y) * scaleY));
        // 只染原图可见像素：跟随源 alpha，避免在透明区外画出色块。
        const sourceAlpha = preview.data[(sampleY * preview.width + sampleX) * 4 + 3] ?? 0;
        alpha = Math.round((sourceAlpha / 255) * opacity * 255);
      }
      image.data[target] = color.r;
      image.data[target + 1] = color.g;
      image.data[target + 2] = color.b;
      image.data[target + 3] = alpha;
    }
  }
  ctx.putImageData(image, 0, 0);
  return canvas;
}

function parseColor(value: string): { r: number; g: number; b: number } {
  const hex = value.replace("#", "");
  const full =
    hex.length === 3
      ? hex
          .split("")
          .map((c) => c + c)
          .join("")
      : hex;
  return {
    r: Number.parseInt(full.slice(0, 2), 16) || 0,
    g: Number.parseInt(full.slice(2, 4), 16) || 0,
    b: Number.parseInt(full.slice(4, 6), 16) || 0,
  };
}

export function imageRectOfPart(part: PartAsset): Rect | null {
  const bounds = maskBounds(part.mask);
  if (bounds === null) return null;
  return {
    x: part.sourceRect.x + bounds.x,
    y: part.sourceRect.y + bounds.y,
    width: bounds.width,
    height: bounds.height,
  };
}

export function partAtPoint(parts: PartAsset[], point: { x: number; y: number }): PartAsset | null {
  for (let index = parts.length - 1; index >= 0; index--) {
    const part = parts[index];
    if (part === undefined) continue;
    const localX = point.x - part.sourceRect.x;
    const localY = point.y - part.sourceRect.y;
    if (
      localX >= 0 &&
      localY >= 0 &&
      localX < part.sourceRect.width &&
      localY < part.sourceRect.height &&
      maskBitAt(part.mask, localX, localY)
    )
      return part;
  }
  return null;
}

export function PartsCanvas({
  preview,
  sourceSize,
  tool,
  busy,
  canvasBackground,
  onImageClick,
}: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const hostRef = useRef<HTMLDivElement>(null);
  const imageRef = useRef<HTMLCanvasElement | null>(null);
  const highlightCache = useRef(new Map<string, HighlightCacheEntry>());
  const drag = useRef<{ kind: "pan"; startX: number; startY: number } | null>(null);
  const downPoint = useRef<{ x: number; y: number } | null>(null);
  const [pointer, setPointer] = useState<{ x: number; y: number } | null>(null);
  const zoom = usePartsStore((state) => state.zoom);
  const pan = usePartsStore((state) => state.pan);
  const parts = usePartsStore((state) => state.parts);
  const selectedPartId = usePartsStore((state) => state.selectedPartId);
  const maskHighlight = usePartsStore((state) => state.maskHighlight);
  const setViewport = usePartsStore((state) => state.setViewport);

  useEffect(() => {
    if (!preview) {
      imageRef.current = null;
      return;
    }
    const canvas = document.createElement("canvas");
    canvas.width = preview.width;
    canvas.height = preview.height;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.putImageData(
      new ImageData(new Uint8ClampedArray(preview.data), preview.width, preview.height),
      0,
      0,
    );
    imageRef.current = canvas;
  }, [preview]);

  const toImage = (event: React.PointerEvent<HTMLCanvasElement> | React.MouseEvent) => {
    const canvas = canvasRef.current;
    if (!canvas) return { x: 0, y: 0 };
    const box = canvas.getBoundingClientRect();
    return {
      x: (event.clientX - box.left - pan.x) / zoom,
      y: (event.clientY - box.top - pan.y) / zoom,
    };
  };

  const paint = () => {
    const canvas = canvasRef.current;
    const host = hostRef.current;
    if (!canvas || !host) return;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = host.clientWidth * dpr;
    canvas.height = host.clientHeight * dpr;
    canvas.style.width = `${host.clientWidth}px`;
    canvas.style.height = `${host.clientHeight}px`;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.scale(dpr, dpr);
    ctx.clearRect(0, 0, host.clientWidth, host.clientHeight);
    ctx.save();
    ctx.translate(pan.x, pan.y);
    ctx.scale(zoom, zoom);
    if (sourceSize) {
      const tile = getCheckerTile();
      const pattern = tile ? ctx.createPattern(tile, "repeat") : null;
      if (pattern) {
        ctx.fillStyle = pattern;
        ctx.fillRect(0, 0, sourceSize.width, sourceSize.height);
      }
    }
    const image = imageRef.current;
    if (image && sourceSize) {
      ctx.imageSmoothingEnabled = false;
      ctx.drawImage(image, 0, 0, sourceSize.width, sourceSize.height);
    }
    if (maskHighlight && sourceSize) {
      const colorHex = resolveVisualToken("--parts-mask-color", "#b48bff");
      const opacityRaw = Number.parseFloat(resolveVisualToken("--parts-mask-opacity", "0.45"));
      const opacity = Number.isFinite(opacityRaw) ? opacityRaw : 0.45;
      const color = parseColor(colorHex);
      const signature = `${colorHex}:${opacity}`;
      for (const part of parts) {
        const entry = highlightCache.current.get(part.id);
        const fresh =
          entry && entry.part === part && entry.signature === signature
            ? entry.canvas
            : buildHighlight(part, preview, sourceSize, color, opacity);
        if (!entry || entry.part !== part || entry.signature !== signature)
          highlightCache.current.set(part.id, { part, canvas: fresh, signature });
        ctx.drawImage(fresh, part.sourceRect.x, part.sourceRect.y);
      }
    }
    for (const [index, part] of parts.entries()) {
      const active = part.id === selectedPartId;
      const bounds = maskBounds(part.mask);
      ctx.globalAlpha = 1;
      ctx.strokeStyle = active ? "#4d8dff" : "#98a5bd";
      ctx.lineWidth = (active ? 2 : 1.5) / zoom;
      if (bounds !== null) {
        ctx.strokeRect(
          part.sourceRect.x + bounds.x,
          part.sourceRect.y + bounds.y,
          bounds.width,
          bounds.height,
        );
      }
      ctx.font = `${11 / zoom}px ui-monospace`;
      ctx.fillStyle = "#151a22";
      ctx.fillRect(part.sourceRect.x, part.sourceRect.y - 14 / zoom, 22 / zoom, 14 / zoom);
      ctx.fillStyle = "#e8edf5";
      ctx.fillText(String(index + 1), part.sourceRect.x + 4 / zoom, part.sourceRect.y - 4 / zoom);
      if (active) {
        ctx.fillStyle = "#4d8dff";
        ctx.fillText(
          `${Math.round(part.sourceRect.width)}×${Math.round(part.sourceRect.height)}`,
          part.sourceRect.x + 2 / zoom,
          part.sourceRect.y + part.sourceRect.height - 3 / zoom,
        );
      }
    }
    ctx.restore();
  };
  useLayoutEffect(() => {
    paint();
    const observer = new ResizeObserver(paint);
    if (hostRef.current) observer.observe(hostRef.current);
    return () => observer.disconnect();
  });

  const fit = useCallback(() => {
    const host = hostRef.current;
    if (!host || !sourceSize) return;
    const value = Math.min(
      (host.clientWidth - 48) / sourceSize.width,
      (host.clientHeight - 48) / sourceSize.height,
    );
    setViewport(value, {
      x: (host.clientWidth - sourceSize.width * value) / 2,
      y: (host.clientHeight - sourceSize.height * value) / 2,
    });
  }, [setViewport, sourceSize]);
  useEffect(() => {
    fit();
  }, [fit]);
  useEffect(() => {
    window.addEventListener("spriteflow-parts-fit", fit);
    return () => window.removeEventListener("spriteflow-parts-fit", fit);
  }, [fit]);
  // 视觉调节面板（§13.3）改蒙版 token 时即时重绘（无 deps：paint 闭包随渲染更新）。
  useEffect(() => {
    const handler = () => paint();
    window.addEventListener("spriteflow-parts-tokens", handler);
    return () => window.removeEventListener("spriteflow-parts-tokens", handler);
  });

  const onDown = (event: React.PointerEvent<HTMLCanvasElement>) => {
    if (!sourceSize) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    const point = toImage(event);
    if (tool === "pan" || event.button === 1) {
      drag.current = { kind: "pan", startX: event.clientX, startY: event.clientY };
      return;
    }
    downPoint.current = point;
  };
  const onMove = (event: React.PointerEvent<HTMLCanvasElement>) => {
    if (!sourceSize) return;
    setPointer(toImage(event));
    const current = drag.current;
    if (!current) return;
    setViewport(zoom, {
      x: pan.x + event.clientX - current.startX,
      y: pan.y + event.clientY - current.startY,
    });
    current.startX = event.clientX;
    current.startY = event.clientY;
  };
  const onUp = (event: React.PointerEvent<HTMLCanvasElement>) => {
    if (!sourceSize) return;
    const point = toImage(event);
    const started = downPoint.current;
    drag.current = null;
    downPoint.current = null;
    if (!started) return;
    // 拖动距离 <3px 视为点击；区域工具提交提示点（V-04）。
    if (Math.hypot(point.x - started.x, point.y - started.y) >= 3) return;
    if (tool === "select" || tool === "pan") return;
    if (busy) return;
    onImageClick({
      x: clamp(Math.floor(point.x), 0, sourceSize.width - 1),
      y: clamp(Math.floor(point.y), 0, sourceSize.height - 1),
    });
  };
  const cursor =
    tool === "pan" ? "grab" : tool === "select" ? "default" : busy ? "wait" : "crosshair";
  return (
    <div
      className="canvas-host parts-canvas-host"
      ref={hostRef}
      style={{ background: canvasBackground }}
    >
      <canvas
        ref={canvasRef}
        aria-label="Part editor"
        style={{ cursor }}
        onPointerDown={onDown}
        onPointerMove={onMove}
        onPointerUp={onUp}
        onWheel={(event) => {
          event.preventDefault();
          const next = clamp(zoom * (event.deltaY > 0 ? 0.9 : 1.1), 1 / 32, 32);
          const box = event.currentTarget.getBoundingClientRect();
          const px = event.clientX - box.left;
          const py = event.clientY - box.top;
          setViewport(next, {
            x: px - (px - pan.x) * (next / zoom),
            y: py - (py - pan.y) * (next / zoom),
          });
        }}
      />
      <div className="zoom-tools">
        <button type="button" onClick={() => setViewport(clamp(zoom / 1.1, 1 / 32, 32), pan)}>
          -
        </button>
        <button type="button" onClick={() => setViewport(1, pan)}>
          {Math.round(zoom * 100)}%
        </button>
        <button type="button" onClick={() => setViewport(clamp(zoom * 1.1, 1 / 32, 32), pan)}>
          +
        </button>
        <button type="button" onClick={fit}>
          0
        </button>
      </div>
      <div className="canvas-pointer">
        {pointer ? `${Math.floor(pointer.x)}, ${Math.floor(pointer.y)}` : "—"}
      </div>
    </div>
  );
}

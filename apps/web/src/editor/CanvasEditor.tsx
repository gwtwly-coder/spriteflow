import type { PixelBuffer, Rect } from "@spriteflow/pipeline";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { useEditorStore } from "../store/editor-store";

interface Props {
  preview: PixelBuffer | null;
  sourceSize: { width: number; height: number } | null;
  disabled: boolean;
}
type Drag = {
  kind: "pan" | "move" | "resize" | "add" | "marquee" | "split";
  start: { x: number; y: number };
  origin: Rect | null;
  handle?: string;
  ids?: string[];
  initialRects?: Record<string, Rect>;
};
const handles = ["nw", "n", "ne", "e", "se", "s", "sw", "w"] as const;
const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));
const contained = (rect: Rect, size: { width: number; height: number }): Rect => {
  const left = clamp(Math.floor(rect.x), 0, size.width - 1);
  const top = clamp(Math.floor(rect.y), 0, size.height - 1);
  const right = clamp(Math.ceil(rect.x + rect.width), left + 1, size.width);
  const bottom = clamp(Math.ceil(rect.y + rect.height), top + 1, size.height);
  return { x: left, y: top, width: right - left, height: bottom - top };
};
const hitHandle = (rect: Rect, point: { x: number; y: number }, zoom: number) =>
  handles.find((handle) => {
    const x = handle.includes("w")
      ? rect.x
      : handle.includes("e")
        ? rect.x + rect.width
        : rect.x + rect.width / 2;
    const y = handle.includes("n")
      ? rect.y
      : handle.includes("s")
        ? rect.y + rect.height
        : rect.y + rect.height / 2;
    return Math.abs(point.x - x) * zoom <= 8 && Math.abs(point.y - y) * zoom <= 8;
  });

export function CanvasEditor({ preview, sourceSize, disabled }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const hostRef = useRef<HTMLDivElement>(null);
  const imageRef = useRef<HTMLCanvasElement | null>(null);
  const drag = useRef<Drag | null>(null);
  const [pointer, setPointer] = useState<{ x: number; y: number } | null>(null);
  const [gestureRects, setGestureRects] = useState<Record<string, Rect>>({});
  const {
    drafts,
    normalized,
    selected,
    tool,
    zoom,
    pan,
    filter,
    setSelection,
    setViewport,
    updateRects,
    addDraft,
    splitSelected,
  } = useEditorStore();
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
  const toImage = (event: React.PointerEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return { x: 0, y: 0 };
    const box = canvas.getBoundingClientRect();
    return {
      x: (event.clientX - box.left - pan.x) / zoom,
      y: (event.clientY - box.top - pan.y) / zoom,
    };
  };
  const visible = (id: string) => {
    const frame = normalized.find((entry) => entry.id === id);
    if (!frame) return true;
    return (
      filter === "all" ||
      (filter === "attention" &&
        (frame.flags.outlier || frame.flags.multipleComponents || frame.flags.empty)) ||
      (filter === "outlier" && frame.flags.outlier) ||
      (filter === "multipleComponents" && frame.flags.multipleComponents) ||
      (filter === "empty" && frame.flags.empty)
    );
  };
  const paint = () => {
    const canvas = canvasRef.current;
    const host = hostRef.current;
    if (!canvas || !host) return;
    const dpr = window.devicePixelRatio || 1;
    const width = host.clientWidth;
    const height = host.clientHeight;
    canvas.width = width * dpr;
    canvas.height = height * dpr;
    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.scale(dpr, dpr);
    ctx.clearRect(0, 0, width, height);
    ctx.save();
    ctx.translate(pan.x, pan.y);
    ctx.scale(zoom, zoom);
    const image = imageRef.current;
    if (image && sourceSize) {
      const pattern = ctx.createPattern(image, "repeat");
      if (pattern) {
        ctx.fillStyle = pattern;
        ctx.fillRect(0, 0, sourceSize.width, sourceSize.height);
      }
      ctx.imageSmoothingEnabled = false;
      ctx.drawImage(image, 0, 0, sourceSize.width, sourceSize.height);
    }
    for (const [index, frame] of drafts.entries()) {
      const sourceRect = gestureRects[frame.id] ?? frame.sourceRect;
      const active = selected.includes(frame.id);
      const normalizedFrame = normalized.find((entry) => entry.id === frame.id);
      const faded = !visible(frame.id);
      ctx.globalAlpha = faded ? 0.15 : 1;
      ctx.strokeStyle = active ? "#4d8dff" : normalizedFrame?.flags.empty ? "#8b96a8" : "#98a5bd";
      ctx.lineWidth = active ? 2 / zoom : 1.5 / zoom;
      ctx.setLineDash(normalizedFrame?.flags.empty ? [4 / zoom, 3 / zoom] : []);
      ctx.strokeRect(sourceRect.x, sourceRect.y, sourceRect.width, sourceRect.height);
      ctx.setLineDash([]);
      ctx.font = `${11 / zoom}px ui-monospace`;
      ctx.fillStyle = "#151a22";
      ctx.fillRect(sourceRect.x, sourceRect.y - 14 / zoom, 22 / zoom, 14 / zoom);
      ctx.fillStyle = "#e8edf5";
      ctx.fillText(String(index + 1), sourceRect.x + 4 / zoom, sourceRect.y - 4 / zoom);
      if (active) {
        ctx.fillStyle = "#4d8dff";
        ctx.fillText(
          `${frame.sourceRect.width}×${frame.sourceRect.height}`,
          sourceRect.x + 2 / zoom,
          sourceRect.y + sourceRect.height - 3 / zoom,
        );
        if (selected.length === 1)
          for (const handle of handles) {
            const x = handle.includes("w")
              ? sourceRect.x
              : handle.includes("e")
                ? sourceRect.x + sourceRect.width
                : sourceRect.x + sourceRect.width / 2;
            const y = handle.includes("n")
              ? sourceRect.y
              : handle.includes("s")
                ? sourceRect.y + sourceRect.height
                : sourceRect.y + sourceRect.height / 2;
            ctx.fillStyle = "#151a22";
            ctx.strokeStyle = "#4d8dff";
            ctx.lineWidth = 2 / zoom;
            ctx.fillRect(x - 4 / zoom, y - 4 / zoom, 8 / zoom, 8 / zoom);
            ctx.strokeRect(x - 4 / zoom, y - 4 / zoom, 8 / zoom, 8 / zoom);
          }
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
  const onDown = (event: React.PointerEvent<HTMLCanvasElement>) => {
    if (!sourceSize) return;
    const point = toImage(event);
    setPointer(point);
    event.currentTarget.setPointerCapture(event.pointerId);
    const selectedFrame = drafts.find((frame) => selected.includes(frame.id));
    const handle =
      selected.length === 1 && selectedFrame
        ? hitHandle(selectedFrame.sourceRect, point, zoom)
        : undefined;
    const hit = [...drafts]
      .reverse()
      .find(
        (frame) =>
          point.x >= frame.sourceRect.x &&
          point.x <= frame.sourceRect.x + frame.sourceRect.width &&
          point.y >= frame.sourceRect.y &&
          point.y <= frame.sourceRect.y + frame.sourceRect.height,
      );
    if (tool === "pan" || event.button === 1 || event.shiftKey) {
      drag.current = { kind: "pan", start: { x: event.clientX, y: event.clientY }, origin: null };
      return;
    }
    if (tool === "add" && !disabled) {
      drag.current = {
        kind: "add",
        start: point,
        origin: { x: point.x, y: point.y, width: 1, height: 1 },
      };
      return;
    }
    if (tool === "split" && hit && !disabled) {
      setSelection([hit.id]);
      drag.current = { kind: "split", start: point, origin: hit.sourceRect, ids: [hit.id] };
      return;
    }
    if (handle && selectedFrame && !disabled) {
      drag.current = { kind: "resize", start: point, origin: selectedFrame.sourceRect, handle };
      return;
    }
    if (hit) {
      const ids = event.ctrlKey
        ? selected.includes(hit.id)
          ? selected.filter((id) => id !== hit.id)
          : [...selected, hit.id]
        : selected.includes(hit.id)
          ? selected
          : [hit.id];
      setSelection(ids);
      drag.current = {
        kind: "move",
        start: point,
        origin: hit.sourceRect,
        ids,
        initialRects: Object.fromEntries(
          ids.flatMap((id) => {
            const frame = drafts.find((entry) => entry.id === id);
            return frame ? [[id, frame.sourceRect]] : [];
          }),
        ),
      };
      return;
    }
    setSelection([]);
    drag.current = { kind: "marquee", start: point, origin: null };
  };
  const onMove = (event: React.PointerEvent<HTMLCanvasElement>) => {
    if (!sourceSize) return;
    const point = toImage(event);
    setPointer(point);
    const current = drag.current;
    if (!current) return;
    if (current.kind === "pan") {
      setViewport(zoom, {
        x: pan.x + event.clientX - current.start.x,
        y: pan.y + event.clientY - current.start.y,
      });
      current.start = { x: event.clientX, y: event.clientY };
      return;
    }
    if (current.kind === "move" && current.origin && !disabled) {
      const dx = point.x - current.start.x;
      const dy = point.y - current.start.y;
      setGestureRects(
        Object.fromEntries(
          Object.entries(current.initialRects ?? {}).map(([id, rect]) => [
            id,
            contained({ ...rect, x: rect.x + dx, y: rect.y + dy }, sourceSize),
          ]),
        ),
      );
      return;
    }
    if (current.kind === "resize" && current.origin && current.handle && !disabled) {
      const r = current.origin;
      let left = r.x,
        top = r.y,
        right = r.x + r.width,
        bottom = r.y + r.height;
      if (current.handle.includes("w")) left = point.x;
      if (current.handle.includes("e")) right = point.x;
      if (current.handle.includes("n")) top = point.y;
      if (current.handle.includes("s")) bottom = point.y;
      const selectedId = selected[0];
      if (selectedId)
        setGestureRects({
          [selectedId]: contained(
            {
              x: Math.min(left, right),
              y: Math.min(top, bottom),
              width: Math.max(1, Math.abs(right - left)),
              height: Math.max(1, Math.abs(bottom - top)),
            },
            sourceSize,
          ),
        });
    }
  };
  const onUp = (event: React.PointerEvent<HTMLCanvasElement>) => {
    if (!sourceSize || !drag.current) return;
    const point = toImage(event);
    const current = drag.current;
    if (current.kind === "add" && !disabled) {
      addDraft(
        contained(
          {
            x: Math.min(current.start.x, point.x),
            y: Math.min(current.start.y, point.y),
            width: Math.max(1, Math.abs(point.x - current.start.x)),
            height: Math.max(1, Math.abs(point.y - current.start.y)),
          },
          sourceSize,
        ),
      );
    }
    if ((current.kind === "move" || current.kind === "resize") && !disabled) {
      if (Object.keys(gestureRects).length) updateRects(gestureRects);
      setGestureRects({});
    }
    if (current.kind === "split" && current.origin && current.ids?.[0] && !disabled) {
      const dx = Math.abs(point.x - current.start.x);
      const dy = Math.abs(point.y - current.start.y);
      if (Math.max(dx, dy) >= 3) {
        const axis = dx >= dy ? "vertical" : "horizontal";
        const cut = axis === "vertical" ? point.x : point.y;
        splitSelected(axis, Math.round(cut));
      }
    }
    if (current.kind === "marquee") {
      const x = Math.min(current.start.x, point.x),
        y = Math.min(current.start.y, point.y),
        right = Math.max(current.start.x, point.x),
        bottom = Math.max(current.start.y, point.y);
      if (Math.hypot(point.x - current.start.x, point.y - current.start.y) >= 3)
        setSelection(
          drafts
            .filter(
              (frame) =>
                frame.sourceRect.x < right &&
                frame.sourceRect.x + frame.sourceRect.width > x &&
                frame.sourceRect.y < bottom &&
                frame.sourceRect.y + frame.sourceRect.height > y,
            )
            .map((frame) => frame.id),
        );
    }
    drag.current = null;
  };
  const fit = () => {
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
  };
  useEffect(() => {
    fit();
  }, [fit]);
  useEffect(() => {
    window.addEventListener("spriteflow-fit", fit);
    return () => window.removeEventListener("spriteflow-fit", fit);
  });
  return (
    <div className="canvas-host" ref={hostRef}>
      <canvas
        ref={canvasRef}
        aria-label="Sprite sheet editor"
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

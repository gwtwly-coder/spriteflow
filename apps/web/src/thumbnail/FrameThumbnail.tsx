import type { AssetRef, Frame, PixelBuffer } from "@spriteflow/pipeline";
import { useEffect, useRef, useState } from "react";
import { type FrameThumbnailService, THUMBNAIL_MAX_DIMENSION } from "./frame-thumbnail-service";

export function drawFrameThumbnail(canvas: HTMLCanvasElement, frame: Frame, pixels: PixelBuffer) {
  const context = canvas.getContext("2d");
  if (!context) return;
  canvas.width = THUMBNAIL_MAX_DIMENSION;
  canvas.height = THUMBNAIL_MAX_DIMENSION;
  context.clearRect(0, 0, canvas.width, canvas.height);
  drawFramePixels(canvas, frame, pixels, THUMBNAIL_MAX_DIMENSION);
}

export function drawFramePixels(
  canvas: HTMLCanvasElement,
  frame: Frame,
  pixels: PixelBuffer,
  dimension: number,
  alpha = 1,
) {
  const context = canvas.getContext("2d");
  if (!context || !frame.bbox) return;
  const crop = document.createElement("canvas");
  crop.width = pixels.width;
  crop.height = pixels.height;
  const cropContext = crop.getContext("2d");
  if (!cropContext) return;
  cropContext.putImageData(
    new ImageData(new Uint8ClampedArray(pixels.data), pixels.width, pixels.height),
    0,
    0,
  );
  const scale = Math.min(dimension / frame.canvas.width, dimension / frame.canvas.height);
  const left = (dimension - frame.canvas.width * scale) / 2 + frame.canvas.offset.x * scale;
  const top = (dimension - frame.canvas.height * scale) / 2 + frame.canvas.offset.y * scale;
  context.imageSmoothingEnabled = false;
  context.globalAlpha = alpha;
  context.drawImage(crop, left, top, frame.bbox.width * scale, frame.bbox.height * scale);
  context.globalAlpha = 1;
}

export function FrameThumbnail({
  asset,
  frame,
  scope,
  service,
  index,
}: {
  asset: AssetRef | null;
  frame: Frame | undefined;
  scope: string;
  service: FrameThumbnailService;
  index: number;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [nearViewport, setNearViewport] = useState(false);

  useEffect(() => {
    const node = canvasRef.current;
    if (!node) return;
    if (typeof IntersectionObserver === "undefined") {
      setNearViewport(true);
      return;
    }
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          setNearViewport(true);
          observer.disconnect();
        }
      },
      { rootMargin: "192px" },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (!nearViewport || !asset || !frame?.bbox || frame.flags.empty) return;
    let cancelled = false;
    void service
      .requestThumbnail(asset, frame, scope)
      .then((pixels) => {
        if (!cancelled && canvasRef.current) drawFrameThumbnail(canvasRef.current, frame, pixels);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [asset, frame, nearViewport, scope, service]);

  return (
    <canvas
      aria-label={`Frame thumbnail ${index + 1}`}
      className={frame?.flags.empty ? "thumb empty-dot" : "thumb"}
      height={THUMBNAIL_MAX_DIMENSION}
      ref={canvasRef}
      width={THUMBNAIL_MAX_DIMENSION}
    />
  );
}

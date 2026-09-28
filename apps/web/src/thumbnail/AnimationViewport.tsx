import type { AssetRef, Frame, PixelBuffer } from "@spriteflow/pipeline";
import { useEffect, useRef, useState } from "react";
import { drawFramePixels } from "./FrameThumbnail";
import type { FrameThumbnailService } from "./frame-thumbnail-service";

const VIEWPORT_SIZE = 128;

export function AnimationViewport({
  asset,
  frames,
  playhead,
  onion,
  scope,
  service,
  title,
  busyLabel,
}: {
  asset: AssetRef | null;
  frames: Frame[];
  playhead: number;
  onion: boolean;
  scope: string;
  service: FrameThumbnailService;
  title: string;
  busyLabel: string;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [pixels, setPixels] = useState(new Map<string, PixelBuffer>());
  const pixelsScope = useRef(scope);
  const [renderedFrameId, setRenderedFrameId] = useState<string | null>(null);
  const current = frames[playhead];

  useEffect(() => {
    if (pixelsScope.current === scope) return;
    pixelsScope.current = scope;
    setPixels(new Map());
    setRenderedFrameId(null);
  }, [scope]);

  useEffect(() => {
    if (!asset || !frames.length) return;
    const wanted = new Set<number>();
    for (let offset = -8; offset <= 8; offset += 1) {
      const index = playhead + offset;
      if (index >= 0 && index < frames.length && frames[index]?.bbox) wanted.add(index);
    }
    let cancelled = false;
    for (const index of wanted) {
      const frame = frames[index];
      if (!frame || pixels.has(frame.id)) continue;
      void service
        .requestPlayer(asset, frame, scope)
        .then((next) => {
          if (cancelled) return;
          setPixels((known) => new Map(known).set(frame.id, next));
        })
        .catch(() => undefined);
    }
    return () => {
      cancelled = true;
    };
  }, [asset, frames, pixels, playhead, scope, service]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ratio = Math.min(window.devicePixelRatio || 1, 2.5);
    const dimension = Math.round(VIEWPORT_SIZE * ratio);
    canvas.width = dimension;
    canvas.height = dimension;
    const context = canvas.getContext("2d");
    if (!context) return;
    context.clearRect(0, 0, dimension, dimension);
    const draw = (index: number, alpha: number) => {
      const frame = frames[index];
      const source = frame && pixels.get(frame.id);
      if (frame && source) drawFramePixels(canvas, frame, source, dimension, alpha);
    };
    if (onion) {
      draw(playhead - 1, 0.3);
      draw(playhead + 1, 0.2);
    }
    const active = current && pixels.get(current.id);
    if (current && active) {
      draw(playhead, 1);
      setRenderedFrameId(current.id);
    }
  }, [current, frames, onion, pixels, playhead]);

  return (
    <section aria-label={title} className="animation-viewport">
      <b>{title}</b>
      <canvas className="animation-canvas" ref={canvasRef} />
      {renderedFrameId !== current?.id && current?.bbox && (
        <output aria-label={busyLabel} className="viewport-loading" />
      )}
      <span className="viewport-caption">{playhead + 1}</span>
    </section>
  );
}

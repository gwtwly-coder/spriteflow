import type { Frame, PixelBuffer } from "@spriteflow/pipeline";
import { render, waitFor } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import { AnimationViewport } from "../src/thumbnail/AnimationViewport";
import { FrameThumbnail } from "../src/thumbnail/FrameThumbnail";
import type { FrameThumbnailService } from "../src/thumbnail/frame-thumbnail-service";

const frame: Frame = {
  asset: { assetId: "asset", revision: 1 },
  bbox: { height: 2, width: 2, x: 0, y: 0 },
  canvas: { height: 4, offset: { x: 1, y: 1 }, width: 4 },
  clusterId: null,
  flags: {
    duplicateOf: null,
    edited: false,
    empty: false,
    merged: false,
    multipleComponents: false,
    outlier: false,
  },
  id: "frame",
  included: true,
  name: "frame",
  origin: "grid",
  pHash: null,
  reviewStatus: "accepted",
  sourceFrameIds: [],
  sourceRect: { height: 2, width: 2, x: 0, y: 0 },
};
const pixels: PixelBuffer = {
  alphaMode: "straight",
  colorSpace: "srgb",
  data: new Uint8ClampedArray([255, 0, 0, 255, 255, 0, 0, 255, 255, 0, 0, 255, 255, 0, 0, 255]),
  format: "rgba8",
  height: 2,
  width: 2,
};

it("composites a non-transparent preview crop into the thumbnail canvas", async () => {
  const alpha = new WeakMap<HTMLCanvasElement, Uint8ClampedArray>();
  const source = new WeakMap<HTMLCanvasElement, Uint8ClampedArray>();
  class TestImageData {
    constructor(
      readonly data: Uint8ClampedArray,
      readonly width: number,
      readonly height: number,
    ) {}
  }
  vi.stubGlobal("ImageData", TestImageData);
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation(function (
    this: HTMLCanvasElement,
  ) {
    return {
      clearRect: () => alpha.set(this, new Uint8ClampedArray(this.width * this.height)),
      drawImage: (crop: HTMLCanvasElement) => {
        const input = source.get(crop) ?? new Uint8ClampedArray();
        alpha.set(this, new Uint8ClampedArray([input[3] ?? 0]));
      },
      putImageData: (image: TestImageData) => source.set(this, image.data),
      set imageSmoothingEnabled(_: boolean) {},
    } as unknown as CanvasRenderingContext2D;
  });
  const service = {
    requestThumbnail: vi.fn().mockResolvedValue(pixels),
  } as unknown as FrameThumbnailService;
  const { container } = render(
    <FrameThumbnail
      asset={frame.asset}
      frame={frame}
      index={0}
      scope="normalization-a"
      service={service}
    />,
  );

  await waitFor(() =>
    expect(service.requestThumbnail).toHaveBeenCalledWith(frame.asset, frame, "normalization-a"),
  );
  await waitFor(() => {
    const canvas = container.querySelector<HTMLCanvasElement>("canvas.thumb");
    expect(canvas).toBeTruthy();
    expect((alpha.get(canvas as HTMLCanvasElement) ?? []).some((value) => value > 0)).toBe(true);
  });
});

it("preloads the playback window and composites both onion-skin alpha layers", async () => {
  const alphas: number[] = [];
  class TestImageData {
    constructor(
      readonly data: Uint8ClampedArray,
      readonly width: number,
      readonly height: number,
    ) {}
  }
  vi.stubGlobal("ImageData", TestImageData);
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation(() => {
    let alpha = 1;
    return {
      clearRect: vi.fn(),
      drawImage: vi.fn(() => alphas.push(alpha)),
      putImageData: vi.fn(),
      set globalAlpha(value: number) {
        alpha = value;
      },
      set imageSmoothingEnabled(_: boolean) {},
    } as unknown as CanvasRenderingContext2D;
  });
  const frames = [
    { ...frame, id: "previous" },
    { ...frame, id: "current" },
    { ...frame, id: "next" },
  ];
  const service = {
    requestPlayer: vi.fn().mockResolvedValue(pixels),
  } as unknown as FrameThumbnailService;
  const { container } = render(
    <AnimationViewport
      asset={frame.asset}
      busyLabel="Loading"
      frames={frames}
      onion
      playhead={1}
      scope="normalization-a"
      service={service}
      title="Animation preview"
      viewportLoading="Loading preview frame"
      frameCaption="Frame 2 of 3"
    />,
  );

  await waitFor(() => expect(service.requestPlayer).toHaveBeenCalledTimes(3));
  await waitFor(() => expect(alphas).toEqual(expect.arrayContaining([0.3, 0.2, 1])));
  expect(container.querySelector("canvas.animation-canvas")).toBeTruthy();
});

it("keeps the previous canvas pixels while the next playback crop is delayed", async () => {
  const alpha = new WeakMap<HTMLCanvasElement, Uint8ClampedArray>();
  const source = new WeakMap<HTMLCanvasElement, Uint8ClampedArray>();
  class TestImageData {
    constructor(
      readonly data: Uint8ClampedArray,
      readonly width: number,
      readonly height: number,
    ) {}
  }
  vi.stubGlobal("ImageData", TestImageData);
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation(function (
    this: HTMLCanvasElement,
  ) {
    return {
      clearRect: () => alpha.set(this, new Uint8ClampedArray(this.width * this.height)),
      drawImage: (crop: HTMLCanvasElement) => {
        const input = source.get(crop) ?? new Uint8ClampedArray();
        alpha.set(this, new Uint8ClampedArray([input[3] ?? 0]));
      },
      putImageData: (image: TestImageData) => source.set(this, image.data),
      set imageSmoothingEnabled(_: boolean) {},
    } as unknown as CanvasRenderingContext2D;
  });
  const frames = [
    { ...frame, id: "ready" },
    { ...frame, id: "delayed" },
  ];
  const delayed = new Promise<PixelBuffer>(() => undefined);
  const service = {
    requestPlayer: vi.fn((_: unknown, target: Frame) =>
      target.id === "ready" ? Promise.resolve(pixels) : delayed,
    ),
  } as unknown as FrameThumbnailService;
  const props = {
    asset: frame.asset,
    busyLabel: "Loading",
    frames,
    onion: false,
    scope: "normalization-a",
    service,
    title: "Animation preview",
    viewportLoading: "Loading preview frame",
  };
  const { container, rerender } = render(
    <AnimationViewport {...props} frameCaption="Frame 1 of 2" playhead={0} />,
  );
  const canvas = container.querySelector<HTMLCanvasElement>("canvas.animation-canvas");
  if (!canvas) throw new Error("Playback canvas is missing");
  await waitFor(() => expect((alpha.get(canvas) ?? []).some((value) => value > 0)).toBe(true));

  rerender(<AnimationViewport {...props} frameCaption="Frame 2 of 2" playhead={1} />);
  expect((alpha.get(canvas) ?? []).some((value) => value > 0)).toBe(true);
});

beforeEach(() => {
  vi.restoreAllMocks();
});

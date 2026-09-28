import { render } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { CanvasEditor } from "../src/editor/CanvasEditor";
import { useEditorStore } from "../src/store/editor-store";

type Call = { method: string; args: unknown[] };

const recorded: Call[] = [];

const makeContext = () => {
  const context: Record<string, unknown> = {
    canvas: null,
    imageSmoothingEnabled: true,
    fillStyle: "",
    strokeStyle: "",
    lineWidth: 1,
    font: "",
    globalAlpha: 1,
  };
  return new Proxy(context, {
    get(target, prop) {
      if (typeof prop !== "string") return undefined;
      if (prop in target) return target[prop];
      if (prop === "createPattern")
        return (...args: unknown[]) => {
          recorded.push({ method: "createPattern", args });
          return { __pattern: true };
        };
      return (...args: unknown[]) => {
        recorded.push({ method: prop, args });
        return undefined;
      };
    },
    set(target, prop, value) {
      if (typeof prop === "string") target[prop] = value;
      return true;
    },
  });
};

const preview = {
  format: "rgba8" as const,
  colorSpace: "srgb" as const,
  alphaMode: "straight" as const,
  data: new Uint8ClampedArray([255, 0, 0, 255]),
  width: 1,
  height: 1,
};

describe("canvas editor transparent-area backing", () => {
  beforeEach(() => {
    recorded.length = 0;
    vi.stubGlobal(
      "ImageData",
      class {
        data: Uint8ClampedArray;
        width: number;
        height: number;
        constructor(data: Uint8ClampedArray, width: number, height: number) {
          this.data = data;
          this.width = width;
          this.height = height;
        }
      },
    );
    useEditorStore.setState({
      drafts: [],
      normalized: [],
      selected: [],
      tool: "select",
      filter: "all",
      zoom: 1,
      pan: { x: 0, y: 0 },
    });
    // jsdom's default getContext mock returns null; record paint calls instead.
    Object.defineProperty(HTMLCanvasElement.prototype, "getContext", {
      configurable: true,
      value: vi.fn(() => makeContext()),
    });
  });

  it("backs the image rectangle with a 16×16 checker tile, never the source image", () => {
    render(
      <CanvasEditor
        preview={preview}
        sourceSize={{ width: 1536, height: 1024 }}
        disabled={false}
      />,
    );

    const patterns = recorded.filter(({ method }) => method === "createPattern");
    expect(patterns.length).toBeGreaterThan(0);
    for (const { args } of patterns) {
      const tile = args[0] as HTMLCanvasElement;
      expect(tile.width).toBe(16);
      expect(tile.height).toBe(16);
    }

    // The backing rectangle and the bitmap stretch must cover exactly the working rect.
    // (Tile generation itself also issues fillRect calls; filter by the working rect.)
    const backing = recorded.find(
      ({ method, args }) => method === "fillRect" && args[2] === 1536 && args[3] === 1024,
    );
    expect(backing?.args).toEqual([0, 0, 1536, 1024]);
    const draw = recorded.find(({ method }) => method === "drawImage");
    expect(draw?.args).toEqual([expect.anything(), 0, 0, 1536, 1024]);
    const bitmap = draw?.args[0] as HTMLCanvasElement;
    expect(bitmap.width).toBe(preview.width);
    expect(bitmap.height).toBe(preview.height);
  });
});

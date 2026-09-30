// PartAsset pure-function tests (docs/interface-contract-v3.md section 2, :229-246):
// validation branches, pixel-invariant extraction, SAM wrapping, immutable removal.
import { describe, expect, it } from "vitest";
import { createBitMask, getMaskBit, maskBounds, setMaskBit } from "../src/bitmask.js";
import {
  createPartAsset,
  extractPartPixels,
  removePartAsset,
  validatePartAsset,
} from "../src/partAsset.js";
import { type BitMask, type PartAsset, PartKind, type SamMaskResult } from "../src/types.js";
import { asset, paint, paintGradient, value } from "./helpers.js";

const SOURCE_RECT = { x: 2, y: 3, width: 8, height: 4 };

function baseMask(): BitMask {
  const mask = createBitMask(SOURCE_RECT.width, SOURCE_RECT.height);
  setMaskBit(mask, 1, 0, true);
  setMaskBit(mask, 5, 2, true);
  return mask;
}

function basePart(): PartAsset {
  return {
    id: "part-1",
    asset: { assetId: "fixture", revision: 1 },
    name: "Torso",
    kind: PartKind.Torso,
    sourceRect: { ...SOURCE_RECT },
    mask: baseMask(),
    canvas: { width: SOURCE_RECT.width, height: SOURCE_RECT.height, offset: { x: 0, y: 0 } },
    confidence: 0.9,
    occluded: false,
    visibleFraction: 0.25,
  };
}

function baseSamResult(): SamMaskResult {
  return {
    asset: { assetId: "fixture", revision: 1 },
    mask: baseMask(),
    sourceRect: { ...SOURCE_RECT },
    predictedIou: 0.87,
    provider: "webgpu",
  };
}

describe("validatePartAsset", () => {
  it("accepts a well-formed part", () => {
    expect(validatePartAsset(asset(), basePart()).ok).toBe(true);
  });

  it("rejects empty id, empty name and unknown kinds", () => {
    const emptyId = { ...basePart(), id: "" };
    const result = validatePartAsset(asset(), emptyId);
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("unreachable");
    expect(result.error.code).toBe("INVALID_ARGUMENT");
    expect(result.error.details.field).toBe("part.id");

    const emptyName = { ...basePart(), name: "" };
    const nameResult = validatePartAsset(asset(), emptyName);
    expect(nameResult.ok).toBe(false);
    if (nameResult.ok) throw new Error("unreachable");
    expect(nameResult.error.details.field).toBe("part.name");

    const unknownKind = { ...basePart(), kind: "spoon" as PartKind };
    const kindResult = validatePartAsset(asset(), unknownKind);
    expect(kindResult.ok).toBe(false);
    if (kindResult.ok) throw new Error("unreachable");
    expect(kindResult.error.details.field).toBe("part.kind");
  });

  it("rejects a part whose asset reference differs from the input asset", () => {
    const part = { ...basePart(), asset: { assetId: "fixture", revision: 2 } };
    const result = validatePartAsset(asset(), part);
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("unreachable");
    expect(result.error.code).toBe("ASSET_MISMATCH");
  });

  it("rejects non-integer and out-of-bounds sourceRects", () => {
    const source = asset(32, 24);
    expect(
      validatePartAsset(source, { ...basePart(), sourceRect: { x: -1, y: 3, width: 8, height: 4 } })
        .ok,
    ).toBe(false);
    expect(
      validatePartAsset(source, { ...basePart(), sourceRect: { x: 0, y: 0, width: 0, height: 4 } })
        .ok,
    ).toBe(false);
    expect(
      validatePartAsset(source, { ...basePart(), sourceRect: { x: 30, y: 0, width: 8, height: 4 } })
        .ok,
    ).toBe(false); // 30+8 > 32
    expect(
      validatePartAsset(source, {
        ...basePart(),
        sourceRect: { x: 0, y: 0, width: 8.5, height: 4 },
      }).ok,
    ).toBe(false);
  });

  it("rejects mask structural faults: wrong dims, length, encoding and padding", () => {
    const source = asset();
    const wrongDims = { ...basePart(), mask: createBitMask(4, 4) };
    expect(validatePartAsset(source, wrongDims).ok).toBe(false);

    const wrongLength = basePart();
    wrongLength.mask.data = new Uint8Array(99);
    expect(validatePartAsset(source, wrongLength).ok).toBe(false);

    const wrongEncoding = basePart();
    wrongEncoding.mask.encoding = "row-bytes" as never;
    expect(validatePartAsset(source, wrongEncoding).ok).toBe(false);

    const padded = { ...basePart(), mask: createBitMask(5, 4) }; // 20 bits, last byte has 4 padding bits
    padded.mask.data[padded.mask.data.length - 1] = 0b0001_0000; // padding bit set
    expect(validatePartAsset(source, padded).ok).toBe(false);
  });

  it("rejects canvas size drift and non-zero v3.0 offsets", () => {
    const source = asset();
    const drifted = {
      ...basePart(),
      canvas: { width: 7, height: 4, offset: { x: 0, y: 0 } },
    };
    const driftResult = validatePartAsset(source, drifted);
    expect(driftResult.ok).toBe(false);
    if (driftResult.ok) throw new Error("unreachable");
    expect(driftResult.error.details.field).toBe("part.canvas.size");

    const shifted = {
      ...basePart(),
      canvas: { width: 8, height: 4, offset: { x: 1, y: 0 } },
    };
    const shiftResult = validatePartAsset(source, shifted);
    expect(shiftResult.ok).toBe(false);
    if (shiftResult.ok) throw new Error("unreachable");
    expect(shiftResult.error.details.field).toBe("part.canvas.offset");
  });

  it("rejects confidence and visibleFraction outside [0,1]", () => {
    const source = asset();
    expect(validatePartAsset(source, { ...basePart(), confidence: 1.5 }).ok).toBe(false);
    expect(validatePartAsset(source, { ...basePart(), confidence: -0.01 }).ok).toBe(false);
    expect(validatePartAsset(source, { ...basePart(), visibleFraction: 2 }).ok).toBe(false);
  });
});

describe("extractPartPixels", () => {
  it("produces a sourceRect-sized buffer honoring the three pixel assertions", () => {
    const source = paintGradient(asset(32, 24));
    // mask=1 pixel sitting on a fully transparent source pixel
    paint(source, { x: 3, y: 3, width: 1, height: 1 }, [10, 20, 30, 0]);
    const part = basePart();
    const pixels = value(extractPartPixels(source, part));

    expect(pixels.width).toBe(8);
    expect(pixels.height).toBe(4);
    expect(pixels.format).toBe("rgba8");
    expect(pixels.colorSpace).toBe("srgb");
    expect(pixels.alphaMode).toBe("straight");
    expect(pixels.data).toBeInstanceOf(Uint8ClampedArray);

    const sourceData = source.pixels.data;
    for (let y = 0; y < 4; y++) {
      for (let x = 0; x < 8; x++) {
        const target = (y * 8 + x) * 4;
        const sourceOffset = ((3 + y) * 32 + (2 + x)) * 4;
        if (getMaskBit(part.mask, x, y)) {
          // assertion 1+2: mask=1 copies the source RGBA verbatim (alpha=0 stays 0)
          expect(Array.from(pixels.data.slice(target, target + 4))).toEqual(
            Array.from(sourceData.slice(sourceOffset, sourceOffset + 4)),
          );
          expect(pixels.data[target + 3]).toBeLessThanOrEqual(sourceData[sourceOffset + 3] ?? 0);
        } else {
          // assertion 3: mask=0 pixels are fully transparent
          expect(Array.from(pixels.data.slice(target, target + 4))).toEqual([0, 0, 0, 0]);
        }
      }
    }
    // the mask=1 pixel over a transparent source keeps alpha 0 with verbatim RGB
    expect(Array.from(pixels.data.slice(4, 8))).toEqual([10, 20, 30, 0]);
  });

  it("maps tight-crop coordinates as sourceRect + maskBounds origin + local point", () => {
    const source = paintGradient(asset(32, 24));
    const part = basePart();
    const bounds = maskBounds(part.mask);
    expect(bounds).toEqual({ x: 1, y: 0, width: 5, height: 3 });
    if (!bounds) throw new Error("maskBounds returned null");

    const pixels = value(extractPartPixels(source, part));
    const tightLocal = { x: 4, y: 2 }; // inside bounds, mask bit set at local (5,2)
    const outputX = bounds.x + tightLocal.x;
    const outputY = bounds.y + tightLocal.y;
    const sourceX = SOURCE_RECT.x + outputX;
    const sourceY = SOURCE_RECT.y + outputY;
    const target = (outputY * 8 + outputX) * 4;
    const sourceOffset = (sourceY * 32 + sourceX) * 4;
    expect(Array.from(pixels.data.slice(target, target + 4))).toEqual(
      Array.from(source.pixels.data.slice(sourceOffset, sourceOffset + 4)),
    );
  });

  it("never modifies the input asset and rejects foreign references", () => {
    const source = paintGradient(asset(32, 24));
    const snapshot = Array.from(source.pixels.data);
    value(extractPartPixels(source, basePart()));
    expect(Array.from(source.pixels.data)).toEqual(snapshot);

    const foreign = { ...basePart(), asset: { assetId: "other", revision: 1 } };
    const result = extractPartPixels(source, foreign);
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("unreachable");
    expect(result.error.code).toBe("ASSET_MISMATCH");
  });
});

describe("createPartAsset", () => {
  it("wraps a SAM mask into a validated part with package-generated identity", () => {
    const source = asset();
    const result = value(createPartAsset(source, PartKind.Hair, "Front hair", baseSamResult()));
    expect(validatePartAsset(source, result).ok).toBe(true);
    expect(result.id).toMatch(/^part_/);
    expect(result.asset).toEqual({ assetId: "fixture", revision: 1 });
    expect(result.name).toBe("Front hair");
    expect(result.kind).toBe(PartKind.Hair);
    expect(result.confidence).toBe(0.87);
    expect(result.occluded).toBe(false);
    expect(result.visibleFraction).toBe(2 / 32);
    expect(result.canvas).toEqual({ width: 8, height: 4, offset: { x: 0, y: 0 } });
  });

  it("mints unique ids and copies mask bytes", () => {
    const source = asset();
    const sam = baseSamResult();
    const first = value(createPartAsset(source, PartKind.Hair, "a", sam));
    const second = value(createPartAsset(source, PartKind.Torso, "b", sam));
    expect(first.id).not.toBe(second.id);

    sam.mask.data[0] = 0xff; // late in-place SAM edit must not leak into created parts
    expect(Array.from(first.mask.data)).not.toEqual(Array.from(sam.mask.data));
  });

  it("rejects reference mismatch, bad kind/name, bad rects, IOU, provider and masks", () => {
    const source = asset();
    const mismatch = { ...baseSamResult(), asset: { assetId: "fixture", revision: 9 } };
    const mismatchResult = createPartAsset(source, PartKind.Hair, "a", mismatch);
    expect(mismatchResult.ok).toBe(false);
    if (mismatchResult.ok) throw new Error("unreachable");
    expect(mismatchResult.error.code).toBe("ASSET_MISMATCH");

    expect(createPartAsset(source, "spoon" as PartKind, "a", baseSamResult()).ok).toBe(false);
    expect(createPartAsset(source, PartKind.Hair, "", baseSamResult()).ok).toBe(false);
    expect(
      createPartAsset(source, PartKind.Hair, "a", {
        ...baseSamResult(),
        sourceRect: { x: 30, y: 0, width: 8, height: 4 },
      }).ok,
    ).toBe(false);
    expect(
      createPartAsset(source, PartKind.Hair, "a", { ...baseSamResult(), predictedIou: 1.5 }).ok,
    ).toBe(false);
    expect(
      createPartAsset(source, PartKind.Hair, "a", {
        ...baseSamResult(),
        provider: "cuda" as never,
      }).ok,
    ).toBe(false);
    const badMask = baseSamResult();
    badMask.mask.data = new Uint8Array(1);
    expect(createPartAsset(source, PartKind.Hair, "a", badMask).ok).toBe(false);
  });
});

describe("removePartAsset", () => {
  it("returns a new array without the target part, leaving the input intact", () => {
    const first = { ...basePart(), id: "part-1" };
    const second = { ...basePart(), id: "part-2" };
    const parts = [first, second];
    const result = value(removePartAsset(parts, "part-1"));
    expect(result).toHaveLength(1);
    expect(result[0]?.id).toBe("part-2");
    expect(result).not.toBe(parts);
    expect(parts).toHaveLength(2);
    expect(parts[0]?.id).toBe("part-1");
  });

  it("rejects unknown and empty ids", () => {
    const parts = [basePart()];
    const unknown = removePartAsset(parts, "nope");
    expect(unknown.ok).toBe(false);
    if (unknown.ok) throw new Error("unreachable");
    expect(unknown.error.code).toBe("INVALID_ARGUMENT");
    expect(removePartAsset(parts, "").ok).toBe(false);
  });
});

// BitMask packing tests (docs/interface-contract-v3.md section 2, :111): row-major,
// LSB-first, strict ceil(w*h/8) length, zeroed high bits in the last byte.
import { describe, expect, it } from "vitest";
import {
  applyMaskEdits,
  countSetBits,
  createBitMask,
  getMaskBit,
  maskBounds,
  setMaskBit,
  validateBitMask,
} from "../src/bitmask.js";
import type { MaskEdit } from "../src/types.js";

describe("BitMask packing", () => {
  it("allocates ceil(w*h/8) zeroed bytes with the contract encoding literal", () => {
    const mask = createBitMask(9, 2);
    expect(mask.encoding).toBe("bitset-lsb0-row-major");
    expect(mask.width).toBe(9);
    expect(mask.height).toBe(2);
    expect(mask.data.length).toBe(Math.ceil((9 * 2) / 8));
    expect(mask.data.length).toBe(3);
    expect(Array.from(mask.data)).toEqual([0, 0, 0]);
  });

  it("round-trips bits in LSB-first order within each byte", () => {
    const mask = createBitMask(9, 2);
    setMaskBit(mask, 0, 0, true);
    setMaskBit(mask, 8, 0, true);
    setMaskBit(mask, 1, 1, true);
    expect(getMaskBit(mask, 0, 0)).toBe(true);
    expect(getMaskBit(mask, 8, 0)).toBe(true);
    expect(getMaskBit(mask, 1, 1)).toBe(true);
    expect(getMaskBit(mask, 7, 0)).toBe(false);
    expect(getMaskBit(mask, 8, 1)).toBe(false);
    // index 0 -> byte 0 bit 0; index 8 -> byte 1 bit 0; index 10 -> byte 1 bit 2.
    expect(mask.data[0]).toBe(0b0000_0001);
    expect(mask.data[1]).toBe(0b0000_0101);
    expect(mask.data[2]).toBe(0);
  });

  it("keeps row-major indexing across rows", () => {
    const mask = createBitMask(3, 3);
    setMaskBit(mask, 2, 1, true); // index 5 -> byte 0 bit 5
    expect(getMaskBit(mask, 2, 1)).toBe(true);
    expect(mask.data[0]).toBe(0b0010_0000);
    expect(mask.data[1]).toBe(0);
  });

  it("counts set bits", () => {
    const mask = createBitMask(8, 8);
    setMaskBit(mask, 0, 0, true);
    setMaskBit(mask, 7, 0, true);
    setMaskBit(mask, 7, 7, true);
    expect(countSetBits(mask)).toBe(3);
  });
});

describe("validateBitMask", () => {
  it("accepts a well-formed mask with padding bits clear", () => {
    const mask = createBitMask(9, 1); // 9 used bits, 1 byte padding
    setMaskBit(mask, 8, 0, true); // bit 0 of the last byte
    expect(validateBitMask(mask).ok).toBe(true);
  });

  it("rejects nonzero unused high bits in the last byte", () => {
    const mask = createBitMask(9, 1); // 9 used bits -> 7 unused padding bits
    expect(validateBitMask(mask).ok).toBe(true);
    const corrupt = createBitMask(9, 1);
    corrupt.data[corrupt.data.length - 1] = 0b0000_0010; // bit 1 is padding
    const corrupted = validateBitMask(corrupt);
    expect(corrupted.ok).toBe(false);
    if (corrupted.ok) throw new Error("unreachable");
    expect(corrupted.error.details.field).toBe("mask.data[trailing]");
  });

  it("rejects wrong data length", () => {
    const mask = createBitMask(9, 1);
    mask.data = new Uint8Array(1);
    const result = validateBitMask(mask);
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("unreachable");
    expect(result.error.code).toBe("INVALID_MASK");
    expect(result.error.details.field).toBe("mask.data.length");
  });

  it("rejects wrong encoding, non-positive and non-integer dimensions", () => {
    const wrongEncoding = createBitMask(8, 8);
    wrongEncoding.encoding = "bitset-msb0" as never;
    expect(validateBitMask(wrongEncoding).ok).toBe(false);
    const zeroWidth = createBitMask(0, 8);
    expect(validateBitMask(zeroWidth).ok).toBe(false);
    const fractional = createBitMask(8.5, 8);
    expect(validateBitMask(fractional).ok).toBe(false);
  });

  it("rejects dimension mismatch against expected sourceRect size", () => {
    const mask = createBitMask(4, 4);
    const result = validateBitMask(mask, 8, 4);
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("unreachable");
    expect(result.error.code).toBe("INVALID_MASK");
  });
});

describe("maskBounds", () => {
  it("returns the local tight box of set bits", () => {
    const mask = createBitMask(8, 8);
    setMaskBit(mask, 2, 1, true);
    setMaskBit(mask, 4, 3, true);
    expect(maskBounds(mask)).toEqual({ x: 2, y: 1, width: 3, height: 3 });
  });

  it("returns null for an empty mask", () => {
    expect(maskBounds(createBitMask(8, 8))).toBeNull();
  });

  it("returns null for a structurally invalid mask", () => {
    const mask = createBitMask(8, 8);
    mask.data = new Uint8Array(2);
    expect(maskBounds(mask)).toBeNull();
  });
});

describe("applyMaskEdits", () => {
  it("applies positive and negative points without mutating the input", () => {
    const input = createBitMask(4, 4);
    setMaskBit(input, 2, 2, true);
    const before = Array.from(input.data);
    const edits: MaskEdit[] = [
      {
        points: [
          { point: { x: 1, y: 1 }, label: "positive" },
          { point: { x: 2, y: 2 }, label: "negative" },
        ],
      },
    ];
    const result = applyMaskEdits(input, edits);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.error.code);
    expect(getMaskBit(result.value, 1, 1)).toBe(true);
    expect(getMaskBit(result.value, 2, 2)).toBe(false);
    expect(result.value).not.toBe(input);
    expect(result.value.data).not.toBe(input.data);
    // input keeps its previous bits
    expect(Array.from(input.data)).toEqual(before);
    expect(getMaskBit(input, 1, 1)).toBe(false);
  });

  it("returns an independent copy for an empty edit list", () => {
    const input = createBitMask(4, 4);
    setMaskBit(input, 0, 0, true);
    const result = applyMaskEdits(input, []);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.error.code);
    expect(Array.from(result.value.data)).toEqual(Array.from(input.data));
    result.value.data[0] = 0xff;
    expect(input.data[0]).toBe(1);
  });

  it("rejects out-of-bounds points and keeps the input untouched", () => {
    const input = createBitMask(4, 4);
    const before = Array.from(input.data);
    const result = applyMaskEdits(input, [
      { points: [{ point: { x: 4, y: 0 }, label: "positive" }] },
    ]);
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("unreachable");
    expect(result.error.code).toBe("INVALID_ARGUMENT");
    expect(result.error.details.field).toBe("edits[0].points[0]");
    expect(Array.from(input.data)).toEqual(before);
  });

  it("rejects unknown labels, fractional points and malformed edit entries", () => {
    const input = createBitMask(4, 4);
    expect(
      applyMaskEdits(input, [{ points: [{ point: { x: 0, y: 0 }, label: "toggle" as never }] }]).ok,
    ).toBe(false);
    expect(
      applyMaskEdits(input, [{ points: [{ point: { x: 0.5, y: 0 }, label: "positive" }] }]).ok,
    ).toBe(false);
    expect(applyMaskEdits(input, [null as never]).ok).toBe(false);
    expect(applyMaskEdits(input, [{ points: [] }, {} as never]).ok).toBe(false);
  });

  it("rejects a structurally invalid input mask", () => {
    const input = createBitMask(4, 4);
    input.data = new Uint8Array(99);
    expect(applyMaskEdits(input, []).ok).toBe(false);
  });
});

// BitMask helpers (docs/interface-contract-v3.md section 2): row-major, LSB-first
// one-bit bitmap, data length is strictly ceil(width*height/8) and the unused high
// bits of the last byte must be 0.
import { characterError, failure } from "./errors.js";
import type { Rect } from "./m1.js";
import {
  type BitMask,
  CharacterErrorCode,
  type CharacterOutcome,
  CharacterStage,
  type MaskEdit,
} from "./types.js";

export const BITMASK_ENCODING = "bitset-lsb0-row-major" as const;

/** Allocates an all-zero mask of the given size. */
export function createBitMask(width: number, height: number): BitMask {
  return {
    width,
    height,
    encoding: BITMASK_ENCODING,
    data: new Uint8Array(Math.ceil((width * height) / 8)),
  };
}

/** Reads the bit at local mask coordinates (LSB-first within each byte). */
export function getMaskBit(mask: BitMask, x: number, y: number): boolean {
  const index = y * mask.width + x;
  const byte = mask.data[index >> 3];
  return byte !== undefined && (byte & (1 << (index & 7))) !== 0;
}

/** Writes the bit at local mask coordinates without touching neighbouring bits. */
export function setMaskBit(mask: BitMask, x: number, y: number, value: boolean): void {
  const index = y * mask.width + x;
  const byteIndex = index >> 3;
  const byte = mask.data[byteIndex];
  if (byte === undefined) return;
  const bit = 1 << (index & 7);
  mask.data[byteIndex] = value ? byte | bit : byte & ~bit;
}

/** Number of set bits; used for visibleFraction. */
export function countSetBits(mask: BitMask): number {
  let count = 0;
  for (const byte of mask.data) {
    let current = byte;
    while (current !== 0) {
      current &= current - 1;
      count += 1;
    }
  }
  return count;
}

/**
 * Structural validation: encoding literal, integer positive dimensions, exact
 * data length ceil(w*h/8), and zeroed trailing padding bits in the last byte.
 */
export function validateBitMask(
  mask: BitMask,
  expectedWidth?: number,
  expectedHeight?: number,
): CharacterOutcome<void> {
  const invalid = (field: string, actual: number, limit: number) =>
    failure<void>(
      characterError(CharacterErrorCode.InvalidMask, CharacterStage.MaskPostprocess, {
        details: { field, actual, limit },
      }),
    );
  if (mask.encoding !== BITMASK_ENCODING) {
    return invalid("mask.encoding", 0, 1);
  }
  if (!Number.isInteger(mask.width) || mask.width < 1) {
    return invalid("mask.width", mask.width, 1);
  }
  if (!Number.isInteger(mask.height) || mask.height < 1) {
    return invalid("mask.height", mask.height, 1);
  }
  if (expectedWidth !== undefined && mask.width !== expectedWidth) {
    return invalid("mask.width", mask.width, expectedWidth);
  }
  if (expectedHeight !== undefined && mask.height !== expectedHeight) {
    return invalid("mask.height", mask.height, expectedHeight);
  }
  if (!(mask.data instanceof Uint8Array)) {
    return invalid("mask.data", 0, 1);
  }
  const expectedLength = Math.ceil((mask.width * mask.height) / 8);
  if (mask.data.length !== expectedLength) {
    return invalid("mask.data.length", mask.data.length, expectedLength);
  }
  const usedBits = (mask.width * mask.height) & 7;
  if (usedBits !== 0) {
    const lastByte = mask.data[mask.data.length - 1] ?? 0;
    if (lastByte >>> usedBits !== 0) {
      return invalid("mask.data[trailing]", lastByte, usedBits);
    }
  }
  return { ok: true, value: undefined };
}

/**
 * Local tight bounding box of all set bits, or null when no bit is set.
 * Structurally invalid masks (wrong encoding/length) also yield null: the
 * function has no error channel, and callers must validate the mask first
 * when they need to distinguish "empty" from "invalid".
 */
export function maskBounds(mask: BitMask): Rect | null {
  if (validateBitMask(mask).ok !== true) return null;
  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  for (let y = 0; y < mask.height; y++) {
    for (let x = 0; x < mask.width; x++) {
      if (!getMaskBit(mask, x, y)) continue;
      if (x < minX) minX = x;
      if (y < minY) minY = y;
      if (x > maxX) maxX = x;
      if (y > maxY) maxY = y;
    }
  }
  if (minX > maxX || minY > maxY) return null;
  return { x: minX, y: minY, width: maxX - minX + 1, height: maxY - minY + 1 };
}

/**
 * Applies positive/negative point edits to a copy of the mask. The input mask
 * is never modified; undo stacks keep holding the previous object.
 */
export function applyMaskEdits(mask: BitMask, edits: MaskEdit[]): CharacterOutcome<BitMask> {
  const structure = validateBitMask(mask);
  if (!structure.ok) return structure;
  for (let editIndex = 0; editIndex < edits.length; editIndex++) {
    const edit = edits[editIndex];
    if (
      edit === undefined ||
      edit === null ||
      typeof edit !== "object" ||
      !Array.isArray(edit.points)
    ) {
      return failure(
        characterError(CharacterErrorCode.InvalidArgument, CharacterStage.MaskPostprocess, {
          details: { field: `edits[${editIndex}]` },
        }),
      );
    }
    for (let pointIndex = 0; pointIndex < edit.points.length; pointIndex++) {
      const point = edit.points[pointIndex]?.point;
      const label = edit.points[pointIndex]?.label;
      const field = `edits[${editIndex}].points[${pointIndex}]`;
      const isFiniteIntPoint =
        point !== undefined &&
        Number.isInteger(point.x) &&
        Number.isInteger(point.y) &&
        point.x >= 0 &&
        point.y >= 0 &&
        point.x < mask.width &&
        point.y < mask.height;
      if (!isFiniteIntPoint || (label !== "positive" && label !== "negative")) {
        return failure(
          characterError(CharacterErrorCode.InvalidArgument, CharacterStage.MaskPostprocess, {
            details: { field },
          }),
        );
      }
    }
  }
  const next: BitMask = {
    width: mask.width,
    height: mask.height,
    encoding: mask.encoding,
    data: mask.data.slice(),
  };
  for (const edit of edits) {
    for (const editPoint of edit.points) {
      setMaskBit(next, editPoint.point.x, editPoint.point.y, editPoint.label === "positive");
    }
  }
  return { ok: true, value: next };
}

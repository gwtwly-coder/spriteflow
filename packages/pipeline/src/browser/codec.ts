// biome-ignore-all lint/style/noNonNullAssertion: Container lengths and pixel bounds are validated before indexed byte access.
import { CONTRACT_VERSION, PROTOCOL_VERSION } from "../defaults.js";
import { alphaStats, resizePixels } from "../input/pixels.js";
import * as validate from "../input/validate.js";
import type { Progress } from "../runtime/execution.js";
import { checkpoint, fail, memory } from "../runtime/execution.js";
import type {
  ExecutionContext,
  InputAsset,
  LoadInput,
  PixelBuffer,
  PngCodec,
  ResourceLimits,
  WorkerCapabilities,
} from "../types.js";
import { PipelineErrorCode as Code, ProgressStage as Stage } from "../types.js";

export function inspectEncoded(buffer: ArrayBuffer): {
  width: number;
  height: number;
  mime: "image/png" | "image/webp";
} {
  const bytes = new Uint8Array(buffer),
    view = new DataView(buffer);
  const ascii = (at: number, text: string) =>
    [...text].every((c, i) => bytes[at + i] === c.charCodeAt(0));
  if (bytes.length >= 24 && ascii(0, "\x89PNG\r\n\x1a\n")) {
    if (!ascii(12, "IHDR") || view.getUint32(8) !== 13) fail(Code.DecodeFailed, Stage.Decode);
    const width = view.getUint32(16),
      height = view.getUint32(20);
    if (!width || !height) fail(Code.DecodeFailed, Stage.Decode);
    for (let pos = 8; pos + 8 <= bytes.length; ) {
      const length = view.getUint32(pos);
      if (ascii(pos + 4, "acTL")) fail(Code.AnimatedInputUnsupported);
      if (pos + 12 + length > bytes.length) fail(Code.DecodeFailed, Stage.Decode);
      pos += 12 + length;
    }
    return { width, height, mime: "image/png" };
  }
  if (bytes.length >= 20 && ascii(0, "RIFF") && ascii(8, "WEBP")) {
    const end = view.getUint32(4, true) + 8;
    if (end !== bytes.length) fail(Code.DecodeFailed, Stage.Decode);
    let width = 0,
      height = 0;
    for (let pos = 12; pos + 8 <= end; ) {
      const length = view.getUint32(pos + 4, true),
        data = pos + 8;
      if (data + length > end) fail(Code.DecodeFailed, Stage.Decode);
      if (ascii(pos, "ANIM") || ascii(pos, "ANMF")) fail(Code.AnimatedInputUnsupported);
      if (ascii(pos, "VP8X") && length >= 10) {
        if (bytes[data]! & 2) fail(Code.AnimatedInputUnsupported);
        width = 1 + bytes[data + 4]! + (bytes[data + 5]! << 8) + (bytes[data + 6]! << 16);
        height = 1 + bytes[data + 7]! + (bytes[data + 8]! << 8) + (bytes[data + 9]! << 16);
      } else if (ascii(pos, "VP8L") && length >= 5 && bytes[data] === 47 && !width) {
        const bits = view.getUint32(data + 1, true);
        width = (bits & 0x3fff) + 1;
        height = ((bits >>> 14) & 0x3fff) + 1;
      } else if (ascii(pos, "VP8 ") && length >= 10 && ascii(data + 3, "\x9d\x01\x2a") && !width) {
        width = view.getUint16(data + 6, true) & 0x3fff;
        height = view.getUint16(data + 8, true) & 0x3fff;
      }
      pos += 8 + length + (length & 1);
    }
    if (!width || !height) fail(Code.DecodeFailed, Stage.Decode);
    return { width, height, mime: "image/webp" };
  }
  fail(Code.UnsupportedFormat);
}
export const pngCodec: PngCodec = {
  async encode(pixels: PixelBuffer, context: ExecutionContext): Promise<ArrayBuffer> {
    const canvas = new OffscreenCanvas(pixels.width, pixels.height);
    try {
      const drawing = canvas.getContext("2d", { colorSpace: "srgb" });
      if (!drawing) fail(Code.EncodeFailed, Stage.Encode);
      drawing.putImageData(
        new ImageData(
          new Uint8ClampedArray(pixels.data.buffer as ArrayBuffer),
          pixels.width,
          pixels.height,
          { colorSpace: "srgb" },
        ),
        0,
        0,
      );
      const blob = await canvas.convertToBlob({ type: "image/png" });
      await checkpoint(context, Stage.Encode);
      if (blob.type !== "image/png") fail(Code.EncodeFailed, Stage.Encode);
      return await blob.arrayBuffer();
    } finally {
      canvas.width = 1;
      canvas.height = 1;
    }
  },
};
export async function probe(limits: ResourceLimits): Promise<WorkerCapabilities> {
  if (
    typeof OffscreenCanvas !== "function" ||
    typeof createImageBitmap !== "function" ||
    typeof structuredClone !== "function"
  )
    fail(Code.WorkerUnavailable);
  try {
    const buffer = new ArrayBuffer(1);
    const moved = structuredClone(buffer, { transfer: [buffer] });
    if (buffer.byteLength !== 0 || moved.byteLength !== 1) fail(Code.WorkerUnavailable);
    const canvas = new OffscreenCanvas(1, 1),
      drawing = canvas.getContext("2d", { colorSpace: "srgb" });
    if (
      !drawing ||
      typeof drawing.getImageData !== "function" ||
      typeof canvas.convertToBlob !== "function"
    )
      fail(Code.WorkerUnavailable);
    const blob = await canvas.convertToBlob({ type: "image/png" });
    if (blob.type !== "image/png") fail(Code.WorkerUnavailable);
    const bitmap = await createImageBitmap(blob);
    try {
      drawing.drawImage(bitmap, 0, 0);
      if (drawing.getImageData(0, 0, 1, 1).data.length !== 4) fail(Code.WorkerUnavailable);
    } finally {
      bitmap.close();
    }
    const decode: WorkerCapabilities["decode"] = ["image/png"];
    try {
      const webp = Uint8Array.from(
        atob(
          "UklGRl4AAABXRUJQVlA4TFIAAAAvf8APEA8Q8x/zHwxFbRsx5o/5BoP1i+j/GyYAAAAAAAAAAAAAAAAAAAAAAAAAAER3/xYAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA5msN",
        ),
        (c) => c.charCodeAt(0),
      );
      const image = await createImageBitmap(new Blob([webp], { type: "image/webp" }));
      image.close();
      decode.push("image/webp");
    } catch {
      /* PNG capability is mandatory; WebP capability is optional. */
    }
    return {
      protocolVersion: PROTOCOL_VERSION,
      contractVersion: CONTRACT_VERSION,
      decode,
      encode: ["image/png"],
      offscreenCanvas: true,
      limits: { ...limits },
    };
  } catch {
    fail(Code.WorkerUnavailable);
  }
}
export async function loadAsset(
  input: LoadInput,
  capabilities: WorkerCapabilities,
  context: ExecutionContext,
  progress: Progress,
): Promise<InputAsset> {
  if (input.kind === "rgba") {
    validate.asset(input.asset, context.limits);
    memory(context, input.asset.pixels.data.byteLength * 3 + 16_777_216, input.asset.pixels);
    await alphaStats(input.asset.pixels, context);
    // RGBA ownership was transferred to this worker; canonicalize it in place.
    for (let y = 0; y < input.asset.pixels.height; y++) {
      for (
        let p = y * input.asset.pixels.width * 4;
        p < (y + 1) * input.asset.pixels.width * 4;
        p += 4
      ) {
        if (!input.asset.pixels.data[p + 3]) input.asset.pixels.data.fill(0, p, p + 3);
      }
      if ((y & 63) === 63) await checkpoint(context, Stage.Decode);
    }
    return input.asset;
  }
  const header = inspectEncoded(input.bytes),
    target = input.resizeTo ?? header;
  if (!capabilities.decode.includes(header.mime)) fail(Code.UnsupportedFormat);
  if (input.bytes.byteLength > context.limits.maxInputBytes)
    fail(Code.MemoryLimit, Stage.Validate, {
      actual: input.bytes.byteLength,
      limit: context.limits.maxInputBytes,
      estimatedBytes: input.bytes.byteLength,
      suggestedSize: {
        width: Math.max(1, Math.floor(header.width / 2)),
        height: Math.max(1, Math.floor(header.height / 2)),
      },
    });
  validate.dimensions(target, context.limits);
  if (input.resizeTo) {
    const sx = target.width / header.width,
      sy = target.height / header.height;
    if (
      sx > 1 ||
      sy > 1 ||
      (Math.abs(target.width - header.width * sy) > 1 &&
        Math.abs(target.height - header.height * sx) > 1)
    )
      validate.invalid("payload.resizeTo");
  }
  memory(context, 12 * header.width * header.height + input.bytes.byteLength + 16_777_216, header);
  progress.report(Stage.Decode);
  let bitmap: ImageBitmap | null = null;
  let canvas: OffscreenCanvas | null = null;
  try {
    bitmap = await createImageBitmap(new Blob([input.bytes], { type: header.mime }), {
      imageOrientation: "from-image",
      premultiplyAlpha: "none",
      colorSpaceConversion: "default",
    });
    await checkpoint(context, Stage.Decode);
    const originalSize = { width: bitmap.width, height: bitmap.height };
    const working = input.resizeTo ?? originalSize;
    canvas = new OffscreenCanvas(working.width, working.height);
    const drawing = canvas.getContext("2d", { willReadFrequently: true, colorSpace: "srgb" });
    if (!drawing) fail(Code.DecodeFailed, Stage.Decode);
    drawing.imageSmoothingEnabled = true;
    drawing.imageSmoothingQuality = "high";
    drawing.drawImage(bitmap, 0, 0, working.width, working.height);
    const image = drawing.getImageData(0, 0, working.width, working.height);
    const pixels: PixelBuffer = {
      ...working,
      format: "rgba8",
      colorSpace: "srgb",
      alphaMode: "straight",
      data: image.data,
    };
    // Copy also canonicalizes transparent RGB and ensures an independent, tight buffer.
    const canonical = await resizePixels(pixels, Math.max(working.width, working.height), context);
    return {
      ref: { ...input.ref },
      name: input.name,
      sourceMime: header.mime,
      originalSize,
      pixels: canonical,
      scaleFromOriginal: {
        x: working.width / originalSize.width,
        y: working.height / originalSize.height,
      },
    };
  } catch (caught) {
    if (context.isCancelled()) fail(Code.Cancelled, Stage.Decode);
    if (caught && typeof caught === "object" && "error" in caught) throw caught;
    return fail(Code.DecodeFailed, Stage.Decode);
  } finally {
    bitmap?.close();
    if (canvas) {
      canvas.width = 1;
      canvas.height = 1;
    }
  }
}

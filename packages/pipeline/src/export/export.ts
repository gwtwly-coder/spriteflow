// biome-ignore-all lint/style/noNonNullAssertion: Frame counts, page membership, and geometry are validated before indexed rendering access.
import { strToU8 } from "fflate";
import { CONTRACT_VERSION } from "../defaults.js";
import { alphaStats } from "../input/pixels.js";
import * as validate from "../input/validate.js";
import { warnings } from "../normalization/frames.js";
import {
  checkpoint,
  createExecutionContext,
  fail,
  memory,
  outcome,
  Progress,
  uniqueId,
} from "../runtime/execution.js";
import type {
  AnimationSpec,
  ExecutionContext,
  ExportResult,
  ExportSource,
  ExportTask,
  Frame,
  GenericAtlasDocument,
  Outcome,
  OutputFile,
  PackResult,
  PngCodec,
  Rect,
  SequenceDocument,
} from "../types.js";
import {
  PipelineErrorCode as Code,
  ExportFormat as Format,
  ProgressStage as Stage,
} from "../types.js";
import { archive } from "./archive.js";
import { godotReadme, godotScript } from "./godot.js";
import { renderAtlas, renderFrame } from "./render.js";

function equalRect(a: Rect | null, b: Rect | null): boolean {
  if (a === null || b === null) return a === b;
  return a.x === b.x && a.y === b.y && a.width === b.width && a.height === b.height;
}

function checkPack(
  pack: PackResult,
  frames: Frame[],
  source: ExportSource,
  context: ExecutionContext,
): void {
  validate.object(pack, ["asset", "options", "pages", "frames", "frameOrder", "warnings"], "pack");
  validate.ref(pack.asset);
  validate.packOptions(pack.options, context.limits);
  if (
    !validate.sameRef(pack.asset, source.asset.ref) ||
    !Array.isArray(pack.frames) ||
    !Array.isArray(pack.pages) ||
    !Array.isArray(pack.frameOrder) ||
    pack.frames.length !== frames.length ||
    pack.frameOrder.length !== frames.length ||
    !pack.pages.length ||
    pack.pages.length > pack.options.maxPages
  )
    fail(Code.StaleResult);
  // Legacy DTOs have a dedicated diagnostic before any snapshot value checks.
  for (const [i, p] of pack.frames.entries()) {
    const field = `source.pack.frames.${i}`;
    if (p === null || typeof p !== "object" || Array.isArray(p)) validate.invalid(field);
    for (const key of ["sourceRect", "bbox"] as const) {
      if (!Object.hasOwn(p, key))
        fail(Code.StaleResult, Stage.Validate, {
          field: `${field}.${key}`,
          frameIds: [frames[i]!.id],
        });
    }
  }
  // Validate all source geometry before comparing values or checking layout.
  // This is O(F) and never scans source pixels or re-runs normalization/packing.
  for (const [i, p] of pack.frames.entries()) {
    const field = `source.pack.frames.${i}`;
    validate.object(
      p,
      [
        "frameId",
        "name",
        "sourceRect",
        "bbox",
        "pageIndex",
        "allocation",
        "rect",
        "rotated",
        "sourceSize",
        "spriteSourceSize",
        "empty",
      ],
      field,
    );
    validate.rect(p.sourceRect, source.asset.pixels, `${field}.sourceRect`);
    if (p.bbox !== null) {
      validate.rect(p.bbox, source.asset.pixels, `${field}.bbox`);
      if (
        p.bbox.x < p.sourceRect.x ||
        p.bbox.y < p.sourceRect.y ||
        p.bbox.x + p.bbox.width > p.sourceRect.x + p.sourceRect.width ||
        p.bbox.y + p.bbox.height > p.sourceRect.y + p.sourceRect.height
      )
        validate.invalid(`${field}.bbox`);
    }
    validate.size(p.sourceSize, `${field}.sourceSize`);
    for (const key of ["allocation", "rect", "spriteSourceSize"] as const)
      validate.object(p[key], ["x", "y", "width", "height"], `${field}.${key}`);
  }
  for (const [i, page] of pack.pages.entries()) {
    validate.object(page, ["index", "width", "height", "frameIds"], `pack.pages.${i}`);
    if (
      page.index !== i ||
      page.width < 1 ||
      page.height < 1 ||
      !Number.isInteger(page.width) ||
      !Number.isInteger(page.height) ||
      page.width > pack.options.maxWidth ||
      page.height > pack.options.maxHeight ||
      !Array.isArray(page.frameIds)
    )
      fail(Code.StaleResult);
    if (
      pack.options.sizeMode === "pot" &&
      (!Number.isInteger(Math.log2(page.width)) || !Number.isInteger(Math.log2(page.height)))
    )
      fail(Code.StaleResult);
    const expected = pack.frames.filter((f) => f.pageIndex === i).map((f) => f.frameId);
    if (JSON.stringify(expected) !== JSON.stringify(page.frameIds)) fail(Code.StaleResult);
  }
  for (const [i, frame] of frames.entries()) {
    const p = pack.frames[i]!;
    const stale: (field: string) => never = (field) =>
      fail(Code.StaleResult, Stage.Validate, {
        field: `source.pack.frames.${i}.${field}`,
        frameIds: [frame.id],
      });
    for (const key of ["sourceRect", "bbox"] as const)
      if (!equalRect(p[key], frame[key])) stale(key);
    const page = pack.pages[p.pageIndex];
    if (!page) stale("pageIndex");
    if (pack.frameOrder[i] !== frame.id) fail(Code.StaleResult);
    if (p.frameId !== frame.id) stale("frameId");
    if (p.name !== frame.name) stale("name");
    if (p.sourceSize.width !== frame.canvas.width || p.sourceSize.height !== frame.canvas.height)
      stale("sourceSize");
    if (p.empty !== (frame.bbox === null)) stale("empty");
    if (typeof p.rotated !== "boolean" || (p.rotated && !pack.options.allowRotation))
      stale("rotated");
    const expected = frame.bbox
      ? { ...frame.canvas.offset, width: frame.bbox.width, height: frame.bbox.height }
      : { x: 0, y: 0, width: 1, height: 1 };
    if (
      ["x", "y", "width", "height"].some(
        (key) =>
          p.spriteSourceSize[key as keyof typeof expected] !==
          expected[key as keyof typeof expected],
      )
    )
      stale("spriteSourceSize");
    if (
      p.rect.width !== (p.rotated ? expected.height : expected.width) ||
      p.rect.height !== (p.rotated ? expected.width : expected.height) ||
      p.rect.x !== p.allocation.x + pack.options.extrude ||
      p.rect.y !== p.allocation.y + pack.options.extrude ||
      p.allocation.width !== p.rect.width + pack.options.extrude * 2 ||
      p.allocation.height !== p.rect.height + pack.options.extrude * 2
    )
      stale("rect");
    const a = p.allocation,
      border = pack.options.border;
    if (
      ![a.x, a.y, a.width, a.height].every(Number.isSafeInteger) ||
      a.x < border ||
      a.y < border ||
      a.x + a.width + border > page.width ||
      a.y + a.height + border > page.height
    )
      stale("allocation");
    for (let j = 0; j < i; j++) {
      const other = pack.frames[j]!;
      if (other.pageIndex !== p.pageIndex) continue;
      const b = other.allocation,
        pad = pack.options.padding;
      if (
        a.x < b.x + b.width + pad &&
        b.x < a.x + a.width + pad &&
        a.y < b.y + b.height + pad &&
        b.y < a.y + a.height + pad
      )
        stale("allocation");
    }
  }
}
function animations(task: ExportTask, frames: Frame[]): AnimationSpec[] {
  if (!Array.isArray(task.animations)) validate.invalid("task.animations");
  const ids = new Set(frames.map((f) => f.id)),
    names = new Set<string>();
  for (const a of task.animations) {
    validate.object(a, ["name", "frameIds", "fps", "loop"], "task.animations");
    validate.name(a.name, "task.animations.name");
    if (names.has(a.name.toLowerCase())) validate.invalid("task.animations.name");
    names.add(a.name.toLowerCase());
    validate.number(a.fps, 1, 120, "task.animations.fps", false);
    validate.bool(a.loop, "task.animations.loop");
    if (!Array.isArray(a.frameIds) || !a.frameIds.length || a.frameIds.some((id) => !ids.has(id)))
      validate.invalid("task.animations.frameIds");
  }
  return task.animations.length
    ? task.animations.map((a) => ({ ...a, frameIds: [...a.frameIds] }))
    : [{ name: "default", frameIds: frames.map((f) => f.id), fps: 12, loop: true }];
}
export async function exportAssets(
  source: ExportSource,
  task: ExportTask,
  codec: PngCodec,
  context: ExecutionContext = createExecutionContext(uniqueId()),
): Promise<Outcome<ExportResult>> {
  const progress = new Progress(context, source?.asset?.ref ?? null, "export");
  return outcome(progress, async () => {
    validate.context(context);
    validate.object(source, ["asset", "frames", "pack"], "source");
    validate.asset(source.asset, context.limits);
    validate.object(task, ["format", "baseName", "animations"], "task");
    validate.oneOf(task.format, Object.values(Format), "task.format");
    validate.name(task.baseName, "task.baseName");
    if (!codec || typeof codec.encode !== "function") validate.invalid("codec");
    const frames = validate.frames(
        source.frames,
        source.asset.ref,
        context.limits,
        source.asset.pixels,
      ),
      anims = animations(task, frames);
    const sequence = task.format === Format.GodotFramesZip || task.format === Format.PngSequenceZip;
    if (sequence ? source.pack !== null : source.pack === null) fail(Code.StaleResult);
    const pack = source.pack;
    if (pack) {
      checkPack(pack, frames, source, context);
      if (task.format !== Format.GenericJson && pack.pages.length > 1)
        fail(Code.ExportIncompatible);
    }
    const outputPixels = sequence
      ? frames.reduce((sum, f) => sum + f.canvas.width * f.canvas.height, 0)
      : pack!.pages.reduce((sum, page) => sum + page.width * page.height, 0);
    memory(
      context,
      source.asset.pixels.data.byteLength + outputPixels * 24 + 16_777_216,
      source.asset.pixels,
    );
    await alphaStats(source.asset.pixels, context);
    const files: OutputFile[] = [];
    const addText = (path: string, text: string, mime: "application/json" | "text/plain") =>
      files.push({ path, mime, bytes: strToU8(text).slice().buffer });
    const addJson = (path: string, data: unknown) =>
      addText(path, `${JSON.stringify(data, null, 2)}\n`, "application/json");
    let totalBytes = 0;
    const count = sequence ? frames.length : pack!.pages.length;
    for (let i = 0; i < count; i++) {
      progress.report(Stage.Render, i, count);
      const image = sequence
        ? await renderFrame(source.asset, frames[i]!, context)
        : await renderAtlas(source.asset, frames, pack!, i, context);
      progress.report(Stage.Render, i + 1, count);
      progress.report(Stage.Encode, i, count);
      let bytes: ArrayBuffer;
      try {
        bytes = await codec.encode(image, context);
      } catch {
        if (context.isCancelled()) fail(Code.Cancelled, Stage.Encode);
        fail(Code.EncodeFailed, Stage.Encode);
      }
      if (!(bytes instanceof ArrayBuffer) || !bytes.byteLength)
        fail(Code.EncodeFailed, Stage.Encode);
      await checkpoint(context, Stage.Encode);
      totalBytes += bytes.byteLength;
      if (totalBytes > context.limits.maxArchiveBytes)
        fail(Code.ArchiveLimit, Stage.Encode, {
          actual: totalBytes,
          limit: context.limits.maxArchiveBytes,
        });
      const path = sequence
        ? `frames/${frames[i]!.name}.png`
        : task.format === Format.GenericJson
          ? `${task.baseName}-${i}.png`
          : `${task.baseName}.png`;
      files.push({ path, mime: "image/png", bytes });
      progress.report(Stage.Encode, i + 1, count);
    }
    if (sequence) {
      const doc: SequenceDocument = {
        schemaVersion: "spriteflow-sequence/1",
        frames: frames.map((f) => ({
          id: f.id,
          name: f.name,
          file: `frames/${f.name}.png`,
          size: { width: f.canvas.width, height: f.canvas.height },
        })),
        animations: anims,
      };
      addJson("sequence.json", doc);
      if (task.format === Format.GodotFramesZip) {
        addText("build_spriteframes.gd", godotScript(task.baseName), "text/plain");
        addText("README.txt", godotReadme, "text/plain");
      }
    } else if (task.format === Format.GenericJson) {
      const doc: GenericAtlasDocument = {
        schemaVersion: "spriteflow-atlas/1",
        generator: "SpriteFlow M1",
        coordinateSystem: "top-left-half-open-pixels",
        asset: { ...source.asset.ref },
        pages: pack!.pages.map((p) => ({
          index: p.index,
          file: `${task.baseName}-${p.index}.png`,
          size: { width: p.width, height: p.height },
        })),
        frames: pack!.frames.map((p) => ({
          id: p.frameId,
          name: p.name,
          pageIndex: p.pageIndex,
          rect: { ...p.rect },
          rotated: p.rotated,
          sourceSize: { ...p.sourceSize },
          spriteSourceSize: { ...p.spriteSourceSize },
          empty: p.empty,
        })),
        frameOrder: [...pack!.frameOrder],
        animations: anims,
      };
      addJson(`${task.baseName}.json`, doc);
    } else {
      const entries = pack!.frames.map((p) => ({
        frame: {
          x: p.rect.x,
          y: p.rect.y,
          w: p.rotated ? p.rect.height : p.rect.width,
          h: p.rotated ? p.rect.width : p.rect.height,
        },
        rotated: p.rotated,
        trimmed:
          p.spriteSourceSize.x !== 0 ||
          p.spriteSourceSize.y !== 0 ||
          p.sourceSize.width !== p.spriteSourceSize.width ||
          p.sourceSize.height !== p.spriteSourceSize.height,
        spriteSourceSize: {
          x: p.spriteSourceSize.x,
          y: p.spriteSourceSize.y,
          w: p.spriteSourceSize.width,
          h: p.spriteSourceSize.height,
        },
        sourceSize: { w: p.sourceSize.width, h: p.sourceSize.height },
      }));
      const page = pack!.pages[0]!;
      addJson(`${task.baseName}.json`, {
        frames:
          task.format === Format.PhaserJsonHash
            ? Object.fromEntries(entries.map((e, i) => [frames[i]!.name, e]))
            : entries.map((e, i) => ({ filename: frames[i]!.name, ...e })),
        meta: {
          app: "SpriteFlow",
          version: CONTRACT_VERSION,
          image: `${task.baseName}.png`,
          format: "RGBA8888",
          size: { w: page.width, h: page.height },
          scale: "1",
        },
      });
      const names = new Map(frames.map((f) => [f.id, f.name]));
      addJson("animations.json", {
        schemaVersion: "spriteflow-animations/1",
        animations: anims.map((a) => ({
          name: a.name,
          frames: a.frameIds.map((id) => names.get(id)),
          fps: a.fps,
          loop: a.loop,
        })),
      });
    }
    files.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
    progress.report(Stage.Archive);
    return {
      format: task.format,
      fileName: `${task.baseName}-${task.format}.zip`,
      mime: "application/zip",
      archive: await archive(files, context, progress),
      files: files.map((f) => ({ path: f.path, mime: f.mime, byteLength: f.bytes.byteLength })),
      warnings: warnings(frames),
    };
  });
}

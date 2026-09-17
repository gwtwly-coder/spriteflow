import { Zip, ZipDeflate, ZipPassThrough } from "fflate";
import type { Progress } from "../runtime/execution.js";
import { checkpoint, fail } from "../runtime/execution.js";
import type { ExecutionContext, OutputFile } from "../types.js";
import { PipelineErrorCode as Code, ProgressStage as Stage } from "../types.js";

export async function archive(
  files: OutputFile[],
  context: ExecutionContext,
  progress: Progress,
): Promise<ArrayBuffer> {
  const chunks: Uint8Array[] = [];
  let size = 0,
    zipError: unknown = null;
  const zip = new Zip((error, chunk) => {
    if (error) {
      zipError = error;
      return;
    }
    size += chunk.length;
    if (size > context.limits.maxArchiveBytes) {
      zipError = Code.ArchiveLimit;
      return;
    }
    chunks.push(chunk);
  });
  const seen = new Set<string>();
  try {
    for (const [index, file] of files.entries()) {
      if (
        !/^[A-Za-z0-9_/-]+\.[A-Za-z0-9]+$/.test(file.path) ||
        file.path.startsWith("/") ||
        file.path.includes("..") ||
        seen.has(file.path.toLowerCase())
      )
        fail(Code.InvalidArgument, Stage.Archive, { field: "files.path" });
      seen.add(file.path.toLowerCase());
      const entry =
        file.mime === "image/png"
          ? new ZipPassThrough(file.path)
          : new ZipDeflate(file.path, { level: 6 });
      entry.mtime = new Date(1980, 0, 1, 0, 0, 0);
      entry.os = 0;
      entry.attrs = 0;
      zip.add(entry);
      const bytes = new Uint8Array(file.bytes);
      for (let offset = 0; offset < Math.max(1, bytes.length); offset += 65_536) {
        entry.push(
          bytes.subarray(offset, Math.min(bytes.length, offset + 65_536)),
          offset + 65_536 >= bytes.length,
        );
        if (zipError)
          fail(
            zipError === Code.ArchiveLimit ? Code.ArchiveLimit : Code.InternalError,
            Stage.Archive,
            { actual: size, limit: context.limits.maxArchiveBytes },
          );
        await checkpoint(context, Stage.Archive);
      }
      progress.report(Stage.Archive, index + 1, files.length);
    }
    zip.end();
    if (zipError)
      fail(zipError === Code.ArchiveLimit ? Code.ArchiveLimit : Code.InternalError, Stage.Archive, {
        actual: size,
        limit: context.limits.maxArchiveBytes,
      });
    const output = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) {
      output.set(chunk, offset);
      offset += chunk.length;
    }
    return output.buffer;
  } finally {
    zip.terminate();
  }
}

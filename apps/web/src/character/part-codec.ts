// 真实 PartExportCodec（契约 §2 :248-328，apps/web 内 fflate 实现）。
// encodePng/decodePng：RGBA8 真 PNG 双向——编码写 IHDR/IDAT/IEND（zlib deflate、
// filter 0），解码支持全部 5 种 scanline filter（None/Sub/Up/Average/Paeth）与
// 色彩类型 6/2、位深 8、非隔行。
// encodeZip：PNG 条目 store（method 0）、JSON/文本 deflate level 6、条目按路径
// 排序、mtime 固定 1980-01-01、无权限位/绝对路径；inspectZip 解析中央目录。

import type { PixelBuffer } from "@spriteflow/pipeline";
import type {
  CharacterExecutionContext,
  PartExportCodec,
  PartExportFileEntry,
} from "@spriteflow/segment";
import { deflateSync, inflateSync } from "fflate";

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a] as const;
const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of bytes) crc = (CRC_TABLE[(crc ^ byte) & 0xff] ?? 0) ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

interface Chunk {
  type: string;
  data: Uint8Array;
}

function pngChunks(bytes: Uint8Array): Chunk[] {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  for (let i = 0; i < 8; i++) {
    if (bytes[i] !== PNG_SIGNATURE[i]) throw new Error("not a PNG");
  }
  const chunks: Chunk[] = [];
  let pos = 8;
  while (pos + 12 <= bytes.length) {
    const length = view.getUint32(pos);
    const type = String.fromCharCode(
      bytes[pos + 4] ?? 0,
      bytes[pos + 5] ?? 0,
      bytes[pos + 6] ?? 0,
      bytes[pos + 7] ?? 0,
    );
    if (pos + 12 + length > bytes.length) throw new Error("truncated PNG chunk");
    chunks.push({ type, data: bytes.subarray(pos + 8, pos + 8 + length) });
    pos += 12 + length;
    if (type === "IEND") break;
  }
  return chunks;
}

function writeChunk(target: Uint8Array, offset: number, type: string, data: Uint8Array): number {
  const view = new DataView(target.buffer, target.byteOffset + offset);
  view.setUint32(0, data.length);
  for (let i = 0; i < 4; i++) target[offset + 4 + i] = type.charCodeAt(i);
  target.set(data, offset + 8);
  const crcInput = target.subarray(offset + 4, offset + 8 + data.length);
  view.setUint32(8 + data.length, crc32(crcInput));
  return offset + 12 + data.length;
}

/** 每 scanline 一个字节写入 filter type 0（合法 PNG；压缩交给 zlib）。 */
export function encodePngSync(pixels: PixelBuffer): ArrayBuffer {
  const { width, height, data } = pixels;
  const stride = width * 4;
  const raw = new Uint8Array((stride + 1) * height);
  for (let row = 0; row < height; row++) {
    raw[row * (stride + 1)] = 0;
    raw.set(data.subarray(row * stride, (row + 1) * stride), row * (stride + 1) + 1);
  }
  const idat = deflateSync(raw, { level: 6 });
  const ihdr = new Uint8Array(13);
  const ihdrView = new DataView(ihdr.buffer);
  ihdrView.setUint32(0, width);
  ihdrView.setUint32(4, height);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // color type RGBA
  ihdr[10] = 0; // compression
  ihdr[11] = 0; // filter
  ihdr[12] = 0; // interlace
  // 8 签名 + IHDR(12+13) + IDAT(12+idat) + IEND(12)。
  const total = 8 + 25 + (12 + idat.length) + 12;
  const out = new Uint8Array(total);
  out.set(PNG_SIGNATURE);
  let offset = 8;
  offset = writeChunk(out, offset, "IHDR", ihdr);
  offset = writeChunk(out, offset, "IDAT", idat);
  writeChunk(out, offset, "IEND", new Uint8Array(0));
  return out.buffer as ArrayBuffer;
}

const PAETH = (a: number, b: number, c: number) => {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  return pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
};

/** RGBA8 解码：bit depth 8、color type 6/2、非隔行、全部 5 种 filter。 */
export function decodePngSync(bytes: ArrayBuffer): PixelBuffer {
  const chunks = pngChunks(new Uint8Array(bytes));
  const ihdr = chunks.find((chunk) => chunk.type === "IHDR")?.data;
  if (!ihdr || ihdr.length < 13) throw new Error("missing IHDR");
  const view = new DataView(ihdr.buffer, ihdr.byteOffset, ihdr.byteLength);
  const width = view.getUint32(0);
  const height = view.getUint32(4);
  const bitDepth = ihdr[8];
  const colorType = ihdr[9];
  const interlace = ihdr[12];
  if (bitDepth !== 8 || interlace !== 0) throw new Error("unsupported PNG bit depth/interlace");
  if (colorType !== 6 && colorType !== 2) throw new Error("unsupported PNG color type");
  const channels = colorType === 6 ? 4 : 3;
  const idat = new Uint8Array(
    chunks
      .filter((chunk) => chunk.type === "IDAT")
      .reduce((sum, chunk) => sum + chunk.data.length, 0),
  );
  let idatOffset = 0;
  for (const chunk of chunks) {
    if (chunk.type === "IDAT") {
      idat.set(chunk.data, idatOffset);
      idatOffset += chunk.data.length;
    }
  }
  const raw = inflateSync(idat);
  const stride = width * channels;
  if (raw.length < (stride + 1) * height) throw new Error("truncated PNG pixel data");
  const out = new Uint8ClampedArray(width * height * 4);
  const line = new Uint8Array(stride);
  const previous = new Uint8Array(stride);
  const at = (buffer: Uint8Array, index: number): number => buffer[index] ?? 0;
  for (let y = 0; y < height; y++) {
    const rowStart = y * (stride + 1);
    const filter = at(raw, rowStart);
    line.set(raw.subarray(rowStart + 1, rowStart + 1 + stride));
    for (let x = 0; x < stride; x++) {
      const left = x >= channels ? at(line, x - channels) : 0;
      const up = y > 0 ? at(previous, x) : 0;
      const upLeft = x >= channels && y > 0 ? at(previous, x - channels) : 0;
      const value = at(line, x);
      const reconstructed =
        filter === 0
          ? value
          : filter === 1
            ? (value + left) & 0xff
            : filter === 2
              ? (value + up) & 0xff
              : filter === 3
                ? (value + ((left + up) >> 1)) & 0xff
                : filter === 4
                  ? (value + PAETH(left, up, upLeft)) & 0xff
                  : -1;
      if (reconstructed < 0) throw new Error("bad PNG filter type");
      line[x] = reconstructed;
    }
    for (let x = 0; x < width; x++) {
      const target = (y * width + x) * 4;
      const source = x * channels;
      out[target] = at(line, source);
      out[target + 1] = at(line, source + 1);
      out[target + 2] = at(line, source + 2);
      out[target + 3] = channels === 4 ? at(line, source + 3) : 0xff;
    }
    previous.set(line);
  }
  return {
    width,
    height,
    format: "rgba8",
    colorSpace: "srgb",
    alphaMode: "straight",
    data: out,
  };
}

// --- ZIP（store/deflate 混合、路径排序、mtime 1980-01-01、无权限位） -------------

const DOS_DATE_1980_01_01 = ((1 << 5) | 1) & 0xffff; // 1980-01-01
const DOS_TIME_00_00 = 0;
const METHOD_STORE = 0;
const METHOD_DEFLATE = 8;

function mimeForPath(path: string): "image/png" | "application/json" | "text/plain" | null {
  if (path.endsWith(".png")) return "image/png";
  if (path.endsWith(".json")) return "application/json";
  if (path.endsWith(".txt")) return "text/plain";
  return null;
}

function collectZip(files: Array<{ path: string; mime: string; bytes: ArrayBuffer }>): Uint8Array {
  const sorted = [...files].sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  const encoder = new TextEncoder();
  const locals: Uint8Array[] = [];
  const central: Uint8Array[] = [];
  let offset = 0;
  for (const file of sorted) {
    if (!/^[\x21-\x7e/]+$/.test(file.path) || file.path.includes("..") || file.path.startsWith("/"))
      throw new Error(`unsafe archive path: ${file.path}`);
    const name = encoder.encode(file.path);
    const raw = new Uint8Array(file.bytes);
    const deflate = file.mime !== "image/png";
    const stored = deflate ? deflateSync(raw, { level: 6 }) : raw;
    const crc = crc32(raw);
    const local = new Uint8Array(30 + name.length);
    const localView = new DataView(local.buffer);
    localView.setUint32(0, 0x04034b50, true);
    localView.setUint16(4, 20, true); // version needed
    localView.setUint16(6, 0, true); // flags
    localView.setUint16(8, deflate ? METHOD_DEFLATE : METHOD_STORE, true);
    localView.setUint16(10, DOS_TIME_00_00, true);
    localView.setUint16(12, DOS_DATE_1980_01_01, true);
    localView.setUint32(14, crc, true);
    localView.setUint32(18, stored.length, true);
    localView.setUint32(22, raw.length, true);
    localView.setUint16(26, name.length, true);
    localView.setUint16(28, 0, true); // extra length
    local.set(name, 30);
    locals.push(local, stored);
    const entry = new Uint8Array(46 + name.length);
    const entryView = new DataView(entry.buffer);
    entryView.setUint32(0, 0x02014b50, true);
    entryView.setUint16(4, 20, true); // version made by (MS-DOS, 无权限位)
    entryView.setUint16(6, 20, true);
    entryView.setUint16(8, 0, true);
    entryView.setUint16(10, deflate ? METHOD_DEFLATE : METHOD_STORE, true);
    entryView.setUint16(12, DOS_TIME_00_00, true);
    entryView.setUint16(14, DOS_DATE_1980_01_01, true);
    entryView.setUint32(16, crc, true);
    entryView.setUint32(20, stored.length, true);
    entryView.setUint32(24, raw.length, true);
    entryView.setUint16(28, name.length, true);
    entryView.setUint16(30, 0, true); // extra length
    entryView.setUint16(32, 0, true); // comment length
    entryView.setUint32(38, 0, true); // external attributes = 0（无权限位）
    entryView.setUint32(42, offset, true); // local header offset
    entry.set(name, 46);
    central.push(entry);
    offset += local.length + stored.length;
  }
  const centralSize = central.reduce((sum, part) => sum + part.length, 0);
  const end = new Uint8Array(22);
  const endView = new DataView(end.buffer);
  endView.setUint32(0, 0x06054b50, true);
  endView.setUint16(8, sorted.length, true);
  endView.setUint16(10, sorted.length, true);
  endView.setUint32(12, centralSize, true);
  endView.setUint32(16, offset, true);
  const total = offset + centralSize + 22;
  const out = new Uint8Array(total);
  let position = 0;
  for (const part of [...locals, ...central, end]) {
    out.set(part, position);
    position += part.length;
  }
  return out;
}

function inspectZipSync(archive: ArrayBuffer): PartExportFileEntry[] {
  const bytes = new Uint8Array(archive);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  // 从尾部找 EOCD 签名
  let eocd = -1;
  for (let i = bytes.length - 22; i >= 0 && i > bytes.length - 66_000; i--) {
    if (view.getUint32(i, true) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error("missing ZIP EOCD");
  const count = view.getUint16(eocd + 10, true);
  let ptr = view.getUint32(eocd + 16, true);
  const entries: PartExportFileEntry[] = [];
  for (let index = 0; index < count; index++) {
    if (view.getUint32(ptr, true) !== 0x02014b50) throw new Error("bad central directory");
    const method = view.getUint16(ptr + 10, true);
    const compressedSize = view.getUint32(ptr + 20, true);
    const uncompressedSize = view.getUint32(ptr + 24, true);
    const nameLength = view.getUint16(ptr + 28, true);
    const extraLength = view.getUint16(ptr + 30, true);
    const commentLength = view.getUint16(ptr + 32, true);
    const localOffset = view.getUint32(ptr + 42, true);
    const path = new TextDecoder().decode(bytes.subarray(ptr + 46, ptr + 46 + nameLength));
    const mime = mimeForPath(path);
    if (mime === null) throw new Error(`unknown archive entry type: ${path}`);
    // 校验 local header 一致性（mtime/方法），确保结构可解包。
    if (view.getUint32(localOffset, true) !== 0x04034b50) throw new Error("bad local header");
    const localMethod = view.getUint16(localOffset + 8, true);
    if (localMethod !== method) throw new Error("local/central method mismatch");
    if (method === METHOD_DEFLATE) {
      const dataStart = localOffset + 30 + view.getUint16(localOffset + 26, true);
      inflateSync(bytes.subarray(dataStart, dataStart + compressedSize));
    }
    entries.push({ path, mime, byteLength: uncompressedSize });
    ptr += 46 + nameLength + extraLength + commentLength;
  }
  return entries;
}

/** 契约形状的 codec（Worker 内使用；同步实现包装为 Promise）。 */
export function createPartExportCodec(): PartExportCodec {
  return {
    async encodePng(
      pixels: PixelBuffer,
      _context: CharacterExecutionContext,
    ): Promise<ArrayBuffer> {
      return encodePngSync(pixels);
    },
    async decodePng(bytes: ArrayBuffer, _context: CharacterExecutionContext): Promise<PixelBuffer> {
      return decodePngSync(bytes);
    },
    async encodeZip(
      files: Array<{
        path: string;
        mime: "image/png" | "application/json" | "text/plain";
        bytes: ArrayBuffer;
      }>,
      _context: CharacterExecutionContext,
    ): Promise<ArrayBuffer> {
      return collectZip(files).buffer as ArrayBuffer;
    },
    async inspectZip(
      archive: ArrayBuffer,
      _context: CharacterExecutionContext,
    ): Promise<PartExportFileEntry[]> {
      return inspectZipSync(archive);
    },
  };
}

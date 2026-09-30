// Honest minimal PNG/ZIP codec for export tests. Real formats, real checksums:
// PNG (color type 6 RGBA8, filter 0, zlib wrapper with stored-deflate blocks +
// adler32, CRC32 per chunk) and ZIP (PNG entries stored / method 0, JSON/text
// entries method 8 with raw stored-deflate blocks, CRC32 per entry, mtime fixed
// 1980-01-01, no permission bits, entries sorted by path) — mirroring the codec
// requirements of docs/interface-contract-v3.md :327. The stored-block deflate
// is a legitimate RFC1951 stream; the production codec belongs to apps/web.
import type { PixelBuffer } from "../src/m1.js";
import type {
  CharacterExecutionContext,
  PartExportCodec,
  PartExportFile,
  PartExportFileEntry,
} from "../src/types.js";

// --- Checksums -------------------------------------------------------------------

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

export function crc32(bytes: Uint8Array): number {
  let c = 0xffffffff;
  for (const byte of bytes) c = ((CRC_TABLE[(c ^ byte) & 0xff] ?? 0) ^ (c >>> 8)) >>> 0;
  return (c ^ 0xffffffff) >>> 0;
}

export function adler32(bytes: Uint8Array): number {
  let a = 1;
  let b = 0;
  for (const byte of bytes) {
    a = (a + byte) % 65521;
    b = (b + a) % 65521;
  }
  return ((b << 16) | a) >>> 0;
}

// --- Byte writer / reader ----------------------------------------------------------

class ByteWriter {
  private chunks: number[] = [];

  u8(value: number): this {
    this.chunks.push(value & 0xff);
    return this;
  }

  u16le(value: number): this {
    return this.u8(value).u8(value >> 8);
  }

  u32le(value: number): this {
    return this.u8(value)
      .u8(value >> 8)
      .u8(value >> 16)
      .u8(value >> 24);
  }

  u32be(value: number): this {
    return this.u8(value >>> 24)
      .u8(value >>> 16)
      .u8(value >>> 8)
      .u8(value);
  }

  bytes(values: Uint8Array | number[]): this {
    for (const value of values) this.chunks.push(value & 0xff);
    return this;
  }

  ascii(text: string): this {
    for (let index = 0; index < text.length; index++) {
      this.chunks.push(text.charCodeAt(index) & 0xff);
    }
    return this;
  }

  toUint8Array(): Uint8Array<ArrayBuffer> {
    return Uint8Array.from(this.chunks);
  }
}

class ByteReader {
  offset = 0;

  constructor(private readonly data: Uint8Array) {}

  u8(): number {
    return this.data[this.offset++] ?? 0;
  }

  u16le(): number {
    const value = this.u8() | (this.u8() << 8);
    return value >>> 0;
  }

  u32le(): number {
    return (this.u16le() | (this.u16le() << 16)) >>> 0;
  }

  u32be(): number {
    const a = this.u8();
    const b = this.u8();
    const c = this.u8();
    const d = this.u8();
    return ((a << 24) | (b << 16) | (c << 8) | d) >>> 0;
  }

  slice(length: number): Uint8Array {
    const slice = this.data.subarray(this.offset, this.offset + length);
    this.offset += length;
    return slice;
  }

  get remaining(): number {
    return this.data.length - this.offset;
  }
}

// --- Deflate (stored blocks only) --------------------------------------------------

function deflateStoredRaw(data: Uint8Array): Uint8Array {
  const writer = new ByteWriter();
  if (data.length === 0) {
    writer.u8(0x01).u16le(0).u16le(0xffff);
  }
  for (let offset = 0; offset < data.length; offset += 65_535) {
    const slice = data.subarray(offset, Math.min(data.length, offset + 65_535));
    const final = offset + 65_535 >= data.length ? 0x01 : 0x00;
    writer
      .u8(final)
      .u16le(slice.length)
      .u16le(~slice.length & 0xffff)
      .bytes(slice);
  }
  return writer.toUint8Array();
}

function inflateStoredRaw(stream: Uint8Array): Uint8Array {
  const reader = new ByteReader(stream);
  const blocks: Uint8Array[] = [];
  for (;;) {
    const header = reader.u8();
    const bfinal = header & 0x01;
    const btype = (header >> 1) & 0x03;
    if (btype !== 0) throw new Error("unsupported deflate block type");
    const len = reader.u16le();
    const nlen = reader.u16le();
    if ((len ^ 0xffff) !== nlen) throw new Error("corrupt stored block header");
    blocks.push(reader.slice(len));
    if (bfinal === 1) break;
  }
  const total = blocks.reduce((sum, block) => sum + block.length, 0);
  const output = new Uint8Array(total);
  let offset = 0;
  for (const block of blocks) {
    output.set(block, offset);
    offset += block.length;
  }
  return output;
}

function zlibWrap(data: Uint8Array): Uint8Array {
  const writer = new ByteWriter();
  writer.u8(0x78).u8(0x01).bytes(deflateStoredRaw(data)).u32be(adler32(data));
  return writer.toUint8Array();
}

function zlibUnwrap(stream: Uint8Array): Uint8Array {
  const cmf = stream[0] ?? 0;
  const flg = stream[1] ?? 0;
  if (((cmf << 8) | flg) % 31 !== 0 || (cmf & 0x0f) !== 8) {
    throw new Error("invalid zlib header");
  }
  const body = stream.subarray(2, stream.length - 4);
  const raw = inflateStoredRaw(body);
  const expected = stream.subarray(stream.length - 4);
  const actual = adler32(raw);
  const stored =
    (((expected[0] ?? 0) << 24) |
      ((expected[1] ?? 0) << 16) |
      ((expected[2] ?? 0) << 8) |
      (expected[3] ?? 0)) >>>
    0;
  if (stored !== actual) throw new Error("adler32 mismatch");
  if (readerRemaining(stream, 2 + body.length + 4) !== 0) throw new Error("zlib trailing bytes");
  return raw;
}

function readerRemaining(stream: Uint8Array, consumed: number): number {
  return stream.length - consumed;
}

// --- PNG (color type 6, filter 0) ---------------------------------------------------

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

export function encodePngBytes(pixels: PixelBuffer): ArrayBuffer {
  const raw = new ByteWriter();
  for (let y = 0; y < pixels.height; y++) {
    raw.u8(0); // filter type 0 (None)
    for (let x = 0; x < pixels.width; x++) {
      const offset = (y * pixels.width + x) * 4;
      raw
        .u8(pixels.data[offset] ?? 0)
        .u8(pixels.data[offset + 1] ?? 0)
        .u8(pixels.data[offset + 2] ?? 0)
        .u8(pixels.data[offset + 3] ?? 0);
    }
  }
  const idat = zlibWrap(raw.toUint8Array());
  const ihdr = new ByteWriter()
    .u32be(pixels.width)
    .u32be(pixels.height)
    .u8(8) // bit depth
    .u8(6) // color type RGBA
    .u8(0) // compression
    .u8(0) // filter
    .u8(0) // interlace
    .toUint8Array();
  const writer = new ByteWriter();
  writer.bytes(PNG_SIGNATURE);
  const writeChunk = (type: string, data: Uint8Array): void => {
    const body = new ByteWriter().ascii(type).bytes(data).toUint8Array();
    writer.u32be(data.length).bytes(body).u32be(crc32(body));
  };
  writeChunk("IHDR", ihdr);
  writeChunk("IDAT", idat);
  writeChunk("IEND", new Uint8Array(0));
  return writer.toUint8Array().buffer;
}

export function decodePngBytes(bytes: ArrayBuffer): PixelBuffer {
  const data = new Uint8Array(bytes);
  for (let index = 0; index < PNG_SIGNATURE.length; index++) {
    if (data[index] !== PNG_SIGNATURE[index]) throw new Error("not a PNG");
  }
  const reader = new ByteReader(data);
  reader.offset = 8;
  let width = 0;
  let height = 0;
  const idatParts: Uint8Array[] = [];
  while (reader.remaining >= 12) {
    const length = reader.u32be();
    const type = String.fromCharCode(...reader.slice(4));
    const body = reader.slice(length);
    const crc = reader.u32be();
    if (crc32(new ByteWriter().ascii(type).bytes(body).toUint8Array()) !== crc) {
      throw new Error(`PNG chunk CRC mismatch (${type})`);
    }
    if (type === "IHDR") {
      const ihdr = new ByteReader(body);
      width = ihdr.u32be();
      height = ihdr.u32be();
      const depth = ihdr.u8();
      const colorType = ihdr.u8();
      const compression = ihdr.u8();
      const filter = ihdr.u8();
      const interlace = ihdr.u8();
      if (depth !== 8 || colorType !== 6 || compression !== 0 || filter !== 0 || interlace !== 0) {
        throw new Error("unsupported PNG variant");
      }
    } else if (type === "IDAT") {
      idatParts.push(body);
    } else if (type === "IEND") {
      break;
    }
  }
  if (width < 1 || height < 1 || idatParts.length === 0) throw new Error("incomplete PNG");
  const total = idatParts.reduce((sum, part) => sum + part.length, 0);
  const idat = new Uint8Array(total);
  let offset = 0;
  for (const part of idatParts) {
    idat.set(part, offset);
    offset += part.length;
  }
  const raw = zlibUnwrap(idat);
  if (raw.length !== height * (1 + width * 4)) throw new Error("PNG pixel size mismatch");
  const out = new Uint8ClampedArray(width * height * 4);
  const rows = new ByteReader(raw);
  for (let y = 0; y < height; y++) {
    if (rows.u8() !== 0) throw new Error("unsupported PNG filter");
    for (let x = 0; x < width; x++) {
      const target = (y * width + x) * 4;
      out[target] = rows.u8();
      out[target + 1] = rows.u8();
      out[target + 2] = rows.u8();
      out[target + 3] = rows.u8();
    }
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

// --- ZIP (store + raw stored-deflate) -----------------------------------------------

const DOS_DATE_1980_01_01 = 0x0021;
const DOS_TIME_MIDNIGHT = 0x0000;

function mimeOfPath(path: string): PartExportFileEntry["mime"] {
  if (path.endsWith(".png")) return "image/png";
  if (path.endsWith(".json")) return "application/json";
  if (path.endsWith(".txt")) return "text/plain";
  throw new Error(`unknown archive entry type: ${path}`);
}

export function encodeZipBytes(files: PartExportFile[]): ArrayBuffer {
  const sorted = [...files].sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  const writer = new ByteWriter();
  const central: Array<{
    name: Uint8Array;
    method: number;
    crc: number;
    compSize: number;
    size: number;
    offset: number;
  }> = [];
  for (const file of sorted) {
    const raw = new Uint8Array(file.bytes);
    const method = file.mime === "image/png" ? 0 : 8;
    const payload = method === 0 ? raw : deflateStoredRaw(raw);
    const crc = crc32(raw);
    const name = new ByteWriter().ascii(file.path).toUint8Array();
    central.push({
      name,
      method,
      crc,
      compSize: payload.length,
      size: raw.length,
      offset: writer.toUint8Array().length,
    });
    writer
      .u32le(0x04034b50)
      .u16le(20)
      .u16le(0)
      .u16le(method)
      .u16le(DOS_TIME_MIDNIGHT)
      .u16le(DOS_DATE_1980_01_01)
      .u32le(crc)
      .u32le(payload.length)
      .u32le(raw.length)
      .u16le(name.length)
      .u16le(0)
      .bytes(name)
      .bytes(payload);
  }
  const centralOffset = writer.toUint8Array().length;
  for (const entry of central) {
    writer
      .u32le(0x02014b50)
      .u16le(20) // version made by: OS 0 (MS-DOS), no permission attributes
      .u16le(20)
      .u16le(0)
      .u16le(entry.method)
      .u16le(DOS_TIME_MIDNIGHT)
      .u16le(DOS_DATE_1980_01_01)
      .u32le(entry.crc)
      .u32le(entry.compSize)
      .u32le(entry.size)
      .u16le(entry.name.length)
      .u16le(0)
      .u16le(0)
      .u16le(0)
      .u16le(0)
      .u32le(0) // external attributes: none
      .u32le(entry.offset)
      .bytes(entry.name);
  }
  const centralSize = writer.toUint8Array().length - centralOffset;
  writer
    .u32le(0x06054b50)
    .u16le(0)
    .u16le(0)
    .u16le(central.length)
    .u16le(central.length)
    .u32le(centralSize)
    .u32le(centralOffset)
    .u16le(0);
  return writer.toUint8Array().buffer;
}

interface ZipEntry {
  path: string;
  method: number;
  crc: number;
  compSize: number;
  size: number;
}

function parseCentralDirectory(archive: ArrayBuffer): ZipEntry[] {
  const data = new Uint8Array(archive);
  let eocd = -1;
  for (let offset = data.length - 22; offset >= 0; offset--) {
    if (
      data[offset] === 0x50 &&
      data[offset + 1] === 0x4b &&
      data[offset + 2] === 0x05 &&
      data[offset + 3] === 0x06
    ) {
      eocd = offset;
      break;
    }
  }
  if (eocd < 0) throw new Error("missing ZIP EOCD");
  const reader = new ByteReader(data);
  reader.offset = eocd + 8;
  const count = reader.u16le();
  reader.u16le();
  reader.u32le();
  const centralOffset = reader.u32le();
  reader.offset = centralOffset;
  const entries: ZipEntry[] = [];
  for (let index = 0; index < count; index++) {
    if (reader.u32le() !== 0x02014b50) throw new Error("bad central directory");
    reader.u16le();
    reader.u16le();
    reader.u16le();
    const method = reader.u16le();
    reader.u16le();
    reader.u16le();
    const crc = reader.u32le();
    const compSize = reader.u32le();
    const size = reader.u32le();
    const nameLength = reader.u16le();
    reader.u16le();
    reader.u16le();
    reader.u16le();
    reader.u16le();
    reader.u32le();
    reader.u32le();
    const name = String.fromCharCode(...reader.slice(nameLength));
    entries.push({ path: name, method, crc, compSize, size });
  }
  return entries;
}

function entryData(archive: ArrayBuffer, entry: ZipEntry): Uint8Array {
  const data = new Uint8Array(archive);
  const reader = new ByteReader(data);
  // Walk to the entry's local header by re-scanning (entries are path-sorted).
  reader.offset = 0;
  const target = entry.path;
  for (;;) {
    while (reader.remaining >= 4 && reader.u32le() !== 0x04034b50) {
      reader.offset -= 3;
    }
    if (reader.remaining < 26) throw new Error("bad local header");
    reader.u16le();
    reader.u16le();
    reader.u16le();
    reader.u16le();
    reader.u16le();
    reader.u32le();
    const compSize = reader.u32le();
    reader.u32le();
    const nameLength = reader.u16le();
    const extraLength = reader.u16le();
    const name = String.fromCharCode(...reader.slice(nameLength));
    reader.offset += extraLength;
    if (name === target) {
      const payload = reader.slice(compSize);
      const raw = entry.method === 0 ? payload : inflateStoredRaw(payload);
      if (raw.length !== entry.size) throw new Error("entry size mismatch");
      if (crc32(raw) !== entry.crc) throw new Error("entry CRC mismatch");
      return raw;
    }
    if (reader.remaining <= 0) throw new Error(`entry not found: ${target}`);
  }
}

export function readZipEntry(archive: ArrayBuffer, path: string): Uint8Array {
  const entry = parseCentralDirectory(archive).find((candidate) => candidate.path === path);
  if (entry === undefined) throw new Error(`entry not found: ${path}`);
  return entryData(archive, entry);
}

export function inspectZipBytes(archive: ArrayBuffer): PartExportFileEntry[] {
  return parseCentralDirectory(archive).map((entry) => ({
    path: entry.path,
    mime: mimeOfPath(entry.path),
    byteLength: entry.size,
  }));
}

// --- Codec assembly with test hooks --------------------------------------------------

export interface CodecHooks {
  /** Throws from the named codec call (simulating codec failure). */
  throwOn?: Array<"encodePng" | "decodePng" | "encodeZip" | "inspectZip">;
  /** Mutates the decoded pixels after the honest decode (invariant tampering). */
  transformDecoded?: (pixels: PixelBuffer) => PixelBuffer;
  /** Replaces the decoded dimensions after decode (size mismatch simulation). */
  decodedSizeOverride?: { width: number; height: number };
  /** Rewrites the inspected entry list (structural lie simulation). */
  inspectOverride?: (entries: PartExportFileEntry[]) => PartExportFileEntry[];
  /** Called after each codec call (e.g. to cancel the context mid-flight). */
  afterCall?: (call: string) => void;
}

export function honestCodec(hooks: CodecHooks = {}): {
  codec: PartExportCodec;
  calls: string[];
} {
  const calls: string[] = [];
  const guard = async (context: CharacterExecutionContext): Promise<void> => {
    await context.yieldControl();
    if (context.isCancelled()) throw new Error("cancelled");
  };
  const enter = (call: "encodePng" | "decodePng" | "encodeZip" | "inspectZip"): void => {
    calls.push(call);
    if (hooks.throwOn?.includes(call)) throw new Error(`codec crashed in ${call}`);
  };
  const leave = (call: string): void => {
    hooks.afterCall?.(call);
  };
  return {
    calls,
    codec: {
      async encodePng(pixels, context) {
        enter("encodePng");
        await guard(context);
        const bytes = encodePngBytes(pixels);
        leave("encodePng");
        return bytes;
      },
      async decodePng(bytes, context) {
        enter("decodePng");
        await guard(context);
        let pixels = decodePngBytes(bytes);
        if (hooks.transformDecoded) pixels = hooks.transformDecoded(pixels);
        if (hooks.decodedSizeOverride) {
          pixels = {
            ...pixels,
            width: hooks.decodedSizeOverride.width,
            height: hooks.decodedSizeOverride.height,
          };
        }
        leave("decodePng");
        return pixels;
      },
      async encodeZip(files, context) {
        enter("encodeZip");
        await guard(context);
        const archive = encodeZipBytes(files);
        leave("encodeZip");
        return archive;
      },
      async inspectZip(archive, context) {
        enter("inspectZip");
        await guard(context);
        const entries = inspectZipBytes(archive);
        const overridden = hooks.inspectOverride ? hooks.inspectOverride(entries) : entries;
        leave("inspectZip");
        return overridden;
      },
    },
  };
}

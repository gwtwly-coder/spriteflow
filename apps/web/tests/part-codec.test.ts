// 真实 PartExportCodec 单元测试（契约 §2 :248-328 的 codec 要求）：
// PNG RGBA8 双向（含全部 5 种 filter 解码）、ZIP 结构（PNG store / JSON·文本
// deflate / 条目路径排序 / mtime 1980-01-01 / 无权限位）与 inspectZip。
// 另有规范级（spec-level）IDAT 测试：zlib 头、手算 adler32 尾校验、以及用与
// encoder 不同源的 node:zlib 解码路径逐字节复验像素——防再度回归"裸 deflate
// IDAT 自产自销自洽、独立解码器拒读"。

import { inflateSync as nodeInflateSync } from "node:zlib";
import type { PixelBuffer } from "@spriteflow/pipeline";
import { unzipSync, zlibSync } from "fflate";
import { describe, expect, it } from "vitest";
import { createPartExportCodec, decodePngSync, encodePngSync } from "../src/character/part-codec";

const pixels = (width: number, height: number, seed = 1): PixelBuffer => {
  const data = new Uint8ClampedArray(width * height * 4);
  let state = seed;
  for (let i = 0; i < data.length; i++) {
    state = (state * 1_106_351_595 + 12_345) & 0x7fffffff;
    // 让 alpha 覆盖 0/255/中间值，检查透明像素的字节保持。
    data[i] = i % 4 === 3 ? (i % 12 === 3 ? 0 : i % 20) : state & 0xff;
  }
  return { width, height, format: "rgba8", colorSpace: "srgb", alphaMode: "straight", data };
};

const crc32 = (bytes: Uint8Array): number => {
  let c: number;
  const table: number[] = [];
  for (let n = 0; n < 256; n++) {
    c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  let crc = 0xffffffff;
  for (const byte of bytes) crc = (table[(crc ^ byte) & 0xff] ?? 0) ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
};

/** RFC 1950 的 adler32（独立手算，不复用 encoder 路径）。 */
const adler32 = (bytes: Uint8Array): number => {
  let a = 1;
  let b = 0;
  for (const byte of bytes) {
    a = (a + byte) % 65521;
    b = (b + a) % 65521;
  }
  return ((b << 16) | a) >>> 0;
};

/** 从 PNG 字节流里解析出 IDAT chunk 的 data（测试自用极简 chunk 解析器）。 */
const idatOf = (encoded: ArrayBuffer): Uint8Array => {
  const bytes = new Uint8Array(encoded);
  const view = new DataView(encoded);
  let offset = 8;
  while (offset + 12 <= bytes.length) {
    const length = view.getUint32(offset);
    const type = String.fromCharCode(
      bytes[offset + 4] ?? 0,
      bytes[offset + 5] ?? 0,
      bytes[offset + 6] ?? 0,
      bytes[offset + 7] ?? 0,
    );
    if (type === "IDAT") return bytes.subarray(offset + 8, offset + 8 + length);
    offset += 12 + length;
  }
  throw new Error("IDAT chunk not found");
};

/** encoder 手搓的 filter-0 未压缩 scanline 流（与 encodePngSync 的 raw 一致）。 */
const filterZeroRaw = (source: PixelBuffer): Uint8Array => {
  const stride = source.width * 4;
  const raw = new Uint8Array((stride + 1) * source.height);
  for (let row = 0; row < source.height; row++) {
    raw[row * (stride + 1)] = 0;
    raw.set(source.data.subarray(row * stride, (row + 1) * stride), row * (stride + 1) + 1);
  }
  return raw;
};

/** 用全部 5 种 filter 手工构造 PNG（filter per-row 0..4 循环），验证解码。 */
const buildFilteredPng = (width: number, height: number): ArrayBuffer => {
  const pixelsBuffer = pixels(width, height, 7);
  const stride = width * 4;
  const raw = new Uint8Array((stride + 1) * height);
  for (let y = 0; y < height; y++) {
    const filter = y % 5;
    raw[y * (stride + 1)] = filter;
    for (let x = 0; x < stride; x++) {
      const value = pixelsBuffer.data[y * stride + x] ?? 0;
      const left = x >= 4 ? (pixelsBuffer.data[y * stride + x - 4] ?? 0) : 0;
      const up = y > 0 ? (pixelsBuffer.data[(y - 1) * stride + x] ?? 0) : 0;
      const upLeft = x >= 4 && y > 0 ? (pixelsBuffer.data[(y - 1) * stride + x - 4] ?? 0) : 0;
      const paeth = (() => {
        const p = left + up - upLeft;
        const pa = Math.abs(p - left);
        const pb = Math.abs(p - up);
        const pc = Math.abs(p - upLeft);
        return pa <= pb && pa <= pc ? left : pb <= pc ? up : upLeft;
      })();
      const filtered =
        filter === 0
          ? value
          : filter === 1
            ? (value - left) & 0xff
            : filter === 2
              ? (value - up) & 0xff
              : filter === 3
                ? (value - ((left + up) >> 1)) & 0xff
                : (value - paeth) & 0xff;
      raw[y * (stride + 1) + 1 + x] = filtered;
    }
  }
  const idat = zlibSync(raw, { level: 6 });
  const ihdr = new Uint8Array(13);
  const view = new DataView(ihdr.buffer);
  view.setUint32(0, width);
  view.setUint32(4, height);
  ihdr[8] = 8;
  ihdr[9] = 6;
  // 8 签名 + IHDR(12+13) + IDAT(12+idat) + IEND(12)。
  const total = 8 + 25 + (12 + idat.length) + 12;
  const out = new Uint8Array(total);
  out.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  let offset = 8;
  const chunk = (type: string, data: Uint8Array) => {
    const chunkView = new DataView(out.buffer, offset);
    chunkView.setUint32(0, data.length);
    for (let i = 0; i < 4; i++) out[offset + 4 + i] = type.charCodeAt(i);
    out.set(data, offset + 8);
    chunkView.setUint32(8 + data.length, crc32(out.subarray(offset + 4, offset + 8 + data.length)));
    offset += 12 + data.length;
  };
  chunk("IHDR", ihdr);
  chunk("IDAT", idat);
  chunk("IEND", new Uint8Array(0));
  return out.buffer as ArrayBuffer;
};

describe("part export codec", () => {
  it("round-trips RGBA8 pixels through PNG encode/decode", async () => {
    for (const [width, height] of [
      [1, 1],
      [7, 3],
      [16, 16],
      [33, 5],
    ] as const) {
      const source = pixels(width, height, width * 31 + height);
      const encoded = encodePngSync(source);
      const decoded = decodePngSync(encoded);
      expect(decoded.width).toBe(width);
      expect(decoded.height).toBe(height);
      expect(Array.from(decoded.data)).toEqual(Array.from(source.data));
    }
  });

  it("emits spec-compliant zlib IDAT (0x7x header + hand-checked adler32)", () => {
    const source = pixels(11, 7, 5);
    const encoded = encodePngSync(source);
    const idat = idatOf(encoded);
    expect(idat.length).toBeGreaterThan(6);
    // RFC 1950/RFC 2083：zlib 头 CMF=0x7x（CM=8 deflate、CINFO<=7）、
    // (CMF<<8|FLG) % 31 == 0。裸 deflate 的首字节高半字节不是 0x7。
    const cmf = idat[0] ?? 0;
    const flg = idat[1] ?? 0;
    expect(cmf >> 4).toBe(7);
    expect(cmf & 0x0f).toBe(8);
    expect(((cmf << 8) | flg) % 31).toBe(0);
    // adler32 尾校验：手算未压缩 scanline 流的 adler32，与 zlib 流末 4 字节
    // （大端）比对。
    const expected = adler32(filterZeroRaw(source));
    const idatView = new DataView(idat.buffer, idat.byteOffset, idat.byteLength);
    expect(idatView.getUint32(idat.length - 4)).toBe(expected);
  });

  it("IDAT inflates via the independent node:zlib decoder to the exact input pixels", () => {
    const source = pixels(13, 9, 9);
    const idat = idatOf(encodePngSync(source));
    // node:zlib 与 fflate encoder 不同源，且默认校验 zlib 头与 adler32——
    // 裸 deflate 在这里直接抛 "incorrect header check"。
    const raw = nodeInflateSync(idat);
    expect(Array.from(raw)).toEqual(Array.from(filterZeroRaw(source)));
    // 再显式逐行比对输入像素（filter 字节 + RGBA 字节）。
    const stride = source.width * 4;
    for (let row = 0; row < source.height; row++) {
      expect(raw[row * (stride + 1)]).toBe(0);
      expect(
        Array.from(raw.subarray(row * (stride + 1) + 1, row * (stride + 1) + 1 + stride)),
      ).toEqual(Array.from(source.data.subarray(row * stride, (row + 1) * stride)));
    }
  });

  it("decodes PNGs that use all five scanline filters", () => {
    const width = 9;
    const height = 10;
    const decoded = decodePngSync(buildFilteredPng(width, height));
    const source = pixels(width, height, 7);
    expect(Array.from(decoded.data)).toEqual(Array.from(source.data));
  });

  it("rejects malformed PNG payloads instead of returning pixels", () => {
    expect(() => decodePngSync(new ArrayBuffer(4))).toThrow();
  });

  it("encodes ZIP with stored PNGs, deflated text, sorted entries and 1980 mtime", async () => {
    const codec = createPartExportCodec();
    const png = encodePngSync(pixels(2, 2));
    const manifest = new TextEncoder().encode("{}\n").buffer as ArrayBuffer;
    const readme = new TextEncoder().encode("hello\n").buffer as ArrayBuffer;
    const archive = await codec.encodeZip(
      [
        { path: "parts.json", mime: "application/json", bytes: manifest },
        { path: "README.txt", mime: "text/plain", bytes: readme },
        { path: "parts/b.png", mime: "image/png", bytes: png },
        { path: "parts/a.png", mime: "image/png", bytes: png },
      ],
      {} as never,
    );
    const bytes = new Uint8Array(archive);
    const view = new DataView(archive);
    const entryAt = (offset: number) => {
      expect(view.getUint32(offset, true)).toBe(0x04034b50);
      const method = view.getUint16(offset + 8, true);
      const time = view.getUint16(offset + 10, true);
      const date = view.getUint16(offset + 12, true);
      const nameLength = view.getUint16(offset + 26, true);
      const name = new TextDecoder().decode(bytes.subarray(offset + 30, offset + 30 + nameLength));
      return { method, time, date, name };
    };
    // 条目按路径排序：README.txt < parts.json < parts/a.png < parts/b.png
    const first = entryAt(0);
    expect(first.name).toBe("README.txt");
    expect(first.method).toBe(8); // 文本 deflate
    expect(first.date).toBe(((1 << 5) | 1) & 0xffff); // 1980-01-01
    expect(first.time).toBe(0);
    const secondOffset = 30 + first.name.length + view.getUint32(18, true);
    const second = entryAt(secondOffset);
    expect(second.name).toBe("parts.json");
    expect(second.method).toBe(8);
    const thirdOffset =
      secondOffset + 30 + second.name.length + view.getUint32(secondOffset + 18, true);
    const third = entryAt(thirdOffset);
    expect(third.name).toBe("parts/a.png");
    expect(third.method).toBe(0); // PNG store
    // 无权限位：从 EOCD 定位中央目录，逐条目断言 external attributes 为 0
    // 且 version made by 为 MS-DOS（20，非 Unix 0x03）。
    let eocd = archive.byteLength - 22;
    while (view.getUint32(eocd, true) !== 0x06054b50) eocd -= 1;
    let central = view.getUint32(eocd + 16, true);
    for (let index = 0; index < 4; index++) {
      expect(view.getUint32(central, true)).toBe(0x02014b50);
      expect(view.getUint16(central + 4, true)).toBe(20); // version made by：无 Unix 权限位
      expect(view.getUint32(central + 38, true)).toBe(0); // external attributes = 0
      central += 46 + view.getUint16(central + 28, true);
    }
    // fflate 可解包且内容一致（真实可解压）。
    const unzipped = unzipSync(bytes);
    expect(new TextDecoder().decode(unzipped["README.txt"])).toBe("hello\n");
    expect(new TextDecoder().decode(unzipped["parts.json"])).toBe("{}\n");
    const storedPng = unzipped["parts/a.png"];
    expect(storedPng).toBeDefined();
    expect(Array.from(storedPng ?? new Uint8Array())).toEqual(Array.from(new Uint8Array(png)));
  });

  it("inspectZip reports sorted entries with mime and uncompressed byte lengths", async () => {
    const codec = createPartExportCodec();
    const png = encodePngSync(pixels(2, 2));
    const manifest = new TextEncoder().encode('{"a":1}\n').buffer as ArrayBuffer;
    const archive = await codec.encodeZip(
      [
        { path: "parts.json", mime: "application/json", bytes: manifest },
        { path: "parts/one.png", mime: "image/png", bytes: png },
      ],
      {} as never,
    );
    const inspected = await codec.inspectZip(archive, {} as never);
    expect(inspected.map((entry) => entry.path)).toEqual(["parts.json", "parts/one.png"]);
    expect(inspected[0]).toMatchObject({
      mime: "application/json",
      byteLength: manifest.byteLength,
    });
    expect(inspected[1]).toMatchObject({ mime: "image/png", byteLength: png.byteLength });
  });
});

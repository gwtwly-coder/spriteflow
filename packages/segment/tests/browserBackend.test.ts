// Real-backend tests with an injected fake ORT module (contract section 4):
// provider fallback orchestration, admission gates, embed/infer tensor flow,
// mask mapping back to source coordinates and the cache diagnostics protocol.
import { describe, expect, it } from "vitest";
import { getMaskBit } from "../src/bitmask.js";
import {
  createOnnxSamBackendWithDeps,
  type OnnxSamBackendDeps,
  type OrtTensorLike,
} from "../src/browser/onnxBackend.js";
import { createSamSession } from "../src/session.js";
import { CharacterWarningCode, CharacterErrorCode as Code } from "../src/types.js";
import { asset, context, value } from "./helpers.js";
import {
  chunkedFakeFetch,
  fakeBackend,
  fakeCache,
  fakeFetch,
  fakeOrt,
  SAM_MANIFEST,
  type SyntheticModel,
  syntheticModel,
} from "./samHelpers.js";

const HALF_POSITIVE_LOGITS = [1, 1, -1, -1, 1, 1, -1, -1, 1, 1, -1, -1, 1, 1, -1, -1];

function backendDeps(
  model: SyntheticModel,
  ort: ReturnType<typeof fakeOrt>,
  cache: ReturnType<typeof fakeCache> | null = null,
  overrides: Partial<OnnxSamBackendDeps> = {},
): OnnxSamBackendDeps {
  const network = fakeFetch(model.bytes);
  return {
    loadOrtModule: async () => ort.module,
    fetchImpl: network.fetchImpl,
    openCache: async () => (cache === null ? null : cache.cache),
    subtle: globalThis.crypto.subtle,
    useModelCache: true,
    registry: model.registry,
    ...overrides,
  };
}

describe("OnnxSamBackend.create provider handling", () => {
  it("fails for an unsupported provider and succeeds for wasm", async () => {
    const model = await syntheticModel();
    const ort = fakeOrt({ failingProviders: ["webgpu"] });
    const backend = createOnnxSamBackendWithDeps(backendDeps(model, ort));
    await expect(backend.create(model.encoderManifest, "webgpu")).rejects.toMatchObject({
      characterError: { code: Code.ModelInitializationFailed },
    });
    await backend.create(model.encoderManifest, "wasm");
    expect(ort.created).toHaveLength(2);
    expect(ort.created.every((entry) => entry.providers[0] === "wasm")).toBe(true);
  });

  it("pins the WASM thread count to 1", async () => {
    const model = await syntheticModel();
    const ort = fakeOrt();
    const backend = createOnnxSamBackendWithDeps(backendDeps(model, ort));
    await backend.create(model.encoderManifest, "wasm");
    expect(ort.created.map((entry) => entry.numThreads)).toEqual([1, 1]);
  });

  it("rejects a manifest that drifted from the audited entry before any fetch", async () => {
    const model = await syntheticModel();
    const ort = fakeOrt();
    const deps = backendDeps(model, ort);
    const network = fakeFetch(model.bytes);
    const backend = createOnnxSamBackendWithDeps({ ...deps, fetchImpl: network.fetchImpl });
    await expect(
      backend.create({ ...model.encoderManifest, sha256: "0".repeat(64) }, "wasm"),
    ).rejects.toMatchObject({ characterError: { code: Code.ModelNotApproved } });
    expect(network.requestedUrls).toHaveLength(0);
  });

  it("propagates hash mismatches as MODEL_HASH_MISMATCH", async () => {
    const model = await syntheticModel();
    const wrong = new TextEncoder().encode("spriteflow-fake-encoder-weights-02");
    const ort = fakeOrt();
    const backend = createOnnxSamBackendWithDeps(
      backendDeps(model, ort, null, {
        fetchImpl: fakeFetch(new Map([[model.encoderManifest.artifactUrl, wrong]])).fetchImpl,
      }),
    );
    await expect(backend.create(model.encoderManifest, "wasm")).rejects.toMatchObject({
      characterError: { code: Code.ModelHashMismatch },
    });
  });

  it("rejects unfrozen or unlicensed registry entries", async () => {
    const model = await syntheticModel();
    const ort = fakeOrt();
    const unfrozen = createOnnxSamBackendWithDeps(
      backendDeps(model, ort, null, {
        registry: [{ ...model.encoderEntry, frozen: false }],
      }),
    );
    await expect(unfrozen.create(model.encoderManifest, "wasm")).rejects.toMatchObject({
      characterError: { code: Code.ModelNotApproved },
    });
    const unlicensed = createOnnxSamBackendWithDeps(
      backendDeps(model, ort, null, {
        registry: [
          { ...model.encoderEntry, manifest: { ...model.encoderManifest, licenseId: "bogus" } },
        ],
      }),
    );
    await expect(unlicensed.create(model.encoderManifest, "wasm")).rejects.toMatchObject({
      characterError: { code: Code.ModelNotApproved },
    });
  });
});

describe("OnnxSamBackend embed and infer", () => {
  it("embeds through the encoder and infers through the decoder with scaled prompts", async () => {
    const model = await syntheticModel();
    const ort = fakeOrt({ decoderLogits: HALF_POSITIVE_LOGITS, scores: [0.7, 0.9] });
    const backend = createOnnxSamBackendWithDeps(backendDeps(model, ort));
    await backend.create(model.encoderManifest, "wasm");
    const source = asset(8, 8);
    await backend.embed(source, model.encoderManifest, context());
    const result = await backend.infer(
      { type: "points", points: [{ point: { x: 6, y: 4 }, label: "positive" }], box: null },
      context(),
    );
    expect(result.predictedIou).toBeCloseTo(0.9);
    expect(result.sourceRect).toEqual({ x: 0, y: 0, width: 8, height: 8 });
    expect(result.mask.width).toBe(8);
    expect(result.mask.height).toBe(8);
    // Logits are positive for grid columns 0-1 → source columns 0-3 after upscale.
    for (let y = 0; y < 8; y++) {
      for (let x = 0; x < 8; x++) {
        expect(getMaskBit(result.mask, x, y)).toBe(x < 4);
      }
    }
    const feeds = ort.decoderFeeds[0];
    expect(feeds).toBeDefined();
    // Measured decoder feed set: three passthrough embeddings + prompt tensors
    // + first-run mask memory.
    expect(Object.keys(feeds as Record<string, OrtTensorLike>).sort()).toEqual([
      "has_mask_input",
      "image_embeddings.0",
      "image_embeddings.1",
      "image_embeddings.2",
      "input_labels",
      "input_masks",
      "input_points",
    ]);
    const points = feeds?.input_points;
    expect(points?.data).toBeInstanceOf(Float32Array);
    expect(points?.dims).toEqual([1, 1, 1, 2]); // measured [1,1,N,2] grid coords
    expect(Array.from(points?.data as Float32Array)).toEqual([3, 2]); // (6,4) scaled to the 4x4 grid
    const labels = feeds?.input_labels;
    expect(labels?.dims).toEqual([1, 1, 1]);
    expect(Array.from(labels?.data as BigInt64Array)).toEqual([1n]); // int64 positive label
    const maskMemory = feeds?.input_masks;
    expect(maskMemory?.dims).toEqual([1, 1, 256, 256]);
    expect(Array.from(maskMemory?.data as Float32Array).every((v) => v === 0)).toBe(true);
    const hasMask = feeds?.has_mask_input;
    expect(hasMask?.dims).toEqual([1]);
    expect(Array.from(hasMask?.data as Float32Array)).toEqual([0]);
    // The encoder was fed through the measured pixel_values input.
    const encoderFeeds = ort.encoderFeeds[0];
    expect(Object.keys(encoderFeeds as Record<string, OrtTensorLike>)).toEqual(["pixel_values"]);
    expect(encoderFeeds?.pixel_values?.dims).toEqual([1, 3, 4, 4]);
    expect(encoderFeeds?.pixel_values?.data).toBeInstanceOf(Float32Array);
  });

  it("sends box corners with SAM labels 2/3 when a box prompt has no explicit points", async () => {
    const model = await syntheticModel();
    const ort = fakeOrt({ decoderLogits: HALF_POSITIVE_LOGITS, scores: [0.5] });
    const backend = createOnnxSamBackendWithDeps(backendDeps(model, ort));
    await backend.create(model.encoderManifest, "wasm");
    await backend.embed(asset(8, 8), model.encoderManifest, context());
    await backend.infer(
      { type: "box", box: { x: 2, y: 2, width: 4, height: 4 }, points: [] },
      context(),
    );
    const feeds = ort.decoderFeeds[0];
    const points = feeds?.input_points;
    expect(points?.dims).toEqual([1, 1, 2, 2]);
    // Inclusive half-open corners (2,2)..(5,5) scaled to the 4x4 grid.
    expect(Array.from(points?.data as Float32Array)).toEqual([1, 1, 2.5, 2.5]);
    expect(Array.from(feeds?.input_labels?.data as BigInt64Array)).toEqual([2n, 3n]);
  });

  it("appends box corners after explicit points with labels 2/3", async () => {
    const model = await syntheticModel();
    const ort = fakeOrt({ decoderLogits: HALF_POSITIVE_LOGITS, scores: [0.9, 0.1] });
    const backend = createOnnxSamBackendWithDeps(backendDeps(model, ort));
    await backend.create(model.encoderManifest, "wasm");
    await backend.embed(asset(8, 8), model.encoderManifest, context());
    await backend.infer(
      {
        type: "points",
        points: [
          { point: { x: 1, y: 1 }, label: "positive" },
          { point: { x: 6, y: 6 }, label: "negative" },
        ],
        box: { x: 2, y: 2, width: 4, height: 4 },
      },
      context(),
    );
    const feeds = ort.decoderFeeds[0];
    const points = feeds?.input_points;
    expect(points?.dims).toEqual([1, 1, 4, 2]);
    expect(Array.from(points?.data as Float32Array)).toEqual([0.5, 0.5, 3, 3, 1, 1, 2.5, 2.5]);
    expect(Array.from(feeds?.input_labels?.data as BigInt64Array)).toEqual([1n, 0n, 2n, 3n]);
  });

  it("maps decoder failures to INFERENCE_UNAVAILABLE", async () => {
    const model = await syntheticModel();
    const ort = fakeOrt({ decoderRunError: new Error("decoder exploded") });
    const backend = createOnnxSamBackendWithDeps(backendDeps(model, ort));
    await backend.create(model.encoderManifest, "wasm");
    await backend.embed(asset(8, 8), model.encoderManifest, context());
    await expect(
      backend.infer(
        { type: "box", box: { x: 0, y: 0, width: 2, height: 2 }, points: [] },
        context(),
      ),
    ).rejects.toMatchObject({ characterError: { code: Code.InferenceUnavailable } });
  });

  it("reports cache provenance and MODEL_CACHE_UNAVAILABLE through diagnostics", async () => {
    const model = await syntheticModel();
    const coldOrt = fakeOrt();
    const coldBackend = createOnnxSamBackendWithDeps(backendDeps(model, coldOrt));
    await coldBackend.create(model.encoderManifest, "wasm");
    // No Cache API at all: the model still loads, but the session is told.
    const cold = coldBackend.describeModelLoad();
    expect(cold.cachedModel).toBe(false);
    expect(cold.warnings.map((warning) => warning.code)).toContain(
      CharacterWarningCode.ModelCacheUnavailable,
    );

    const cache = fakeCache();
    const warmOrt = fakeOrt();
    const warmBackend = createOnnxSamBackendWithDeps(backendDeps(model, warmOrt, cache));
    await warmBackend.create(model.encoderManifest, "wasm");
    const warmSecond = createOnnxSamBackendWithDeps(backendDeps(model, warmOrt, cache));
    await warmSecond.create(model.encoderManifest, "wasm");
    expect(warmSecond.describeModelLoad().cachedModel).toBe(true);

    const failingPut = fakeCache();
    failingPut.failPut = true;
    const degraded = createOnnxSamBackendWithDeps(backendDeps(model, fakeOrt(), failingPut));
    await degraded.create(model.encoderManifest, "wasm");
    const diagnostics = degraded.describeModelLoad();
    expect(diagnostics.warnings.map((warning) => warning.code)).toContain(
      CharacterWarningCode.ModelCacheUnavailable,
    );
  });

  it("releases both sessions on dispose and stays idempotent", async () => {
    const model = await syntheticModel();
    const ort = fakeOrt();
    const backend = createOnnxSamBackendWithDeps(backendDeps(model, ort));
    await backend.create(model.encoderManifest, "wasm");
    await backend.dispose();
    expect(ort.released).toBe(2);
    await backend.dispose();
    expect(ort.released).toBe(2);
  });
});

// 2026-10-04 蒙版碎片化修复（真模型消融数据见 apps/web/evidence/sam-quality/）：
// SAM 解码器每 prompt 出 4 个候选蒙版，其自评 iou_scores 系统性偏向子部件碎片
// （tall-elf torso 只切出腰带）。新解码管线：候选按与提示框的网格 IoU 择优、
// 阈值 logit>-0.62（p≈0.35）、补洞+闭运算+保留最大连通域、上采样后裁剪回提示框。
// 以下测试改前红、改后绿（默认 fake ORT 网格 4×4，资产 8×8，网格单元映射资产 2×2；
// 形态学用例改用 8×8 网格与资产 1:1 映射，避免 3×3 结构元吞掉整个 4×4 网格）。
describe("mask decode pipeline: candidate selection and post-processing", () => {
  const BOX44 = { x: 2, y: 2, width: 4, height: 4 };
  // 网格布局（4×4，行优先）: 0  1  2  3 / 4  5  6  7 / 8  9 10 11 / 12 13 14 15
  // 资产像素 (x,y) → 网格 (floor(x/2), floor(y/2))。
  const grid4 = (value: number) => new Array<number>(16).fill(value);
  const grid8 = (value: number) => new Array<number>(64).fill(value);
  const withCells = (base: number[], cells: readonly number[], value: number) =>
    base.map((original, index) => (cells.includes(index) ? value : original));

  it("selects the candidate with the best prompt-box IoU over the argmax(iou_scores) fragment", async () => {
    const model = await syntheticModel();
    const ort = fakeOrt({
      // 候选0 自评最高但覆盖全图（与框 IoU=0.25）——旧行为选中它；
      // 候选1 自评最低但恰好覆盖框（IoU=1.0）；候选2 单格；候选3 空。
      candidateLogits: [
        grid4(1),
        withCells(grid4(-1), [5, 6, 9, 10], 1),
        withCells(grid4(-1), [0], 1),
        grid4(-1),
      ],
      scores: [0.95, 0.3, 0.5, 0.1],
    });
    const backend = createOnnxSamBackendWithDeps(backendDeps(model, ort));
    await backend.create(model.encoderManifest, "wasm");
    await backend.embed(asset(8, 8), model.encoderManifest, context());
    const result = await backend.infer({ type: "box", box: BOX44, points: [] }, context());
    expect(result.predictedIou).toBeCloseTo(0.3);
    for (let y = 0; y < 8; y++) {
      for (let x = 0; x < 8; x++) {
        const insideBox =
          x >= BOX44.x && x < BOX44.x + BOX44.width && y >= BOX44.y && y < BOX44.y + BOX44.height;
        expect(getMaskBit(result.mask, x, y)).toBe(insideBox);
      }
    }
  });

  it("clips the upsampled mask to the prompt box in asset coordinates", async () => {
    const model = await syntheticModel();
    const ort = fakeOrt({ decoderLogits: grid4(1), scores: [0.9] });
    const backend = createOnnxSamBackendWithDeps(backendDeps(model, ort));
    await backend.create(model.encoderManifest, "wasm");
    await backend.embed(asset(8, 8), model.encoderManifest, context());
    const result = await backend.infer(
      { type: "box", box: { x: 1, y: 1, width: 4, height: 4 }, points: [] },
      context(),
    );
    for (let y = 0; y < 8; y++) {
      for (let x = 0; x < 8; x++) {
        const insideBox = x >= 1 && x < 5 && y >= 1 && y < 5;
        expect(getMaskBit(result.mask, x, y)).toBe(insideBox);
      }
    }
  });

  it("thresholds candidate logits at logit -0.62 (p≈0.35), keeping weak-positive cells", async () => {
    const model = await syntheticModel();
    // 8×8 网格 1:1 资产。格 9（=(1,1)，logit -0.3）旧阈值 >0 丢弃、新阈值保留；
    // 中央 4×4 深负块（行 2-5 × 列 4-7）大于 3×3 结构元，闭运算后仍被排除。
    const darkBlock: number[] = [];
    for (let row = 2; row <= 5; row++)
      for (let col = 4; col <= 7; col++) darkBlock.push(row * 8 + col);
    const ort = fakeOrt({
      decoderGrid: { width: 8, height: 8 },
      decoderLogits: withCells(withCells(grid8(1), [9], -0.3), darkBlock, -5),
      scores: [0.9],
    });
    const backend = createOnnxSamBackendWithDeps(backendDeps(model, ort));
    await backend.create(model.encoderManifest, "wasm");
    await backend.embed(asset(8, 8), model.encoderManifest, context());
    const result = await backend.infer(
      { type: "points", points: [{ point: { x: 1, y: 1 }, label: "positive" }], box: null },
      context(),
    );
    expect(getMaskBit(result.mask, 1, 1)).toBe(true); // 弱正纳入
    expect(getMaskBit(result.mask, 5, 3)).toBe(false); // 深负大块仍排除
  });

  it("fills interior holes in the candidate mask before upsampling", async () => {
    const model = await syntheticModel();
    // 网格中心 2×2（5,6,9,10）深负：闭环内部按补洞填平。
    const ort = fakeOrt({
      decoderLogits: withCells(grid4(1), [5, 6, 9, 10], -5),
      scores: [0.9],
    });
    const backend = createOnnxSamBackendWithDeps(backendDeps(model, ort));
    await backend.create(model.encoderManifest, "wasm");
    await backend.embed(asset(8, 8), model.encoderManifest, context());
    const result = await backend.infer(
      { type: "points", points: [{ point: { x: 0, y: 0 }, label: "positive" }], box: null },
      context(),
    );
    expect(getMaskBit(result.mask, 2, 2)).toBe(true);
    expect(getMaskBit(result.mask, 5, 5)).toBe(true);
  });

  it("keeps only the largest 4-connected component of the candidate mask", async () => {
    const model = await syntheticModel();
    // 8×8 网格 1:1 资产。孤岛 {(0,0)} 与 3×3 大块（行 3-5 × 列 3-5）相距足够远，
    // 闭运算不会桥接；小孤岛被过滤。
    const block: number[] = [];
    for (let row = 3; row <= 5; row++) for (let col = 3; col <= 5; col++) block.push(row * 8 + col);
    const ort = fakeOrt({
      decoderGrid: { width: 8, height: 8 },
      decoderLogits: withCells(withCells(grid8(-1), [0], 1), block, 1),
      scores: [0.9],
    });
    const backend = createOnnxSamBackendWithDeps(backendDeps(model, ort));
    await backend.create(model.encoderManifest, "wasm");
    await backend.embed(asset(8, 8), model.encoderManifest, context());
    const result = await backend.infer(
      { type: "points", points: [{ point: { x: 4, y: 4 }, label: "positive" }], box: null },
      context(),
    );
    expect(getMaskBit(result.mask, 0, 0)).toBe(false); // 孤岛
    expect(getMaskBit(result.mask, 4, 4)).toBe(true); // 大块
    expect(getMaskBit(result.mask, 3, 5)).toBe(true);
  });

  it("ranks candidates on their p50 masks, not the dilated p35 extent (torso regression)", async () => {
    const model = await syntheticModel();
    // 8×8 网格 1:1 资产，box = 左半（列 0-3）。
    // 候选0（自评 0.95，SAM 偏爱的碎片）：列 4-5 强正、其余弱正 -0.3 —— p50 蒙版在框外
    // （IoU 0），p35 膨胀成全图（IoU 0.5）。
    // 候选1（自评 0.40）：列 0-3 强正、其余 -0.3 —— p50 恰好盖框（IoU 1.0），p35 全图（0.5）。
    // 若排序用 p35 蒙版：两者 0.5 平手 → 自评高者胜（选错碎片，真图 torso 即此回归）；
    // 排序用 p50：候选1 以 1.0 胜出。断言 predictedIou=0.4 即锁定 p50 排名。
    const plane = (strong: readonly number[], weakValue: number) => {
      const cells = new Array<number>(64).fill(weakValue);
      for (const index of strong) cells[index] = 1;
      return cells;
    };
    const strongCol = (from: number, to: number) => {
      const out: number[] = [];
      for (let row = 0; row < 8; row++)
        for (let col = from; col <= to; col++) out.push(row * 8 + col);
      return out;
    };
    const ort = fakeOrt({
      decoderGrid: { width: 8, height: 8 },
      candidateLogits: [
        plane(strongCol(4, 5), -0.3),
        plane(strongCol(0, 3), -0.3),
        new Array<number>(64).fill(-5),
        new Array<number>(64).fill(-5),
      ],
      scores: [0.95, 0.4, 0.1, 0.1],
    });
    const backend = createOnnxSamBackendWithDeps(backendDeps(model, ort));
    await backend.create(model.encoderManifest, "wasm");
    await backend.embed(asset(8, 8), model.encoderManifest, context());
    const result = await backend.infer(
      { type: "box", box: { x: 0, y: 0, width: 4, height: 8 }, points: [] },
      context(),
    );
    expect(result.predictedIou).toBeCloseTo(0.4);
    for (let y = 0; y < 8; y++) {
      for (let x = 0; x < 8; x++) {
        expect(getMaskBit(result.mask, x, y)).toBe(x < 4);
      }
    }
  });

  it("falls back to argmax(iou_scores) selection for point-only prompts without a box", async () => {
    const model = await syntheticModel();
    // 候选1 单格 (2,2)（网格中央，闭运算不扩边）。
    const ort = fakeOrt({
      candidateLogits: [grid4(1), withCells(grid4(-1), [10], 1)],
      scores: [0.2, 0.8],
    });
    const backend = createOnnxSamBackendWithDeps(backendDeps(model, ort));
    await backend.create(model.encoderManifest, "wasm");
    await backend.embed(asset(8, 8), model.encoderManifest, context());
    const result = await backend.infer(
      { type: "points", points: [{ point: { x: 4, y: 4 }, label: "positive" }], box: null },
      context(),
    );
    expect(result.predictedIou).toBeCloseTo(0.8);
    expect(getMaskBit(result.mask, 4, 4)).toBe(true); // 网格(2,2) → 资产 [4,6)×[4,6)
    expect(getMaskBit(result.mask, 0, 0)).toBe(false); // 网格0 未被选中（闭运算不跨 2 格）
  });
});

describe("SamSession over the real backend with a fake ORT (webgpu → wasm)", () => {
  it("falls back once, re-embeds on the WASM session and segments", async () => {
    const model = await syntheticModel();
    const ort = fakeOrt({
      failingProviders: ["webgpu"],
      decoderLogits: HALF_POSITIVE_LOGITS,
      scores: [0.9],
    });
    const network = fakeFetch(model.bytes);
    const cache = fakeCache();
    const backend = createOnnxSamBackendWithDeps({
      loadOrtModule: async () => ort.module,
      fetchImpl: network.fetchImpl,
      openCache: async () => cache.cache,
      subtle: globalThis.crypto.subtle,
      useModelCache: true,
      registry: model.registry,
    });
    const session = createSamSession(
      model.encoderManifest,
      {
        provider: "auto",
        wasmThreads: 1,
        useModelCache: true,
      },
      backend,
    );
    const info = value(await session.initialize(context()));
    expect(info.provider).toBe("wasm");
    expect(info.state).toBe("ready");
    expect(info.warnings.map((warning) => warning.code)).toEqual([
      CharacterWarningCode.WebGpuFallbackToWasm,
    ]);
    const embedded = value(await session.setImage(asset(8, 8), context()));
    expect(embedded.state).toBe("image-ready");
    const mask = value(
      await session.segment(
        { type: "box", box: { x: 1, y: 1, width: 4, height: 4 }, points: [] },
        context(),
      ),
    );
    expect(mask.provider).toBe("wasm");
    expect(mask.predictedIou).toBeCloseTo(0.9);
    // 网格列 0-1 → 资产列 0-3；box (1,1,4,4) 裁剪后仅列 1-3、行 1-4 置位
    // （2026-10-04 碎片化修复：上采样蒙版限制在提示框内）。
    for (let y = 0; y < 8; y++) {
      for (let x = 0; x < 8; x++) {
        expect(getMaskBit(mask.mask, x, y)).toBe(x >= 1 && x < 4 && y >= 1 && y < 5);
      }
    }
    await session.dispose();
    // The artifacts were fetched once (first create) and served from the cache on
    // the WASM rebuild; only successful wasm session creations are recorded, and
    // the final dispose released both live sessions.
    expect(ort.created.map((entry) => entry.providers[0])).toEqual(["wasm", "wasm"]);
    expect(ort.released).toBe(2);
    expect(network.requestedUrls.length).toBe(2);
    expect(cache.puts.length).toBe(2);
  });
});

// P1 回归（2026-09-30 真浏览器挂死）：session.initialize → backend.create 必须
// 在流式下载时逐块发出字节进度（经 setDownloadProgressSink），且两个字节的
// 工件都要真正写进 Cache API。此前 loader 无进度通道、字节也从未进缓存。
describe("real backend download progress protocol (streaming fetch)", () => {
  it("forwards per-artifact byte progress during session.initialize and caches both artifacts", async () => {
    const model = await syntheticModel();
    const ort = fakeOrt();
    const cache = fakeCache();
    const network = chunkedFakeFetch(model.bytes, 8);
    const backend = createOnnxSamBackendWithDeps({
      loadOrtModule: async () => ort.module,
      fetchImpl: network.fetchImpl,
      openCache: async () => cache.cache,
      subtle: globalThis.crypto.subtle,
      useModelCache: true,
      registry: model.registry,
    });
    const events: Array<{
      modelId: string;
      role: string;
      loadedBytes: number;
      totalBytes: number;
    }> = [];
    backend.setDownloadProgressSink((event) => events.push({ ...event }));
    const session = createSamSession(
      model.encoderManifest,
      { provider: "wasm", wasmThreads: 1, useModelCache: true },
      backend,
    );
    const info = value(await session.initialize(context()));
    expect(info.state).toBe("ready");
    await session.dispose();
    // Both artifacts streamed with monotonic progress ending at the exact bytes.
    for (const [manifest, role] of [
      [model.encoderManifest, "encoder"],
      [model.decoderManifest, "decoder"],
    ] as const) {
      const roleEvents = events.filter((event) => event.role === role);
      expect(roleEvents.length, role).toBeGreaterThan(0);
      for (let index = 1; index < roleEvents.length; index++) {
        expect(roleEvents[index]?.loadedBytes).toBeGreaterThan(
          roleEvents[index - 1]?.loadedBytes ?? 0,
        );
      }
      expect(roleEvents.at(-1)).toEqual({
        modelId: manifest.modelId,
        role,
        loadedBytes: manifest.byteLength,
        totalBytes: manifest.byteLength,
      });
    }
    // The verified bytes landed in the Cache API for both artifacts.
    expect(cache.puts).toHaveLength(2);
    expect(network.requestedUrls).toEqual([
      model.encoderManifest.artifactUrl,
      model.decoderManifest.artifactUrl,
    ]);
  });

  it("stops emitting after the sink is cleared and treats null as no sink", async () => {
    const model = await syntheticModel();
    const ort = fakeOrt();
    const backend = createOnnxSamBackendWithDeps(backendDeps(model, ort));
    backend.setDownloadProgressSink(null);
    // A cleared sink must behave exactly like the pre-subscription backend.
    await backend.create(model.encoderManifest, "wasm");
    expect(ort.created).toHaveLength(2);
  });
});

describe("fake backend sanity (used by session/orchestration tests)", () => {
  it("records create/embed/infer/dispose calls", async () => {
    const { backend, calls } = fakeBackend();
    await backend.create(SAM_MANIFEST, "webgpu");
    await backend.embed(asset(8, 8), SAM_MANIFEST, context());
    await backend.infer(
      { type: "box", box: { x: 0, y: 0, width: 2, height: 2 }, points: [] },
      context(),
    );
    await backend.dispose();
    expect(calls.create).toHaveLength(1);
    expect(calls.embeds).toHaveLength(1);
    expect(calls.infer).toHaveLength(1);
    expect(calls.dispose).toBe(1);
  });
});

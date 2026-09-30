// Shared SAM/browser fixtures for @spriteflow/segment tests. Everything here is a
// fake: no onnxruntime-web, no real fetch and no real Cache API is ever touched.
import { createBitMask, setMaskBit } from "../src/bitmask.js";
import {
  getApprovedSamManifest,
  type SamCacheLike,
  type SamRegistryEntry,
} from "../src/browser/manifest.js";
import type { OrtModuleLike, OrtSessionLike, OrtTensorLike } from "../src/browser/onnxBackend.js";
import type { InputAsset } from "../src/m1.js";
import type {
  CharacterWarning,
  SamExecutionProvider,
  SamInferenceBackend,
  SamMaskResult,
  SamModelManifest,
  SamPrompt,
} from "../src/types.js";

export const SAM_MANIFEST: SamModelManifest = getApprovedSamManifest(
  "sam2.1-hiera-tiny-encoder-fp16",
) as SamModelManifest;

export const SAM_DECODER_MANIFEST: SamModelManifest = getApprovedSamManifest(
  "sam2.1-hiera-tiny-decoder-fp16",
) as SamModelManifest;

// --- Fake SamInferenceBackend ---------------------------------------------------

export interface FakeBackendScript {
  /** Errors thrown by create() keyed by requested provider. */
  createErrors?: Partial<Record<SamExecutionProvider, unknown>>;
  embedError?: unknown;
  inferError?: unknown;
  /** Overrides the default rectangular half-width mask result. */
  inferImpl?: (prompt: SamPrompt) => Promise<Omit<SamMaskResult, "asset" | "provider">>;
  /** Adds an optional describeModelLoad diagnostics protocol. */
  diagnostics?: { cachedModel: boolean; warnings: CharacterWarning[] };
}

export interface FakeBackendCalls {
  create: Array<{ modelId: string; provider: SamExecutionProvider }>;
  embeds: Array<{ assetId: string; revision: number }>;
  infer: SamPrompt[];
  dispose: number;
}

export function fakeBackend(script: FakeBackendScript = {}): {
  backend: SamInferenceBackend;
  calls: FakeBackendCalls;
} {
  const calls: FakeBackendCalls = { create: [], embeds: [], infer: [], dispose: 0 };
  const backend: SamInferenceBackend = {
    async create(manifest, provider) {
      calls.create.push({ modelId: manifest.modelId, provider });
      const error = script.createErrors?.[provider];
      if (error !== undefined) throw error;
    },
    async embed(asset) {
      calls.embeds.push({ assetId: asset.ref.assetId, revision: asset.ref.revision });
      if (script.embedError !== undefined) throw script.embedError;
    },
    async infer(prompt) {
      calls.infer.push(prompt);
      if (script.inferError !== undefined) throw script.inferError;
      if (script.inferImpl !== undefined) return script.inferImpl(prompt);
      return defaultInferResult();
    },
    async dispose() {
      calls.dispose += 1;
    },
  };
  const withDiagnostics = backend as SamInferenceBackend & {
    describeModelLoad?(): { cachedModel: boolean; warnings: CharacterWarning[] };
  };
  if (script.diagnostics !== undefined) {
    withDiagnostics.describeModelLoad = () =>
      script.diagnostics as {
        cachedModel: boolean;
        warnings: CharacterWarning[];
      };
  }
  return { backend, calls };
}

/** Default result: left half of the 8x8 fixture asset set, predictedIou 0.9. */
export function defaultInferResult(): Omit<SamMaskResult, "asset" | "provider"> {
  const mask = createBitMask(8, 8);
  for (let y = 0; y < 8; y++) {
    for (let x = 0; x < 4; x++) setMaskBit(mask, x, y, true);
  }
  return {
    mask,
    sourceRect: { x: 0, y: 0, width: 8, height: 8 },
    predictedIou: 0.9,
  };
}

// --- Fake ORT module -------------------------------------------------------------

export class FakeTensor implements OrtTensorLike {
  constructor(
    readonly type: string,
    readonly data: OrtTensorLike["data"],
    readonly dims: readonly number[],
  ) {}
}

export interface FakeOrtOptions {
  /** Execution providers that make InferenceSession.create reject. */
  failingProviders?: readonly string[];
  /** Logits grid for the decoder masks output (dims [1,1,gh,gw]). */
  decoderLogits?: readonly number[];
  decoderGrid?: { width: number; height: number };
  scores?: readonly number[];
  /** Makes the first successful session's run() reject. */
  encoderRunError?: Error;
  /** Makes the second successful session's run() reject. */
  decoderRunError?: Error;
}

export interface FakeOrtHandle {
  module: OrtModuleLike;
  created: Array<{ providers: string[]; numThreads: number | undefined }>;
  released: number;
  decoderFeeds: Array<Record<string, OrtTensorLike>>;
}

export function fakeOrt(options: FakeOrtOptions = {}): FakeOrtHandle {
  const handle: FakeOrtHandle = {
    module: null as unknown as OrtModuleLike,
    created: [],
    released: 0,
    decoderFeeds: [],
  };
  let successfulCreates = 0;
  const makeSession = (sessionIndex: number): OrtSessionLike => {
    return {
      async run(feeds: Record<string, OrtTensorLike>) {
        if (sessionIndex === 0) {
          if (options.encoderRunError) throw options.encoderRunError;
          // Encoder: echo one embedding output for the decoder feeds.
          return {
            image_embeddings: new FakeTensor(
              "float32",
              new Float32Array([0.1, 0.2, 0.3]),
              [1, 1, 3],
            ),
          };
        }
        if (options.decoderRunError) throw options.decoderRunError;
        handle.decoderFeeds.push(feeds);
        const grid = options.decoderGrid ?? { width: 4, height: 4 };
        const logits = options.decoderLogits ?? [];
        const scores = options.scores ?? [0.9];
        return {
          masks: new FakeTensor("float32", Float32Array.from(logits), [
            1,
            1,
            grid.height,
            grid.width,
          ]),
          iou_predictions: new FakeTensor("float32", Float32Array.from(scores), [1, scores.length]),
        };
      },
      async release() {
        handle.released += 1;
      },
    };
  };
  handle.module = {
    InferenceSession: {
      async create(
        _model: Uint8Array,
        sessionOptions?: { executionProviders?: readonly string[]; numThreads?: number },
      ) {
        const providers = [...(sessionOptions?.executionProviders ?? [])];
        if (options.failingProviders?.some((provider) => providers.includes(provider))) {
          throw new Error(`unsupported execution provider: ${providers.join(",")}`);
        }
        const sessionIndex = successfulCreates;
        successfulCreates += 1;
        handle.created.push({ providers, numThreads: sessionOptions?.numThreads });
        return makeSession(sessionIndex);
      },
    },
    Tensor: FakeTensor as unknown as OrtModuleLike["Tensor"],
  };
  return handle;
}

// --- Synthetic registry, fetch and Cache API --------------------------------------

const TEST_BASE_URL = "https://models.unit.test/sam";

export function syntheticManifest(
  modelId: string,
  fileName: string,
  byteLength: number,
  sha256: string,
): SamModelManifest {
  return {
    modelId,
    revision: "test-v1",
    artifactUrl: `${TEST_BASE_URL}/${fileName}`,
    sha256,
    byteLength,
    inputSize: { width: 4, height: 4 },
    maxSourceDimension: 8,
    imageInputName: "image",
    promptInputNames: { box: "box_coords", points: "point_coords", pointLabels: "point_labels" },
    outputNames: { masks: "masks", scores: "iou_predictions" },
    licenseId: "apache-2.0",
  };
}

export interface SyntheticModel {
  registry: SamRegistryEntry[];
  encoderEntry: SamRegistryEntry;
  decoderEntry: SamRegistryEntry;
  encoderManifest: SamModelManifest;
  decoderManifest: SamModelManifest;
  bytes: Map<string, Uint8Array>;
}

export async function syntheticModel(): Promise<SyntheticModel> {
  const encoderBytes = new TextEncoder().encode("spriteflow-fake-encoder-weights-01");
  const decoderBytes = new TextEncoder().encode("spriteflow-fake-decoder-weights-01");
  const encoderManifest = syntheticManifest(
    "test-encoder-fp16",
    "encoder.onnx",
    encoderBytes.byteLength,
    await sha256Hex(encoderBytes),
  );
  const decoderManifest = syntheticManifest(
    "test-decoder-fp16",
    "decoder.onnx",
    decoderBytes.byteLength,
    await sha256Hex(decoderBytes),
  );
  const encoderEntry: SamRegistryEntry = {
    manifest: encoderManifest,
    role: "encoder",
    family: "test-fp16",
    frozen: true,
  };
  const decoderEntry: SamRegistryEntry = {
    manifest: decoderManifest,
    role: "decoder",
    family: "test-fp16",
    frozen: true,
  };
  return {
    registry: [encoderEntry, decoderEntry],
    encoderEntry,
    decoderEntry,
    encoderManifest,
    decoderManifest,
    bytes: new Map([
      [encoderManifest.artifactUrl, encoderBytes],
      [decoderManifest.artifactUrl, decoderBytes],
    ]),
  };
}

export async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const copy = new Uint8Array(bytes.length);
  copy.set(bytes);
  const digest = await globalThis.crypto.subtle.digest("SHA-256", copy);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export interface FakeFetchHandle {
  fetchImpl: typeof fetch;
  requestedUrls: string[];
}

export function fakeFetch(bytes: Map<string, Uint8Array>): FakeFetchHandle {
  const requestedUrls: string[] = [];
  const fetchImpl = (async (input: RequestInfo | URL) => {
    const url = typeof input === "string" ? input : input.toString();
    requestedUrls.push(url);
    const payload = bytes.get(url);
    if (payload === undefined) {
      return new Response("missing", { status: 404 });
    }
    return new Response(payload.slice(), { status: 200 });
  }) as typeof fetch;
  return { fetchImpl, requestedUrls };
}

export interface FakeCacheHandle {
  cache: SamCacheLike;
  puts: string[];
  hits: string[];
  failPut: boolean;
}

/** Cache double backed by raw bytes so responses can be matched repeatedly. */
export function fakeCache(initial: Map<string, Uint8Array> = new Map()): FakeCacheHandle {
  const store = initial;
  const handle: FakeCacheHandle = {
    cache: {
      async match(request: RequestInfo | URL) {
        const url = typeof request === "string" ? request : request.toString();
        const payload = store.get(url);
        if (payload === undefined) return undefined;
        handle.hits.push(url);
        return new Response(payload.slice(), { status: 200 });
      },
      async put(request: RequestInfo | URL, response: Response) {
        if (handle.failPut) throw new Error("quota exceeded");
        const url = typeof request === "string" ? request : request.toString();
        const buffer = await response.arrayBuffer();
        store.set(url, new Uint8Array(buffer));
        handle.puts.push(url);
      },
    },
    puts: [],
    hits: [],
    failPut: false,
  };
  return handle;
}

export function assetRefOf(asset: InputAsset): { assetId: string; revision: number } {
  return { assetId: asset.ref.assetId, revision: asset.ref.revision };
}

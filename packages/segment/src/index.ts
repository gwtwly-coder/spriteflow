// @spriteflow/segment root entry — v3.0-alpha contract surface
// (docs/interface-contract-v3.md sections 1-5 and 10). ES2022 + TypedArray only,
// Node-importable; no DOM, Worker, fetch, Cache API, Canvas or ORT references.
// Browser-only SAM runtime and fetch transport will arrive via ./browser later.

export { applyMaskEdits, maskBounds } from "./bitmask.js";
export {
  DEFAULT_CHARACTER_LIMITS,
  DEFAULT_SEGMENTATION_OPTIONS,
  V3_CONTRACT_VERSION,
  V3_PROTOCOL_VERSION,
} from "./defaults.js";
export { locatePartsWithLlm } from "./llm.js";
export {
  createPartAsset,
  extractPartPixels,
  removePartAsset,
  validatePartAsset,
} from "./partAsset.js";
export * from "./types.js";

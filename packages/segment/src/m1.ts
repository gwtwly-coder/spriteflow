// M1 contract types (interface-contract.md 3.0.0 / r4), imported type-only from the
// built @spriteflow/pipeline root-entry declarations (docs/interface-contract-v3.md
// header: "项目必须使用该版本根入口已导出的 AssetRef、InputAsset、… 等类型").
//
// NOTE: this zero-dependency skeleton cannot declare the workspace dependency in
// package.json, so the canonical "@spriteflow/pipeline" specifier does not resolve
// for tsc here; the emitted declaration file is referenced relatively instead.
// All imports stay `import type`, so nothing is resolved at runtime. When the
// workspace devDependency is added later, only this file needs to change.
export type {
  AssetRef,
  InputAsset,
  PixelBuffer,
  Point,
  Rect,
  Size,
} from "../../pipeline/dist/types.js";

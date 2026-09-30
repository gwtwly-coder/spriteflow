import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react()],
  // Character Worker 经 @spriteflow/segment/browser 动态 import onnxruntime-web，
  // worker 包需要 code-splitting：默认 iife 不支持，改用 ES module worker
  //（源码本就是 new Worker(url, { type: "module" })）。
  worker: {
    format: "es",
  },
  // ORT 的 wasm 胶水按自身 import.meta.url 相对定位 ort-wasm-*.wasm。Vite dev
  // 预打包把它搬进 node_modules/.vite/deps/，相对定位落空 → 请求被 SPA 回退
  // 伺服成 index.html（WebAssembly magic word 报错，验收 P1）。排除预打包后
  // dev 从真实 dist 路径伺服模块，相对定位成立；生产构建不受此配置影响。
  optimizeDeps: {
    exclude: ["onnxruntime-web"],
  },
});

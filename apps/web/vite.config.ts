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
  // 2026-10-01 走查破案：workspace 包（pipeline/segment）的 dist 变更会触发整页
  // reload——而根 lint/typecheck 门禁每次都重建 pipeline dist，导致任何人在跑
  // 门禁时浏览器会话被随机清空（多次"页面自发重置/状态丢失"的元凶）。排除后
  // 包重建需要手动刷新生效，行为可预期。
  server: {
    watch: {
      ignored: ["**/packages/*/dist/**"],
    },
  },
});

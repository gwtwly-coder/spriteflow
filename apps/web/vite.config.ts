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
});

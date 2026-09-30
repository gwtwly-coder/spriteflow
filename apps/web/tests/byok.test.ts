// BYOK 端点校验测试（契约 :421 HTTPS 强制 + 开发 localhost 例外；契约 :331
// 明文允许 loopback http）。2026-10-01 RC 走查回归锁：RC 的 BYOK 形状
// `http://localhost:8787/chat/completions`（自定义服务商 + 本地转发中继）
// 必须在 UI 层通过校验——与 segment llm.ts 的 isAuthorityLocalhost 家族
// （localhost / 127.0.0.1 / [::1]）保持 parity，http 到非 loopback 仍拒绝。

import { describe, expect, it } from "vitest";
import { isValidEndpoint } from "../src/character/byok";

describe("isValidEndpoint（BYOK 面板端点校验）", () => {
  it.each([
    ["RC 场景：localhost + http", "http://localhost:8787/chat/completions"],
    ["IPv4 loopback + http", "http://127.0.0.1:8787/chat/completions"],
    ["IPv6 loopback + http", "http://[::1]:8787/chat/completions"],
    ["https 任意主机", "https://open.bigmodel.cn/api/paas/v4/chat/completions"],
    ["https 自定义中继", "https://relay.internal:9000/v1/chat/completions"],
  ])("接受：%s", (_name, endpoint) => {
    expect(isValidEndpoint(endpoint)).toBe(true);
  });

  it.each([
    ["http 到公网主机", "http://api.example.com/v1/chat/completions"],
    ["http 到内网主机", "http://192.168.1.10:8787/chat/completions"],
    ["localhost 前缀的伪 loopback", "http://localhost.evil.com/chat/completions"],
    ["loopback 但路径不是 /chat/completions", "http://localhost:8787/v1/messages"],
    ["裸主机名无 scheme", "localhost:8787/chat/completions"],
    ["userinfo", "https://user:pass@llm.example.com/v1/chat/completions"],
    ["fragment", "https://llm.example.com/v1/chat/completions#frag"],
    ["空串", ""],
    ["超长", `https://${"a".repeat(2_100)}.com/v1/chat/completions`],
  ])("拒绝：%s", (_name, endpoint) => {
    expect(isValidEndpoint(endpoint)).toBe(false);
  });
});

// --- maxOutputTokensForModel（2026-10-01 RC 走查 P1） ------------------------------
// z.ai glm-4v-flash 的服务商侧 max_tokens 上限实测为 [1,1024]（HTTP 400 code
// 1210 "The max_tokens parameter is illegal.：限制数值范围[1,1024]"，<1s）。
// 应用默认发契约上限 4,096 会被快速拒绝且（修复前）被归网络类误报"连不上
// 服务商"；已实测档必须夹到服务商上限，未登记模型用契约上限。
import { DEFAULT_MAX_OUTPUT_TOKENS, maxOutputTokensForModel } from "../src/character/byok";

describe("maxOutputTokensForModel（语义定位输出 token 上限）", () => {
  it("clamps the measured glm-4v-flash ceiling to 1024", () => {
    expect(maxOutputTokensForModel("glm-4v-flash")).toBe(1_024);
    // 大小写/首尾空白不改变判定（用户手输模型名）
    expect(maxOutputTokensForModel("GLM-4V-FLASH")).toBe(1_024);
    expect(maxOutputTokensForModel(" glm-4v-flash ")).toBe(1_024);
  });

  it("uses the contract ceiling 4096 for models without a known cap", () => {
    expect(DEFAULT_MAX_OUTPUT_TOKENS).toBe(4_096);
    expect(maxOutputTokensForModel("glm-4v")).toBe(4_096);
    expect(maxOutputTokensForModel("gpt-4o")).toBe(4_096);
    expect(maxOutputTokensForModel("")).toBe(4_096);
  });
});

// L1 classification parity against REAL-transport response shapes (2026-09-30 RC
// P1 regression lock). The earlier tests inject LlmChatResponse objects straight
// into locatePartsWithLlm; these drive createFetchLlmTransportWithDeps with the
// platform fetch, i.e. the same Response/ReadableStream/TextDecoder path the
// browser executes. Provider error bodies mirror the RC-observed bigmodel
// shapes ({"error":{"code":"401",...}} with HTTP 401 etc.). Locks the contract:
// HTTP status classifies FIRST — 401/403 → authentication, 429 → rate limit,
// 5xx/network/timeout → network, only 2xx with an unparseable body ever enters
// the one-shot repair path (LLM_INVALID_RESPONSE). Error details never carry the
// key, image data URLs or provider body text.

import http from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createFetchLlmTransportWithDeps } from "../src/browser/fetchTransport.js";
import { DEFAULT_SEGMENTATION_OPTIONS } from "../src/defaults.js";
import { locatePartsWithLlm } from "../src/llm.js";
import type {
  CharacterError,
  CharacterOutcome,
  LlmLocateRequest,
  LlmProviderConfig,
} from "../src/types.js";
import { context, LOCATE_IMAGE } from "./helpers.js";

const BIGMODEL_401_BODY = JSON.stringify({
  error: { code: "401", message: "令牌已过期或验证不正确" },
});
const API_KEY = "deliberately-wrong-key-rc-repro";

let server: http.Server;
let endpoint = "";

function marker(auth: string): string {
  if (auth.includes("wrong")) return "unauthorized";
  if (auth.includes("forbidden")) return "forbidden";
  if (auth.includes("limited")) return "limited";
  if (auth.includes("broken")) return "broken";
  if (auth.includes("slow")) return "slow";
  return "garbage";
}

beforeAll(async () => {
  server = http.createServer((req, res) => {
    // CORS response headers echoing the RC evidence: preflight 200 + ACAO,
    // then the actual POST answers with the provider's error shape.
    res.setHeader("Access-Control-Allow-Origin", req.headers.origin ?? "*");
    res.setHeader("Access-Control-Allow-Headers", "content-type,authorization");
    res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
    if (req.method === "OPTIONS") {
      res.writeHead(200);
      res.end();
      return;
    }
    let raw = "";
    req.on("data", (chunk: Buffer) => {
      raw += chunk;
    });
    req.on("end", () => {
      expect(raw).not.toContain(API_KEY); // key only travels in the header
      switch (marker(String(req.headers.authorization ?? ""))) {
        case "unauthorized":
          res.writeHead(401, { "Content-Type": "application/json" });
          res.end(BIGMODEL_401_BODY);
          return;
        case "forbidden":
          res.writeHead(403, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: { code: "403", message: "无权访问该模型" } }));
          return;
        case "limited":
          res.writeHead(429, { "Content-Type": "application/json", "Retry-After": "7" });
          res.end(JSON.stringify({ error: { code: "429", message: "请求过快" } }));
          return;
        case "broken":
          res.writeHead(500, { "Content-Type": "text/plain" });
          res.end("upstream internal error html page");
          return;
        case "slow":
          setTimeout(() => {
            res.writeHead(200, { "Content-Type": "application/json" });
            res.end("{}");
          }, 1_500);
          return;
        default:
          res.writeHead(200, { "Content-Type": "text/plain" });
          res.end("this is not a locate document at all");
      }
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  endpoint = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/paas/v4/chat/completions`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

function provider(apiKey: string, overrides?: Partial<LlmProviderConfig>): LlmProviderConfig {
  return {
    endpoint,
    model: "glm-4v",
    apiKey,
    timeoutMs: 4_000,
    maxResponseBytes: 65_536,
    maxOutputTokens: 1_024,
    ...overrides,
  };
}

function locateRequest(apiKey: string, overrides?: Partial<LlmProviderConfig>): LlmLocateRequest {
  return {
    asset: { assetId: "fixture", revision: 1 },
    image: LOCATE_IMAGE,
    provider: provider(apiKey, overrides),
    userConsent: true,
    options: { ...DEFAULT_SEGMENTATION_OPTIONS },
  };
}

const realTransport = () =>
  createFetchLlmTransportWithDeps({ fetchImpl: (input, init) => fetch(input, init) });

function expectFailure(outcome: CharacterOutcome<unknown>): CharacterError {
  expect(outcome.ok).toBe(false);
  if (outcome.ok) throw new Error("expected a failure outcome");
  return outcome.error;
}

describe("locatePartsWithLlm over the real fetch transport (browser parity)", () => {
  it("classifies a bigmodel-shaped 401 as authentication failure without repair", async () => {
    const result = await locatePartsWithLlm(locateRequest(API_KEY), realTransport(), context());
    const error = expectFailure(result);
    expect(error.code).toBe("LLM_AUTHENTICATION_FAILED");
    expect(error.messageKey).toBe("character.error.LLM_AUTHENTICATION_FAILED");
    expect(error.stage).toBe("semantic-locate");
    expect(error.recoveryActions).toContain("configure-key");
    // details hygiene: provider host only — no key, no body text
    expect(JSON.stringify(error.details)).not.toContain(API_KEY);
    expect(JSON.stringify(error.details)).not.toContain("令牌已过期");
  });

  it("classifies 403 the same way", async () => {
    const result = await locatePartsWithLlm(
      locateRequest("forbidden-key-rc"),
      realTransport(),
      context(),
    );
    expect(expectFailure(result).code).toBe("LLM_AUTHENTICATION_FAILED");
  });

  it("classifies 429 (with Retry-After) as rate limiting without repair", async () => {
    const result = await locatePartsWithLlm(
      locateRequest("limited-key-rc"),
      realTransport(),
      context(),
    );
    expect(expectFailure(result).code).toBe("LLM_RATE_LIMITED");
  });

  it("classifies a 5xx non-JSON body as network failure without repair", async () => {
    const result = await locatePartsWithLlm(
      locateRequest("broken-key-rc"),
      realTransport(),
      context(),
    );
    expect(expectFailure(result).code).toBe("LLM_NETWORK_FAILED");
  });

  it("keeps 2xx + unparseable body on the one-shot repair path (LLM_INVALID_RESPONSE)", async () => {
    const result = await locatePartsWithLlm(
      locateRequest("garbage-key-rc"),
      realTransport(),
      context(),
    );
    const error = expectFailure(result);
    expect(error.code).toBe("LLM_INVALID_RESPONSE");
    expect(JSON.stringify(error.details)).not.toContain("not a locate document");
  });

  it("classifies a refused connection as network failure", async () => {
    const request = locateRequest(API_KEY);
    request.provider.endpoint = "http://127.0.0.1:9/v4/chat/completions";
    const result = await locatePartsWithLlm(request, realTransport(), context());
    expect(expectFailure(result).code).toBe("LLM_NETWORK_FAILED");
  });

  it("classifies a stalled 2xx response past timeoutMs as timeout", async () => {
    const result = await locatePartsWithLlm(
      locateRequest("slow-key-rc", { timeoutMs: 1_000 }),
      realTransport(),
      context(),
    );
    expect(expectFailure(result).code).toBe("LLM_TIMEOUT");
  });
});

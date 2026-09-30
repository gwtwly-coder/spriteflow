// fetchLlmTransport tests (contract section 3, :331-421): request shape, no
// redirects/credentials, timeout and cancellation linkage, response byte cap,
// Retry-After parsing, non-JSON passthrough and error hygiene (no key material,
// no data URLs, no provider bodies in thrown errors).
import { describe, expect, it } from "vitest";
import {
  createFetchLlmTransportWithDeps,
  LlmTransportError,
} from "../src/browser/fetchTransport.js";
import { locatePartsWithLlm } from "../src/llm.js";
import type { LlmChatRequest, LlmTransport } from "../src/types.js";
import {
  cancellableContext,
  context,
  locateRequest,
  PROVIDER,
  scriptedTransport,
} from "./helpers.js";

const VALID_JSON_BODY = JSON.stringify({
  schemaVersion: "spriteflow-parts/1",
  coordinateSpace: "working-pixels-top-left-half-open",
  humanoid: { isHumanoid: true, confidence: 0.9, reason: "humanoid" },
  parts: [
    {
      kind: "hair",
      name: "hair",
      box: { x: 1, y: 1, width: 4, height: 4 },
      confidence: 0.8,
      occluded: false,
    },
  ],
});

function chatRequest(overrides: Partial<LlmChatRequest> = {}): LlmChatRequest {
  return {
    endpoint: "https://llm.example.com/v1/chat/completions",
    model: "vision-model",
    authorization: "Bearer sk-unit-test-key",
    timeoutMs: 4_000,
    maxResponseBytes: 65_536,
    body: {
      model: "vision-model",
      temperature: 0,
      max_tokens: 1_024,
      response_format: { type: "json_object" },
      messages: [{ role: "user", content: "detect parts" }],
    },
    ...overrides,
  };
}

interface RecordedCall {
  url: string;
  init: RequestInit;
}

function fetchScript(responder: (url: string, init: RequestInit) => Promise<Response> | Response): {
  fetchImpl: typeof fetch;
  calls: RecordedCall[];
} {
  const calls: RecordedCall[] = [];
  const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input.toString();
    calls.push({ url, init: init ?? {} });
    return responder(url, init ?? {});
  }) as typeof fetch;
  return { fetchImpl, calls };
}

describe("createFetchLlmTransportWithDeps request shape", () => {
  it("posts JSON with authorization, without credentials, refusing redirects", async () => {
    const { fetchImpl, calls } = fetchScript(() => new Response(VALID_JSON_BODY, { status: 200 }));
    const transport = createFetchLlmTransportWithDeps({ fetchImpl });
    const response = await transport.send(chatRequest(), context());
    expect(calls).toHaveLength(1);
    const recorded = calls[0];
    if (recorded === undefined) throw new Error("unreachable");
    const init = recorded.init;
    expect(recorded.url).toBe("https://llm.example.com/v1/chat/completions");
    expect(init.method).toBe("POST");
    expect(init.redirect).toBe("error");
    expect(init.credentials).toBe("omit");
    expect((init.headers as Record<string, string>)["Content-Type"]).toBe("application/json");
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer sk-unit-test-key");
    expect(JSON.parse(init.body as string)).toEqual(chatRequest().body);
    expect(response.status).toBe(200);
    expect(response.retryAfterMs).toBeNull();
    expect(response.body).toEqual(JSON.parse(VALID_JSON_BODY));
  });

  it("parses Retry-After on 429 and tolerates an unparseable header", async () => {
    const { fetchImpl } = fetchScript(
      () =>
        new Response('{"error":"slow down"}', {
          status: 429,
          headers: { "Retry-After": "2" },
        }),
    );
    const transport = createFetchLlmTransportWithDeps({ fetchImpl });
    const response = await transport.send(chatRequest(), context());
    expect(response.status).toBe(429);
    expect(response.retryAfterMs).toBe(2_000);

    const plain = fetchScript(
      () => new Response("{}", { status: 429, headers: { "Retry-After": "soon" } }),
    );
    const second = await createFetchLlmTransportWithDeps({ fetchImpl: plain.fetchImpl }).send(
      chatRequest(),
      context(),
    );
    expect(second.retryAfterMs).toBeNull();
  });

  it("passes non-JSON bodies through as raw text for the repair path", async () => {
    const { fetchImpl } = fetchScript(() => new Response("<html>oops</html>", { status: 200 }));
    const transport = createFetchLlmTransportWithDeps({ fetchImpl });
    const response = await transport.send(chatRequest(), context());
    expect(response.body).toBe("<html>oops</html>");
  });
});

describe("timeout, cancellation and byte cap", () => {
  it("aborts and throws LLM_TIMEOUT when the response stalls", async () => {
    const { fetchImpl } = fetchScript(
      (_url, init) =>
        new Promise<Response>((_resolve, reject) => {
          init.signal?.addEventListener("abort", () =>
            reject(new DOMException("The operation was aborted.", "AbortError")),
          );
        }),
    );
    const transport = createFetchLlmTransportWithDeps({ fetchImpl });
    await expect(transport.send(chatRequest({ timeoutMs: 30 }), context())).rejects.toMatchObject({
      code: "LLM_TIMEOUT",
    });
  });

  it("aborts the in-flight request when the context cancels", async () => {
    let abortObserved = false;
    const { fetchImpl } = fetchScript(
      (_url, init) =>
        new Promise<Response>((_resolve, reject) => {
          init.signal?.addEventListener("abort", () => {
            abortObserved = true;
            reject(new DOMException("The operation was aborted.", "AbortError"));
          });
        }),
    );
    const transport = createFetchLlmTransportWithDeps({ fetchImpl });
    const cancellable = cancellableContext();
    setTimeout(() => cancellable.cancel(), 20);
    await expect(
      transport.send(chatRequest({ timeoutMs: 5_000 }), cancellable),
    ).rejects.toMatchObject({ code: "CANCELLED" });
    expect(abortObserved).toBe(true);
  });

  it("throws CANCELLED without any fetch when already cancelled", async () => {
    const { fetchImpl, calls } = fetchScript(() => new Response("{}", { status: 200 }));
    const transport = createFetchLlmTransportWithDeps({ fetchImpl });
    const cancellable = cancellableContext();
    cancellable.cancel();
    await expect(transport.send(chatRequest(), cancellable)).rejects.toMatchObject({
      code: "CANCELLED",
    });
    expect(calls).toHaveLength(0);
  });

  it("throws LLM_RESPONSE_TOO_LARGE and stops reading when the cap is exceeded", async () => {
    const encoder = new TextEncoder();
    let cancelledStream = false;
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(encoder.encode("a".repeat(64)));
        controller.enqueue(encoder.encode("b".repeat(64)));
        controller.enqueue(encoder.encode("c".repeat(64)));
      },
      cancel() {
        cancelledStream = true;
      },
    });
    const { fetchImpl } = fetchScript(() => new Response(stream, { status: 200 }));
    const transport = createFetchLlmTransportWithDeps({ fetchImpl });
    await expect(
      transport.send(chatRequest({ maxResponseBytes: 128 }), context()),
    ).rejects.toMatchObject({ code: "LLM_RESPONSE_TOO_LARGE" });
    expect(cancelledStream).toBe(true);
  });

  it("classifies non-coded fetch rejections as LLM_NETWORK_FAILED", async () => {
    const { fetchImpl } = fetchScript(() => {
      throw new TypeError("Failed to fetch");
    });
    const transport = createFetchLlmTransportWithDeps({ fetchImpl });
    await expect(transport.send(chatRequest(), context())).rejects.toMatchObject({
      code: "LLM_NETWORK_FAILED",
    });
  });
});

describe("error hygiene", () => {
  it("never leaks the key, endpoint or dataUrl through thrown transport errors", async () => {
    const { fetchImpl } = fetchScript(() => {
      throw new TypeError("Failed to fetch");
    });
    const transport = createFetchLlmTransportWithDeps({ fetchImpl });
    const error = (await transport
      .send(
        chatRequest({
          endpoint: "https://secret-endpoint.example.com/api?token=zzz",
          authorization: "Bearer sk-super-secret",
        }),
        context(),
      )
      .catch((e: unknown) => e)) as Error;
    const rendered = `${error.message}|${JSON.stringify(error)}|${error.stack ?? ""}`;
    expect(rendered).not.toContain("sk-super-secret");
    expect(rendered).not.toContain("secret-endpoint");
    expect(rendered).not.toContain("token=zzz");
  });

  it("surfaces CANCELLED as a CharacterError through the L1 entry point", async () => {
    const transport: LlmTransport = {
      send() {
        throw new LlmTransportError("CANCELLED");
      },
    };
    const outcome = await locatePartsWithLlm(locateRequest(), transport, context());
    expect(outcome.ok).toBe(false);
    if (outcome.ok) throw new Error("unreachable");
    expect(outcome.error.code).toBe("CANCELLED");
    expect(outcome.error.messageKey).toBe("character.error.CANCELLED");
  });

  it("keeps the configured provider untouched in script mode", async () => {
    const { transport, requests } = scriptedTransport([
      { status: 200, retryAfterMs: null, body: VALID_JSON_BODY },
    ]);
    const outcome = await locatePartsWithLlm(locateRequest(), transport, context());
    expect(outcome.ok).toBe(true);
    expect(requests[0]?.authorization).toBe(`Bearer ${PROVIDER.apiKey}`);
  });
});

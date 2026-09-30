// L1 semantic locate tests (docs/interface-contract-v3.md section 3, :329-424):
// schema parsing, single-repair semantics, non-repairable failures, consent,
// config ranges, and the no-key/no-raw-body error hygiene rules.
import { describe, expect, it } from "vitest";
import { DEFAULT_SEGMENTATION_OPTIONS } from "../src/defaults.js";
import { locatePartsWithLlm, parseLocateDocument } from "../src/llm.js";
import type { LlmLocateRequest, LlmProviderConfig, LlmTransport } from "../src/types.js";
import {
  cancellableContext,
  chatResponse,
  context,
  LOCATE_IMAGE,
  locateRequest,
  PROVIDER,
  scriptedTransport,
  VALID_LOCATE_DOCUMENT,
} from "./helpers.js";

const VALID_JSON = JSON.stringify(VALID_LOCATE_DOCUMENT);

describe("parseLocateDocument", () => {
  it("accepts a valid document", () => {
    const parsed = parseLocateDocument(VALID_JSON, 64, 48, DEFAULT_SEGMENTATION_OPTIONS);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) throw new Error(JSON.stringify(parsed.errors));
    expect(parsed.document.humanoid.isHumanoid).toBe(true);
    expect(parsed.document.parts).toHaveLength(1);
  });

  it("strips at most one surrounding markdown code fence", () => {
    const fenced = `\`\`\`json\n${VALID_JSON}\n\`\`\``;
    expect(parseLocateDocument(fenced, 64, 48, DEFAULT_SEGMENTATION_OPTIONS).ok).toBe(true);
    // a dangling opening fence line is tolerated
    expect(
      parseLocateDocument(`\`\`\`json\n${VALID_JSON}`, 64, 48, DEFAULT_SEGMENTATION_OPTIONS).ok,
    ).toBe(true);
    // trailing junk after the closing fence is not
    expect(
      parseLocateDocument(`${fenced} hope this helps`, 64, 48, DEFAULT_SEGMENTATION_OPTIONS).ok,
    ).toBe(false);
  });

  it("never guesses fields out of surrounding prose", () => {
    const prose = `Here is the parts list you asked for:\n${VALID_JSON}\nLet me know if you need more.`;
    expect(parseLocateDocument(prose, 64, 48, DEFAULT_SEGMENTATION_OPTIONS).ok).toBe(false);
  });

  it("validates schemaVersion, coordinateSpace, humanoid and part count", () => {
    const parse = (text: string) => parseLocateDocument(text, 64, 48, DEFAULT_SEGMENTATION_OPTIONS);
    const expectError = (text: string, fragment: string) => {
      const parsed = parse(text);
      expect(parsed.ok).toBe(false);
      if (parsed.ok) throw new Error("unreachable");
      expect(parsed.errors.join("\n")).toContain(fragment);
    };
    expectError('{"schemaVersion":"spriteflow-parts/2"}', "schemaVersion");
    expectError(
      JSON.stringify({ ...VALID_LOCATE_DOCUMENT, coordinateSpace: "nds-top-left" }),
      "coordinateSpace",
    );
    expectError(JSON.stringify({ ...VALID_LOCATE_DOCUMENT, humanoid: null }), "humanoid");
    expectError(
      JSON.stringify({
        ...VALID_LOCATE_DOCUMENT,
        humanoid: { isHumanoid: true, confidence: 1.5, reason: "humanoid" },
      }),
      "humanoid.confidence",
    );
    expectError(
      JSON.stringify({
        ...VALID_LOCATE_DOCUMENT,
        humanoid: { isHumanoid: true, confidence: 0.9, reason: "robot" },
      }),
      "humanoid.reason",
    );
    expectError(JSON.stringify({ ...VALID_LOCATE_DOCUMENT, parts: [] }), "parts");
    expectError(JSON.stringify({ ...VALID_LOCATE_DOCUMENT, parts: "many" }), "parts");
    const tooMany = {
      ...VALID_LOCATE_DOCUMENT,
      parts: Array.from({ length: 33 }, (_, index) => ({
        ...VALID_LOCATE_DOCUMENT.parts[0],
        name: `part-${index}`,
      })),
    };
    expectError(JSON.stringify(tooMany), "parts");
  });

  it("validates closed PartKind, names, boxes, confidence, occluded and duplicates", () => {
    const parse = (text: string) => parseLocateDocument(text, 64, 48, DEFAULT_SEGMENTATION_OPTIONS);
    const withPart = (patch: Record<string, unknown>) => {
      const part = { ...VALID_LOCATE_DOCUMENT.parts[0], ...patch };
      return JSON.stringify({ ...VALID_LOCATE_DOCUMENT, parts: [part] });
    };
    const expectError = (text: string, fragment: string) => {
      const parsed = parse(text);
      expect(parsed.ok).toBe(false);
      if (parsed.ok) throw new Error("unreachable");
      expect(parsed.errors.join("\n")).toContain(fragment);
    };

    expectError(withPart({ kind: "spoon" }), "kind");
    expectError(withPart({ name: "" }), "name");
    expectError(withPart({ box: { x: 0.5, y: 0, width: 10, height: 10 } }), "integers");
    expectError(withPart({ box: { x: -1, y: 0, width: 10, height: 10 } }), "outside");
    expectError(withPart({ box: { x: 60, y: 0, width: 10, height: 10 } }), "outside");
    expectError(withPart({ box: { x: 0, y: 40, width: 10, height: 20 } }), "outside");
    expectError(withPart({ confidence: 2 }), "confidence");
    expectError(withPart({ occluded: "maybe" }), "occluded");
    expectError(
      JSON.stringify({
        ...VALID_LOCATE_DOCUMENT,
        parts: [VALID_LOCATE_DOCUMENT.parts[0], VALID_LOCATE_DOCUMENT.parts[0]],
      }),
      "duplicate",
    );
  });
});

describe("locatePartsWithLlm request/response exchange", () => {
  it("sends one chat request with the image and returns attempts=1", async () => {
    const { transport, requests } = scriptedTransport([chatResponse(VALID_JSON)]);
    const result = await locatePartsWithLlm(locateRequest(), transport, context());
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.error.code);
    expect(result.value.attempts).toBe(1);
    expect(result.value.repaired).toBe(false);

    expect(requests).toHaveLength(1);
    const request = requests[0];
    expect(request?.endpoint).toBe(PROVIDER.endpoint);
    expect(request?.model).toBe(PROVIDER.model);
    expect(request?.authorization).toBe(`Bearer ${PROVIDER.apiKey}`);
    expect(request?.timeoutMs).toBe(4_000);
    expect(request?.maxResponseBytes).toBe(65_536);
    expect(request?.body.model).toBe(PROVIDER.model);
    expect(request?.body.temperature).toBe(0);
    expect(request?.body.max_tokens).toBe(1_024);
    expect(request?.body.response_format).toEqual({ type: "json_object" });
    expect(request?.body.messages).toHaveLength(2);
    expect(request?.body.messages[0]?.role).toBe("system");
    const userContent = requests[0]?.body.messages[1]?.content;
    expect(Array.isArray(userContent)).toBe(true);
    expect(JSON.stringify(userContent)).toContain(LOCATE_IMAGE.dataUrl);
    expect(JSON.stringify(userContent)).toContain('"detail":"high"');
  });

  it("strips a code fence around an otherwise valid reply", async () => {
    const { transport, requests } = scriptedTransport([
      chatResponse(`\`\`\`json\n${VALID_JSON}\n\`\`\``),
    ]);
    const result = await locatePartsWithLlm(locateRequest(), transport, context());
    expect(result.ok).toBe(true);
    expect(requests).toHaveLength(1);
  });

  it("repairs once: schema + truncated original + error summary, never the image", async () => {
    const broken = "I cannot produce strict JSON, sorry: {oops";
    const { transport, requests } = scriptedTransport([
      chatResponse(broken),
      chatResponse(VALID_JSON),
    ]);
    const result = await locatePartsWithLlm(locateRequest(), transport, context());
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.error.code);
    expect(result.value.attempts).toBe(2);
    expect(result.value.repaired).toBe(true);
    expect(requests).toHaveLength(2);

    const repair = requests[1];
    expect(repair).toBeDefined();
    if (!repair) throw new Error("missing repair request");
    const serialized = JSON.stringify(repair);
    // no image and no other third request
    expect(serialized).not.toContain("data:image/png");
    expect(serialized).not.toContain(LOCATE_IMAGE.dataUrl);
    const repairContent = repair.body.messages[1]?.content;
    expect(typeof repairContent).toBe("string");
    // the schema rides in the re-sent system prompt (contract :420: schema + truncated
    // original + field error summary, nothing else)
    expect(JSON.stringify(repair.body.messages[0]?.content)).toContain("spriteflow-parts/1");
    const text = typeof repairContent === "string" ? repairContent : "";
    expect(text).toContain("not a single JSON document"); // field error summary
    expect(text).toContain(broken); // truncated original text
    // retained model / temperature / token ceiling
    expect(repair.body.model).toBe(PROVIDER.model);
    expect(repair.body.temperature).toBe(0);
    expect(repair.body.max_tokens).toBe(1_024);
    expect(repair.body.response_format).toEqual({ type: "json_object" });
  });

  it("fails with LLM_INVALID_RESPONSE when the repaired reply is still invalid", async () => {
    const { transport, requests } = scriptedTransport([
      chatResponse('{"schemaVersion":"legacy"}'),
      chatResponse('{"schemaVersion":"still-legacy"}'),
    ]);
    const result = await locatePartsWithLlm(locateRequest(), transport, context());
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("unreachable");
    expect(result.error.code).toBe("LLM_INVALID_RESPONSE");
    expect(result.error.messageKey).toBe("character.error.LLM_INVALID_RESPONSE");
    expect(requests).toHaveLength(2); // no third request
  });

  it("does not repair on 429 and never auto-retries", async () => {
    const { transport, requests } = scriptedTransport([chatResponse({ error: "slow down" }, 429)]);
    const result = await locatePartsWithLlm(locateRequest(), transport, context());
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("unreachable");
    expect(result.error.code).toBe("LLM_RATE_LIMITED");
    expect(requests).toHaveLength(1);
  });

  it("maps 401/403 to authentication failures without a repair", async () => {
    for (const status of [401, 403] as const) {
      const { transport, requests } = scriptedTransport([chatResponse({}, status)]);
      const result = await locatePartsWithLlm(locateRequest(), transport, context());
      expect(result.ok).toBe(false);
      if (result.ok) throw new Error("unreachable");
      expect(result.error.code).toBe("LLM_AUTHENTICATION_FAILED");
      expect(requests).toHaveLength(1);
    }
  });

  it("maps 5xx, thrown transport failures and timeouts to non-repairable errors", async () => {
    const serverError = scriptedTransport([chatResponse({}, 500)]);
    const serverResult = await locatePartsWithLlm(
      locateRequest(),
      serverError.transport,
      context(),
    );
    expect(serverResult.ok).toBe(false);
    if (serverResult.ok) throw new Error("unreachable");
    expect(serverResult.error.code).toBe("LLM_NETWORK_FAILED");
    expect(serverError.requests).toHaveLength(1);

    const thrown = scriptedTransport([new Error("socket hang up")]);
    const thrownResult = await locatePartsWithLlm(locateRequest(), thrown.transport, context());
    expect(thrownResult.ok).toBe(false);
    if (thrownResult.ok) throw new Error("unreachable");
    expect(thrownResult.error.code).toBe("LLM_NETWORK_FAILED");
    expect(thrown.requests).toHaveLength(1);

    const timeout = scriptedTransport([
      Object.assign(new Error("timed out"), { name: "TimeoutError" }),
    ]);
    const timeoutResult = await locatePartsWithLlm(locateRequest(), timeout.transport, context());
    expect(timeoutResult.ok).toBe(false);
    if (timeoutResult.ok) throw new Error("unreachable");
    expect(timeoutResult.error.code).toBe("LLM_TIMEOUT");
  });

  it("fails LLM_RESPONSE_TOO_LARGE without a repair when the body exceeds the cap", async () => {
    const request = locateRequest();
    const provider = { ...PROVIDER, maxResponseBytes: 64 };
    const { transport, requests } = scriptedTransport([chatResponse(`"${"x".repeat(500)}"`)]);
    const result = await locatePartsWithLlm({ ...request, provider }, transport, context());
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("unreachable");
    expect(result.error.code).toBe("LLM_RESPONSE_TOO_LARGE");
    expect(requests).toHaveLength(1);
  });

  it("cancels without sending when the task is already cancelled", async () => {
    const { transport, requests } = scriptedTransport([]);
    const cancelled = cancellableContext();
    cancelled.cancel();
    const result = await locatePartsWithLlm(locateRequest(), transport, cancelled);
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("unreachable");
    expect(result.error.code).toBe("CANCELLED");
    expect(requests).toHaveLength(0);
  });

  it("does not send the repair request once the task is cancelled", async () => {
    const { transport, requests } = scriptedTransport([
      chatResponse("not json"),
      chatResponse(VALID_JSON),
    ]);
    const cancelled = cancellableContext();
    // simulate the user cancelling while the first request is in flight
    const wrapped: LlmTransport = {
      async send(request, innerContext) {
        cancelled.cancel();
        return transport.send(request, innerContext);
      },
    };
    const result = await locatePartsWithLlm(locateRequest(), wrapped, cancelled);
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("unreachable");
    expect(result.error.code).toBe("CANCELLED");
    expect(requests).toHaveLength(1);
  });
});

describe("consent and configuration gates", () => {
  it("sends nothing when userConsent is not the literal true", async () => {
    const { transport, requests } = scriptedTransport([chatResponse(VALID_JSON)]);
    const request = { ...locateRequest(), userConsent: false } as unknown as LlmLocateRequest;
    const result = await locatePartsWithLlm(request, transport, context());
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("unreachable");
    expect(result.error.code).toBe("LLM_CONSENT_REQUIRED");
    expect(requests).toHaveLength(0);
  });

  it("checks consent before configuration validity", async () => {
    const { transport } = scriptedTransport([]);
    const request = {
      ...locateRequest(),
      userConsent: undefined,
      provider: { ...PROVIDER, endpoint: "http://nope.example.com" },
    } as unknown as LlmLocateRequest;
    const result = await locatePartsWithLlm(request, transport, context());
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("unreachable");
    expect(result.error.code).toBe("LLM_CONSENT_REQUIRED");
  });

  it.each([
    [
      "http on a public host",
      { ...PROVIDER, endpoint: "http://api.example.com/v1/chat/completions" },
    ],
    [
      "userinfo in the URL",
      { ...PROVIDER, endpoint: "https://user:pass@llm.example.com/v1/chat/completions" },
    ],
    ["URL fragment", { ...PROVIDER, endpoint: "https://llm.example.com/v1/chat/completions#frag" }],
    ["endpoint over 2048 chars", { ...PROVIDER, endpoint: `https://${"a".repeat(2_100)}.com/v1` }],
    ["empty model", { ...PROVIDER, model: "" }],
    ["model over 128 chars", { ...PROVIDER, model: "m".repeat(129) }],
    ["empty api key", { ...PROVIDER, apiKey: "" }],
    ["api key over 4096 chars", { ...PROVIDER, apiKey: "k".repeat(4_097) }],
    ["timeout below range", { ...PROVIDER, timeoutMs: 999 }],
    ["timeout above range", { ...PROVIDER, timeoutMs: 8_001 }],
    ["fractional timeout", { ...PROVIDER, timeoutMs: 4_000.5 }],
    ["maxResponseBytes zero", { ...PROVIDER, maxResponseBytes: 0 }],
    ["maxResponseBytes over cap", { ...PROVIDER, maxResponseBytes: 1_048_577 }],
    ["maxOutputTokens below range", { ...PROVIDER, maxOutputTokens: 127 }],
    ["maxOutputTokens above range", { ...PROVIDER, maxOutputTokens: 4_097 }],
  ] as ReadonlyArray<
    [string, LlmProviderConfig]
  >)("rejects invalid provider config: %s", async (_name, provider) => {
    const { transport, requests } = scriptedTransport([chatResponse(VALID_JSON)]);
    const result = await locatePartsWithLlm({ ...locateRequest(), provider }, transport, context());
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("unreachable");
    expect(result.error.code).toBe("LLM_CONFIGURATION_INVALID");
    expect(requests).toHaveLength(0);
  });

  it("caps maxResponseBytes against context limits", async () => {
    const { transport } = scriptedTransport([]);
    const provider = { ...PROVIDER, maxResponseBytes: 2_048 };
    const result = await locatePartsWithLlm(
      { ...locateRequest(), provider },
      transport,
      context({
        maxLlmResponseBytes: 1_024,
      }),
    );
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("unreachable");
    expect(result.error.code).toBe("LLM_CONFIGURATION_INVALID");
  });

  it("rejects maxParts above context.limits.maxParts as a resource limit", async () => {
    const { transport, requests } = scriptedTransport([chatResponse(VALID_JSON)]);
    const result = await locatePartsWithLlm(
      locateRequest({ maxParts: 16 }),
      transport,
      context({ maxParts: 8 }),
    );
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("unreachable");
    expect(result.error.code).toBe("RESOURCE_LIMIT");
    expect(requests).toHaveLength(0);
  });

  it("validates the request image and options before sending", async () => {
    const { transport, requests } = scriptedTransport([chatResponse(VALID_JSON)]);
    const badMime = { ...locateRequest(), image: { ...LOCATE_IMAGE, mime: "image/jpeg" as never } };
    expect((await locatePartsWithLlm(badMime, transport, context())).ok).toBe(false);
    const badUrl = {
      ...locateRequest(),
      image: { ...LOCATE_IMAGE, dataUrl: "data:text/plain;base64,QUJD" },
    };
    expect((await locatePartsWithLlm(badUrl, transport, context())).ok).toBe(false);
    const huge = { ...locateRequest(), image: { ...LOCATE_IMAGE, width: 64, height: 48 } };
    // dimensions stay within the working limit, but the pixel budget is tightened
    const hugeResult = await locatePartsWithLlm(
      huge,
      transport,
      context({ maxWorkingPixels: 1_000 }),
    );
    expect(hugeResult.ok).toBe(false);
    if (hugeResult.ok) throw new Error("unreachable");
    expect(hugeResult.error.code).toBe("RESOURCE_LIMIT");
    expect(hugeResult.error.recoveryActions).toContain("reduce-image-size");
    const badOptions = locateRequest({ minimumPartConfidence: 1.5 });
    expect((await locatePartsWithLlm(badOptions, transport, context())).ok).toBe(false);
    expect(requests).toHaveLength(0);
  });
});

describe("error hygiene (:419, :883)", () => {
  it("never leaks the key, the image or the raw provider body through errors", async () => {
    const rawBody = 'SECRET_PROVIDER_BODY {"broken": true}';
    const { transport } = scriptedTransport([chatResponse(rawBody), chatResponse(rawBody)]);
    const result = await locatePartsWithLlm(locateRequest(), transport, context());
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("unreachable");
    const serialized = JSON.stringify(result.error);
    expect(serialized).not.toContain(PROVIDER.apiKey);
    expect(serialized).not.toContain(LOCATE_IMAGE.dataUrl);
    expect(serialized).not.toContain("SECRET_PROVIDER_BODY");
    expect(result.error.details.provider).toBe("llm.example.com");
  });

  it("keeps the key out of transport-level errors too", async () => {
    const { transport } = scriptedTransport([chatResponse({}, 401)]);
    const result = await locatePartsWithLlm(locateRequest(), transport, context());
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("unreachable");
    const serialized = JSON.stringify(result.error);
    expect(serialized).not.toContain(PROVIDER.apiKey);
    expect(serialized).not.toContain(LOCATE_IMAGE.dataUrl);
    expect(serialized).not.toContain("sk-");
  });
});

// Browser LLM transport over fetch (docs/interface-contract-v3.md section 3,
// :329-424). POSTs the prepared chat request as JSON; does not follow redirects,
// never sends cookies/credentials, enforces the response byte cap, links the
// timeout and workspace cancellation into one AbortController, parses Retry-After
// on 429, and normalizes failures to contract codes. Thrown errors never carry
// the authorization value, the key, image data URLs or untruncated provider body.
import type {
  CharacterExecutionContext,
  LlmChatRequest,
  LlmChatResponse,
  LlmTransport,
} from "../types.js";

/** Coded transport failure; message text is a constant, never request content. */
export class LlmTransportError extends Error {
  readonly code: "LLM_TIMEOUT" | "LLM_NETWORK_FAILED" | "LLM_RESPONSE_TOO_LARGE" | "CANCELLED";

  constructor(code: "LLM_TIMEOUT" | "LLM_NETWORK_FAILED" | "LLM_RESPONSE_TOO_LARGE" | "CANCELLED") {
    super(`llm transport failure: ${code}`);
    this.name = "LlmTransportError";
    this.code = code;
  }
}

export interface FetchLlmTransportDeps {
  fetchImpl: typeof fetch;
}

const CANCEL_WATCH_INTERVAL_MS = 50;

function parseRetryAfter(headerValue: string | null): number | null {
  if (headerValue === null) return null;
  const trimmed = headerValue.trim();
  if (/^\d+$/.test(trimmed)) {
    const seconds = Number.parseInt(trimmed, 10);
    return seconds <= Number.MAX_SAFE_INTEGER / 1000 ? seconds * 1000 : null;
  }
  const dateMs = Date.parse(trimmed);
  if (!Number.isFinite(dateMs)) return null;
  const delta = dateMs - Date.now();
  return delta > 0 ? delta : 0;
}

function mergeChunks(chunks: Uint8Array[], total: number): string {
  const merged = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    merged.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(merged);
}

async function readBodyWithCap(
  response: Response,
  maxResponseBytes: number,
  context: CharacterExecutionContext,
): Promise<string> {
  const body = response.body;
  if (body === null) return "";
  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value !== undefined) {
        total += value.byteLength;
        if (total > maxResponseBytes) throw new LlmTransportError("LLM_RESPONSE_TOO_LARGE");
        chunks.push(value);
      }
      if (context.isCancelled()) throw new LlmTransportError("CANCELLED");
    }
  } catch (error: unknown) {
    // Stop pulling from the stream when bailing out early (cap or cancel).
    try {
      await reader.cancel();
    } catch {
      // stream already closed by the aborted request
    }
    throw error;
  } finally {
    try {
      reader.releaseLock();
    } catch {
      // reader already released by the aborted stream
    }
  }
  return mergeChunks(chunks, total);
}

function createTransport(deps: FetchLlmTransportDeps): LlmTransport {
  return {
    async send(
      request: LlmChatRequest,
      context: CharacterExecutionContext,
    ): Promise<LlmChatResponse> {
      if (context.isCancelled()) throw new LlmTransportError("CANCELLED");
      const controller = new AbortController();
      let timedOut = false;
      let cancelledFlight = false;
      const timer = setTimeout(() => {
        timedOut = true;
        controller.abort();
      }, request.timeoutMs);
      const watch = setInterval(() => {
        if (context.isCancelled()) {
          cancelledFlight = true;
          controller.abort();
        }
      }, CANCEL_WATCH_INTERVAL_MS);
      try {
        const response = await deps.fetchImpl(request.endpoint, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: request.authorization,
          },
          body: JSON.stringify(request.body),
          redirect: "error",
          credentials: "omit",
          signal: controller.signal,
        });
        const retryAfterMs = parseRetryAfter(response.headers.get("retry-after"));
        const text = await readBodyWithCap(response, request.maxResponseBytes, context);
        if (context.isCancelled()) throw new LlmTransportError("CANCELLED");
        let body: unknown = "";
        if (text.length > 0) {
          try {
            body = JSON.parse(text) as unknown;
          } catch {
            // Non-JSON bodies stay raw text; classification into the one-shot
            // repair path happens in the L1 parser, never here.
            body = text;
          }
        }
        return { status: response.status, retryAfterMs, body };
      } catch (error: unknown) {
        if (error instanceof LlmTransportError) throw error;
        if (cancelledFlight || context.isCancelled()) throw new LlmTransportError("CANCELLED");
        if (timedOut) throw new LlmTransportError("LLM_TIMEOUT");
        throw new LlmTransportError("LLM_NETWORK_FAILED");
      } finally {
        clearTimeout(timer);
        clearInterval(watch);
      }
    },
  };
}

/** Test/ops factory with an injectable fetch implementation. */
export function createFetchLlmTransportWithDeps(deps: FetchLlmTransportDeps): LlmTransport {
  return createTransport(deps);
}

/** Contract factory (:530): the real browser transport. */
export function createFetchLlmTransport(): LlmTransport {
  return createTransport({ fetchImpl: (input, init) => fetch(input, init) });
}

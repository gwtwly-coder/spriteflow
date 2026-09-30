// LLM 失败四分类（AC-V02-C：key 无效 / 网络 / 额度 / 无法解析）。
// 权威来源是 segment exchange 自身的错误码——transport 里 HTTP status 优先分类
// （401/403→认证、429→额度、5xx/网络/超时→网络、仅 2xx 且 body 非法→无法解析）
// 的产物随 LLM_FALLBACK_TO_CLICK.llmErrorCode 透传；HTTP status 旁路记录
// （worker 的 lastLlmStatus）只在降级路径缺少错误码时兜底。
// 2026-09-30 RC P1 根因：旧实现把旁路 status 的 catch-all（bad_response）放在
// 错误码之前，任何 status 记录缺口都会把认证失败渲染成"无法解析的结果"。
import type { CharacterError, CharacterErrorCode } from "@spriteflow/segment";
import type { LlmFailureReason } from "./character-protocol";

/**
 * LLM 错误码 → 失败卡四分类；非 LLM 失败（模型/校验/取消等）返回 null，
 * 调用方不得把这类失败渲染成 LLM 失败卡。
 */
export function llmFailureFromLlmCode(code: CharacterErrorCode): LlmFailureReason | null {
  switch (code) {
    case "LLM_AUTHENTICATION_FAILED":
    // key/配置形状类错误（endpoint/model/key 非法）与"key 无效"共用修复动作
    // （打开 BYOK 设置），归入 key 无效类比"无法解析"诚实。
    case "LLM_CONFIGURATION_INVALID":
    case "LLM_CONSENT_REQUIRED":
      return "unauthorized";
    case "LLM_RATE_LIMITED":
      return "rate_limited";
    case "LLM_NETWORK_FAILED":
    case "LLM_TIMEOUT":
      return "network";
    case "LLM_INVALID_RESPONSE":
    case "LLM_RESPONSE_TOO_LARGE":
      return "bad_response";
    default:
      return null;
  }
}

/** CharacterError → 四分类；仅语义定位阶段的错误参与分类，其余返回 null。 */
export function llmFailureFromError(error: CharacterError): LlmFailureReason | null {
  if (error.stage !== "semantic-locate") return null;
  return llmFailureFromLlmCode(error.code);
}

/**
 * 兜底：transport 旁路记录的失败形态 → 四分类。仅当降级结果没有携带
 * llmErrorCode 时使用（例如页面仍引用旧版 segment dist）。
 */
export function llmFailureFromStatus(status: number, threw: boolean): LlmFailureReason {
  if (threw) return "network";
  if (status === 401 || status === 403) return "unauthorized";
  if (status === 429) return "rate_limited";
  if (status >= 500) return "network";
  // exchange 只允许 2xx 进入解析路径，因此到这里仍失败的只剩
  // "回复无法解析/超大"一类；status 0（exchange 未完成）同理。
  return "bad_response";
}

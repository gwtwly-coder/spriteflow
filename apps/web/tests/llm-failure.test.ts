// LLM 失败四分类映射测试（AC-V02-C；2026-09-30 RC P1 回归锁）：
// 错误码权威 —— 认证/配置类失败必须落在"key 无效"类，绝不落入
// "无法解析"类；非 LLM 失败（模型/校验）返回 null，不得渲染 LLM 失败卡；
// status 旁路仅作降级兜底，401/403/429/5xx 与 2xx 的归类须与 transport 一致。

import { type CharacterError, CharacterErrorCode, CharacterStage } from "@spriteflow/segment";
import { describe, expect, it } from "vitest";
import {
  llmFailureFromError,
  llmFailureFromLlmCode,
  llmFailureFromStatus,
} from "../src/character/llm-failure";

function error(
  code: CharacterErrorCode,
  stage: CharacterStage = CharacterStage.SemanticLocate,
): CharacterError {
  return {
    code,
    messageKey: `character.error.${code}`,
    stage,
    recoverable: true,
    recoveryActions: [],
    details: {},
  };
}

describe("llmFailureFromLlmCode（错误码 → 四分类）", () => {
  it("认证失败归 key 无效类（RC P1：曾被渲染成无法解析）", () => {
    expect(llmFailureFromLlmCode(CharacterErrorCode.LlmAuthenticationFailed)).toBe("unauthorized");
  });

  it("配置/同意类归 key 无效类而非无法解析类", () => {
    expect(llmFailureFromLlmCode(CharacterErrorCode.LlmConfigurationInvalid)).toBe("unauthorized");
    expect(llmFailureFromLlmCode(CharacterErrorCode.LlmConsentRequired)).toBe("unauthorized");
  });

  it("网络/超时归网络类，额度归限流类", () => {
    expect(llmFailureFromLlmCode(CharacterErrorCode.LlmNetworkFailed)).toBe("network");
    expect(llmFailureFromLlmCode(CharacterErrorCode.LlmTimeout)).toBe("network");
    expect(llmFailureFromLlmCode(CharacterErrorCode.LlmRateLimited)).toBe("rate_limited");
  });

  it("仅解析失败与超大响应归无法解析类", () => {
    expect(llmFailureFromLlmCode(CharacterErrorCode.LlmInvalidResponse)).toBe("bad_response");
    expect(llmFailureFromLlmCode(CharacterErrorCode.LlmResponseTooLarge)).toBe("bad_response");
  });

  it("非 LLM 失败（模型/状态/校验）返回 null", () => {
    expect(llmFailureFromLlmCode(CharacterErrorCode.ModelInitializationFailed)).toBeNull();
    expect(llmFailureFromLlmCode(CharacterErrorCode.InvalidState)).toBeNull();
    expect(llmFailureFromLlmCode(CharacterErrorCode.InvalidArgument)).toBeNull();
    expect(llmFailureFromLlmCode(CharacterErrorCode.Cancelled)).toBeNull();
    expect(llmFailureFromLlmCode(CharacterErrorCode.InternalError)).toBeNull();
  });
});

describe("llmFailureFromError（stage 门卫）", () => {
  it("语义定位阶段的错误参与分类", () => {
    expect(llmFailureFromError(error(CharacterErrorCode.LlmAuthenticationFailed))).toBe(
      "unauthorized",
    );
  });

  it("其他阶段（模型下载/初始化）的同名错误不判为 LLM 失败", () => {
    expect(
      llmFailureFromError(
        error(CharacterErrorCode.ModelInitializationFailed, CharacterStage.ModelInitialize),
      ),
    ).toBeNull();
    expect(
      llmFailureFromError(error(CharacterErrorCode.Cancelled, CharacterStage.SemanticLocate)),
    ).toBeNull();
  });
});

describe("llmFailureFromStatus（降级路径兜底，与 transport 分类一致）", () => {
  it("抛错→网络；401/403→key 无效；429→限流；5xx→网络", () => {
    expect(llmFailureFromStatus(0, true)).toBe("network");
    expect(llmFailureFromStatus(401, false)).toBe("unauthorized");
    expect(llmFailureFromStatus(403, false)).toBe("unauthorized");
    expect(llmFailureFromStatus(429, false)).toBe("rate_limited");
    expect(llmFailureFromStatus(500, false)).toBe("network");
    expect(llmFailureFromStatus(503, false)).toBe("network");
  });

  it("仅 2xx/未知状态（exchange 唯一可能的剩余失败）落无法解析类", () => {
    expect(llmFailureFromStatus(200, false)).toBe("bad_response");
    expect(llmFailureFromStatus(0, false)).toBe("bad_response");
  });
});

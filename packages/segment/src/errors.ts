// CharacterError factory. messageKey always follows "character.error.<CODE>"
// (docs/interface-contract-v3.md section 10) and details never carry key material,
// image data, or untruncated provider output.
import type {
  CharacterError,
  CharacterErrorCode,
  CharacterOutcome,
  CharacterRecoveryAction,
  CharacterStage,
} from "./types.js";

export type CharacterErrorOptions = {
  recoverable?: boolean;
  recoveryActions?: CharacterRecoveryAction[];
  details?: CharacterError["details"];
};

export function characterError(
  code: CharacterErrorCode,
  stage: CharacterStage,
  options: CharacterErrorOptions = {},
): CharacterError {
  return {
    code,
    messageKey: `character.error.${code}`,
    stage,
    recoverable: options.recoverable ?? true,
    recoveryActions: options.recoveryActions ?? [],
    details: options.details ?? {},
  };
}

export function failure<T>(error: CharacterError): CharacterOutcome<T> {
  return { ok: false, error };
}

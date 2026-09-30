// BYOK 配置（契约 §3 :333）：endpoint/model 可持久化到 localStorage；
// key 仅在用户显式勾选"本 tab 记住"后进 sessionStorage（关闭 tab 即清），
// 否则只存内存；退出工作区/清除时立即清掉。key 只向前转发进 Worker。
import type { ByokConfig } from "./parts-store";

const CONFIG_STORAGE_KEY = "spriteflow.byok.config";
const KEY_STORAGE_KEY = "spriteflow.byok.key";
export const GLM_ENDPOINT = "https://open.bigmodel.cn/api/paas/v4/chat/completions";
const OPENAI_ENDPOINT = "https://api.openai.com/v1/chat/completions";

const PRESET_ENDPOINTS: Record<Exclude<ByokConfig["provider"], "custom">, string> = {
  glm_4v: GLM_ENDPOINT,
  cogvlm: GLM_ENDPOINT,
  openai_gpt: OPENAI_ENDPOINT,
};

let memoryKey: string | null = null;

export function presetEndpoint(provider: ByokConfig["provider"]): string {
  return provider === "custom" ? "" : PRESET_ENDPOINTS[provider];
}

/** 契约 :421：endpoint 必须是完整 HTTPS /chat/completions URL（开发 localhost 例外）。 */
export function isValidEndpoint(url: string): boolean {
  if (url.length === 0 || url.length > 2048) return false;
  try {
    const parsed = new URL(url);
    const isLocal = parsed.hostname === "localhost" || parsed.hostname === "127.0.0.1";
    if (parsed.protocol !== "https:" && !(isLocal && parsed.protocol === "http:")) return false;
    if (parsed.username || parsed.password || parsed.hash) return false;
    return parsed.pathname.endsWith("/chat/completions");
  } catch {
    return false;
  }
}

export interface StoredByokState {
  config: ByokConfig | null;
  key: string | null;
  remember: boolean;
}

export function loadByokState(): StoredByokState {
  let config: ByokConfig | null = null;
  try {
    const raw = window.localStorage.getItem(CONFIG_STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<ByokConfig>;
      if (
        typeof parsed === "object" &&
        parsed !== null &&
        typeof parsed.provider === "string" &&
        typeof parsed.endpoint === "string" &&
        typeof parsed.model === "string"
      ) {
        config = {
          provider: parsed.provider as ByokConfig["provider"],
          endpoint: parsed.endpoint,
          model: parsed.model,
        };
      }
    }
  } catch {
    config = null;
  }
  let key: string | null = null;
  let remember = false;
  try {
    key = window.sessionStorage.getItem(KEY_STORAGE_KEY);
    remember = key !== null;
  } catch {
    key = null;
  }
  if (key === null) key = memoryKey;
  return { config, key, remember };
}

export function saveByok(config: ByokConfig, key: string, remember: boolean): void {
  window.localStorage.setItem(
    CONFIG_STORAGE_KEY,
    JSON.stringify({ provider: config.provider, endpoint: config.endpoint, model: config.model }),
  );
  clearKey();
  if (remember) {
    try {
      window.sessionStorage.setItem(KEY_STORAGE_KEY, key);
    } catch {
      memoryKey = key;
    }
  } else {
    memoryKey = key;
  }
}

export function clearKey(): void {
  memoryKey = null;
  try {
    window.sessionStorage.removeItem(KEY_STORAGE_KEY);
  } catch {
    /* storage unavailable — memory clear above is enough */
  }
}

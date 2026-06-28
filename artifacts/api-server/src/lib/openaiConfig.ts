export type OpenAIProvider = "openai" | "replit";

export type ReasoningEffort = "none" | "low" | "medium" | "high" | "xhigh";

export type ResolvedOpenAIConfig = {
  apiKey: string;
  baseURL: string;
  model: string;
  provider: OpenAIProvider;
  /** When set, passed to chat.completions.create as reasoning_effort. */
  reasoningEffort?: ReasoningEffort;
};

const DEFAULT_OPENAI_BASE_URL = "https://api.openai.com/v1";
const DEFAULT_DIRECT_MODEL = "gpt-4.1";
const DEFAULT_REPLIT_MODEL = "gpt-5.4";

const REASONING_EFFORTS = new Set<ReasoningEffort>([
  "none",
  "low",
  "medium",
  "high",
  "xhigh",
]);

function trimEnv(name: string): string | undefined {
  const value = process.env[name]?.trim();
  return value || undefined;
}

function isReplitHost(): boolean {
  return !!(
    process.env.REPL_ID ||
    process.env.REPLIT_DEPLOYMENT ||
    process.env.REPLIT_CLUSTER_URL ||
    process.env.REPLIT_DEV_DOMAIN
  );
}

export function parseReasoningEffort(
  raw: string | undefined,
): ReasoningEffort | undefined {
  if (!raw) return undefined;
  const normalized = raw.trim().toLowerCase() as ReasoningEffort;
  return REASONING_EFFORTS.has(normalized) ? normalized : undefined;
}

/**
 * Resolve OpenAI credentials for the AI Coach chat route.
 *
 * Priority:
 * 1. OPENAI_API_KEY (+ optional OPENAI_BASE_URL) — Render, local, any direct OpenAI deployment.
 * 2. AI_INTEGRATIONS_OPENAI_* — Replit AI Integrations proxy (only works on Replit infra).
 *
 * On non-Replit hosts (e.g. Render sets RENDER=true), Replit integration URLs are
 * ignored when OPENAI_API_KEY is absent so we fail fast with a clear 502 instead of
 * streaming "AI service is temporarily unavailable" on every upstream 401.
 */
export function resolveOpenAIConfig():
  | ResolvedOpenAIConfig
  | { error: string } {
  const openaiKey = trimEnv("OPENAI_API_KEY");
  const openaiBase = trimEnv("OPENAI_BASE_URL");
  const replitKey = trimEnv("AI_INTEGRATIONS_OPENAI_API_KEY");
  const replitBase = trimEnv("AI_INTEGRATIONS_OPENAI_BASE_URL");
  const modelOverride = trimEnv("OPENAI_CHAT_MODEL");
  const reasoningOverride = parseReasoningEffort(
    trimEnv("OPENAI_REASONING_EFFORT"),
  );

  if (openaiKey) {
    return {
      apiKey: openaiKey,
      baseURL: openaiBase ?? DEFAULT_OPENAI_BASE_URL,
      model: modelOverride ?? DEFAULT_DIRECT_MODEL,
      provider: "openai",
      reasoningEffort: reasoningOverride,
    };
  }

  if (replitKey && replitBase) {
    if (!isReplitHost()) {
      return {
        error:
          "Replit AI Integrations credentials only work on Replit infrastructure. Set OPENAI_API_KEY (and optionally OPENAI_BASE_URL, OPENAI_CHAT_MODEL) in the Render dashboard.",
      };
    }

    return {
      apiKey: replitKey,
      baseURL: replitBase,
      model: modelOverride ?? DEFAULT_REPLIT_MODEL,
      provider: "replit",
      reasoningEffort: reasoningOverride ?? "low",
    };
  }

  return {
    error:
      "AI integration not configured. Set OPENAI_API_KEY for Render/direct OpenAI, or AI_INTEGRATIONS_OPENAI_API_KEY + AI_INTEGRATIONS_OPENAI_BASE_URL on Replit.",
  };
}

export function isOpenAIConfigured(): boolean {
  return !("error" in resolveOpenAIConfig());
}

export function openAIProviderLabel(): OpenAIProvider | null {
  const config = resolveOpenAIConfig();
  return "error" in config ? null : config.provider;
}

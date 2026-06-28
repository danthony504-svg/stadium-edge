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

export type OpenAIProbeResult =
  | { ok: true; model: string; provider: OpenAIProvider }
  | {
      ok: false;
      model: string;
      provider: OpenAIProvider;
      code?: string;
      message: string;
    };

const DEFAULT_OPENAI_BASE_URL = "https://api.openai.com/v1";
/** 1M context — the Coach system prompt alone is ~170k chars. */
const DEFAULT_DIRECT_MODEL = "gpt-4.1";
const DEFAULT_REPLIT_MODEL = "gpt-5.4";

/** Serialized size of the Coach system prompt in chat.ts (keep in sync manually). */
export const COACH_SYSTEM_PROMPT_CHARS = 169_215;

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

/** gpt-5.x only exists on Replit's proxy — remap if copied into Render env. */
function sanitizeDirectModel(model: string): string {
  if (/^gpt-5/i.test(model)) return DEFAULT_DIRECT_MODEL;
  return model;
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
    const model = sanitizeDirectModel(modelOverride ?? DEFAULT_DIRECT_MODEL);
    return {
      apiKey: openaiKey,
      baseURL: openaiBase ?? DEFAULT_OPENAI_BASE_URL,
      model,
      provider: "openai",
      // reasoning_effort is only valid on Replit's gpt-5.x proxy — never pass it
      // to direct OpenAI models (gpt-4o / gpt-4.1 400 on every chat).
      reasoningEffort: undefined,
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

/** Token cap passed to chat.completions.create — mirrors chat.ts. */
export function chatTokenLimit(
  config: ResolvedOpenAIConfig,
): { max_tokens: number } | { max_completion_tokens: number } {
  return config.provider === "openai"
    ? { max_tokens: 4096 }
    : { max_completion_tokens: 16384 };
}

/** Direct OpenAI models reject reasoning_effort; only Replit gpt-5.x supports it. */
export function chatReasoningEffort(
  config: ResolvedOpenAIConfig,
): ReasoningEffort | undefined {
  return config.provider === "replit" ? config.reasoningEffort : undefined;
}

export function chatUsesStreaming(config: ResolvedOpenAIConfig): boolean {
  return config.provider !== "openai";
}

function formatUpstreamError(e: unknown): { code?: string; message: string } {
  const err = e as { status?: number; code?: string; message?: string };
  return {
    code: err.code ?? (err.status ? String(err.status) : undefined),
    message: String(err.message ?? "upstream error").slice(0, 240),
  };
}

let probeCache: { at: number; result: OpenAIProbeResult } | null = null;
const PROBE_TTL_MS = 60_000;

/** Lightweight upstream check — surfaces auth/model/billing errors on /api/healthz. */
export async function probeOpenAI(): Promise<OpenAIProbeResult> {
  if (probeCache && Date.now() - probeCache.at < PROBE_TTL_MS) {
    return probeCache.result;
  }
  const config = resolveOpenAIConfig();
  if ("error" in config) {
    const result: OpenAIProbeResult = {
      ok: false,
      model: "",
      provider: "openai",
      message: config.error,
    };
    probeCache = { at: Date.now(), result };
    return result;
  }
  const { default: OpenAI } = await import("openai");
  const client = new OpenAI({
    apiKey: config.apiKey,
    baseURL: config.baseURL,
    timeout: 90_000,
  });
  const tokenLimit = chatTokenLimit(config);
  const reasoning = chatReasoningEffort(config);
  const pingMessages = [{ role: "user" as const, content: "ping" }];
  try {
    if (chatUsesStreaming(config)) {
      const stream = await client.chat.completions.create({
        model: config.model,
        ...tokenLimit,
        messages: pingMessages,
        ...(reasoning ? { reasoning_effort: reasoning } : {}),
        stream: true,
        max_tokens: 5,
      });
      for await (const chunk of stream) {
        if (chunk.choices[0]?.delta?.content) break;
      }
    } else {
      await client.chat.completions.create({
        model: config.model,
        max_tokens: 5,
        messages: pingMessages,
        stream: false,
      });
    }
    const result: OpenAIProbeResult = {
      ok: true,
      model: config.model,
      provider: config.provider,
    };
    probeCache = { at: Date.now(), result };
    return result;
  } catch (e) {
    const { code, message } = formatUpstreamError(e);
    const result: OpenAIProbeResult = {
      ok: false,
      model: config.model,
      provider: config.provider,
      code,
      message,
    };
    probeCache = { at: Date.now(), result };
    return result;
  }
}

let chatProbeCache: { at: number; result: OpenAIProbeResult } | null = null;

/**
 * Coach-sized upstream probe — uses the same completion params as /api/chat
 * with a system message padded to the real Coach prompt size so healthz catches
 * context-length / reasoning_effort / model mismatches the tiny ping misses.
 */
export async function probeOpenAIChat(): Promise<OpenAIProbeResult> {
  if (chatProbeCache && Date.now() - chatProbeCache.at < PROBE_TTL_MS) {
    return chatProbeCache.result;
  }
  const config = resolveOpenAIConfig();
  if ("error" in config) {
    const result: OpenAIProbeResult = {
      ok: false,
      model: "",
      provider: "openai",
      message: config.error,
    };
    chatProbeCache = { at: Date.now(), result };
    return result;
  }
  const { default: OpenAI } = await import("openai");
  const client = new OpenAI({
    apiKey: config.apiKey,
    baseURL: config.baseURL,
    timeout: 120_000,
  });
  const padLen = Math.max(0, COACH_SYSTEM_PROMPT_CHARS - 64);
  const systemContent =
    "You are Stadium Edge, an AI sports betting analyst. " + "x".repeat(padLen);
  const tokenLimit = chatTokenLimit(config);
  const reasoning = chatReasoningEffort(config);
  try {
    const completion = await client.chat.completions.create({
      model: config.model,
      ...tokenLimit,
      messages: [
        { role: "system", content: systemContent },
        { role: "user", content: "Reply with exactly: ok" },
      ],
      ...(reasoning ? { reasoning_effort: reasoning } : {}),
      stream: false,
      max_tokens: 8,
    });
    const text = completion.choices[0]?.message?.content ?? "";
    if (!text.trim()) {
      throw new Error("empty completion");
    }
    const result: OpenAIProbeResult = {
      ok: true,
      model: config.model,
      provider: config.provider,
    };
    chatProbeCache = { at: Date.now(), result };
    return result;
  } catch (e) {
    const { code, message } = formatUpstreamError(e);
    const result: OpenAIProbeResult = {
      ok: false,
      model: config.model,
      provider: config.provider,
      code,
      message,
    };
    chatProbeCache = { at: Date.now(), result };
    return result;
  }
}
